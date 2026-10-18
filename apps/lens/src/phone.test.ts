import { describe, expect, it } from 'vitest'
import type { ConversationResponse, HistoryResponse } from '../../../shared/phone-protocol.ts'
import { systemClock } from '../../../shared/clock.ts'
import { isHistory, PhoneScreenRecord, rowsOn, sectionsOn } from '../../../test/harness/phone.ts'
import { clockTime, conversationMarkup, dayLabel, historyMarkup, httpOrigin, startPhone } from './phone.ts'

// The phone page's two screens (D100, D98), read back the way the wearer reads
// them (test/harness/phone.ts); the API they come from is tested end to end in
// test/integration/phone-api.test.ts.

const at = (h: number, m: number, day = 17, month = 9) => new Date(2026, month, day, h, m).getTime()
const NOW = at(18, 0)

const HISTORY: HistoryResponse = {
  open: 5,
  conversations: [
    { id: 3, startedAt: at(14, 10), names: ['Priya', 'Marcus'], open: 2, kept: false },
    { id: 2, startedAt: at(9, 5), names: [], open: 3, kept: false },
    { id: 1, startedAt: at(16, 0, 16), names: ['Ana'], open: 0, kept: true },
    { id: 0, startedAt: at(11, 30, 14), names: ['Dev'], open: 0, kept: false },
  ],
}

const CONVERSATION: ConversationResponse = {
  id: 3,
  startedAt: at(14, 10),
  endedAt: at(14, 40),
  names: ['Dev'],
  kept: false,
  you: ['Send Dev the deck tonight', 'Introduce Dev to Sam', 'Book the room', 'Call Ana', 'Write the brief'].map((text, id) => ({ id, text, done: false })),
  owed: [
    { id: 10, text: 'Dev sends the agenda', done: false },
    { id: 11, text: 'Dev intros you to Kim', done: false },
  ],  jogger: false,
}

describe('the history screen (D100)', () => {
  it('lists newest first under the day, each row with the names (or "no name"), the time, the open count (or "all done") and a kept mark', () => {
    const markup = historyMarkup(HISTORY, NOW)
    expect(isHistory(markup)).toBe(true)
    expect(rowsOn(markup).map((r) => [r.day, r.names, r.time, r.open, r.kept])).toEqual([
      ['TODAY', 'Priya, Marcus', '2:10 pm', '2 open', false],
      ['TODAY', 'no name', '9:05 am', '3 open', false],
      ['YESTERDAY', 'Ana', '4:00 pm', 'all done', true],
      ['WEDNESDAY, OCT 14', 'Dev', '11:30 am', 'all done', false],
    ])
    expect(rowsOn(markup).map((r) => r.at)).toEqual(HISTORY.conversations.map((c) => c.startedAt))
    expect(markup).toContain('<p class="open-total">5 open</p>')
  })

  it('says so when there is nothing yet, and "all done" in the header when nothing is open', () => {
    const markup = historyMarkup({ open: 0, conversations: [] }, NOW)
    expect(rowsOn(markup)).toEqual([])
    expect(markup).toContain('<p class="open-total">all done</p>')
    expect(markup).toContain('class="empty"')
  })

  it('writes names as text, never as markup', () => {
    const markup = historyMarkup({ open: 1, conversations: [{ id: 1, startedAt: NOW, names: ['<img src=x onerror=alert(1)>'], open: 1, kept: false }] }, NOW)
    expect(markup).not.toContain('<img')
    expect(rowsOn(markup)[0]!.names).toBe('<img src=x onerror=alert(1)>')
  })
})

describe("a conversation's screen (D98)", () => {
  it('heads with the names and the time, then YOU and OWED TO YOU with every promise, each with a tick box drawn and inert', () => {
    const markup = conversationMarkup(CONVERSATION, NOW)
    expect(markup).toContain('<h1 class="names">Dev</h1>')
    expect(markup).toContain('2:10 pm')
    expect(sectionsOn(markup)).toEqual([
      { title: 'YOU', promises: CONVERSATION.you.map((p) => ({ text: p.text, tickable: false })) },
      { title: 'OWED TO YOU', promises: CONVERSATION.owed.map((p) => ({ text: p.text, tickable: false })) },
    ])
    expect(markup.match(/<input type="checkbox" disabled/g)).toHaveLength(7)
  })

  it('draws both sections even when one is empty, and "no name" when none was caught', () => {
    const markup = conversationMarkup({ ...CONVERSATION, names: [], owed: [] }, NOW)
    expect(sectionsOn(markup).map((s) => [s.title, s.promises.length])).toEqual([
      ['YOU', 5],
      ['OWED TO YOU', 0],
    ])
    expect(markup).toContain('<h1 class="names">no name</h1>')
  })
})

describe('the times', () => {
  it('reads as the phone reads them', () => {
    expect(clockTime(at(0, 5))).toBe('12:05 am')
    expect(clockTime(at(12, 0))).toBe('12:00 pm')
    expect(clockTime(at(23, 59))).toBe('11:59 pm')
  })

  it('calls the calendar day before today yesterday, across a clock change', () => {
    // 2026-11-01 is the day US clocks fall back; the day before is 25 hours long there.
    expect(dayLabel(at(0, 30, 31), at(23, 30, 1, 10))).toBe('YESTERDAY')
    expect(dayLabel(at(23, 59, 30), at(0, 1, 31))).toBe('YESTERDAY')
    expect(dayLabel(at(0, 0, 31), at(23, 59, 31))).toBe('TODAY')
  })

  it('reaches the http twin of the server origin', () => {
    expect(httpOrigin('wss://catch-g2.fly.dev')).toBe('https://catch-g2.fly.dev')
    expect(httpOrigin('ws://localhost:8080/')).toBe('http://localhost:8080')
    expect(httpOrigin('http://127.0.0.1:9')).toBe('http://127.0.0.1:9')
  })
})

