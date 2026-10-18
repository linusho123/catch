// The model layer's one error type with a loggable message.

/**
 * An error whose message carries no conversation text: no prompt, no answer.
 * Only such a message goes into the server's log (fix round, head-log-1:
 * D76 says nothing of an unkept conversation survives, a log included).
 */
export class SafeModelError extends Error {
  override name = 'SafeModelError'
}
