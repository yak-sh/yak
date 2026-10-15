// Compiler-owned public modules. Their directory names the complete emitted
// package graph, including dependency URLs and resources. They have their own
// storage namespace: an app's private content-addressed bytes never cross this
// door. These URLs outlive releases and apps, as browser caches do.
//
// An npm package's home (@yaks/esbuild home.ts) is served here too:
// `__packages/<sha256>/` holds the files of the registry tarball whose SHA-256
// names it, each put there the first time a page asks for it. Beside it,
// `__packages/<sha256>.json` says where that tarball is, written when a compile
// first names the home (esbuild.ts), and once the tarball has been read, every
// path it holds, so a path it does not hold answers 404 without reading it
// again. Only a home a compile named is ever filled.
import { mimeOf, type Objects, rangedOpen } from '@yaks/blob'
import { REGISTRY } from '@yaks/esbuild'
import { immutable } from './cache.ts'
import type { Env } from './env.ts'
import { r2RawObjects } from './lib/objects.ts'

export let PREFIX = '__packages/'

export let valid = (path: string) =>
  /^__packages\/[a-f0-9]{64}\/.+/.test(path) &&
  !/[\\?#%]/.test(path) &&
  !path.split('/').some((p) => !p || p == '.' || p == '..')

/** Where a home's tarball is, and once read, every path it holds. */
type Home = { tarball: string; paths?: string[] }

let noteOf = (sha256: string) => `${PREFIX}${sha256}.json`
let encode = (home: Home) => new TextEncoder().encode(JSON.stringify(home))

/** Whether a compile may name this home: a SHA-256, filled from a tarball on
 * the npm registry, since the door fetches it for whoever asks. */
export let fillable = (sha256: string, tarball: string) =>
  /^[a-f0-9]{64}$/.test(sha256) && tarball.startsWith(`${REGISTRY}/`)

/** Note where each home a compile named is filled from, once. */
export let noted = (
  blobs: Pick<Objects, 'has' | 'put'>,
  tarballs: Record<string, string>,
) =>
  Promise.all(
    Object.entries(tarballs).map(async ([sha256, tarball]) => {
      if (!await blobs.has(noteOf(sha256))) {
        await blobs.put(noteOf(sha256), encode({ tarball }))
      }
    }),
  )

// A file of a package's home, put there out of its tarball; null when no
// compile named the home, or its tarball holds no such file. A tarball that
// cannot be read, or is not the one the home names, is a failure.
let filled = async (raw: Objects, path: string) => {
  let [, sha256, want] = /^__packages\/([a-f0-9]{64})\/(.+)$/.exec(path)!
  let note = await raw.read(noteOf(sha256))
  if (!note) return null
  let home: Home = JSON.parse(new TextDecoder().decode(note))
  if (home.paths && !home.paths.includes(want)) return null
  let r = await globalThis.fetch(home.tarball)
  if (!r.ok || !r.body) {
    throw new Error(`${home.tarball} answered ${r.status}`)
  }
  // Loaded by the first fill, never by an isolate's start.
  let { unpacked } = await import('@yaks/esbuild/unpack')
  let got = await unpacked(r.body, want)
  if (got.sha256 != sha256) {
    throw new Error(`${home.tarball} is not the tarball ${sha256} names`)
  }
  await Promise.all([
    got.bytes && raw.put(path, got.bytes),
    home.paths ??
      raw.put(noteOf(sha256), encode({ ...home, paths: got.paths })),
  ])
  return got.bytes && raw.open(path)
}

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
  let raw = r2RawObjects(env.BLOBS)
  let object = valid(path)
    ? await raw.open(path) ?? await filled(raw, path)
    : null
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
