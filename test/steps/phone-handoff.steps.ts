import { expect } from 'vitest'
import type { Definer } from 'gherkin-node-test/vitest'
import { wearerOf } from '../../server/src/phone/api.ts'
import { History } from '../../server/src/phone/history.ts'
import type { Store } from '../../server/src/store.ts'
import { HARNESS_TOKEN } from '../harness/index.ts'
import { isHistory, openPhone, rowsOn, type PhoneScreen } from '../harness/phone.ts'
import {
  begin,
  LINE_MS,
  lineIn,
  linesShown,
  NAME_BOUND_MS,
  nowSec,
  playTo,
  SLACK_MS,
  startRun,
  tapForPage,
  visible,
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
// D130); the notification scenarios are P2a's.

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

const phoneHandoff: Definer<PhoneWorld> = (reg) => {
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
