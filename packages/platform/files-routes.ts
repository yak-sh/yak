// The `yak/files` routes facet: an app's release answering at its own
// addresses with its files, by the rules every host serves them by
// (./files.ts), read through the `file` its host lends (./lent.ts). Its
// wrangler config is read on each request, so a release edited while it is
// served answers as it stands. A host that lends no `file` gets no route.
import type { Loaded } from '@yaks/blob'
import { mimeOf } from '@yaks/blob'
import type { Route } from '@yaks/api/routed'
import type { Options } from './lent.ts'
import {
  decoded,
  inside,
  resolve,
  rootOf,
  type Serving,
  serving,
  WORKER,
} from './files.ts'

type Read = (path: string) => Promise<Loaded | null>

// What the release's wrangler config says of serving, the `.jsonc` first.
let configOf = async (file: Read): Promise<Serving> => {
  let [jsonc, json] = await Promise.all(
    ['/wrangler.jsonc', '/wrangler.json'].map(file),
  )
  let text = jsonc ?? json
  return text ? serving(new TextDecoder().decode(text.bytes)) : {}
}

let missing = () =>
  new Response('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

/** The answer a release's file is, tagged by its version so a page that
 * holds it is answered 304. */
let answer = (req: Request, file: Loaded, path: string, status = 200) => {
  let etag = `"${file.version}"`
  let headers = { etag, 'cache-control': 'no-cache' }
  if (status == 200 && req.headers.get('if-none-match') == etag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(file.bytes, {
    status,
    headers: { ...headers, 'content-type': mimeOf(path) },
  })
}

/** What a request for one of the release's addresses answers. */
export let fileAt = async (file: Read, req: Request): Promise<Response> => {
  let at = decoded(new URL(req.url).pathname)
  if (at == null || inside(at)) return missing()
  let config = await configOf(file)
  let root = rootOf('', config)
  // The server source is never served, even where `main` names a file inside
  // the served folder.
  if (`${root}${at}` == `/${config.main ?? WORKER}`) return missing()
  let found = await resolve(
    at,
    (p) => file(`${root}${p}`),
    config.assets?.not_found_handling,
  )
  if (!found) return missing()
  if ('to' in found) {
    return new Response(null, { status: 307, headers: { location: found.to } })
  }
  return answer(req, found.file, found.path, found.status)
}

export let routes = (_host: unknown, { store }: Options): Route[] => {
  let file = store.file
  if (!file) return []
  return [{
    method: 'GET',
    path: '/*',
    handle: (req) => fileAt(file, req),
    says: 'the release’s own files',
  }]
}
