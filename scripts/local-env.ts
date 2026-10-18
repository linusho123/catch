// The server's environment under `npm run local` (D128): the wearer's .env
// (read by Node's --env-file-if-exists), the port, and one default of the
// local path's own. On a laptop microphone (a MacBook Air, operator, P5) the
// server's -20 dBFS near-field threshold puts the wearer's normal voice under
// it, so nothing the wearer says is the wearer's; -25 separated the wearer at
// about 30 cm from another voice at about 2 m. So `npm run local` gives the
// server -25 when the .env sets no threshold (a blank value, as a name-only
// line copied from .env.example would leave, counts as none). The server's
// own default (split.ts) and the fixtures stay at -20.

/** The near-field threshold `npm run local` uses when the .env sets none. A tuning value for the laptop mic, not a ruling. */
export const LOCAL_LOUDNESS_THRESHOLD_DBFS = '-25'

export function localServerEnv(env: NodeJS.ProcessEnv, port: string): NodeJS.ProcessEnv {
  const set = env.CATCH_LOUDNESS_THRESHOLD_DBFS?.trim()
  return { ...env, PORT: port, CATCH_LOUDNESS_THRESHOLD_DBFS: set ? env.CATCH_LOUDNESS_THRESHOLD_DBFS : LOCAL_LOUDNESS_THRESHOLD_DBFS }
}
