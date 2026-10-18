import { expect } from 'vitest'
import { harness, type Harness } from '../harness/index.ts'
import { DISPLAY_METHODS, type Payload } from '../harness/even-host.ts'
import type { FixtureRun } from '../harness/player.ts'
import type { FixtureWord } from '../fixtures/fixture.ts'

// What the step bindings share: the world of one scenario, and the far side.
//
// The far side is the bridge stub's record (test/harness/even-host.ts): every
// page and text payload the SDK sent for the glasses, stamped with the fixture
// clock. `screens()` replays that record into what the glasses were told to
// show after each payload, and every "the wearer sees" step reads those
// screens, never a flag the lens or the server keeps about itself. Times are
// fixture time: a fixture second is a fixture second whatever the wall clock did.
//
// One fixture plays a whole scenario, because the server lines the provider's
// words up with the lens's frames on one timeline; so a Given that sets up the
// conversation the When continues is recorded as a precondition and checked,
// on the far side, when the When starts that scenario's fixture (`startRun`).

/** The G2 canvas the payloads address, in pixels (Even's 576 x 288). */
export const CANVAS = { width: 576, height: 288 }
/**
 * The lowest readable brightness: the SDK's `textColor` runs 0..4 with 0 fully
 * dim, and the plan puts the dot at 1 ("the dot at brightness 1 top right").
 */
export const LOWEST_READABLE = 1
/** D17: a name line within two seconds, held for a second and a half. */
export const NAME_BOUND_MS = 2000
export const LINE_MS = 1500
/** How far a payload may land from its mark on fixture time: the socket hops between server and lens cost real milliseconds, 20 times over. */
export const SLACK_MS = 300
/** D31, D43: a held page stays five seconds with no touch. */
export const PAGE_MS = 5000

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Shown {
  containerID: number
  containerName: string
  content: string
  brightness: number | undefined
  box: Box
}

/** What the glasses were told to show from `at` until the next payload. */
export interface Screen {
  at: number
  method: string
  containers: Shown[]
}

export type Precondition = 'in-conversation, dot only' | 'Priya introduced at the start'

export interface LensWorld {
  h?: Harness
  run?: FixtureRun
  /** Fixture-clock readings the later steps measure from. */
  saidAt?: number
  saidLine?: { start: number; end: number }
  lineAt?: number
  /** The clock when the scenario's fixture started: the dot was already showing. */
  dotSince?: number
  pending?: Precondition[]
  /** The name lines shown before the moment the scenario is about, in order. */
  linesBefore?: string[]
  lostAt?: number
  restoredAt?: number
  /** The page the last tap brought up (holding.feature), and whether a later step has already read it. */
  page?: Screen
  pageRead?: boolean
  /** The names held before the moment the scenario is about, read from a names page or the lines shown. */
  heldBefore?: string[]
  pressedAt?: number
  /** The clock when the wearer last spoke before a silence the scenario counts (D92). */
  quietFrom?: number
}

let started = false

/**
 * After every scenario: a model pass that failed (a missing cassette above
 * all) fails the scenario loudly, whatever its steps read, so a promise is
 * never lost in silence.
 */
export async function afterScenario(): Promise<void> {
  if (!started) return
  const h = await harness()
  const errors = h.modelErrors.splice(0)
  if (errors.length > 0) throw new Error(`a model pass failed in this scenario: ${errors.map((e) => (e as Error)?.message ?? String(e)).join('; ')}`)
}

/** Closes the worker's harness if a scenario started it. */
export async function closeHarness(): Promise<void> {
  if (started) await (await harness()).close()
  started = false
}

function boxOf(o: Record<string, unknown>): Box {
  return { x: Number(o.xPosition ?? 0), y: Number(o.yPosition ?? 0), width: Number(o.width ?? 0), height: Number(o.height ?? 0) }
}

