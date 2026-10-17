import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { harness, type Harness } from '../harness/index.ts'
import { isDotOnly, lineIn, linesShown, screenAt, screens, visible } from '../steps/lens-world.ts'

// The conversation across the lens's edge, end to end through the real lens
// on the real SDK. The operator's P1b carry (a), D79: one wearer per account,
// keyed by the shared token, so the conversation belongs to the wearer and
// not to one /audio socket. A lens that loses its socket and comes back (a reconnect, a
// network blip, the Even app reloading the plugin) finds the held names, the
// wearer's own name and the open conversation where it left them. And the
// long-press (D52), whose feature scenario first runs in P2a: the glasses'
// LONG_PRESS_EVENT reaches the server and ends the conversation. Read from
// the bridge stub's record: the lines shown, and a tap's page.

let h: Harness
beforeAll(async () => {
  h = await harness()
})
afterAll(() => h.close())
beforeEach(() => h.reset())

async function untilDot(): Promise<void> {
  for (let waited = 0; waited < 3000 && !isDotOnly(screenAt(h, h.clock.now()) ?? { at: 0, method: '', containers: [] }); waited += 20) {
    await h.clock.sleepUntil(h.clock.now() + 20)
  }
  expect(isDotOnly(screenAt(h, h.clock.now())!), 'the dot is showing').toBe(true)
}

/** Taps, and returns the names a names page listed ([] for the nothing-held page). */
async function tapForNames(): Promise<string[]> {
  const tappedAt = h.clock.now()
  h.host.push('textEvent', { containerID: 1, containerName: 'dot' })
  const page = () => screens(h).find((s) => s.at >= tappedAt && s.containers.some((c) => c.containerName === 'names' || c.containerName === 'empty'))
  for (let waited = 0; waited < 2000 && !page(); waited += 20) await h.clock.sleepUntil(h.clock.now() + 20)
  const shown = page()
  expect(shown, 'a tap brought up no page').toBeDefined()
  const names = visible(shown!).find((c) => c.containerName === 'names')
  return names ? names.content.split('\n').filter((l) => l.trim() !== '') : []
}

describe('the conversation outlives the /audio socket (D79)', () => {
  it('keeps the held names, the wearer\'s own name and the open conversation across a lost socket', async () => {
    const first = await h.startLens()
    await untilDot()
    const run = h.play('blip.wearer-louder')
    const priya = lineIn(run, "Hi, I'm Priya.")
    await run.playTo(priya.end + 2)
    expect(linesShown(h, run.at(priya.end), h.clock.now()).map((l) => l.text)).toEqual(['Priya'])
    await run.playTo(6)

    // The socket goes: the lens stops, and a lens with the same token comes back.
    await first.stop()
    await h.startLens()
    await untilDot()
    const marcus = lineIn(run, "And I'm Marcus.")
    expect(h.clock.now(), 'the lens is back before Marcus speaks').toBeLessThan(run.at(10))
    await run.playTo(marcus.end + 2.5)

    // The wearer's own name, given before the blip, is still never caught; Marcus is.
    expect(linesShown(h, run.at(10), h.clock.now()).map((l) => l.text)).toEqual(['Marcus'])
    await untilDot()
    expect(await tapForNames()).toEqual(['Priya', 'Marcus'])
  })
})

describe('a long-press on the glasses (D52)', () => {
  it('ends the conversation: its names clear, and the next tap shows nothing held', async () => {
    await h.startLens()
    await untilDot()
    const run = h.play('priya.wearer-louder')
    const priya = lineIn(run, "Hi, I'm Priya.")
    await run.playTo(priya.end + 2.5)
    expect(linesShown(h, run.at(priya.end), h.clock.now()).map((l) => l.text)).toEqual(['Priya'])
    await untilDot()
    expect(await tapForNames()).toEqual(['Priya'])
    h.host.push('textEvent', { containerID: 3, containerName: 'names' })
    await untilDot()
    // LONG_PRESS_EVENT (9) from the right temple, then its release (10).
    h.host.push('sysEvent', { eventType: 9, eventSource: 1 })
    h.host.push('sysEvent', { eventType: 10, eventSource: 1 })
    await h.clock.sleepUntil(h.clock.now() + 300)
    const tappedAt = h.clock.now()
    expect(await tapForNames()).toEqual([])
    const page = screens(h).find((s) => s.at >= tappedAt && visible(s).length > 0 && !isDotOnly(s))!
    expect(visible(page).map((c) => c.content)).toEqual(['this conversation · nothing held'])
  })
})
