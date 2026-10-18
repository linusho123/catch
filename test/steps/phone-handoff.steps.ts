import { existsSync, readFileSync } from 'node:fs'
import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { NOTIFY_RETRY_MS } from '../../server/src/notify.ts'
import { wearerOf } from '../../server/src/phone/api.ts'
import { History } from '../../server/src/phone/history.ts'
import type { Store } from '../../server/src/store.ts'
import { HARNESS_TOKEN, OTHER_HARNESS_TOKEN } from '../harness/index.ts'
import { linesOf, type Captured } from '../harness/notifications.ts'
import { isHistory, joggerLinkOn, openPhone, rowsOn, sectionsOn, type PhoneScreen } from '../harness/phone.ts'
import { find, rows, tables } from '../harness/store-reader.ts'
import {
  expectFlat,
  expectInOrder,
  expectTermsBold,
  heard,
  isKeptNotification,
  KEEP_PROMPT,
  keepNow,
  keptWithin,
  longPressNow,
  openKept,
  phoneShows,
  readJogger,
  startSkipping,
  storedJogger,
  type JoggerWorld,
} from './jogger-world.ts'
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
  promisesOn,
  screens,
  SLACK_MS,
  startRun,
  swipeDown,
  tap,
  tapForPage,
  untilDot,
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
// to delete. Bound in full: D51, D76, D79, and from P4 D114 (the kept
// conversation's notification waits with the promise one). P5 binds the rest
// of D117 (the notification's second line, "Owed to you: Dev sends the
// agenda") and of D28 ("opens in full": the notification opened on the phone
// page, the conversation's screen with every promise of the wearer's under
// YOU and both of Dev's under OWED TO YOU, compared with what the lens held).
//
// P4 binds the iPhone rows of the history and jogger outlines against the
// phone page (D130), with steps that match only the "iPhone app" surface: the
// website rows stay unbound and the outlines in wip (D126). The history is
// played through the whole pipeline, a kept conversation yesterday and two
// with promises today, on a clock set to the day; the jogger is opened
// through the page's own links, history row, conversation screen, "Kept
// conversation ›", and read against the store (jogger-world.ts).

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

/** Another account, with its own glasses and its own phone, signed in for "no other phone shows it" (fix round, test-2). */
const OTHER_ACCOUNT = wearerOf(OTHER_HARNESS_TOKEN)

/** A summary as a command, the way the phone reads it. */
const asCommand = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The wearer's promises as a list on one line: "A and B", "A, B and C" (D28, D117). */
function expectedLine(summaries: string[]): string {
  const [first, ...rest] = summaries
  const all = [asCommand(first!), ...rest]
  return all.length === 1 ? all[0]! : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`
}

interface HandoffWorld extends PhoneWorld, JoggerWorld {
  /** The wearer's promises as the lens showed them (`promised · <summary>`), in order. */
  promised?: string[]
  /** The promises owed to the wearer as the lens showed them (`Dev promised · <action>`), and as its promises page held them (`owed: Dev sends …`), P5. */
  owedShown?: string[]
  owedHeld?: string[]
  /** The names the conversation caught, as the lens showed them. */
  caught?: string[]
  /** D76: the transcript's words a reader could find, and the conversations in the store before the boundary. */
  distinctive?: string[]
  conversationsBefore?: number
  /** D114: when the phone came back on. */
  backAt?: number
  /** D100: the history's three conversations as the lens caught them: names, promises, and the clock at their start. */
  day?: { names: string[]; promised: string[]; at: number }[]
}

/** The lens's lines since the scenario's fixture began: the wearer's promise summaries, the owed lines (`Dev promised · …`, P5), and the names. */
function lensLines(w: LensWorld): { promised: string[]; owed: string[]; names: string[] } {
  const lines = linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text)
  return {
    promised: lines.filter((l) => l.startsWith('promised · ')).map((l) => l.slice('promised · '.length)),
    owed: lines.filter((l) => l.includes(' promised · ')),
    names: lines.filter((l) => !l.includes('promised · ')),
  }
}

/** Plays a fixture to its end and lets every catch line come and go. */
async function playAll(w: HandoffWorld, fixture: string): Promise<void> {
  const run = await startRun(w, fixture, 0)
  await playTo(w, run.fixture.words.at(-1)!.end + PROMISE_DONE_S)
  const { promised, owed, names } = lensLines(w)
  w.promised = promised
  w.owedShown = owed
  w.caught = names
}

/** A tap and a swipe down on the lens: the owed lines its promises page holds (P5), as "who does what"; then a tap puts the page away. */
async function owedOnLens(w: HandoffWorld): Promise<string[]> {
  const h = w.h!
  await untilDot(w)
  const names = await tapForPage(w)
  expect(namesOn(names), 'the names page').toEqual(w.caught)
  const held = promisesOn(await swipeDown(w))
  expect(held.slice(0, w.promised!.length), "the wearer's own, first").toEqual(w.promised)
  const at = tap(w)
  await waitFor(w, () => (screens(h).some((s) => s.at >= at && visible(s).length === 1 && visible(s)[0]!.content === '•') ? true : undefined))
  return held.slice(w.promised!.length).map((l) => {
    expect(l.startsWith('owed: '), `"${l}" after the wearer's own is not an owed line`).toBe(true)
    return l.slice('owed: '.length)
  })
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

