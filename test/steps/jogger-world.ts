import { expect } from 'vitest'
import { wearerOf } from '../../server/src/phone/api.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { linesOf, type Captured } from '../harness/notifications.ts'
import { isJogger, joggerOn, openPhone, type JoggerBullet } from '../harness/phone.ts'
import { rows } from '../harness/store-reader.ts'
import type { ScriptLine } from '../fixtures/scripts.ts'
import type { FixtureRun } from '../harness/player.ts'
import { fastForward, isDotOnly, isLine, LINE_MS, nowSec, playTo, screenAt, screens, SLACK_MS, startRun, visible, waitFor, type LensWorld, type Screen } from './lens-world.ts'

// What the keep and the jogger steps share (P4): the gestures, the lines they
// bring, the kept notification, and the jogger read on the far side. A
// gesture is a touch event pushed through the Even host as the Even app would
// deliver it; what it brought is read from the bridge stub's record. "The
// phone" is the notification capture (no push exists, D126); "opening it" is
// the phone page (D130) handed the captured notification's data, as the OS
// hands a tapped notification to its app, and drawing what the server's phone
// API answers. The jogger is read from that page's markup and, beside it,
// straight from the store, never from the server's own account of it.

export const KEEP_PROMPT = 'keep this conversation?'

/** The account the harness's glasses are signed in to (D79). */
export const ACCOUNT = wearerOf(HARNESS_TOKEN)

export interface JoggerWorld extends LensWorld {
  /** The clock reading at the last gesture. */
  gestureAt?: number
  /** When the keep prompt came up. */
  promptAt?: number
  /** The jogger as the phone page drew it, and the markup. */
  jogger?: ReturnType<typeof joggerOn>
  joggerMarkup?: string
  /** The kept notification the phone showed. */
  kept?: Captured
  /** The wearer's promises as the lens showed them (`promised · <summary>`). */
  promised?: string[]
}

/** Starts the scenario's fixture and plays it to fixture second `upTo`, skipping its silences (every word and timer still played). */
export async function startSkipping(w: LensWorld, fixture: string, upTo: number): Promise<FixtureRun> {
  // Everything said before `upTo` is played as it comes; only the silence after it is skipped.
  const run = await startRun(w, fixture, 0)
  const said = run.fixture.words.filter((wd) => wd.end <= upTo).at(-1)
  if (said) await playTo(w, Math.min(upTo - SLACK_MS / 1000, run.frameEnd(said.end)))
  await fastForward(w, upTo - SLACK_MS / 1000)
  // The lines a jump fired reach the lens over its socket after the jump: played on until they have.
  await playTo(w, upTo)
  return run
}

/** SCROLL_TOP_EVENT (1): a swipe up on the container that takes the touches. */
export function swipeUp(w: LensWorld): number {
  const h = w.h!
  const at = h.clock.now()
  h.host.push('textEvent', { containerID: 1, containerName: 'dot', eventType: 1 })
  ;(w as JoggerWorld).gestureAt = at
  return at
}

/** SCROLL_BOTTOM_EVENT (2): a swipe down. */
export function swipeDownOnce(w: LensWorld): number {
  const h = w.h!
  const at = h.clock.now()
  h.host.push('textEvent', { containerID: 2, containerName: 'line', eventType: 2 })
  ;(w as JoggerWorld).gestureAt = at
  return at
}

/** A tap (CLICK_EVENT is 0 and protobuf omits it). */
export function tapOnce(w: LensWorld): number {
  const h = w.h!
  const at = h.clock.now()
  h.host.push('textEvent', { containerID: 1, containerName: 'dot' })
  ;(w as JoggerWorld).gestureAt = at
  return at
}

/** The first screen at or after `from` that shows `text` alone, dim, in the lower third, waited for up to `ms` of fixture time. */
export async function lineAfter(w: LensWorld, text: string, from: number, ms = SLACK_MS): Promise<Screen> {
  const h = w.h!
  const found = await waitFor(w, () => screens(h).find((s) => s.at >= from && isLine(s, text)), ms + SLACK_MS)
  expect(found, `no dim lower-third "${text}" after ${from} ms; screens since: ${JSON.stringify(screens(h).filter((s) => s.at >= from).map((s) => visible(s).map((c) => c.content)))}`).toBeDefined()
  expect(found!.at - from, `"${text}" came ${found!.at - from} ms after`).toBeLessThanOrEqual(ms)
  return found!
}

/** The swipe up brings the prompt (D40). */
export async function expectPrompt(w: JoggerWorld, from = w.gestureAt!): Promise<void> {
  w.promptAt = (await lineAfter(w, KEEP_PROMPT, from)).at
}

