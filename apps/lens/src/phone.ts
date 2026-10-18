import {
  PHONE_CONVERSATION_PATH,
  PHONE_DONE_SUFFIX,
  PHONE_END_PATH,
  PHONE_HISTORY_PATH,
  PHONE_JOGGER_SUFFIX,
  PHONE_NAMES_SUFFIX,
  PHONE_PROMISES_SUFFIX,
  PHONE_PROMISE_PATH,
  type ConversationResponse,
  type HistoryResponse,
  type HistoryRow,
  type JoggerResponse,
  type PhonePromise,
} from '../../../shared/phone-protocol.ts'

// The phone page (D130): the plugin's own page, which the Even app shows on
// the phone while the glasses run the lens. Three screens:
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
// A conversation's screen ends with `Delete conversation` (D134). A first tap
// only asks: the control becomes a confirm, `Delete` and `Cancel`; Cancel puts
// the screen back as it was and asks the server nothing. Delete (the second,
// explicit tap) asks the server to delete it, everything with it, and draws
// the history the server answers, which no longer lists it, with the open
// count as it now stands; the history is then the screen. A delete that does
// not reach the server, or that it refuses, leaves the conversation's screen
// with one quiet line saying it was not deleted, never an error screen; a
// second tap on Delete while the first is on its way asks nothing.
//
// Everything comes from the server's phone API (shared/phone-protocol.ts),
// with the shared token; a tick and a delete are its two writes. Nothing
// here touches the lens or /audio. Each screen is drawn by
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
  /**
   * Deletes the conversation showing (D134), only once its confirm is showing
   * (the second tap); settles once the server has answered (or failed to).
   */
  remove(id: number): Promise<void>
  /**
   * Ends the open conversation now, as a long-press does (the Even OS keeps
   * long-press on the real G2), then shows the history; settles once the
   * history has been drawn. A conversation is listed once its promises are in.
   */
  endConversation(): Promise<void>
  /** D135: adds a name to conversation `id` by hand, then draws its screen as the server answers it. */
  addName(id: number, name: string): Promise<void>
  /** D135: adds a promise by hand, the wearer's (`you`) or owed to the wearer (`owed`), then draws the screen. */
  addPromise(id: number, side: 'you' | 'owed', text: string): Promise<void>
}

/** The history's button that ends the open conversation (the glasses' long-press is the Even OS's). */
export const END_CONVERSATION = 'End conversation'
/** What the history says while an ended conversation's promises are still being judged. */
/** What a conversation's screen says when a hand-added name or promise did not reach the server (D135). */
export const ADD_NOT_SAVED = 'Not added yet. Try again in a moment.'
export const ENDING_NOTE = 'Ending… it shows here in a few seconds.'

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
  return `<main class="phone history"><header><h1>Catch</h1><p class="open-total">${openOf(history.open)}</p><button type="button" class="end" data-end>${END_CONVERSATION}</button></header>${body}</main>`
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

/** What a delete that did not reach the server, or that it refused, says (D134). */
export const DELETE_NOT_DONE = 'Not deleted. Try again in a moment.'

/** The foot of a conversation's screen (D134): the delete control, or, after its first tap, the confirm. */
function deleteControl(id: number, confirming: boolean): string {
  if (!confirming) return `<button type="button" class="delete" data-delete="${id}">Delete conversation</button>`
  return (
    '<div class="delete-confirm">' +
    '<p>Delete this conversation? Its names, promises and jogger go too.</p>' +
    `<button type="button" class="delete-yes" data-delete-confirm="${id}">Delete</button>` +
    '<button type="button" class="delete-no" data-delete-cancel>Cancel</button>' +
    '</div>'
  )
}

/** One conversation's screen (D98): every open promise in full, whatever the notification cut; at its foot, its delete (D134). */
export function conversationMarkup(c: ConversationResponse, now: number, note?: string, confirmingDelete = false): string {
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
    addControls(c.id) +
    deleteControl(c.id, confirmingDelete) +
    '</main>'
  )
}