/** The kept conversation's notification apart: the one promise notification the account holder's phone shows. */
function thePromiseNotification(w: LensWorld): Captured {
  const { promises } = phoneShows(w)
  expect(promises.map((c) => linesOf(c.notification)), "the account holder's phone shows one promise notification").toHaveLength(1)
  return promises[0]!
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
    expect(promised, "the wearer's two promises, each seen on the lens").toHaveLength(2)
    w.promised = promised
    w.caught = names
  })

  reg.define(/^Dev said "([^"]+)"$/, async (w, devArg) => {
    const run = w.run!
    const said = lineIn(run, `${String(devArg)}.`)
    expect(said.words.every((wd) => wd.role === 'other'), 'Dev says it').toBe(true)
    await playTo(w, said.end + PROMISE_DONE_S)
    // P5: Dev's promise, seen on the lens as his and held in the owed list.
    const { promised, owed } = lensLines(w)
    expect(promised, "the wearer's promises").toEqual(w.promised)
    expect(owed, "Dev's promise, seen on the lens").toEqual(['Dev promised · send the agenda'])
    w.owedShown = owed
  })

  reg.define(/^the phone shows a second line in it reading "([^"]+)"$/, (w, lineArg) => {
    const lines = linesOf(theNotification(w).notification)
    expect(lines, 'the notification: its title, the wearer\'s promises, and the owed line').toHaveLength(3)
    expect(lines[2], 'its second line').toBe(String(lineArg))
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

  // D28, with "opens in full" (P5: both owed promises on the phone page's OWED TO YOU).
  reg.define(/^in a conversation with Dev the wearer made five promises and Dev made two$/, async (w) => {
    await begin(w)
    await playAll(w, `long-list.${V}`)
    expect(w.caught, 'the conversation is with Dev').toEqual(['Dev'])
    expect(w.promised, 'the wearer made five promises, each seen on the lens').toHaveLength(5)
    const devs = w.run!.fixture.lines.filter((l) => l.who === 'Dev' && /\bI'll\b/.test(l.text))
    expect(devs, 'Dev made two').toHaveLength(2)
    for (const line of devs) expect(lineIn(w.run!, line.text).words.every((wd) => wd.role === 'other'), 'Dev says it').toBe(true)
    expect(w.owedShown, "Dev's two, each seen on the lens as his").toHaveLength(2)
    for (const l of w.owedShown!) expect(l.startsWith('Dev promised · '), l).toBe(true)
    w.owedHeld = await owedOnLens(w)
    expect(w.owedHeld, "Dev's two, held on the lens's promises page").toHaveLength(2)
  })

  reg.define(/^opening the notification shows all five of the wearer's promises and both owed promises$/, async (w) => {
    const h = w.h!
    const n = theNotification(w)
    const { phone, record } = await openPhone({ server: h.server.url, token: HARNESS_TOKEN, clock: h.clock })
    await phone.openNotification(n.notification.data)
    const markup = record.screens.at(-1)!.markup
    const sections = sectionsOn(markup).map((sec) => [sec.title, sec.promises.map((p) => p.text)])
    // Every promise in full, whatever the notification cut: the wearer's as commands, Dev's as the lens held them.
    expect(sections, "the conversation's screen").toEqual([
      ['YOU', w.promised!.map(asCommand)],
      ['OWED TO YOU', w.owedHeld!.map(asCommand)],
    ])
    expect(sections[0]![1], 'all five').toHaveLength(5)
    expect(sections[1]![1], 'both owed').toHaveLength(2)
    expect(markup, 'the screen is that conversation, with Dev').toContain('<h1 class="names">Dev</h1>')
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

  // D114: a kept conversation with promises ends while the phone is off (P4 keeps it).
  reg.define(/^a kept conversation with held promises has ended while the wearer's phone is off$/, async (w) => {
    const h = await begin(w)
    const run = await startSkipping(w, `handoff.${V}`, 4)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'Dev was caught').toEqual(['Dev'])
    await keepNow(w)
    h.notifications.reachable = false
    await playTo(w, run.fixture.words.at(-1)!.end + PROMISE_DONE_S)
    const { promised } = lensLines(w)
    expect(promised, 'the promises held, seen on the lens').toEqual(['send Dev the deck tonight', 'introduce Dev to Sam'])
    w.promised = promised
    await longPressNow(w)
    // It has ended, kept, and its jogger is written (read from the store): both notifications are due. The
    // server has tried the phone with the first, and the phone was off; nothing reached it.
    const keptRow = () => (rows(h.dbPath, 'conversations') as { id: number; kept: number }[]).find((c) => c.kept === 1)
    await waitFor(w, () => (keptRow() && storedJogger(w, keptRow()!.id) ? true : undefined), 30_000)
    expect(storedJogger(w, keptRow()?.id ?? -1)?.length, 'the kept conversation\'s jogger is written').toBeGreaterThan(0)
    expect(h.notifications.refused.some((c) => !isKeptNotification(c)), 'the promise notification was due, and the phone was off').toBe(true)
    expect(h.notifications.received, 'nothing reached the phone').toEqual([])
  })

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
    await waitFor(w, () => (phoneShows(w).promises.length > 0 ? true : undefined), NOTIFY_RETRY_MS + SLACK_MS)
    const n = thePromiseNotification(w)
    expect(n.at - w.backAt!, 'it came once the phone was back on').toBeGreaterThanOrEqual(0)
    expect(n.at - w.backAt!, 'it came then').toBeLessThanOrEqual(NOTIFY_RETRY_MS + SLACK_MS)
    expect(promiseLineOf(n), 'every promise intact').toBe(expectedLine(w.promised!))
    // Dev's, too (P5): the owed line under it.
    expect(linesOf(n.notification)[2], 'the owed promise intact').toBe('Owed to you: Dev sends the agenda')
  })

  reg.define(/^the phone shows the kept-conversation notification then, with the jogger intact$/, async (w) => {
    const h = w.h!
    await waitFor(w, () => (phoneShows(w).kept.length > 0 ? true : undefined), NOTIFY_RETRY_MS + SLACK_MS)
    const n = await keptWithin(w, Infinity)
    expect(linesOf(n.notification)).toEqual(['Catch', 'Kept: conversation with Dev'])
    expect(n.at - w.backAt!, 'it came once the phone was back on').toBeGreaterThanOrEqual(0)
    expect(n.at - w.backAt!, 'it came then').toBeLessThanOrEqual(NOTIFY_RETRY_MS + SLACK_MS)
    // Every notification that was due, none dropped and none twice: the promise one, then the kept one.
    expect(h.notifications.phone(ACCOUNT).map((c) => isKeptNotification(c)), 'the phone shows the promise notification, then the kept one').toEqual([false, true])
    // Opened, the jogger is all there: the store's, with the wearer's promises among it.
    const jogger = await openKept(w)
    const bullets = jogger.bullets.map((b) => b.text)
    for (const p of w.promised!) expect(bullets, `the promise "${p}" is in the jogger`).toContain(`You promised: ${p}`)
    expect(bullets.length, 'more than the promises').toBeGreaterThan(w.promised!.length)
  })

  // D99, the iPhone row (the website row is cut, D126): the jogger, opened through the phone page's own links.
  reg.define(/^a kept conversation with Ana has a jogger$/, async (w) => {
    const h = await begin(w)
    const run = await startSkipping(w, `lab-call.${V}`, 7)
    expect(linesShown(h, w.dotSince!, h.clock.now()).map((l) => l.text), 'Ana introduced herself').toEqual(['Ana'])
    await keepNow(w)
    const end = 1500
    const last = run.fixture.words.filter((wd) => wd.end <= end).at(-1)!
    await fastForward(w, last.end + PROMISE_DONE_S)
    await fastForward(w, end)
    w.promised = lensLines(w).promised
    await longPressNow(w)
    await keptWithin(w, 30_000)
  })

  reg.define(/^the wearer opens that jogger on the iPhone app$/, async (w) => {
    const h = w.h!
    const id = w.kept!.notification.data!.conversation!
    const { phone, record } = await openPhone({ server: h.server.url, token: HARNESS_TOKEN, clock: h.clock })
    await phone.home()
    const row = rowsOn(record.innerHTML).find((r) => r.conversation === id)
    expect(row, 'the kept conversation is on the history').toBeDefined()
    expect([row!.names, row!.kept], 'its row: Ana, kept').toEqual(['Ana', true])
    const drawn = record.screens.length
    record.tap('data-conversation', id)
    await waitFor(w, () => (record.screens.length > drawn ? true : undefined))
    expect(joggerLinkOn(record.innerHTML), 'the conversation screen links to the jogger: "Kept conversation ›"').toBe(id)
    const linked = record.screens.length
    record.tap('data-jogger', id)
    await waitFor(w, () => (record.screens.length > linked ? true : undefined))
    readJogger(w, record.innerHTML, Number(id))
  })

  reg.define(/^the wearer sees one flat list of bullets in the order things came up, with the technical terms in bold$/, (w) => {
    const jogger = w.jogger!
    const lines = w.run!.fixture.lines
    expectFlat(jogger, heard(lines), lines.length)
    expectInOrder(jogger, lines, w.promised)
    expectTermsBold(jogger, lines)
  })

  // D100, the iPhone row (the website row is cut, D126): three conversations played through the pipeline.
  reg.define(/^today two conversations produced promises, at 9:05 am and 2:10 pm, and yesterday one conversation was kept$/, async (w) => {
    const h = await begin(w)
    // Fixture second 0 is yesterday at 4:00 pm, in the phone's own time zone: the clock is set there.
    const yesterday4pm = new Date(2026, 9, 16, 16, 0, 0).getTime()
    h.clock.advance(yesterday4pm - h.clock.now())
    const run = await startSkipping(w, `history-day.${V}`, 7)
    const day: { names: string[]; promised: string[]; at: number }[] = []
    const lensSince = (from: number) => linesShown(h, from, h.clock.now()).map((l) => l.text)
    // Yesterday: Marcus, kept; quiet ends it ten minutes after the wearer last spoke (D92).
    expect(lensSince(w.dotSince!), 'Marcus was caught').toEqual(['Marcus'])
    await keepNow(w)
    const starts = [0, 61_500, 79_800]
    for (const [i, start] of starts.entries()) {
      const from = run.at(start)
      if (start > nowSec(w)) await fastForward(w, start)
      const said = run.fixture.words.filter((wd) => wd.start >= start && wd.start < (starts[i + 1] ?? Infinity))
      await fastForward(w, said.at(-1)!.end + PROMISE_DONE_S)
      const lines = lensSince(from)
      // The names are the lines that are neither a promise nor the keep's own (D40, D111).
      const keepLines = [KEEP_PROMPT, 'kept', 'already kept']
      day.push({ names: lines.filter((l) => !l.startsWith('promised · ') && !keepLines.includes(l)), promised: lines.filter((l) => l.startsWith('promised · ')), at: from })
      // The wearer says nothing more: ten minutes on, the conversation has ended.
      const lastWearer = said.filter((wd) => wd.role === 'wearer').at(-1)!
      await fastForward(w, lastWearer.end + 600 + SLACK_MS / 1000)
    }
    expect(day.map((d) => [d.names, d.promised.length]), 'Marcus kept with nothing promised; Priya and Dev, each with a promise').toEqual([
      [['Marcus'], 0],
      [['Priya'], 1],
      [['Dev'], 1],
    ])
    // The kept one has its jogger, and its notification came (D24).
    await waitFor(w, () => (phoneShows(w).kept.length > 0 ? true : undefined))
    expect(phoneShows(w).kept, 'the kept conversation produced its notification').toHaveLength(1)
    expect(phoneShows(w).promises, 'each conversation with a promise produced its notification').toHaveLength(2)
    w.day = day
  })

  reg.define(/^the wearer opens Catch on the iPhone app$/, async (w) => {
    const h = w.h!
    const { phone, record } = await openPhone({ server: h.server.url, token: HARNESS_TOKEN, clock: h.clock })
    await phone.home()
    w.phoneScreen = record.screens.at(-1)
    expect(w.phoneScreen && isHistory(w.phoneScreen.markup), 'the phone page shows the history').toBe(true)
  })

  reg.define(/^the wearer sees the 2:10 pm conversation above the 9:05 am one under TODAY$/, (w) => {
    const rows = rowsOn(w.phoneScreen!.markup)
    const afternoon = rows.findIndex((r) => r.time === '2:10 pm')
    const morning = rows.findIndex((r) => r.time === '9:05 am')
    expect(afternoon, `no 2:10 pm row: ${JSON.stringify(rows)}`).toBeGreaterThanOrEqual(0)
    expect(morning, `no 9:05 am row: ${JSON.stringify(rows)}`).toBeGreaterThanOrEqual(0)
    expect(afternoon, 'the 2:10 pm conversation sits above the 9:05 am one').toBeLessThan(morning)
    expect([rows[afternoon]!.day, rows[morning]!.day]).toEqual(['TODAY', 'TODAY'])
    // The rows are those conversations: each begins as its conversation began, within its first minute.
    for (const [row, d] of [[rows[afternoon]!, w.day![2]!], [rows[morning]!, w.day![1]!]] as const) {
      expect(row.at - d.at, `the ${row.time} row starts ${row.at - d.at} ms after its conversation`).toBeGreaterThanOrEqual(-1000)
      expect(row.at - d.at).toBeLessThan(60_000)
    }
  })

  reg.define(/^the wearer sees the kept conversation under YESTERDAY with a kept mark$/, (w) => {
    const rows = rowsOn(w.phoneScreen!.markup)
    const kept = rows.filter((r) => r.kept)
    expect(kept.map((r) => [r.day, r.names, r.time]), 'one row with a kept mark: yesterday, Marcus, 4:00 pm').toEqual([['YESTERDAY', 'Marcus', '4:00 pm']])
    expect(rows.filter((r) => r.day === 'YESTERDAY'), 'yesterday holds that row only').toEqual(kept)
  })

  reg.define(/^the wearer sees, on each row, the names caught, the time, and the count of open promises$/, (w) => {
    const rows = rowsOn(w.phoneScreen!.markup)
    const [marcus, priya, dev] = w.day!
    const open = (d: { promised: string[] }) => (d.promised.length > 0 ? `${d.promised.length} open` : 'all done')
    expect(rows.map((r) => [r.day, r.names, r.time, r.open])).toEqual([
      ['TODAY', dev!.names.join(', '), '2:10 pm', open(dev!)],
      ['TODAY', priya!.names.join(', '), '9:05 am', open(priya!)],
      ['YESTERDAY', marcus!.names.join(', '), '4:00 pm', open(marcus!)],
    ])
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

  // D79. The in-world control (fix round, test-2): another account's glasses
  // are signed in to the same server for the whole scenario, so "no other
  // phone" has another phone that could have been sent it.
  reg.define(/^two people take turns wearing one pair of glasses signed in to the wearer's account$/, async (w) => {
    await begin(w, async (h) => {
      await h.signInOtherAccount()
    })
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
    expect(h.notifications.phone(OTHER_ACCOUNT), "the other account's phone was sent it").toEqual([])
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