/** The bridge record replayed: the screen after each page or text payload. */
export function screens(h: Pick<Harness, 'host'>): Screen[] {
  let containers: Shown[] = []
  const out: Screen[] = []
  for (const p of h.host.payloads() as Payload[]) {
    if (!(DISPLAY_METHODS as readonly string[]).includes(p.method)) continue
    if (p.method === 'createStartUpPageContainer' || p.method === 'rebuildPageContainer') {
      const objects = (p.data.textObject as Record<string, unknown>[] | undefined) ?? []
      containers = objects.map((o) => ({
        containerID: o.containerID as number,
        containerName: o.containerName as string,
        content: (o.content as string | undefined) ?? '',
        brightness: o.textColor as number | undefined,
        box: boxOf(o),
      }))
    } else if (p.method === 'textContainerUpgrade') {
      containers = containers.map((c) =>
        c.containerID === p.data.containerID
          ? { ...c, content: (p.data.content as string | undefined) ?? c.content, brightness: (p.data.textColor as number | undefined) ?? c.brightness }
          : c,
      )
    } else {
      containers = []
    }
    out.push({ at: p.at, method: p.method, containers })
  }
  return out
}

/** What a wearer can see on a screen: containers with something drawn in them. */
export const visible = (s: Screen) => s.containers.filter((c) => c.content.trim() !== '')

/** The screen showing at clock reading `at`. */
export function screenAt(h: Pick<Harness, 'host'>, at: number): Screen | undefined {
  return screens(h).filter((s) => s.at <= at).at(-1)
}

/** The screens in force at any moment in [from, to]: the one showing at `from`, and every one after it up to `to`. */
export function screensDuring(h: Pick<Harness, 'host'>, from: number, to: number): Screen[] {
  const all = screens(h)
  const before = all.filter((s) => s.at <= from).at(-1)
  return [...(before ? [before] : []), ...all.filter((s) => s.at > from && s.at <= to)]
}

export const isTopRight = (b: Box) => b.x >= CANVAS.width * (5 / 6) && b.x + b.width <= CANVAS.width && b.y + b.height <= CANVAS.height / 3
export const inLowerThird = (b: Box) => b.y >= (CANVAS.height * 2) / 3 && b.y + b.height <= CANVAS.height

/** A single dim dot at the lowest brightness in the top-right corner, and nothing else. */
export function expectDotOnly(s: Screen | undefined, when = ''): void {
  expect(s, `no screen ${when}`).toBeDefined()
  const seen = visible(s!)
  expect(
    seen.map((c) => c.content),
    `the lens ${when} at ${s!.at} ms shows ${JSON.stringify(seen.map((c) => c.content))}`,
  ).toEqual(['•'])
  expect(seen[0]!.brightness, `the dot's brightness ${when}`).toBe(LOWEST_READABLE)
  expect(isTopRight(seen[0]!.box), `the dot sits at ${JSON.stringify(seen[0]!.box)}, not the top-right corner`).toBe(true)
}

export const isDotOnly = (s: Screen) => {
  const seen = visible(s)
  return seen.length === 1 && seen[0]!.content === '•'
}

/** `text` alone, in dim text in the lower third. */
export function isLine(s: Screen, text: string): boolean {
  const seen = visible(s)
  return seen.length === 1 && seen[0]!.content === text && seen[0]!.brightness === LOWEST_READABLE && inLowerThird(seen[0]!.box)
}

/** Plays the fixture on to fixture second `t`, so the fixture keeps flowing while a step waits. */
export async function playTo(w: LensWorld, t: number): Promise<void> {
  await w.run!.playTo(t)
}

/**
 * Jumps the fixture to second `t` across its silences, playing every word on
 * the way, and the frame that carries its end (the player refuses to skip
 * either, M6): a long pause costs no wall time. Every word up to `t` has been
 * played when it returns, however far the clock has run meanwhile.
 */
