import { afterAll, describe, expect, it } from 'vitest'
import { rows } from '../harness/store-reader.ts'
import { begin, closeHarness, expectDotOnly, playTo, screens, screensDuring, SLACK_MS, startRun, visible, type LensWorld } from '../steps/lens-world.ts'

// P6 behind the operator's switch, through the real lens on the real SDK and
// the stand-in Even app (D130, D133): with CATCH_PAUSE off, the demo build, a
// swipe down at the bare dot neither pauses Catch nor shows the dash; the
// microphone stays open, the frames keep reaching the server, and what is
// said after it is heard. Read from the bridge record, the server's frames
// and the store, as the staying-dark scenarios read the pause with it on.

afterAll(closeHarness)

describe('a swipe down at the dot with the pause switched off (the demo build)', () => {
  it('neither pauses nor shows the dash: the dot stays, the microphone stays open, and Catch goes on hearing', async () => {
    const w: LensWorld = {}
    const h = await begin(w)
    const frames: number[] = []
    const onFrame = ({ at }: { at: number }) => void frames.push(at)
    h.server.events.on('frame', onFrame)
    try {
      // small-talk: the wearer and Dev, a turn about every second; swiped at second 5, between turns.
      const run = await startRun(w, 'small-talk.wearer-louder', 5)
      expectDotOnly(screens(h).at(-1), 'before the swipe')
      const swipedAt = h.clock.now()
      h.host.push('textEvent', { containerID: 1, containerName: 'dot', eventType: 2 })
      await playTo(w, 12)
      await run.delivered()
      for (const s of screensDuring(h, swipedAt, h.clock.now())) expectDotOnly(s, 'after the swipe down')
      expect(screens(h).filter((s) => s.at >= swipedAt).flatMap((s) => visible(s).map((c) => c.content)), 'no `paused`, no dash').not.toContain('paused')
      expect(h.host.calls.filter((c) => c.method === 'audioControl' && c.at >= swipedAt), 'the microphone never closed').toEqual([])
      expect(frames.filter((at) => at > swipedAt + SLACK_MS).length, 'frames still reach the server').toBeGreaterThan(40)
      // What is said after the swipe is heard: in the store's transcript.
      const after = run.fixture.words.filter((wd) => run.at(wd.start) > swipedAt + SLACK_MS && wd.end < 11)
      expect(after.length).toBeGreaterThan(3)
      const stored = rows(h.dbPath, 'transcript').filter((r) => Number(r.start) > run.seconds(swipedAt + SLACK_MS) && Number(r.end) < 11)
      expect(stored.map((r) => r.text), 'what was said after the swipe, in the transcript').toEqual(after.map((wd) => wd.text))
    } finally {
      h.server.events.off('frame', onFrame)
    }
  })
})
