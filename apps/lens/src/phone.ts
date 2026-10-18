import {
  PHONE_CONVERSATION_PATH,
  PHONE_DONE_SUFFIX,
  PHONE_HISTORY_PATH,
  PHONE_JOGGER_SUFFIX,
  PHONE_PROMISE_PATH,
  type ConversationResponse,
  type HistoryResponse,
  type HistoryRow,
  type JoggerResponse,
  type PhonePromise,
} from '../../../shared/phone-protocol.ts'

// The phone page (D130): the plugin's own page, which the Even app shows on
// the phone while the glasses run the lens. Two screens and nothing else yet:
// the history (D100), newest first and grouped by day, each row with the names
// caught (or "no name"), the time, the open promises (or "all done") and a
// kept mark, with every open promise counted in the header (the wearer's own,
// YOU, never the owed ones: operator answer 2); and one
// conversation's screen (D98), its names and time on top, then YOU and OWED TO
// YOU, each promise with a tick box. A tick (D39, D133, P7) takes the promise
// off the screen at once and asks the server to mark it done; the server's
// answer, the conversation as the store now holds it, is drawn in its place.
// A tick that does not reach the server puts the promise back, with a quiet
// line saying it was not saved; nothing else on the page changes. Ticks are
// never undone, so a promise the server confirmed stays off the screen even
// if an older answer arrives late. A kept conversation's screen links
// to its jogger, "Kept conversation ›" (P4), the third screen (D99): the names
// and the length on top, then one flat list of bullets in the order things
// came up, the technical terms in bold. A notification opened on the phone
// opens the screen its data names: the jogger for a kept one, the
// conversation's screen for the promises (`openNotification`).
//
// Everything comes from the server's phone API (shared/phone-protocol.ts),
// with the shared token; a tick is its one write. Nothing here touches the
// lens or /audio. Each screen is drawn by
// one write of its markup into the page's root, so the test harness reads
// exactly what the WebView was given (test/harness/phone.ts).

/** The part of the page's root element the phone page uses. */
export interface PhoneRoot {
  innerHTML: string
  addEventListener(type: 'click', listener: (event: { target: unknown }) => void): void
}

export interface PhoneOptions {
  root: PhoneRoot
  /** The server origin, http(s)://…; a ws(s):// origin is turned into its http(s) twin. */
  server: string
  /** The shared token (the server's CATCH_AUDIO_TOKEN). */
  token: string
  fetch?: typeof globalThis.fetch
  /** The phone's clock, for "today" and "yesterday". */
  now?: () => number
}

export interface Phone {
  /** Settles when the history has been drawn (or its failure has). */
  home(): Promise<void>
  /** Settles when the conversation's screen has been drawn (or its failure has). */
  open(id: number): Promise<void>
  /** Settles when the kept conversation's jogger has been drawn (or its failure has). */
  jogger(id: number): Promise<void>
  /** A notification opened on the phone: the screen its data names (the jogger for a kept conversation, else the conversation's screen). */
  openNotification(data: Record<string, string> | undefined): Promise<void>
  /** Re-draws the screen last asked for, from the server again: the page coming back into view (fix round, M5). */
  refresh(): Promise<void>
  /** Ticks a promise on the conversation screen showing off (D39); settles once the server has answered (or failed to). */
  tick(promise: number): Promise<void>
}

/** The http(s) origin a ws(s) server origin shares a host with. */
export function httpOrigin(server: string): string {
  return server.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '')
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!)

/** "2:10 pm": the phone's own time zone. */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

const dayStart = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** The day heading a conversation sits under: TODAY, YESTERDAY, or the date. */
export function dayLabel(ms: number, now: number): string {
  const day = dayStart(ms)
  const today = dayStart(now)
  if (day === today) return 'TODAY'
  // A day back from today's midnight, by the calendar (a day is not always 24 hours).
  const yesterday = dayStart(today - 1)
  if (day === yesterday) return 'YESTERDAY'
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()
}

const namesOf = (names: string[]) => (names.length > 0 ? names.join(', ') : 'no name')
const openOf = (open: number) => (open > 0 ? `${open} open` : 'all done')
const timeTag = (ms: number) => `<time datetime="${new Date(ms).toISOString()}">${clockTime(ms)}</time>`

