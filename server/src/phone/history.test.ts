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
      [at(14, 10), [], 1, false],
      [at(9, 5), ['Dev'], 2, false],
      [at(16, 0, 16), ['Ana'], 0, true],
    ])
    expect(open).toBe(3)
  })

  // Operator answer 2 (D100): the open count, on each row and in the header,
  // is the wearer's own promises (YOU) not yet done. OWED TO YOU promises are
  // other people's to keep and never stand between a conversation and "all done".
  it("counts only the wearer's own promises as open, never the ones owed to the wearer", () => {
    const { history } = setup()
    history.record('w', conversation({ startedAt: at(9, 5), you: ['Send Dev the deck tonight'], owed: ['Dev sends the agenda', 'Dev books the room'] }))
    history.record('w', conversation({ startedAt: at(14, 10), names: ['Ana'], owed: ['Ana sends the slides'] }))
    const { open, conversations } = history.list('w')
    expect(conversations.map((c) => [c.names, c.open])).toEqual([
      [['Ana'], 0],
      [['Dev'], 1],
    ])
    expect(open).toBe(1)
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

// D134: a conversation deleted from its screen on the phone page goes
// everywhere: its row, its names, its promises of both kinds, their ticks and
// its jogger, inside one transaction with whatever else the server deletes
// with it (the outbox's waiting notifications, app.ts). Read from the store's
// tables directly; the file's bytes are read in test/integration/phone-delete.test.ts.
describe('deleting a conversation (D134)', () => {
  const count = (store: ReturnType<typeof setup>['store'], sql: string, ...args: (string | number)[]) =>
    (store.db.prepare(sql).get(...args) as { n: number }).n

  it('removes its row, its promises (ticked or not, both kinds) and its jogger, and nothing of any other conversation', () => {
    const { store, history } = setup()
    const dev = history.record('w', conversation({ names: ['Dev'], you: ['Send Dev the deck tonight', 'Introduce Dev to Sam'], owed: ['Dev sends the agenda'], kept: true }))!
    history.recordJogger(dev, ['Dev works on **diffusion models**.'])
    history.tick('w', history.conversation('w', dev)!.you[0]!.id)
    const ana = history.record('w', conversation({ startedAt: at(14, 10), names: ['Ana'], you: ['Call Ana'], kept: true }))!
    history.recordJogger(ana, ['Ana runs the lab.'])
    expect(history.delete('w', dev)).toBe('deleted')
    expect(count(store, 'SELECT COUNT(*) AS n FROM conversations WHERE id = ?', dev)).toBe(0)
    expect(count(store, 'SELECT COUNT(*) AS n FROM promises WHERE conversation_id = ?', dev)).toBe(0)
    expect(count(store, 'SELECT COUNT(*) AS n FROM joggers WHERE conversation_id = ?', dev)).toBe(0)
    expect(history.conversation('w', dev)).toBeUndefined()
    expect(history.jogger('w', dev)).toBeUndefined()
    expect(history.list('w')).toEqual({ open: 1, conversations: [{ id: ana, startedAt: at(14, 10), names: ['Ana'], open: 1, kept: true }] })
    expect(history.jogger('w', ana)!.bullets).toEqual(['Ana runs the lab.'])
  })

  it("refuses another wearer's conversation and changes nothing (D79)", () => {
    const { store, history } = setup()
    const theirs = history.record('them', conversation({ you: ['Theirs'], kept: true }))!
    history.recordJogger(theirs, ['Their bullet.'])
    let also = 0
    expect(history.delete('me', theirs, () => void also++)).toBe('refused')
    expect(also, 'nothing else is deleted with it').toBe(0)
    expect(history.conversation('them', theirs)!.you.map((p) => p.text)).toEqual(['Theirs'])
    expect(history.jogger('them', theirs)!.bullets).toEqual(['Their bullet.'])
    expect(count(store, 'SELECT COUNT(*) AS n FROM promises')).toBe(1)
  })

  it('is idempotent: a conversation already deleted, or one that never was, is quietly gone', () => {
    const { history } = setup()
    const id = history.record('w', conversation({ you: ['Once'] }))!
    expect(history.delete('w', id)).toBe('deleted')
    let also = 0
    expect(history.delete('w', id, () => void also++)).toBe('gone')
    expect(history.delete('w', 999)).toBe('gone')
    expect(also).toBe(0)
  })

  it('deletes everything handed to it in the same transaction: a failure there leaves the conversation whole', () => {
    const { history } = setup()
    const id = history.record('w', conversation({ you: ['Stays'] }))!
    expect(() =>
      history.delete('w', id, () => {
        throw new Error('the outbox could not be read')
      }),
    ).toThrow('the outbox could not be read')
    expect(history.conversation('w', id)!.you.map((p) => p.text)).toEqual(['Stays'])
  })

  // A repeated delete (a retried request) must never take a newer conversation
  // that took the deleted one's number, and a tick or a notification naming a
  // deleted promise or conversation must never reach a newer one.
  it('never gives a deleted conversation\'s number, or its promises\' numbers, to a later one, across a reopen', () => {
    const { store, history } = setup()
    history.record('w', conversation({ you: ['First'] }))
    const newest = history.record('w', conversation({ you: ['Second', 'Third'] }))!
    const promiseIds = history.conversation('w', newest)!.you.map((p) => p.id)
    expect(history.delete('w', newest)).toBe('deleted')
    const later = new History(store).record('w', conversation({ you: ['Fourth'] }))!
    expect(later).toBeGreaterThan(newest)
    expect(history.conversation('w', later)!.you[0]!.id).toBeGreaterThan(Math.max(...promiseIds))
    expect(history.delete('w', newest), 'the retried delete').toBe('gone')
    expect(history.conversation('w', later)!.you.map((p) => p.text)).toEqual(['Fourth'])
  })

  it('never reuses a number from a store written before deletes existed (no high-water mark yet)', () => {
    const { store, history } = setup()
    const id = history.record('w', conversation({ you: ['Old'] }))!
    store.db.exec("DELETE FROM meta WHERE key LIKE '%seq%'")
    expect(history.delete('w', id)).toBe('deleted')
    expect(history.record('w', conversation({ you: ['New'] }))!).toBeGreaterThan(id)
  })
})
