import { existsSync, readFileSync } from 'node:fs'
import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { NOTIFY_RETRY_MS } from '../../server/src/notify.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { History } from '../../server/src/phone/history.ts'
import type { Store } from '../../server/src/store.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { linesOf, type Captured } from '../harness/notifications.ts'
import { isHistory, openPhone, rowsOn, type PhoneScreen } from '../harness/phone.ts'
import { find, rows, tables } from '../harness/store-reader.ts'
import {
  begin,
  fastForward,
  LINE_MS,
  lineIn,
  linesShown,
  NAME_BOUND_MS,
  namesOn,
  nowSec,
  playTo,
  SLACK_MS,
  startRun,
  tapForPage,
  visible,
  waitFor,
  type LensWorld,
} from './lens-world.ts'

// phone-handoff.feature, the phone page's part (P2b′, D130): the history the
// plugin's own page shows on the phone. "The wearer sees" on the phone reads
// the markup the page wrote into its root, recorded by the harness's stand-in
// (test/harness/phone.ts), after the page fetched it from the server's phone
// API with the shared token; never the page's own state.
//
// Bound now: "A conversation with nothing to keep never appears on the phone",
// on a names-only conversation played through the whole pipeline and ended on
// the glasses. The history outline's iPhone row needs conversations with
// promises (P2a) and a kept one (P4); P4 lifts it, with steps that match only
// the "iPhone app" surface, and the outline stays scenario-scoped wip while its
// website row, deferred by D126, is unbound (operator answer 3). The jogger row
// waits for P4, every website row and the tick-off outlines are cut (D126,
// D130).
//
// The notification scenarios (P2a): "the phone" is the harness's notification
// capture (test/harness/notifications.ts), each notification addressed to one
// account's phone, read as the phone shows it (its lines, title first; the
// first line of the body is the promises), never the server's own record.
// "The team, reading the server" reads the SQLite file directly
// (test/harness/store-reader.ts) and its raw bytes, never the API whose job is
// to delete. Bound in full: D51, D76, D79. Bound in part, with the rest
// unbound and the scenario held in wip: D117 (its owed line is P5's), D28 (its
// "opens in full" needs both owed promises, P5's), D114 (its kept
// conversation and kept notification are P4's).

const V = 'wearer-louder'

// The in-world control (fix round, M1): a conversation with a promise, for the
// same wearer, written into the harness's own store the way the server writes
// one as it ends. Its row on the same drawn screen proves the page read the
// server and the server read the store, so the ended conversation's missing
// row is an earned absence. Its time is an hour before the ended conversation's
// span, and its name is none the ended conversation caught. The harness store
// lives for the whole worker, so the control is removed after the Then.
const CONTROL = { names: ['Zoe'], you: ['Send Zoe the notes'], before: 60 * 60_000 }