export async function fastForward(w: LensWorld, t: number): Promise<void> {
  const run = w.run!
  const skip = async (to: number) => {
    // Whatever the clock has already passed is played first, late and in order, never jumped over (P4: a long
    // fixture takes the clock a moment to load, and without this its opening words were skipped unheard).
    // Until the player has caught up: on a loaded machine the catch-up itself takes the clock on (operator answer 5).
    while (run.next <= nowSec(w)) await run.playTo(nowSec(w))
    // The frame carrying the last word said is played before the jump, so the provider has heard it.
    const said = run.fixture.words.filter((wd) => wd.end <= nowSec(w) + 1e-9).at(-1)
    if (said && run.frameEnd(said.end) > nowSec(w)) await run.playTo(Math.min(to, run.frameEnd(said.end)))
    // And the server has judged every word played before the clock jumps (P6, the three-hour workshop's load
    // flake): a frame still crossing the socket when the jump ran the clock past the wearer's ten minutes left
    // the wearer's last word unjudged, so the quiet ended the conversation under it, and its jogger's transcript
    // (the cassette's key) was cut short. Waited for on delivery, never on wall time; only once the frame
    // carrying that word's end has been played (a next word that starts inside it leaves no silence to jump).
    if (said && run.next > run.frameEnd(said.end) + 1e-9) await run.delivered()
    if (to > nowSec(w)) run.skipTo(to)
  }
  for (const wd of run.fixture.words) {
    if (wd.end <= nowSec(w) || wd.start >= t) continue
    if (wd.start > nowSec(w)) await skip(wd.start)
    await run.playTo(Math.min(t, run.frameEnd(wd.end)))
  }
  if (t > nowSec(w)) await skip(t)
  // A word the clock passed while the player was catching up is played now, before the step goes on (operator
  // answer 5: on a loaded machine the restart scenario's last words were left to be played after the long-press).
  await run.playTo(t)
}

/** Fixture seconds now. */
export const nowSec = (w: LensWorld) => w.run!.seconds(w.h!.clock.now())

/**
 * Starts the scenario: the harness reset, the lens started, and the dot drawn
 * (Catch can hear). `beforeLens` runs between the reset and the lens: a
 * second account signed in (phone-handoff, test-2) goes there.
 */
export async function begin(w: LensWorld, beforeLens?: (h: Harness) => Promise<void>): Promise<Harness> {
  if (w.h) return w.h
  started = true
  const h = await harness()
  await h.reset()
  w.h = h
  await beforeLens?.(h)
  await h.startLens()
  // The server shows the dot once its speech-to-text stream is open.
  for (let waited = 0; waited < 2000 && !isDotOnly(screenAt(h, h.clock.now()) ?? { at: 0, method: '', containers: [] }); waited += 20) {
    await h.clock.sleepUntil(h.clock.now() + 20)
  }
  expectDotOnly(screenAt(h, h.clock.now()), 'once the lens is connected')
  return h
}

/** The words of the fixture line reading `text` that starts at or after fixture second `after`. */
export function lineIn(run: FixtureRun, text: string, after = 0): { start: number; end: number; words: FixtureWord[] } {
  const tokens = text.split(/\s+/)
  const words = run.fixture.words
  for (let i = 0; i + tokens.length <= words.length; i++) {
    if (words[i]!.start < after) continue
    const span = words.slice(i, i + tokens.length)
    if (span.every((wd, j) => wd.text.replace(/[.!?]$/, '') === tokens[j]!.replace(/[.!?]$/, ''))) {
      return { start: span[0]!.start, end: span.at(-1)!.end, words: span }
    }
  }
  throw new Error(`fixture ${run.name} has no line "${text}" at or after ${after}s`)
}

/** Name lines (lower-third lines) shown in [from, to], in order. */
export function linesShown(h: Pick<Harness, 'host'>, from: number, to: number): { at: number; text: string }[] {
  return screens(h)
    .filter((s) => s.at >= from && s.at <= to)
    .filter((s) => visible(s).length === 1 && inLowerThird(visible(s)[0]!.box))
    .map((s) => ({ at: s.at, text: visible(s)[0]!.content }))
}

/**
 * Starts the scenario's fixture, plays it up to fixture second `upTo`, and
 * checks every precondition the Givens recorded, on the far side.
 */