function row(c: HistoryRow): string {
  return (
    `<li class="row" data-conversation="${c.id}">` +
    `<span class="names">${esc(namesOf(c.names))}</span>` +
    timeTag(c.startedAt) +
    `<span class="open">${openOf(c.open)}</span>` +
    (c.kept ? '<span class="kept">kept</span>' : '') +
    '</li>'
  )
}

/** The history screen (D100). */
export function historyMarkup(history: HistoryResponse, now: number): string {
  const days: { label: string; rows: HistoryRow[] }[] = []
  for (const c of history.conversations) {
    const label = dayLabel(c.startedAt, now)
    const last = days.at(-1)
    if (last?.label === label) last.rows.push(c)
    else days.push({ label, rows: [c] })
  }
  const body =
    days.length === 0
      ? '<p class="empty">Nothing yet. A conversation shows up here when it ends with a promise or is kept.</p>'
      : days.map((d) => `<section class="day"><h2>${esc(d.label)}</h2><ul>${d.rows.map(row).join('')}</ul></section>`).join('')
  return `<main class="phone history"><header><h1>Catch</h1><p class="open-total">${openOf(history.open)}</p></header>${body}</main>`
}

function promiseItem(p: PhonePromise): string {
  return `<li class="promise"><input type="checkbox" data-tick="${p.id}" aria-label="done"><span class="text">${esc(p.text)}</span></li>`
}

/** A section's open promises: a ticked one has left the list (D39). */
function section(kind: 'you' | 'owed', title: string, promises: PhonePromise[]): string {
  return `<section class="${kind}"><h2>${title}</h2><ul>${promises.filter((p) => !p.done).map(promiseItem).join('')}</ul></section>`
}

/** What a tick that did not reach the server says: calm, and only that it was not saved. */
export const TICK_NOT_SAVED = 'Not saved yet. Tick it again in a moment.'

/** One conversation's screen (D98): every open promise in full, whatever the notification cut. */
export function conversationMarkup(c: ConversationResponse, now: number, note?: string): string {
  const day = dayLabel(c.startedAt, now)
  return (
    '<main class="phone conversation">' +
    '<header><button type="button" class="back" data-home>‹ History</button>' +
    `<h1 class="names">${esc(namesOf(c.names))}</h1>` +
    `<p class="when">${esc(day.charAt(0) + day.slice(1).toLowerCase())} · ${timeTag(c.startedAt)}</p></header>` +
    section('you', 'YOU', c.you) +
    section('owed', 'OWED TO YOU', c.owed) +
    (note ? `<p class="note">${esc(note)}</p>` : '') +
    (c.jogger ? `<button type="button" class="jogger-link" data-jogger="${c.id}">Kept conversation ›</button>` : '') +
    '</main>'
  )
}