describe('the page', () => {
  function fakeServer(answers: Record<string, () => Response | Promise<Response>>) {
    const asked: { url: string; auth: string | null }[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      asked.push({ url, auth: new Headers(init?.headers).get('authorization') })
      const answer = answers[new URL(url).pathname]
      if (!answer) return new Response('', { status: 404 })
      return answer()
    }) as typeof globalThis.fetch
    return { asked, fetch }
  }
  const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 })

  it('asks the server with the shared token, draws the history, and opens a conversation on a tap, then goes back', async () => {
    const { asked, fetch } = fakeServer({ '/phone/history': json(HISTORY), '/phone/conversations/3': json(CONVERSATION) })
    const root = new PhoneScreenRecord(systemClock)
    const phone = startPhone({ root, server: 'ws://localhost:8080', token: 't0k', fetch, now: () => NOW })
    await phone.home()
    expect(asked).toEqual([{ url: 'http://localhost:8080/phone/history', auth: 'Bearer t0k' }])
    expect(rowsOn(root.innerHTML).map((r) => r.conversation)).toEqual(['3', '2', '1', '0'])
    root.tap('data-conversation', '3')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(asked.at(-1)!.url).toBe('http://localhost:8080/phone/conversations/3')
    expect(sectionsOn(root.innerHTML)[0]!.promises).toHaveLength(5)
    root.tap('data-home')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(isHistory(root.innerHTML)).toBe(true)
  })

  it('says when the server refuses the token or cannot be reached, with a way to try again', async () => {
    const refused = fakeServer({ '/phone/history': () => new Response('', { status: 401 }) })
    const root = new PhoneScreenRecord(systemClock)
    await startPhone({ root, server: 'http://localhost:1', token: 'bad', fetch: refused.fetch }).home()
    expect(root.innerHTML).toContain('refused')
    expect(root.innerHTML).toContain('data-home')
    const unreachable = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch
    await startPhone({ root, server: 'http://localhost:1', token: 't', fetch: unreachable }).home()
    expect(root.innerHTML).toContain('cannot be reached at http://localhost:1')
  })

  it('draws only the screen asked for last when an older answer arrives late', async () => {
    let release!: () => void
    const late = new Promise<void>((r) => (release = r))
    const { fetch } = fakeServer({
      '/phone/history': async () => {
        await late
        return json(HISTORY)()
      },
      '/phone/conversations/3': json(CONVERSATION),
    })
    const root = new PhoneScreenRecord(systemClock)
    const phone = startPhone({ root, server: 'http://localhost:1', token: 't', fetch, now: () => NOW })
    const home = phone.home()
    await phone.open(3)
    release()
    await home
    expect(root.screens).toHaveLength(1)
    expect(isHistory(root.innerHTML)).toBe(false)
  })

  // Fix round, M5: coming back to the page (after a lock, or another app)
  // re-draws the screen the wearer was on, never the history in its place.
  it('re-draws the screen it is showing on a refresh: a conversation stays a conversation, the history the history', async () => {
    const { asked, fetch } = fakeServer({ '/phone/history': json(HISTORY), '/phone/conversations/3': json(CONVERSATION) })
    const root = new PhoneScreenRecord(systemClock)
    const phone = startPhone({ root, server: 'http://localhost:1', token: 't', fetch, now: () => NOW })
    await phone.home()
    await phone.open(3)
    await phone.refresh()
    expect(asked.map((a) => new URL(a.url).pathname)).toEqual(['/phone/history', '/phone/conversations/3', '/phone/conversations/3'])
    expect(root.screens).toHaveLength(3)
    expect(isHistory(root.innerHTML)).toBe(false)
    expect(sectionsOn(root.innerHTML)[0]!.promises).toHaveLength(5)
    await phone.home()
    await phone.refresh()
    expect(asked.at(-1)!.url).toBe('http://localhost:1/phone/history')
    expect(isHistory(root.innerHTML)).toBe(true)
  })

  it('keeps a conversation still on its way when the page is refreshed meanwhile', async () => {
    let release!: () => void
    const late = new Promise<void>((r) => (release = r))
    const { fetch } = fakeServer({
      '/phone/history': json(HISTORY),
      '/phone/conversations/3': async () => {
        await late
        return json(CONVERSATION)()
      },
    })
    const root = new PhoneScreenRecord(systemClock)
    const phone = startPhone({ root, server: 'http://localhost:1', token: 't', fetch, now: () => NOW })
    await phone.home()
    const opening = phone.open(3)
    const refreshing = phone.refresh()
    release()
    await Promise.all([opening, refreshing])
    expect(isHistory(root.innerHTML)).toBe(false)
    expect(sectionsOn(root.innerHTML).map((s) => s.title)).toEqual(['YOU', 'OWED TO YOU'])
  })
})
