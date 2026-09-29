// Public pages drawn from this deployment's own files. A deploy changes the
// validator at the next revalidation; a conditional hit never reads or renders
// those files. The gateway itself remains outside Cloudflare's shared cache.
import type { Env } from './env.ts'
import { apex } from './host.ts'

type Deploy = Pick<Env, 'APEX' | 'CF_VERSION_METADATA'>

let tag = (env: Deploy, path: string, variant = '') => {
  let id = env.CF_VERSION_METADATA?.id
  return id
    ? `W/"${encodeURIComponent(`${id}:${apex(env)}:${path}:${variant}`)}"`
    : null
}

let bare = (value: string) => value.replace(/^W\//, '')

export let matches = (asked: string | null, etag: string) =>
  asked?.split(',').some((part) => {
    let value = part.trim()
    return value == '*' || bare(value) == bare(etag)
  }) ?? false

export let publicPage = async (
  req: Request,
  env: Deploy,
  path: string,
  draw: () => Promise<Response | null> | Response | null,
  maxAge = 300,
  variant = '',
): Promise<Response | null> => {
  let etag = tag(env, path, variant)
  let headers = new Headers({
    'cache-control': etag
      ? `public, max-age=${maxAge}, must-revalidate`
      : 'private, no-store',
  })
  if (etag) headers.set('etag', etag)
  if (etag && matches(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers })
  }
  let answer = await draw()
  if (!answer || answer.status != 200) return answer
  let copied = new Headers(answer.headers)
  headers.forEach((value, name) => copied.set(name, value))
  return new Response(req.method == 'HEAD' ? null : answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers: copied,
  })
}