/** "25 min", "3 h", "3 h 5 min": a conversation's length for the jogger's header (D99). */
export function lengthOf(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** A bullet's text, escaped, with its `**term**` spans set in bold. */
const bulletHtml = (text: string) => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

/** A kept conversation's jogger (D99): the names and the length on top, then one flat list of bullets. */
export function joggerMarkup(j: JoggerResponse): string {
  return (
    '<main class="phone jogger">' +
    `<header><button type="button" class="back" data-conversation="${j.id}">‹ Conversation</button>` +
    `<h1 class="names">${esc(namesOf(j.names))}</h1>` +
    `<p class="length">${lengthOf(j.endedAt - j.startedAt)}</p></header>` +
    `<ul class="bullets">${j.bullets.map((b) => `<li>${bulletHtml(b)}</li>`).join('')}</ul>` +
    '</main>'
  )
}

const failureMarkup = (what: string) => `<main class="phone"><p class="error">${esc(what)}</p><button type="button" data-home>Try again</button></main>`

interface Closest {
  closest?(selector: string): { getAttribute(name: string): string | null } | null
}

export function startPhone(opts: PhoneOptions): Phone {
  const { root, token } = opts
  const origin = httpOrigin(opts.server)
  const fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  const now = opts.now ?? Date.now
  const auth = { authorization: `Bearer ${token}` }
  // The newest screen asked for wins; an older answer arriving late is dropped.
  let asked = 0
  // The conversation screen showing now, as last drawn (undefined on any other screen).
  let shown: ConversationResponse | undefined
  // Ticks on their way to the server, and ticks it has confirmed: neither is drawn again (D39).
  const ticking = new Set<number>()
  const ticked = new Set<number>()

  /** A conversation as the screen draws it: a tick on its way or confirmed is done (D39). */
  const settled = (c: ConversationResponse): ConversationResponse => {
    const mark = (p: PhonePromise) => (ticking.has(p.id) || ticked.has(p.id) ? { ...p, done: true } : p)
    return { ...c, you: c.you.map(mark), owed: c.owed.map(mark) }
  }
  const drawConversation = (c: ConversationResponse, note?: string) => {
    shown = c
    root.innerHTML = conversationMarkup(settled(c), now(), note)
  }

  /** Fetches a screen and draws it, unless another has been asked for meanwhile; a conversation is remembered as the one showing. */
  async function show<T>(path: string, markup: (body: T) => string, isConversation = false): Promise<void> {
    const mine = ++asked
    let html: string
    let conversation: ConversationResponse | undefined
    try {
      const res = await fetch(`${origin}${path}`, { headers: auth })
      if (!res.ok) throw new Error(res.status === 401 ? 'Catch refused this page’s token.' : `Catch answered ${res.status}.`)
      const body = (await res.json()) as T
      if (isConversation) conversation = body as ConversationResponse
      html = markup(body)
    } catch (err) {
      html = failureMarkup(err instanceof TypeError ? `Catch cannot be reached at ${origin}.` : (err as Error).message)
    }
    if (mine !== asked) return
    if (conversation) drawConversation(conversation)
    else {
      shown = undefined
      root.innerHTML = html
    }
  }

  const history = () => show<HistoryResponse>(PHONE_HISTORY_PATH, (h) => historyMarkup(h, now()))
  const conversation = (id: number) => show<ConversationResponse>(`${PHONE_CONVERSATION_PATH}${id}`, () => '', true)
  const jogger = (id: number) => show<JoggerResponse>(`${PHONE_CONVERSATION_PATH}${id}${PHONE_JOGGER_SUFFIX}`, joggerMarkup)
  // The screen last asked for, which a refresh asks for again.
  let screen: () => Promise<void> = history

  /**
   * A tick (D39): the promise leaves the screen at once, then the server's
   * answer is drawn; a tick that does not reach the server, or that the server
   * refuses, puts the promise back with a quiet line. A second tick of a
   * promise on its way or done asks nothing.
   */
  async function tick(promise: number): Promise<void> {
    const on = shown
    if (!on || ticking.has(promise) || ticked.has(promise)) return
    if (![...on.you, ...on.owed].some((p) => p.id === promise && !p.done)) return
    ticking.add(promise)
    drawConversation(on)
    let answer: ConversationResponse | undefined
    try {
      const res = await fetch(`${origin}${PHONE_PROMISE_PATH}${promise}${PHONE_DONE_SUFFIX}`, { method: 'PUT', headers: auth })
      if (res.ok) answer = (await res.json()) as ConversationResponse
    } catch {
      answer = undefined
    }
    ticking.delete(promise)
    const done = answer?.id === on.id && [...answer.you, ...answer.owed].some((p) => p.id === promise && p.done)
    if (done) ticked.add(promise)
    // Drawn again only while that conversation is the screen showing; any other screen drawn later reads the same sets.
    // A history the wearer went back to may have answered before the write landed: a confirmed tick asks it again, so its open count drops (risk-3).
    if (shown?.id !== on.id) {
      if (done && screen === history) await history()
      return
    }
    drawConversation(done ? answer! : shown, done ? undefined : TICK_NOT_SAVED)
  }

  const phone: Phone = {
    home: () => (screen = history)(),
    open: (id) => (screen = () => conversation(id))(),
    jogger: (id) => (screen = () => jogger(id))(),
    openNotification: (data) => {
      const id = Number(data?.conversation)
      if (!Number.isInteger(id)) return phone.home()
      return data?.screen === 'jogger' ? phone.jogger(id) : phone.open(id)
    },
    refresh: () => screen(),
    tick,
  }

  root.addEventListener('click', ({ target }) => {
    const t = target as Closest
    const box = t.closest?.('[data-tick]')?.getAttribute('data-tick')
    const conversation = t.closest?.('[data-conversation]')?.getAttribute('data-conversation')
    const kept = t.closest?.('[data-jogger]')?.getAttribute('data-jogger')
    if (box) void phone.tick(Number(box))
    else if (conversation) void phone.open(Number(conversation))
    else if (kept) void phone.jogger(Number(kept))
    else if (t.closest?.('[data-home]')) void phone.home()
  })
  return phone
}