function removeConversation(store: Store, id: number): void {
  store.db.prepare('DELETE FROM promises WHERE conversation_id = ?').run(id)
  store.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

interface PhoneWorld extends LensWorld {
  /** The conversation the Given ended: the names it caught, and its span on the clock. */
  ended?: { names: string[]; from: number; to: number }
  /** The control conversation with a promise, seeded before the When: its id in the store and its time. */
  control?: { id: number; at: number }
  phoneScreen?: PhoneScreen
}

const LINE_DONE_S = (NAME_BOUND_MS + LINE_MS + SLACK_MS) / 1000

/** D89: a promise line within three seconds. */
const PROMISE_DONE_S = (3000 + LINE_MS + SLACK_MS) / 1000

/** D92: ten minutes in which the wearer does not speak. */
const QUIET_S = 600

/** The account the harness's glasses are signed in to (D79). */
const ACCOUNT = wearerOf(HARNESS_TOKEN)

/** A summary as a command, the way the phone reads it. */
const asCommand = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The wearer's promises as a list on one line: "A and B", "A, B and C" (D28, D117). */
function expectedLine(summaries: string[]): string {
  const [first, ...rest] = summaries
  const all = [asCommand(first!), ...rest]
  return all.length === 1 ? all[0]! : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`
}

interface HandoffWorld extends PhoneWorld {
  /** The wearer's promises as the lens showed them (`promised · <summary>`), in order. */
  promised?: string[]
  /** The names the conversation caught, as the lens showed them. */
  caught?: string[]
  /** D76: the transcript's words a reader could find, and the conversations in the store before the boundary. */
  distinctive?: string[]
  conversationsBefore?: number
  /** D114: when the phone came back on. */
  backAt?: number
}

/** The lens's lines since the scenario's fixture began: the promise summaries, and the names. */
function lensLines(w: LensWorld): { promised: string[]; names: string[] } {
  const lines = linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text)
  return {
    promised: lines.filter((l) => l.startsWith('promised · ')).map((l) => l.slice('promised · '.length)),
    names: lines.filter((l) => !l.startsWith('promised · ')),
  }
}

/** Plays a fixture to its end and lets every catch line come and go. */
async function playAll(w: HandoffWorld, fixture: string): Promise<void> {
  const run = await startRun(w, fixture, 0)
  await playTo(w, run.fixture.words.at(-1)!.end + PROMISE_DONE_S)
  const { promised, names } = lensLines(w)
  w.promised = promised
  w.caught = names
}

/** LONG_PRESS_EVENT (9), then its release (10), from the glasses' temple (D52). */
async function longPress(w: LensWorld): Promise<void> {
  const h = w.h!
  w.pressedAt = h.clock.now()
  h.host.push('sysEvent', { eventType: 9, eventSource: 1 })
  await playTo(w, nowSec(w) + 0.2)
  h.host.push('sysEvent', { eventType: 10, eventSource: 1 })
  await playTo(w, nowSec(w) + SLACK_MS / 1000)
}

/** The one notification the account holder's phone shows, and nothing on any other phone. */
function theNotification(w: LensWorld): Captured {
  const h = w.h!
  const got = h.notifications.phone(ACCOUNT)
  expect(got.map((c) => linesOf(c.notification)), "the account holder's phone shows one notification").toHaveLength(1)
  return got[0]!
}

/** The first line of a notification's body: the wearer's promises (D28). */
const promiseLineOf = (c: Captured) => linesOf(c.notification)[1]

/** Words of what was said, four letters or more, that are not in `summary`: each would be a piece of the transcript. */
function distinctiveWords(w: LensWorld, summary: string): string[] {
  const keep = new Set(summary.toLowerCase().split(/\s+/))
  const words = w.run!.fixture.words.map((wd) => wd.text.replace(/[^\p{L}']/gu, '')).filter((t) => t.replace(/'/g, '').length >= 4)
  return [...new Set(words.filter((t) => !keep.has(t.toLowerCase())))]
}

const phoneHandoff: Definer<HandoffWorld> = (reg) => {
  // D117 (the owed second line is P5's and stays unbound).
  reg.define(/^in a conversation with Dev the wearer said "([^"]+)" and "([^"]+)"$/, async (w, firstArg, secondArg) => {
    await begin(w)
    const run = await startRun(w, `handoff.${V}`, 0)
    const first = lineIn(run, `${String(firstArg)}.`)
    const second = lineIn(run, `${String(secondArg)}.`, first.end)
    for (const line of [first, second]) expect(line.words.every((wd) => wd.role === 'wearer'), 'the wearer says it').toBe(true)
    await playTo(w, second.end + PROMISE_DONE_S)
    const { promised, names } = lensLines(w)
    expect(names, 'the conversation is with Dev, whose name was caught').toEqual(['Dev'])
    w.promised = promised
    w.caught = names
  })

  reg.define(/^Dev said "([^"]+)"$/, async (w, devArg) => {
    const run = w.run!
    const said = lineIn(run, `${String(devArg)}.`)
    expect(said.words.every((wd) => wd.role === 'other'), 'Dev says it').toBe(true)
    await playTo(w, said.end + PROMISE_DONE_S)
  })

  reg.define(/^ten minutes pass in which the wearer does not speak$/, async (w) => {
    const run = w.run!
    const now = nowSec(w)
    const last = run.fixture.words.filter((wd) => wd.role === 'wearer' && wd.end <= now).at(-1)!
    expect(last, 'the wearer has spoken in this conversation').toBeDefined()
    const next = run.fixture.words.find((wd) => wd.role === 'wearer' && wd.start > last.end)
    expect(next === undefined || next.start > last.end + QUIET_S, 'the wearer says nothing for ten minutes').toBe(true)
    w.quietFrom = run.at(last.end)
    await fastForward(w, last.end + QUIET_S + SLACK_MS / 1000)
  })

  reg.define(/^the phone shows one notification reading "([^"]+)"$/, (w, textArg) => {
    const n = theNotification(w)
    expect(promiseLineOf(n), 'the notification reads').toBe(String(textArg))
    // The promises the lens showed, as commands: the notification is what the conversation held.
    expect(String(textArg)).toBe(expectedLine(w.promised!))
  })

  reg.define(/^a tap on the glasses shows no names from that conversation$/, async (w) => {
    const page = await tapForPage(w)
    expect(w.caught!.length, 'the conversation caught a name').toBeGreaterThan(0)
    for (const name of w.caught!) expect(namesOn(page), `"${name}" is still held`).not.toContain(name)
    expect(visible(page).map((c) => c.containerName), 'nothing from the old conversation is held').toEqual(['empty'])
  })

  // D28 ("opens in full" needs the two owed promises, P5's, and stays unbound).
  reg.define(/^in a conversation with Dev the wearer made five promises and Dev made two$/, async (w) => {
    await begin(w)
    await playAll(w, `long-list.${V}`)
    expect(w.caught, 'the conversation is with Dev').toEqual(['Dev'])
    expect(w.promised, 'the wearer made five promises, each seen on the lens').toHaveLength(5)
    const devs = w.run!.fixture.lines.filter((l) => l.who === 'Dev' && /\bI'll\b/.test(l.text))
    expect(devs, 'Dev made two').toHaveLength(2)
  })

  reg.define(/^the conversation ends$/, async (w) => {
    await longPress(w)
  })

  reg.define(/^the phone shows the notification cut off with an ellipsis$/, (w) => {
    const line = promiseLineOf(theNotification(w))!
    const full = expectedLine(w.promised!)
    expect(line.endsWith('…'), `"${line}" is not cut off with an ellipsis`).toBe(true)
    expect(line.length, 'the cut line is shorter than the list').toBeLessThan(full.length)
    expect(full.startsWith(line.slice(0, -1)), `"${line}" is not the start of "${full}"`).toBe(true)
  })

  // D51
  reg.define(/^in a conversation Priya and Marcus introduced themselves and nobody promised anything in either direction$/, async (w) => {
    await begin(w)
    await playAll(w, `names-only.${V}`)
    expect(w.caught, 'the names caught').toEqual(['Priya', 'Marcus'])
    expect(w.promised, 'nothing promised').toEqual([])
    for (const l of w.run!.fixture.lines) expect(l.text, `"${l.text}" promises something`).not.toMatch(/\b(i'll|i will|i promise|let me|i'm going to)\b/i)
  })

  reg.define(/^the phone shows no notification$/, (w) => {
    const h = w.h!
    expect(h.notifications.received, 'a phone received a notification').toEqual([])
    expect(h.notifications.refused, 'a notification was even tried').toEqual([])
  })

  reg.define(/^a tap on the glasses shows "([^"]+)"$/, async (w, textArg) => {
    const page = await tapForPage(w)
    expect(visible(page).map((c) => c.content)).toEqual([String(textArg)])
  })

  // D114, the promise half (the kept conversation, its Given, and its notification are P4's and stay unbound).
  reg.define(/^the phone comes back on three hours later$/, async (w) => {
    const h = w.h!
    expect(h.notifications.reachable, 'the phone was off').toBe(false)
    expect(h.notifications.received, 'nothing reached the phone while it was off').toEqual([])
    expect(h.notifications.refused.length, 'the server tried the phone while it was off').toBeGreaterThan(0)
    const at = h.notifications.refused[0]!.at + 3 * 60 * 60_000
    h.clock.advance(Math.max(0, at - h.clock.now()))
    h.notifications.reachable = true
    w.backAt = h.clock.now()
  })

  reg.define(/^the phone shows the promise notification then, with every promise intact$/, async (w) => {
    const h = w.h!
    await waitFor(w, () => (h.notifications.phone(ACCOUNT).length > 0 ? true : undefined), NOTIFY_RETRY_MS + SLACK_MS)
    const n = theNotification(w)
    expect(n.at - w.backAt!, 'it came once the phone was back on').toBeGreaterThanOrEqual(0)
    expect(n.at - w.backAt!, 'it came then').toBeLessThanOrEqual(NOTIFY_RETRY_MS + SLACK_MS)
    expect(promiseLineOf(n), 'every promise intact').toBe(expectedLine(w.promised!))
  })

  // D76
  reg.define(/^an unkept conversation with one promise has been running$/, async (w) => {
    const h = await begin(w)
    w.conversationsBefore = rows(h.dbPath, 'conversations').length
    await playAll(w, `one-promise.${V}`)
    expect(w.promised, 'one promise, seen on the lens').toEqual(['book the room for Thursday'])
    expect(w.caught, 'nobody named').toEqual([])
    // While it runs, its transcript is on the server: the deletion that follows is of something that was there.
    w.distinctive = distinctiveWords(w, w.promised![0]!)
    expect(w.distinctive.length).toBeGreaterThan(3)
    for (const word of w.distinctive) expect(find(h.dbPath, word).length, `"${word}" is not in the store while the conversation runs`).toBeGreaterThan(0)
  })

  reg.define(/^the team, reading the server, finds no transcript and no audio of that conversation$/, (w) => {
    const h = w.h!
    // Through SQLite, every table, every value ...
    for (const word of w.distinctive!) expect(find(h.dbPath, word), `"${word}" of the transcript survives in the store`).toEqual([])
    for (const line of w.run!.fixture.lines) expect(find(h.dbPath, line.text), `"${line.text}" survives in the store`).toEqual([])
    // ... and in the file's raw bytes, the write-ahead log's included: a deleted row can linger in a page.
    for (const file of [h.dbPath, `${h.dbPath}-wal`].filter((f) => existsSync(f))) {
      const bytes = readFileSync(file).toString('latin1')
      for (const word of w.distinctive!) expect(bytes.includes(word), `"${word}" survives in the bytes of ${file}`).toBe(false)
    }
    // No audio: nothing binary is stored anywhere.
    for (const table of tables(h.dbPath)) {
      for (const row of rows(h.dbPath, table)) {
        for (const [column, value] of Object.entries(row)) expect(value instanceof Uint8Array, `${table}.${column} holds binary data`).toBe(false)
      }
    }
  })

  reg.define(/^the team finds only the promise summary$/, (w) => {
    const h = w.h!
    const added = rows(h.dbPath, 'conversations').slice(w.conversationsBefore!) as { id: number; names: string }[]
    expect(added.map((c) => c.names), 'one conversation survives, naming nobody').toEqual(['[]'])
    const its = rows(h.dbPath, 'promises').filter((p) => p.conversation_id === added[0]!.id)
    expect(its.map((p) => [p.side, p.text]), 'its promise summary, and nothing else').toEqual([['you', asCommand(w.promised![0]!)]])
  })

  // D79
  reg.define(/^two people take turns wearing one pair of glasses signed in to the wearer's account$/, async (w) => {
    await begin(w)
    // The lens is signed in to the account by its token; two voices at the glasses' mic, one after the other.
    const run = await startRun(w, `shared-pair.${V}`, 0)
    const wearers = [...new Set(run.fixture.lines.filter((l) => l.who === 'wearer' || l.who.startsWith('wearer:')).map((l) => l.who))]
    expect(wearers, 'two people wear the glasses').toEqual(['wearer', 'wearer:Ana'])
    for (const who of wearers) {
      const theirs = lineIn(run, run.fixture.lines.find((l) => l.who === who && /\bI'll\b/.test(l.text))!.text)
      expect(theirs.words.every((wd) => wd.role === 'wearer'), `${who} is the wearer at the mic`).toBe(true)
    }
  })

  reg.define(/^a conversation with promises ends$/, async (w) => {
    await playTo(w, w.run!.fixture.words.at(-1)!.end + PROMISE_DONE_S)
    const { promised } = lensLines(w)
    expect(promised, 'a promise from each of them, seen on the lens').toEqual(['send Dev the deck tonight', 'introduce Dev to Sam'])
    w.promised = promised
    await longPress(w)
  })

  reg.define(/^the account holder's phone shows the notification$/, async (w) => {
    const h = w.h!
    await waitFor(w, () => (h.notifications.phone(ACCOUNT).length > 0 ? true : undefined))
    expect(linesOf(theNotification(w).notification), "both wearers' promises, to the one account, and nothing else").toEqual(['Catch', expectedLine(w.promised!)])
  })

  reg.define(/^no other phone shows it$/, (w) => {
    const h = w.h!
    expect(h.notifications.received.filter((c) => c.to !== ACCOUNT), 'another phone was sent it').toEqual([])
    expect(h.notifications.refused, 'another phone was even tried').toEqual([])
  })

  // D100, D76
  reg.define(/^today a conversation produced neither a promise nor a keep$/, async (w) => {
    const h = await begin(w)
    const run = await startRun(w, `introductions.${V}`, 0)
    const from = w.dotSince!
    // Names, and nothing to keep: nobody promises anything, and nobody keeps it (the keep is P4's gesture; none is made).
    const dana = lineIn(run, 'Dana, nice to meet you.')
    await playTo(w, dana.end + LINE_DONE_S)
    const names = linesShown(h, from, h.clock.now()).map((l) => l.text)
    expect(names, 'the conversation caught its names on the lens').toEqual(['Priya', 'Marcus', 'Dana'])
    for (const l of run.fixture.lines) expect(l.text, `"${l.text}" promises something`).not.toMatch(/\b(i'll|i will|i promise|let me)\b/i)
    // The wearer ends it with a long-press (D52): LONG_PRESS_EVENT (9), then its release (10).
    h.host.push('sysEvent', { eventType: 9, eventSource: 1 })
    await playTo(w, nowSec(w) + 0.2)
    h.host.push('sysEvent', { eventType: 10, eventSource: 1 })
    await playTo(w, nowSec(w) + SLACK_MS / 1000)
    const to = h.clock.now()
    // It has ended, seen on the glasses: the next tap finds nothing held from it.
    const page = await tapForPage(w)
    expect(visible(page).map((c) => c.containerName), 'the conversation is over: nothing of it is held').toEqual(['empty'])
    w.ended = { names, from, to }
    // The control, before the When: a conversation with a promise, for the same wearer, outside this one's span.
    const at = Math.round(from - CONTROL.before)
    const id = new History(h.server.store).record(wearerOf(HARNESS_TOKEN), { startedAt: at, endedAt: at + 60_000, names: CONTROL.names, you: CONTROL.you, owed: [], kept: false })
    expect(id, 'the control conversation was written').toBeTypeOf('number')
    w.control = { id: id!, at }
  })

  reg.define(/^the wearer opens Catch on the phone$/, async (w) => {
    const h = w.h!
    const { phone, record } = await openPhone({ server: h.server.url, token: HARNESS_TOKEN, clock: h.clock })
    await phone.home()
    w.phoneScreen = record.screens.at(-1)
    expect(w.phoneScreen, 'the phone page drew nothing').toBeDefined()
  })

  reg.define(/^the wearer sees no row for that conversation$/, (w) => {
    const control = w.control!
    try {
      const { markup } = w.phoneScreen!
      expect(isHistory(markup), `the phone shows something other than the history: ${markup}`).toBe(true)
      const { names, from, to } = w.ended!
      const rows = rowsOn(markup)
      // The control row is on this same screen: the page read the server, and the server read the store.
      const controls = rows.filter((r) => r.conversation === String(control.id))
      expect(
        controls.map((r) => [r.names, r.at, r.open]),
        `the control conversation is not on the phone's history: ${markup}`,
      ).toEqual([[CONTROL.names.join(', '), control.at, `${CONTROL.you.length} open`]])
      const its = rows.filter((r) => names.some((n) => r.names.split(', ').includes(n)) || (r.at >= from - 1000 && r.at <= to))
      expect(its, `rows for the ended conversation: ${JSON.stringify(its)}`).toEqual([])
    } finally {
      removeConversation(w.h!.server.store, control.id)
    }
  })
}

export default phoneHandoff