/** "X in dim text for a second and a half": after `from`, the line comes at once, stays D17's second and a half, and goes. */
export async function expectLineForASecondAndAHalfAfter(w: LensWorld, text: string, from: number): Promise<Screen> {
  const h = w.h!
  const line = await lineAfter(w, text, from)
  await playTo(w, w.run!.seconds(line.at) + (LINE_MS + 2 * SLACK_MS) / 1000)
  const all = screens(h)
  const next = all[all.indexOf(all.find((s) => s.at === line.at && isLine(s, text))!) + 1]
  expect(next, `"${text}" never left the lens`).toBeDefined()
  expect(Math.abs(next!.at - line.at - LINE_MS), `"${text}" stayed ${next!.at - line.at} ms`).toBeLessThanOrEqual(SLACK_MS)
  expect(isLine(next!, text)).toBe(false)
  return next!
}

/** The lens shows only the dot now, and did from `since` (a line's end) on. */
export function expectDotNow(w: LensWorld, since: number): void {
  const h = w.h!
  for (const s of screens(h).filter((s) => s.at >= since)) expect(isDotOnly(s), `at ${s.at} ms the lens shows ${JSON.stringify(visible(s).map((c) => c.content))}`).toBe(true)
  expect(isDotOnly(screenAt(h, h.clock.now())!), 'the lens shows only the dot now').toBe(true)
}

/** The wearer keeps the conversation: a swipe up, the prompt, a tap, `kept` for a second and a half, the dot (D40, D111). */
export async function keepNow(w: JoggerWorld): Promise<void> {
  const h = w.h!
  // A line a jump fired may still be on its way to the lens: the dot, once it has come.
  await waitFor(w, () => (isDotOnly(screenAt(h, h.clock.now())!) ? true : undefined), LINE_MS + SLACK_MS)
  expect(isDotOnly(screenAt(h, h.clock.now())!), 'the lens shows only the dot before the swipe up').toBe(true)
  swipeUp(w)
  await expectPrompt(w)
  const tappedAt = tapOnce(w)
  const back = await expectLineForASecondAndAHalfAfter(w, 'kept', tappedAt)
  expect(isDotOnly(back), 'the dot after "kept"').toBe(true)
}

/** LONG_PRESS_EVENT (9), then its release (10): the conversation ends now (D52). */
export async function longPressNow(w: LensWorld): Promise<void> {
  const h = w.h!
  w.pressedAt = h.clock.now()
  h.host.push('sysEvent', { eventType: 9, eventSource: 1 })
  await playTo(w, nowSec(w) + 0.2)
  h.host.push('sysEvent', { eventType: 10, eventSource: 1 })
  await playTo(w, nowSec(w) + SLACK_MS / 1000)
}

/** A kept-conversation notification (it opens the jogger), as against the promise one. */
export const isKeptNotification = (c: Captured) => c.notification.data?.screen === 'jogger'

/** What the account holder's phone showed, the kept notifications apart from the rest. */
export function phoneShows(w: LensWorld): { kept: Captured[]; promises: Captured[] } {
  const got = w.h!.notifications.phone(ACCOUNT)
  return { kept: got.filter(isKeptNotification), promises: got.filter((c) => !isKeptNotification(c)) }
}

/** Waits up to `ms` of fixture time after the conversation ended for the one kept notification, and checks it came within that. */
export async function keptWithin(w: JoggerWorld, ms: number): Promise<Captured> {
  await waitFor(w, () => (phoneShows(w).kept.length > 0 ? true : undefined), ms + SLACK_MS)
  const { kept } = phoneShows(w)
  expect(kept.map((c) => linesOf(c.notification)), 'the phone shows one kept notification').toHaveLength(1)
  expect(kept[0]!.at - w.pressedAt!, `the kept notification came ${kept[0]!.at - w.pressedAt!} ms after the end`).toBeLessThanOrEqual(ms)
  expect(w.h!.notifications.received.filter((c) => c.to !== ACCOUNT), 'no other phone was sent anything').toEqual([])
  // Its transcript lived only until its jogger was written (D76, the operator's P4 note): the store holds none.
  expect(rows(w.h!.dbPath, 'transcript'), 'a transcript survives the kept conversation').toEqual([])
  w.kept = kept[0]!
  return kept[0]!
}

/** The bullets the store holds for a conversation's jogger, read straight from the SQLite file. */
export function storedJogger(w: LensWorld, conversation: number): string[] | undefined {
  const row = rows(w.h!.dbPath, 'joggers').find((r) => r.conversation_id === conversation)
  return row ? (JSON.parse(String(row.bullets)) as string[]) : undefined
}

/** A bullet as the phone page shows it, with `**` around each bold span, for comparing with the store. */
const asStored = (b: JoggerBullet) => {
  let out = b.text
  for (const term of b.bold) out = out.replace(term, `**${term}**`)
  return out
}

/** Opens the kept notification on the phone page: the jogger it names, drawn from the server, checked against the store. */
export async function openKept(w: JoggerWorld): Promise<ReturnType<typeof joggerOn>> {
  const h = w.h!
  const n = w.kept!
  const { phone, record } = await openPhone({ server: h.server.url, token: HARNESS_TOKEN, clock: h.clock })
  await phone.openNotification(n.notification.data)
  return readJogger(w, record.screens.at(-1)?.markup ?? '', Number(n.notification.data?.conversation))
}

