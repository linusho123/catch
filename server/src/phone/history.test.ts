import { describe, expect, it } from 'vitest'
import { openStore } from '../store.ts'
import { History, type ConversationRecord } from './history.ts'

// The phone's history in the store: what survives a conversation for the
// phone (D76, D100), read back as the history and as a conversation's screen (D98).

const at = (h: number, m: number, day = 17) => new Date(2026, 9, day, h, m).getTime()

function conversation(over: Partial<ConversationRecord> = {}): ConversationRecord {
  return { startedAt: at(9, 5), endedAt: at(9, 30), names: ['Dev'], you: [], owed: [], kept: false, ...over }
}

function setup() {
  const store = openStore(':memory:')
  return { store, history: new History(store) }
}

describe('the phone history', () => {
  it('keeps nothing of a conversation that produced neither a promise nor a keep (D76, D100)', () => {
    const { store, history } = setup()
    expect(history.record('w', conversation({ names: ['Priya', 'Marcus'] }))).toBeUndefined()
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM conversations').get()).toEqual({ n: 0 })
    expect(history.list('w')).toEqual({ open: 0, conversations: [] })
  })

  it('keeps a conversation with a promise, one owed, or a keep', () => {
    const { history } = setup()
    expect(history.record('w', conversation({ you: ['Send Dev the deck tonight'] }))).toBeTypeOf('number')
    expect(history.record('w', conversation({ owed: ['Dev sends the agenda'] }))).toBeTypeOf('number')
    expect(history.record('w', conversation({ kept: true }))).toBeTypeOf('number')
    expect(history.list('w').conversations).toHaveLength(3)
  })

  it('lists newest first, each with its names, time, open count and kept mark, and the total open', () => {
    const { history } = setup()
    history.record('w', conversation({ startedAt: at(9, 5), names: ['Dev'], you: ['Send Dev the deck tonight', 'Introduce Dev to Sam'] }))
    history.record('w', conversation({ startedAt: at(14, 10), names: [], you: ['Call the venue'], owed: ['Ana sends the slides'] }))
    history.record('w', conversation({ startedAt: at(16, 0, 16), names: ['Ana'], kept: true }))
    const { open, conversations } = history.list('w')
    expect(conversations.map((c) => [c.startedAt, c.names, c.open, c.kept])).toEqual([
      [at(14, 10), [], 2, false],
      [at(9, 5), ['Dev'], 2, false],
      [at(16, 0, 16), ['Ana'], 0, true],
    ])
    expect(open).toBe(4)
  })

  it('counts a done promise as no longer open', () => {
    const { store, history } = setup()
    const id = history.record('w', conversation({ you: ['Send Dev the deck tonight', 'Introduce Dev to Sam'] }))!
    store.db.prepare("UPDATE promises SET done = 1 WHERE conversation_id = ? AND text = 'Introduce Dev to Sam'").run(id)
    expect(history.list('w').conversations[0]!.open).toBe(1)
    expect(history.conversation('w', id)!.you.map((p) => [p.text, p.done])).toEqual([
      ['Send Dev the deck tonight', false],
      ['Introduce Dev to Sam', true],
    ])
  })

  it("gives a conversation's screen with YOU and OWED TO YOU in the order made, every promise in full", () => {
    const { history } = setup()
    const you = ['One', 'Two', 'Three', 'Four', 'Five']
    const id = history.record('w', conversation({ names: ['Dev'], you, owed: ['Dev sends the agenda', 'Dev books the room'] }))!
    const screen = history.conversation('w', id)!
    expect(screen).toMatchObject({ id, startedAt: at(9, 5), endedAt: at(9, 30), names: ['Dev'], kept: false })
    expect(screen.you.map((p) => p.text)).toEqual(you)
    expect(screen.owed.map((p) => p.text)).toEqual(['Dev sends the agenda', 'Dev books the room'])
  })

  it("keeps each wearer's conversations to that wearer (D79)", () => {
    const { history } = setup()
    const mine = history.record('me', conversation({ you: ['Mine'] }))!
    const theirs = history.record('them', conversation({ you: ['Theirs'] }))!
    expect(history.list('me').conversations.map((c) => c.id)).toEqual([mine])
    expect(history.conversation('me', theirs)).toBeUndefined()
    expect(history.conversation('me', 999)).toBeUndefined()
  })

  it('opens on a store that already has its tables', () => {
    const { store, history } = setup()
    history.record('w', conversation({ you: ['Kept across a reopen'] }))
    expect(new History(store).list('w').conversations).toHaveLength(1)
  })
})
