import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VirtualClock } from '../../test/harness/clock.ts'
import { Outbox, type Notifier, type PhoneNotification } from './notify.ts'
import { StoredOutbox } from './notify-store.ts'
import { openStore } from './store.ts'

// The outbox's table on a real SQLite file (P9, D114), against a delete (D134):
// a notification's number is never given twice, so a send that answers after
// its conversation was deleted can never take a newer notification's stored
// copy with it (head-2).

const newStore = () => openStore(join(mkdtempSync(join(tmpdir(), 'catch-outbox-')), 'catch.db'))
const note = (conversation: number): PhoneNotification => ({ title: 'Catch', body: `Send the deck (${conversation})`, data: { conversation: String(conversation) } })
const settle = () => new Promise((r) => setImmediate(r))

describe('the outbox after a delete (D134, head-2)', () => {
  it('head-2: never gives a notification number twice: not after the newest row is deleted, not after a restart, not after a clean slate', () => {
    const store = newStore()
    const outbox = new StoredOutbox(store)
    const first = outbox.add('w', note(7))
    outbox.removeConversation('w', 7)
    const second = outbox.add('w', note(8))
    expect(second, "a deleted newest row's number is not given to the next").toBeGreaterThan(first)
    outbox.remove(second)
    const path = store.path
    store.close()
    const reopened = openStore(path)
    const third = new StoredOutbox(reopened).add('w', note(9))
    expect(third, 'nor after a restart').toBeGreaterThan(second)
    new StoredOutbox(reopened).clear()
    expect(new StoredOutbox(reopened).add('w', note(10)), 'nor after the clean slate').toBeGreaterThan(third)
    reopened.close()
  })

  it("head-2: a send that answers after its conversation was deleted leaves a newer conversation's waiting notification in the store", async () => {
    const store = newStore()
    const stored = new StoredOutbox(store)
    const answers: ((taken: boolean) => void)[] = []
    const held: Notifier = { send: () => new Promise((resolve) => answers.push(resolve)) }
    const outbox = new Outbox(held, new VirtualClock(1), stored)
    outbox.enqueue('w', note(7))
    await settle()
    expect(answers, "conversation 7's notification is on its way to the phone").toHaveLength(1)
    // Conversation 7 is deleted on the phone page as its notification is in flight.
    stored.removeConversation('w', 7)
    outbox.dropConversation('w', 7)
    outbox.enqueue('w', note(8))
    answers.shift()!(true)
    await settle()
    expect(
      stored.all().map((r) => r.notification.data?.conversation),
      "conversation 8's notification keeps its stored copy, so a restart still sends it (P9)",
    ).toEqual(['8'])
    outbox.close()
    store.close()
  })

  it("head-2: a dropped notification the phone takes late removes no store row (only one still queued is removed), whatever its number", async () => {
    const removed: number[] = []
    const answers: ((taken: boolean) => void)[] = []
    const held: Notifier = { send: () => new Promise((resolve) => answers.push(resolve)) }
    // A store that, like SQLite without a high-water mark, gives a freed number again.
    const outbox = new Outbox(held, new VirtualClock(1), {
      add: () => 1,
      remove: (id) => void removed.push(id),
      all: () => [],
      clear: () => {},
    })
    outbox.enqueue('w', note(7))
    await settle()
    outbox.dropConversation('w', 7)
    outbox.enqueue('w', note(8))
    answers.shift()!(true)
    await settle()
    expect(removed, 'the dropped one removed nothing; the newer one, given the same number, is still waiting').toEqual([])
    expect(outbox.waiting).toBe(1)
    answers.shift()!(true)
    await settle()
    expect(removed, 'the newer one leaves the store once its phone takes it').toEqual([1])
    outbox.close()
  })
})