/** The jogger screen the phone drew, read as the wearer reads it, and the same bullets in the store. */
export function readJogger(w: JoggerWorld, markup: string, conversation: number): ReturnType<typeof joggerOn> {
  expect(isJogger(markup), `the phone shows something other than a jogger: ${markup}`).toBe(true)
  const jogger = joggerOn(markup)
  const stored = storedJogger(w, conversation)
  expect(stored, 'the store holds the jogger').toBeDefined()
  expect(jogger.bullets.map(asStored), 'the phone shows the jogger the store holds').toEqual(stored)
  w.jogger = jogger
  w.joggerMarkup = markup
  return jogger
}

/** Lower case, words stripped of the punctuation around them: how a term is matched. */
export const norm = (text: string) =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .join(' ')

/** The words the server heard of the fixture: every line, but those said while Catch could not hear. */
export function heard(lines: readonly ScriptLine[]): string {
  return norm(lines.map((l) => l.text).join(' '))
}

/**
 * D99: one flat list, no sections, each bullet short, nothing padded, and
 * nothing set in bold that the conversation did not contain (the second
 * reviewer's focus). `transcript` is what Catch heard.
 */
export function expectFlat(jogger: ReturnType<typeof joggerOn>, transcript: string, lineCount: number): void {
  expect(jogger.lists, 'one list').toBe(1)
  expect(jogger.headings, 'no headings under the header').toEqual([])
  expect(jogger.bullets.length, 'some bullets').toBeGreaterThan(0)
  expect(jogger.bullets.length, 'never padded: no more bullets than things said').toBeLessThanOrEqual(lineCount)
  for (const b of jogger.bullets) {
    // A short bullet (the builder's reading: one line of at most twenty-five words), and no heading in disguise.
    expect(b.text.split(/\s+/).length, `"${b.text}" is not short`).toBeLessThanOrEqual(25)
    expect(b.text.trim().endsWith(':'), `"${b.text}" is a heading, not a bullet`).toBe(false)
    expect(b.bold.length > 0 && norm(b.bold.join(' ')) === norm(b.text), `"${b.text}" is all bold: a heading, not a bullet`).toBe(false)
    for (const term of b.bold) expect(` ${transcript} `.includes(` ${norm(term)} `), `"${term}" is in bold, but nobody said it`).toBe(true)
  }
}

/** The index of the first bullet that carries `key`, case-insensitively, or -1. */
const bulletWith = (bullets: readonly JoggerBullet[], key: string) => bullets.findIndex((b) => norm(b.text).includes(norm(key)))

/** Every technical term said in `lines` (by `who`, if given) is set in bold inside a bullet (D24, D99). */
export function expectTermsBold(jogger: ReturnType<typeof joggerOn>, lines: readonly ScriptLine[], who?: string): string[] {
  const terms = lines.filter((l) => who === undefined || l.who === who).flatMap((l) => l.terms ?? [])
  expect(terms.length, 'the fixture names technical terms').toBeGreaterThan(0)
  for (const term of terms) {
    const inBold = jogger.bullets.find((b) => b.bold.some((t) => norm(t) === norm(term)))
    expect(inBold, `"${term}" is not set in bold in any bullet: ${JSON.stringify(jogger.bullets)}`).toBeDefined()
    expect(norm(inBold!.text).length, `"${term}" stands alone, not inside a bullet`).toBeGreaterThan(norm(term).length)
  }
  return terms
}

/**
 * "In the order things came up" (D99): the terms, the questions and the
 * promises the fixture marks, each found in the first bullet that carries
 * it, come in the order they were said.
 */
export function expectInOrder(jogger: ReturnType<typeof joggerOn>, lines: readonly ScriptLine[], promised: readonly string[] = []): void {
  const marks: { key: string; at: number }[] = []
  lines.forEach((l, i) => {
    for (const term of l.terms ?? []) marks.push({ key: term, at: i })
    if (l.ask) marks.push({ key: l.ask, at: i })
  })
  let p = 0
  lines.forEach((l, i) => {
    if (l.who === 'wearer' && /\bI'll\b/.test(l.text) && p < promised.length) marks.push({ key: `You promised: ${promised[p++]!}`, at: i })
  })
  marks.sort((a, b) => a.at - b.at)
  const found = marks.map((m) => ({ ...m, bullet: bulletWith(jogger.bullets, m.key) }))
  for (const f of found) expect(f.bullet, `no bullet carries "${f.key}": ${JSON.stringify(jogger.bullets.map((b) => b.text))}`).toBeGreaterThanOrEqual(0)
  for (let i = 1; i < found.length; i++) {
    expect(found[i]!.bullet, `"${found[i]!.key}" comes before "${found[i - 1]!.key}", which was said first`).toBeGreaterThanOrEqual(found[i - 1]!.bullet)
  }
}
