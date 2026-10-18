// The server origin `npm run lens:pack` builds the lens against, from
// app.json's network whitelist (fix round, M2; operator answer 1). The packed
// page reaches the server at a ws(s) origin (the lens's /audio) and at its
// http(s) twin (the phone page's /phone, D130), and Even's whitelist entries
// are scheme-qualified origins, so the whitelist holds both. The rule: exactly
// one ws(s) entry, which the lens is built against, and every entry on that
// one host (scheme aside), so a Beta build reaches one server and nothing else.

export function lensServer(whitelist: readonly string[]): { server?: string; error?: string } {
  const sockets = whitelist.filter((origin) => /^wss?:\/\//.test(origin))
  if (sockets.length !== 1) {
    return { error: `lens:pack: app.json must whitelist exactly one ws(s):// server origin, found ${JSON.stringify(whitelist)}` }
  }
  const server = sockets[0]!
  const host = (origin: string) => {
    try {
      return new URL(origin).host
    } catch {
      return undefined
    }
  }
  const strays = whitelist.filter((origin) => host(origin) !== host(server))
  if (strays.length > 0) {
    return { error: `lens:pack: every app.json whitelist entry must share the one host of ${server}, but ${JSON.stringify(strays)} do not` }
  }
  return { server }
}
