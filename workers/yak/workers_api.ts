// The account API endpoint used to upload app workers and their resources,
// and the fetch every call to Cloudflare's API goes through, whatever it
// names: scripts, D1, R2 and Vectorize, analytics, custom hostnames, tunnels,
// build logs and Email Sending.
// A probe points it at its Cloudflare stand-in; production uses Cloudflare.
import { sleep } from '@yaks/fp'
import type { Env } from './env.ts'

export let accountUrl = (env: Env, path: string) =>
  `${env.WORKERS_API ?? 'https://api.cloudflare.com/client/v4'}` +
  `/accounts/${env.CF_ACCOUNT}${path}`

/** The pauses before a call Cloudflare failed on its own side is sent again,
 * one per resend: about eight seconds in all, which a passing failure rarely
 * outlasts. */
let PAUSES = [500, 2_000, 6_000]

// The calls that do the same thing however often they are sent (RFC 9110
// 9.2.2). A POST or PATCH that failed may still have done its work, so it is
// sent once, unless its caller says it only reads (`idempotent`).
let IDEMPOTENT = ['GET', 'HEAD', 'PUT', 'DELETE']

/** Whether an answer is Cloudflare's own failure rather than a refusal of the
 * call: its servers erred, or it asked for a slower pace. A 401 or 403
 * refuses the token, which fails every time and is answered at once
 * (bindings.ts names the scope it lacks).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([500, 503, 429, 403, 404].map(passing), [true, true, true, false, false])
 * ```
 */
export let passing = (status: number) => status >= 500 || status == 429

/** A call Cloudflare failed on its own side through every resend: a passing
 * status, or a connection that kept dropping. It refused nothing, so a later
 * call may well be answered: a platform job that meets one is in an outage,
 * not broken, until it lasts (wake.ts `reporting`). */
export class Unavailable extends Error {
  override name = 'Unavailable'
}

/** What a call Cloudflare did not answer with success is thrown as:
 * {@link Unavailable} when the failure was its own, else an Error, since it
 * refused the call.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(failure(500, 'down').name, 'Unavailable')
 * assertEquals(failure(403, 'no').name, 'Error')
 * ```
 */
export let failure = (status: number, message: string): Error =>
  passing(status) ? new Unavailable(message) : new Error(message)

/** `fetch`, where an idempotent call that Cloudflare fails on its own side
 * (a passing status, or a connection that dropped) is sent again after each
 * pause. A POST its caller says only reads (an analytics
 * query) is `idempotent` too. The last answer is the caller's; a connection
 * still dropping after the last pause is thrown as {@link Unavailable}, and
 * a call sent once throws what its fetch threw. */
export let resent = async (
  url: string,
  init: RequestInit = {},
  { idempotent = IDEMPOTENT.includes((init.method ?? 'GET').toUpperCase()) } =
    {},
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Response> => {
  let again = idempotent && !(init.body instanceof ReadableStream)
  for (let sent = 0;; sent++) {
    let pause = again ? PAUSES[sent] : undefined
    try {
      let r = await fetch(url, init)
      if (pause == null || !passing(r.status)) return r
      await r.body?.cancel()
    } catch (e) {
      if (!again || init.signal?.aborted) throw e
      if (pause == null) {
        throw new Unavailable(e instanceof Error ? e.message : String(e), {
          cause: e,
        })
      }
    }
    await wait(pause)
  }
}
