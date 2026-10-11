// Compiler-owned public modules. Their directory names the complete emitted
// package graph, including dependency URLs and resources. They have their own
// storage namespace: an app's private content-addressed bytes never cross this
// door. These URLs outlive releases and apps, as browser caches do.
import { mimeOf, rangedOpen } from '@yaks/blob'
import { immutable } from './cache.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'

export let PREFIX = '__packages/'

export let valid = (path: string) =>
  /^__packages\/[a-f0-9]{64}\/.+/.test(path) &&
  !/[\\?#%]/.test(path) &&
  !path.split('/').some((p) => !p || p == '.' || p == '..')

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'timing-allow-origin': '*',
    'x-content-type-options': 'nosniff',
  }
  if (req.method == 'OPTIONS') return new Response(null, { headers })
  if (req.method != 'GET' && req.method != 'HEAD') {
    return new Response(null, { status: 405, headers })
  }
  let path = new URL(req.url).pathname.slice(1)
  let object = valid(path) ? await r2RawObjects(env.BLOBS).open(path) : null
  if (!object) {
    return new Response('not found', {
      status: 404,
      headers: { ...headers, 'cache-control': 'private, no-store' },
    })
  }
  return rangedOpen(object, req, {
    ...headers,
    ...immutable,
    'content-type': mimeOf(path),
    etag: `"${object.version}"`,
  })
}
