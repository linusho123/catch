import { describe, expect, it } from 'vitest'
import type { ConversationResponse, HistoryResponse } from '../../../shared/phone-protocol.ts'
import { systemClock } from '../../../shared/clock.ts'
import { isHistory, PhoneScreenRecord, rowsOn, sectionsOn } from '../../../test/harness/phone.ts'
import { clockTime, conversationMarkup, dayLabel, DELETE_NOT_DONE, historyMarkup, httpOrigin, startPhone, TICK_NOT_SAVED } from './phone.ts'

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
  ],
  jogger: false,
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
  it('heads with the names and the time, then YOU and OWED TO YOU with every open promise, each with a live tick box (P7)', () => {
    const markup = conversationMarkup(CONVERSATION, NOW)
    expect(markup).toContain('<h1 class="names">Dev</h1>')
    expect(markup).toContain('2:10 pm')
    expect(sectionsOn(markup)).toEqual([
      { title: 'YOU', promises: CONVERSATION.you.map((p) => ({ text: p.text, tickable: true })) },
      { title: 'OWED TO YOU', promises: CONVERSATION.owed.map((p) => ({ text: p.text, tickable: true })) },
    ])
    expect(markup.match(/<input type="checkbox" data-tick="\d+"/g)).toHaveLength(7)
    expect(markup).not.toContain('disabled')
  })

  it('leaves a promise that is done off the list (D39), in either section', () => {
    const markup = conversationMarkup({ ...CONVERSATION, you: CONVERSATION.you.map((p) => ({ ...p, done: p.id === 0 })), owed: CONVERSATION.owed.map((p) => ({ ...p, done: true })) }, NOW)
    expect(sectionsOn(markup).map((s) => [s.title, s.promises.map((p) => p.text)])).toEqual([
      ['YOU', CONVERSATION.you.slice(1).map((p) => p.text)],
      ['OWED TO YOU', []],
    ])
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

  it('ends the open conversation from the history\'s End conversation button, then redraws the history', async () => {
    const { asked, fetch } = fakeServer({ '/phone/history': json(HISTORY), '/phone/end': json({ ended: true }) })
    const root = new PhoneScreenRecord(systemClock)
    const phone = startPhone({ root, server: 'ws://localhost:8080', token: 't0k', fetch, now: () => NOW })
    await phone.home()
    root.tap('data-end')
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
    expect(asked.map((a) => new URL(a.url).pathname)).toEqual(['/phone/history', '/phone/end', '/phone/history'])
    expect(asked[1]!.auth).toBe('Bearer t0k')
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

  // P7: tick-off (D39, D133), its idempotency and its failures (the second reviewer's focus).
  describe('a tick', () => {
    const PROMISE = '/phone/promises/0/done'
    const done = (c: ConversationResponse, ...ids: number[]): ConversationResponse => ({
      ...c,
      you: c.you.map((p) => (ids.includes(p.id) ? { ...p, done: true } : p)),
      owed: c.owed.map((p) => (ids.includes(p.id) ? { ...p, done: true } : p)),
    })
    const you = (root: PhoneScreenRecord) => sectionsOn(root.innerHTML)[0]!.promises.map((p) => p.text)
    const tick = (asked: { url: string }[]) => asked.filter((a) => new URL(a.url).pathname.startsWith('/phone/promises/'))

    function puts(answer: () => Response | Promise<Response>) {
      const asked: { url: string; method: string; auth: string | null }[] = []
      const fetch = (async (url: string, init?: RequestInit) => {
        asked.push({ url, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization') })
        const path = new URL(url).pathname
        if (path === '/phone/conversations/3') return json(CONVERSATION)()
        if (path === PROMISE) return answer()
        return new Response('', { status: 404 })
      }) as typeof globalThis.fetch
      return { asked, fetch }
    }

    it('takes the promise off the screen at once, writes it with the shared token, then draws the server\'s answer', async () => {
      let release!: () => void
      const held = new Promise<void>((r) => (release = r))
      const { asked, fetch } = puts(async () => {
        await held
        return json(done(CONVERSATION, 0))()
      })
      const root = new PhoneScreenRecord(systemClock)
      const phone = startPhone({ root, server: 'ws://localhost:8080', token: 't0k', fetch, now: () => NOW })
      await phone.open(3)
      root.tap('data-tick', '0')
      expect(you(root), 'off the screen before the server answers').toEqual(CONVERSATION.you.slice(1).map((p) => p.text))
      expect(tick(asked)).toEqual([{ url: 'http://localhost:8080/phone/promises/0/done', method: 'PUT', auth: 'Bearer t0k' }])
      const drawn = root.screens.length
      release()
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
      expect(root.screens.length, "the server's answer is drawn").toBe(drawn + 1)
      expect(you(root)).toEqual(CONVERSATION.you.slice(1).map((p) => p.text))
      expect(root.innerHTML).not.toContain('class="note"')
    })

    it('asks the server once for a double tap, and nothing for a promise already ticked', async () => {
      const { asked, fetch } = puts(json(done(CONVERSATION, 0)))
      const root = new PhoneScreenRecord(systemClock)
      const phone = startPhone({ root, server: 'http://localhost:1', token: 't', fetch, now: () => NOW })
      await phone.open(3)
      await Promise.all([phone.tick(0), phone.tick(0)])
      await phone.tick(0)
      expect(tick(asked), 'one write').toHaveLength(1)
      expect(you(root)).toEqual(CONVERSATION.you.slice(1).map((p) => p.text))
      expect(root.innerHTML).not.toContain('class="note"')
    })

    it('puts the promise back, with a quiet line and no error screen, when the server cannot be reached or refuses it', async () => {
      const answers: (() => Response | Promise<Response>)[] = [
        async () => {
          throw new TypeError('fetch failed')
        },
        () => new Response('{"error":"no such promise"}', { status: 404 }),
        () => new Response('', { status: 401 }),
        () => new Response('not json', { status: 200 }),
        json(CONVERSATION),
      ]
      for (const answer of answers) {
        const { fetch } = puts(answer)
        const root = new PhoneScreenRecord(systemClock)
        const phone = startPhone({ root, server: 'http://localhost:1', token: 't', fetch, now: () => NOW })
        await phone.open(3)
        await phone.tick(0)
        expect(you(root), 'the promise is back, in its place').toEqual(CONVERSATION.you.map((p) => p.text))
        expect(root.innerHTML).toContain(`<p class="note">${TICK_NOT_SAVED}</p>`)
        expect(root.innerHTML).not.toContain('class="error"')
        expect(sectionsOn(root.innerHTML)[1]!.promises, 'nothing else changed').toHaveLength(2)
      }
    })

    it('keeps a confirmed tick off the screen when an older answer arrives after it', async () => {
      let release!: () => void
      const late = new Promise<void>((r) => (release = r))
      let gets = 0
      const fetch = (async (url: string) => {
        const path = new URL(url).pathname
        if (path === PROMISE) return json(done(CONVERSATION, 0))()
        if (++gets === 2) await late
        return json(CONVERSATION)()
      }) as typeof globalThis.fetch
      const root = new PhoneScreenRecord(systemClock)
      const phone = startPhone({ root, server: 'http://localhost:1', token: 't', fetch, now: () => NOW })
      await phone.open(3)
      const refreshing = phone.refresh()
      await phone.tick(0)
      release()
      await refreshing
      expect(you(root), 'the refresh left before the tick and answered after it').toEqual(CONVERSATION.you.slice(1).map((p) => p.text))
    })

    it('touches no other screen when it fails after the wearer has gone back to the history', async () => {
      let release!: () => void
      const held = new Promise<void>((r) => (release = r))
      const { fetch } = puts(async () => {
        await held
        throw new TypeError('fetch failed')
      })
      const root = new PhoneScreenRecord(systemClock)
      const answers = fetch
      const phone = startPhone({
        root,
        server: 'http://localhost:1',
        token: 't',
        fetch: (async (url: string, init?: RequestInit) => (new URL(url).pathname === '/phone/history' ? json(HISTORY)() : answers(url, init))) as typeof globalThis.fetch,
        now: () => NOW,
      })
      await phone.open(3)
      const ticking = phone.tick(0)
      await phone.home()
      release()
      await ticking
      expect(isHistory(root.innerHTML)).toBe(true)
      await phone.open(3)
      expect(you(root), 'the promise that was not saved is on its screen again').toEqual(CONVERSATION.you.map((p) => p.text))
    })

    it('draws the history again with the drop when a tick is confirmed after the wearer went back to it and it answered first (risk-3)', async () => {
      let release!: () => void
      const held = new Promise<void>((r) => (release = r))
      let saved = false
      const counted = (): HistoryResponse => ({
        open: HISTORY.open - (saved ? 1 : 0),
        conversations: HISTORY.conversations.map((c) => (c.id === 3 && saved ? { ...c, open: c.open - 1 } : c)),
      })
      const fetch = (async (url: string) => {
        const path = new URL(url).pathname
        if (path === '/phone/history') return json(counted())()
        if (path === '/phone/conversations/3') return json(CONVERSATION)()
        if (path === PROMISE) {
          await held
          saved = true
          return json(done(CONVERSATION, 0))()
        }
        return new Response('', { status: 404 })
      }) as typeof globalThis.fetch
      const root = new PhoneScreenRecord(systemClock)
      const phone = startPhone({ root, server: 'http://localhost:1', token: 't', fetch, now: () => NOW })
      await phone.open(3)
      const ticking = phone.tick(0)
      await phone.home()
      expect(rowsOn(root.innerHTML).find((r) => r.at === at(14, 10))!.open, 'the history answered before the tick landed').toBe('2 open')
      release()
      await ticking
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
      expect(isHistory(root.innerHTML)).toBe(true)
      expect(rowsOn(root.innerHTML).find((r) => r.at === at(14, 10))!.open, "the row's open count dropped once the tick was confirmed").toBe('1 open')
      expect(root.innerHTML).toContain('<p class="open-total">4 open</p>')
    })
  })
})

// D134: a conversation deleted from its own screen, with a confirm (a second,
// explicit tap); cancelling leaves everything. The page asks the server with
// the shared token and then draws the history it answers, which no longer
// lists the conversation. Read from the screens the page wrote into its root
// and from the requests it made; the server's side, its store and its file,
// is tested in test/integration/phone-delete.test.ts.
describe('deleting a conversation (D134)', () => {
  const AFTER: HistoryResponse = { open: HISTORY.open - 2, conversations: HISTORY.conversations.filter((c) => c.id !== 3) }
  const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 })
  type Asked = { path: string; method: string; auth: string | null }

  function server(remove: () => Response | Promise<Response> = json(AFTER)) {
    const asked: Asked[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const method = init?.method ?? 'GET'
      asked.push({ path, method, auth: new Headers(init?.headers).get('authorization') })
      if (path === '/phone/history' && method === 'GET') return json(HISTORY)()
      if (path === '/phone/conversations/3' && method === 'GET') return json(CONVERSATION)()
      if (path === '/phone/conversations/3' && method === 'DELETE') return remove()
      return new Response('', { status: 404 })
    }) as typeof globalThis.fetch
    return { asked, fetch }
  }
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
  }
  const deletes = (asked: Asked[]) => asked.filter((a) => a.method === 'DELETE')

  async function onConversation(remove?: () => Response | Promise<Response>) {
    const { asked, fetch } = server(remove)
    const root = new PhoneScreenRecord(systemClock)
    const phone = startPhone({ root, server: 'ws://localhost:8080', token: 't0k', fetch, now: () => NOW })
    await phone.home()
    await phone.open(3)
    return { asked, root, phone }
  }

  it('puts a delete control on the conversation screen, and a first tap only asks to confirm, with Delete and Cancel', async () => {
    const { asked, root } = await onConversation()
    expect(root.innerHTML).toContain('data-delete="3"')
    const before = asked.length
    root.tap('data-delete', '3')
    expect(asked.length, 'a first tap asks the server nothing').toBe(before)
    expect(root.innerHTML).toContain('data-delete-confirm="3"')
    expect(root.innerHTML).toContain('data-delete-cancel')
    expect(root.innerHTML, 'the control is now the confirm').not.toContain('data-delete="3"')
    expect(sectionsOn(root.innerHTML)[0]!.promises, 'the screen is still the conversation').toHaveLength(5)
  })

  it('cancelling leaves everything: the same screen, and no request', async () => {
    const { asked, root } = await onConversation()
    const shown = root.innerHTML
    const before = asked.length
    root.tap('data-delete', '3')
    root.tap('data-delete-cancel')
    await settle()
    expect(root.innerHTML).toBe(shown)
    expect(asked.length).toBe(before)
  })

  it('on the confirm, deletes it with the shared token and returns to the history the server answers, without it and with the open count dropped', async () => {
    const { asked, root, phone } = await onConversation()
    root.tap('data-delete', '3')
    root.tap('data-delete-confirm', '3')
    await settle()
    expect(deletes(asked)).toEqual([{ path: '/phone/conversations/3', method: 'DELETE', auth: 'Bearer t0k' }])
    expect(isHistory(root.innerHTML)).toBe(true)
    expect(rowsOn(root.innerHTML).map((r) => r.conversation)).toEqual(['2', '1', '0'])
    expect(root.innerHTML).toContain('<p class="open-total">3 open</p>')
    // The history is now the screen: coming back to the page draws it again, never the deleted conversation.
    await phone.refresh()
    expect(asked.at(-1)).toMatchObject({ path: '/phone/history', method: 'GET' })
  })

  it('asks the server once for a double tap on the confirm, and never without the first tap', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const { asked, root, phone } = await onConversation(async () => {
      await held
      return json(AFTER)()
    })
    await phone.remove(3)
    expect(deletes(asked), 'no confirm was asked for').toEqual([])
    root.tap('data-delete', '3')
    root.tap('data-delete-confirm', '3')
    root.tap('data-delete-confirm', '3')
    release()
    await settle()
    expect(deletes(asked)).toHaveLength(1)
    expect(isHistory(root.innerHTML)).toBe(true)
  })

  it('stays on the conversation with a quiet line, never an error screen, when the delete does not reach the server or is refused', async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      async () => {
        throw new TypeError('fetch failed')
      },
      () => new Response('{"error":"no such conversation"}', { status: 404 }),
      () => new Response('', { status: 401 }),
      () => new Response('', { status: 500 }),
      () => new Response('not json', { status: 200 }),
    ]
    for (const answer of answers) {
      const { root } = await onConversation(answer)
      root.tap('data-delete', '3')
      root.tap('data-delete-confirm', '3')
      await settle()
      expect(isHistory(root.innerHTML)).toBe(false)
      expect(sectionsOn(root.innerHTML)[0]!.promises).toHaveLength(5)
      expect(root.innerHTML).toContain(`<p class="note">${DELETE_NOT_DONE}</p>`)
      expect(root.innerHTML).not.toContain('class="error"')
      expect(root.innerHTML, 'the control is back, to try again').toContain('data-delete="3"')
    }
  })

  it('reaches only the phone API: no socket is opened, so /audio and the lens are never touched (P5)', async () => {
    const opened: string[] = []
    const saved = globalThis.WebSocket
    ;(globalThis as Record<string, unknown>).WebSocket = class {
      constructor(url: string) {
        opened.push(url)
      }
    }
    try {
      const { asked, root } = await onConversation()
      root.tap('data-delete', '3')
      root.tap('data-delete-confirm', '3')
      await settle()
      expect(opened).toEqual([])
      expect(asked.every((a) => a.path.startsWith('/phone/'))).toBe(true)
    } finally {
      ;(globalThis as Record<string, unknown>).WebSocket = saved
    }
  })

  it('draws the history from its answer when the wearer has gone back to it meanwhile, and touches no other screen', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const { root, phone } = await onConversation(async () => {
      await held
      return json(AFTER)()
    })
    root.tap('data-delete', '3')
    root.tap('data-delete-confirm', '3')
    await phone.home()
    expect(rowsOn(root.innerHTML).map((r) => r.conversation), 'the history answered before the delete landed').toEqual(['3', '2', '1', '0'])
    release()
    await settle()
    expect(rowsOn(root.innerHTML).map((r) => r.conversation)).toEqual(['2', '1', '0'])
  })
})
