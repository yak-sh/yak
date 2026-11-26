// The `yak/files` routes facet: an app's release answering at its own
// addresses with its files, by the rules every host serves them by
// (./files.ts), read through the `file` its host lends (./lent.ts). Its
// wrangler config is read on each request, so a release edited while it is
// served answers as it stands. A host that lends no `file` gets no route.
//
// Its pages are dressed as yaks.app dresses them (./woven.ts): a base at the
// page's own folder, and the tracker's page reporter (@yaks/tracker/script)
// first in the head, told the page's mount and release. What the reporter
// catches it posts to `./api/report`, answered here (@yaks/tracker/report
// `door`) into the host's own telemetry. The release is served at the root,
// and a directory as it stands is release 0, as an app no deploy has
// numbered is on yaks.app.
import type { Loaded } from '@yaks/blob'
import { mimeOf } from '@yaks/blob'
import type { Route } from '@yaks/api/routed'
import type { Context } from '@yaks/tracker/report'
import { door, flood, thrown } from '@yaks/tracker/report'
import { script } from '@yaks/tracker/script'
import type { Options } from './lent.ts'
import { loadsAsset } from './kept.ts'
import {
  decoded,
  inside,
  resolve,
  rootOf,
  type Serving,
  serving,
  WORKER,
} from './files.ts'
import {
  based,
  baseOf,
  inline,
  intoHead,
  type Script,
  tagged,
} from './woven.ts'

type Read = (path: string) => Promise<Loaded | null>

let AT = '/'
let RELEASE = 0

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

/** A page of the release as it is sent: `page`, the file at `path` from the
 * served folder, given its base and the `reporter` ahead of its own code. */
export let dressed = (page: string, path: string, reporter: Script): string =>
  intoHead(
    based(baseOf(AT, path, false), page),
    tagged(AT, RELEASE, [[reporter]]).tags,
  )

/** The answer a release's file is, tagged by its version so a page that
 * holds it is answered 304. */
let answer = async (
  req: Request,
  file: Loaded,
  path: string,
  reporter: () => Promise<Script>,
  status = 200,
) => {
  let etag = `"${file.version}"`
  let headers = { etag, 'cache-control': 'no-cache' }
  if (status == 200 && req.headers.get('if-none-match') == etag) {
    return new Response(null, { status: 304, headers })
  }
  let type = mimeOf(path)
  let body = type.startsWith('text/html')
    ? dressed(new TextDecoder().decode(file.bytes), path, await reporter())
    : file.bytes
  return new Response(body, {
    status,
    headers: { ...headers, 'content-type': type },
  })
}

/** What a request for one of the release's addresses answers. */
export let fileAt = async (
  file: Read,
  req: Request,
  reporter: () => Promise<Script>,
): Promise<Response> => {
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
    loadsAsset(req),
  )
  if (!found) return missing()
  if ('to' in found) {
    return new Response(null, { status: 307, headers: { location: found.to } })
  }
  return answer(req, found.file, found.path, reporter, found.status)
}

// The reporter, read once; a read that failed is asked again by the next
// page.
let kept: Promise<Script> | undefined
let reporting = () =>
  kept ??= script().then(inline).catch((e) => {
    kept = undefined
    throw e
  })

export let routes = (
  host: { report?: (error: unknown, context?: Partial<Context>) => unknown },
  { store }: Options,
): Route[] => {
  let file = store.file
  if (!file) return []
  // Breaks a minute the release's pages may report, all together: a page in a
  // render loop that throws every frame must not file one a frame.
  let over = flood(30)
  return [{
    method: 'GET',
    path: '/*',
    handle: (req) => fileAt(file, req, reporting),
    says: 'the release’s own files',
  }, {
    method: 'POST',
    path: '/api/report',
    handle: door({
      flooding: () => over('page'),
      file: (b) => host.report?.(...thrown(b)),
    }),
    says: 'what the release’s pages report broke',
  }]
}