export async function startRun(w: LensWorld, fixture: string, upTo: number): Promise<FixtureRun> {
  const h = w.h!
  w.dotSince = h.clock.now()
  const run = h.play(fixture)
  w.run = run
  await run.playTo(upTo)
  for (const pre of (w.pending ?? []).splice(0)) {
    if (pre === 'in-conversation, dot only') {
      // The conversation is under way: the wearer has spoken (D129 would begin it on anyone's speech) ...
      expect(run.fixture.words.some((wd) => wd.role === 'wearer' && wd.end < upTo), `${fixture}: the wearer has not spoken by ${upTo}s`).toBe(true)
      // ... and the lens has shown only the dot.
      for (const s of screensDuring(h, w.dotSince, h.clock.now())) expectDotOnly(s, 'before the moment the scenario is about')
    } else if (pre === 'Priya introduced at the start') {
      const first = lineIn(run, "Hi, I'm Priya.")
      expect(first.start, 'Priya introduces herself at the start of the conversation').toBeLessThan(10)
      expect(first.words.every((wd) => wd.role === 'other')).toBe(true)
      const shown = linesShown(h, run.at(first.end), h.clock.now()).map((l) => l.text)
      expect(shown[0], `${fixture}: Priya's introduction put no line on the lens`).toBe('Priya')
    }
  }
  return run
}

/** Records a precondition a Given set up, for the When's fixture to show (see the header). */
export function pend(w: LensWorld, pre: Precondition): void {
  ;(w.pending ??= []).push(pre)
}

/** The lines shown so far (the record the "original position" is read from). */
export function rememberLines(w: LensWorld): void {
  w.linesBefore = linesShown(w.h!, w.dotSince!, w.h!.clock.now()).map((l) => l.text)
}

/** The containers a held page draws: the names page's header, names and hint, or the one nothing-held page (D31, D43); with detection off, the thread line above them (D120); the promises page's header and list (D43, D112). */
export const PAGE_PARTS = ['thread', 'header', 'names', 'hint', 'empty', 'promises']
export const isPage = (s: Screen) => visible(s).length > 0 && visible(s).every((c) => PAGE_PARTS.includes(c.containerName))

/**
 * The wearer taps the glasses (a textEvent with no eventType: CLICK_EVENT is 0
 * and protobuf omits it). Returns the clock reading of the tap.
 */
export function tap(w: LensWorld): number {
  const h = w.h!
  const at = h.clock.now()
  h.host.push('textEvent', { containerID: 1, containerName: 'dot' })
  return at
}

/** Plays the fixture on (or lets the clock run) until `found` finds something, for at most `ms` of fixture time. */
export async function waitFor<T>(w: LensWorld, found: () => T | undefined, ms = 2000): Promise<T | undefined> {
  const h = w.h!
  for (let waited = 0; waited < ms && found() === undefined; waited += 50) {
    if (w.run) await w.run.playTo(nowSec(w) + 0.05)
    else await h.clock.sleepUntil(h.clock.now() + 50)
  }
  return found()
}

/**
 * The wearer taps and a held page comes up: the page, every part of it dim
 * (D14) and nothing else on the lens. Kept on the world for the steps that read it.
 */
export async function tapForPage(w: LensWorld): Promise<Screen> {
  const h = w.h!
  const tappedAt = tap(w)
  const shown = await waitFor(w, () => screens(h).find((s) => s.at >= tappedAt && isPage(s)))
  expect(shown, `a tap brought up no page; screens since: ${JSON.stringify(screens(h).filter((s) => s.at >= tappedAt).map((s) => visible(s).map((c) => c.content)))}`).toBeDefined()
  for (const c of visible(shown!)) expect(c.brightness, `the page's ${c.containerName} is dim`).toBe(LOWEST_READABLE)
  w.page = shown
  w.pageRead = false
  return shown!
}

/** The lens comes back to the bare dot (a line fades), and the dot alone shows now. */
export async function untilDot(w: LensWorld): Promise<void> {
  const h = w.h!
  await waitFor(w, () => (isDotOnly(screenAt(h, h.clock.now())!) ? true : undefined), LINE_MS + 2 * SLACK_MS)
  expectDotOnly(screenAt(h, h.clock.now()), 'before the tap')
}

/** D43's promises page: its header, and nothing on it but its list. */
export const isPromisesPage = (s: Screen) =>
  visible(s).some((c) => c.containerName === 'header' && c.content === 'this conversation 2/2') && visible(s).some((c) => c.containerName === 'promises')

