// The account API endpoint used to upload app workers and their resources,
// and the fetch a call to it goes through.
// A probe points it at its Cloudflare stand-in; production uses Cloudflare.
import { sleep } from '@yaks/fp'
import type { Env } from './env.ts'

export let accountUrl = (env: Env, path: string) =>
  `${env.WORKERS_API ?? 'https://api.cloudflare.com/client/v4'}` +
  `/accounts/${env.CF_ACCOUNT}${path}`

/** The pauses before a call Cloudflare failed on its own side is sent again,
 * one per resend: about eight seconds in all, which a passing failure rarely
 * outlasts. A test replaces `wait`. */
export let resends = {
  pauses: [500, 2_000, 6_000],
  wait: (ms: number) => sleep(ms),
}

// The calls that do the same thing however often they are sent (RFC 9110
// 9.2.2). A POST or PATCH that failed may still have done its work, so it is
// sent once.
let IDEMPOTENT = ['GET', 'HEAD', 'PUT', 'DELETE']

// An answer that is Cloudflare's own failure rather than a refusal of the
// call: its servers erred, or it asked for a slower pace. A 401 or 403
// refuses the token, which fails every time and is answered at once
// (bindings.ts names the scope it lacks).
let passing = (status: number) => status >= 500 || status == 429

/** `fetch`, where an idempotent call that Cloudflare fails on its own side
 * (a passing status, or a connection that dropped) is sent again after each
 * of {@link resends}' pauses. The last answer, or the last failure, is the
 * caller's, so one that outlasts them reads as it always did. */
export let resent = async (
  url: string,
  init: RequestInit = {},
): Promise<Response> => {
  let again = IDEMPOTENT.includes((init.method ?? 'GET').toUpperCase()) &&
    !(init.body instanceof ReadableStream)
  for (let sent = 0;; sent++) {
    let pause = again ? resends.pauses[sent] : undefined
    try {
      let r = await fetch(url, init)
      if (pause == null || !passing(r.status)) return r
      await r.body?.cancel()
    } catch (e) {
      if (pause == null || init.signal?.aborted) throw e
    }
    await resends.wait(pause)
  }
}