/** D135: a name, or a promise (the wearer's or owed to the wearer), added by hand to this conversation. */
function addControls(id: number): string {
  return (
    `<section class="add" data-add="${id}">` +
    '<input type="text" class="add-name" maxlength="300" placeholder="Add a name" aria-label="name">' +
    `<button type="button" data-add-name="${id}">Add name</button>` +
    '<input type="text" class="add-promise" maxlength="300" placeholder="Add a promise" aria-label="promise">' +
    '<select class="add-side" aria-label="whose"><option value="you">Mine (YOU)</option><option value="owed">Owed to me</option></select>' +
    `<button type="button" data-add-promise="${id}">Add promise</button>` +
    '</section>'
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
  // The conversation whose delete confirm is showing (D134), and the delete on its way to the server.
  let confirming: number | undefined
  let deleting: number | undefined

  /** A conversation as the screen draws it: a tick on its way or confirmed is done (D39). */
  const settled = (c: ConversationResponse): ConversationResponse => {
    const mark = (p: PhonePromise) => (ticking.has(p.id) || ticked.has(p.id) ? { ...p, done: true } : p)
    return { ...c, you: c.you.map(mark), owed: c.owed.map(mark) }
  }
  const drawConversation = (c: ConversationResponse, note?: string) => {
    shown = c
    root.innerHTML = conversationMarkup(settled(c), now(), note, confirming === c.id)
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

  /** The delete control's first tap (D134): the confirm, on the conversation showing; nothing is asked of the server. */
  function askDelete(id: number): void {
    if (shown?.id !== id || deleting !== undefined) return
    confirming = id
    drawConversation(shown)
  }

  /** Cancel (D134): the screen as it was, and nothing asked. */
  function cancelDelete(): void {
    if (confirming === undefined) return
    confirming = undefined
    if (shown) drawConversation(shown)
  }

  /**
   * The confirm's Delete (D134): the server deletes the conversation and
   * answers the history, which is drawn and becomes the screen. One that does
   * not reach the server, or that it refuses, leaves the conversation's
   * screen with a quiet line. Only while the confirm is showing; a second tap
   * meanwhile asks nothing.
   */
  async function remove(id: number): Promise<void> {
    if (confirming !== id || shown?.id !== id || deleting !== undefined) return
    deleting = id
    let answer: HistoryResponse | undefined
    try {
      const res = await fetch(`${origin}${PHONE_CONVERSATION_PATH}${id}`, { method: 'DELETE', headers: auth })
      if (res.ok) answer = (await res.json()) as HistoryResponse
    } catch {
      answer = undefined
    }
    deleting = undefined
    if (confirming === id) confirming = undefined
    const done = answer !== undefined && Array.isArray(answer.conversations) && !answer.conversations.some((c) => c.id === id)
    if (done) {
      // Still on its screen, or gone back to the history meanwhile: the history the server answered is drawn, and is the screen.
      if (shown?.id === id || screen === history) {
        asked++
        shown = undefined
        screen = history
        root.innerHTML = historyMarkup(answer!, now())
      }
      return
    }
    if (shown?.id === id) drawConversation(shown, DELETE_NOT_DONE)
  }

  /** Another screen asked for: it becomes the screen a refresh asks for again, and a confirm showing is let go (D134). */
  const go = (next: () => Promise<void>) => {
    confirming = undefined
    screen = next
    return next()
  }

  /** POSTs the end, then draws the history; once more a few seconds later, when the conversation's promises are in. */
  async function endConversation(): Promise<void> {
    try {
      await fetch(`${origin}${PHONE_END_PATH}`, { method: 'POST', headers: auth })
    } catch {
      // Unreachable: the history says so when it is drawn.
    }
    await go(history)
    if (root.innerHTML.includes('class="empty"')) root.innerHTML = root.innerHTML.replace(/<p class="empty">[^<]*<\/p>/, `<p class="empty">${ENDING_NOTE}</p>`)
    setTimeout(() => {
      if (shown === undefined && root.innerHTML.includes('phone history')) void go(history)
    }, 4000)
  }

  /** POSTs a hand-added name or promise (D135) and draws the conversation as the server answers it. */
  async function add(id: number, suffix: string, body: unknown): Promise<void> {
    try {
      const res = await fetch(`${origin}${PHONE_CONVERSATION_PATH}${id}${suffix}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok) {
        drawConversation((await res.json()) as ConversationResponse)
        return
      }
    } catch {
      // Unreachable: drawn below as not saved.
    }
    if (shown?.id === id) root.innerHTML = conversationMarkup(shown, now(), ADD_NOT_SAVED)
  }

  const phone: Phone = {
    home: () => go(history),
    open: (id) => go(() => conversation(id)),
    jogger: (id) => go(() => jogger(id)),
    openNotification: (data) => {
      const id = Number(data?.conversation)
      if (!Number.isInteger(id)) return phone.home()
      return data?.screen === 'jogger' ? phone.jogger(id) : phone.open(id)
    },
    refresh: () => screen(),
    tick,
    remove,
    endConversation,
    addName: (id, name) => add(id, PHONE_NAMES_SUFFIX, { name }),
    addPromise: (id, side, text) => add(id, PHONE_PROMISES_SUFFIX, { side, text }),
  }

  root.addEventListener('click', ({ target }) => {
    const t = target as Closest
    const box = t.closest?.('[data-tick]')?.getAttribute('data-tick')
    const conversation = t.closest?.('[data-conversation]')?.getAttribute('data-conversation')
    const kept = t.closest?.('[data-jogger]')?.getAttribute('data-jogger')
    const ask = t.closest?.('[data-delete]')?.getAttribute('data-delete')
    const confirm = t.closest?.('[data-delete-confirm]')?.getAttribute('data-delete-confirm')
    if (ask) askDelete(Number(ask))
    else if (confirm) void phone.remove(Number(confirm))
    else if (t.closest?.('[data-delete-cancel]')) cancelDelete()
    else if (box) void phone.tick(Number(box))
    else if (conversation) void phone.open(Number(conversation))
    else if (kept) void phone.jogger(Number(kept))
    else if (t.closest?.('[data-home]')) void phone.home()
    else if (t.closest?.('[data-end]')) void phone.endConversation()
    else if (t.closest?.('[data-add-name]') || t.closest?.('[data-add-promise]')) {
      // D135: read what the wearer typed from the screen's own inputs.
      const box = t.closest?.('[data-add]') as unknown as { querySelector?: (q: string) => { value?: string } | null } | null
      const id = Number(box && (box as unknown as { getAttribute(a: string): string | null }).getAttribute('data-add'))
      const field = (q: string) => box?.querySelector?.(q)?.value?.trim() ?? ''
      if (t.closest?.('[data-add-name]')) {
        if (field('.add-name')) void phone.addName(id, field('.add-name'))
      } else if (field('.add-promise')) void phone.addPromise(id, field('.add-side') === 'owed' ? 'owed' : 'you', field('.add-promise'))
    }
  })
  return phone
}
