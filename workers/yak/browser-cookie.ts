import { COOKIE, cookieValue } from '@yaks/platform/cookie'
import { apex, type Host } from '@yaks/platform/host'
import { hostOf } from '@yaks/platform/routes'
import { cookie, opened, verify } from './lib/token.ts'
import type { Env } from './env.ts'

export let HOST_COOKIE = '__Host-yak_session'
// Every shared cookie issued before this migration has expired by then.
export let SHARED_UNTIL = Date.parse('2027-02-16T00:00:00Z')

export let sessionCookie = (req: Request, env: Host = {}, now = Date.now()) => {
  let header = req.headers.get('cookie')
  if (hostOf(req, env) != apex(env)) return cookieValue(header)
  return cookieValue(header, HOST_COOKIE) ??
    (now < SHARED_UNTIL ? cookieValue(header) : null)
}

/** An apex cookie is host-only, secure and rooted, so no space can shadow it. */
export let hostCookie = (token: string, life: number) =>
  cookie(token, '', life).replace(`${COOKIE}=`, `${HOST_COOKIE}=`)

/** Copy session changes, including sign-out, to the apex's protected cookie. */
export let protectedCookie = async (req: Request, env: Env, res: Response) => {
  if (hostOf(req, env) != apex(env) || res.status == 101) return res
  let headers = new Headers(res.headers)
  let changed = false
  for (let set of res.headers.getSetCookie()) {
    if (!set.startsWith(`${COOKIE}=`)) continue
    changed = true
    headers.append(
      'set-cookie',
      set.replace(`${COOKIE}=`, `${HOST_COOKIE}=`)
        .replace(/;\s*Domain=[^;]+/i, ''),
    )
  }
  let token = !changed &&
    !cookieValue(req.headers.get('cookie'), HOST_COOKIE) &&
    sessionCookie(req, env)
  if (token && env.SESSION_SECRET) {
    let claims = await verify(token, env.SESSION_SECRET) ??
      await opened<{ exp: number }>('browser', token, env.SESSION_SECRET)
    let life = Math.floor((claims?.exp ?? 0) - Date.now() / 1000)
    if (life > 0) {
      changed = true
      headers.append('set-cookie', hostCookie(token, life))
    }
  }
  if (!changed) return res
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