/** The promises a promises page lists, in order: none on `no promises yet` (D112). */
export function promisesOn(page: Screen): string[] {
  const list = visible(page).find((c) => c.containerName === 'promises')
  if (!list || list.content === 'no promises yet') return []
  return list.content.split('\n').filter((l) => l.trim() !== '')
}

/**
 * The wearer swipes down (the SDK's SCROLL_BOTTOM_EVENT, 2, on the container
 * that takes the touches), and the promises page that comes up: dim, the
 * header above its list, nothing else on the lens.
 */
export async function swipeDown(w: LensWorld): Promise<Screen> {
  const h = w.h!
  const at = h.clock.now()
  h.host.push('textEvent', { containerID: 3, containerName: 'names', eventType: 2 })
  const shown = await waitFor(w, () => screens(h).find((s) => s.at >= at && isPromisesPage(s)))
  expect(shown, `a swipe down brought up no promises page; screens since: ${JSON.stringify(screens(h).filter((s) => s.at >= at).map((s) => visible(s).map((c) => c.content)))}`).toBeDefined()
  expect(shown!.at - at, 'the promises page comes on the swipe').toBeLessThanOrEqual(SLACK_MS)
  const parts = [...visible(shown!)].sort((a, b) => a.box.y - b.box.y)
  expect(parts.map((c) => c.containerName), 'the promises page: its header, then its list').toEqual(['header', 'promises'])
  for (const c of parts) expect(c.brightness, `the page's ${c.containerName} is dim`).toBe(LOWEST_READABLE)
  expect(parts[0]!.box.y + parts[0]!.box.height, 'the header sits above the list').toBeLessThanOrEqual(parts[1]!.box.y)
  w.page = shown
  w.pageRead = false
  return shown!
}

/** A tap brings up the names page listing `names`, and a swipe down past its end turns to the promises page. */
export async function tapToPromises(w: LensWorld, names: string[]): Promise<Screen> {
  const page = await tapForPage(w)
  expect(namesOn(page), 'the names page first').toEqual(names)
  return swipeDown(w)
}

/** The names a page lists, in order: none on the nothing-held page. */
export function namesOn(page: Screen): string[] {
  const names = visible(page).find((c) => c.containerName === 'names')
  return names ? names.content.split('\n').filter((l) => l.trim() !== '') : []
}

/** The wearer taps the glasses, and the names the page that comes back lists. */
export async function tapForNames(w: LensWorld): Promise<string[]> {
  return namesOn(await tapForPage(w))
}

/** The quoted names in a step's text: `"Priya" and "Priya (2)"` is ['Priya', 'Priya (2)']. */
export const quoted = (text: string) => [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)

/**
 * "The wearer sees `text` in dim text for a second and a half": the line comes
 * up within D17's two seconds of what was said, alone, dim, in the lower third,
 * stays a second and a half, and goes.
 */
export async function expectLineForASecondAndAHalf(w: LensWorld, text: string): Promise<void> {
  const h = w.h!
  await playTo(w, w.run!.seconds(w.saidAt!) + (NAME_BOUND_MS + LINE_MS + 2 * SLACK_MS) / 1000)
  const all = screens(h)
  const i = all.findIndex((s) => s.at >= w.saidAt! && isLine(s, text))
  expect(i, `no dim lower-third line "${text}" after ${w.saidAt} ms; screens: ${JSON.stringify(all.filter((s) => s.at >= w.saidAt!).map((s) => visible(s).map((c) => c.content)))}`).toBeGreaterThanOrEqual(0)
  const line = all[i]!
  expect(line.at - w.saidAt!, `the line came ${line.at - w.saidAt!} ms after it was said`).toBeLessThanOrEqual(NAME_BOUND_MS)
  w.lineAt = line.at
  const next = all[i + 1]
  expect(next, `"${text}" never left the lens`).toBeDefined()
  expect(Math.abs(next!.at - line.at - LINE_MS), `"${text}" stayed ${next!.at - line.at} ms`).toBeLessThanOrEqual(SLACK_MS)
  expect(isLine(next!, text)).toBe(false)
}
