// The platform's wrapper on every app's worker, kept current (T-123111).
//
// An app's worker goes up wearing the platform's wrapper (dispatch.ts
// `shim`): the platform's code, not the app's, and what hands the app its
// doors. It is uploaded inside each script, so a release that changed it
// reached an app only when that app next deployed, and a kept release that a
// rollback puts back never. This pass closes that. Every script in the
// namespace not tagged with this release's `WRAP` has its wrapper replaced
// through Cloudflare's content door, which swaps the modules and leaves the
// bindings, secrets, limits and Durable Object classes as they were
// (https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/subresources/content/methods/update/).
// The app's own modules go back byte for byte, and the script is then tagged.
// The directory runs it at each release and daily after (facets/wrap-*.ts),
// so a script an older kernel uploaded while a release rolled out is caught
// by the next pass.
//
// The one race is an app deploy uploading the same script between this pass
// reading it and writing it back, which would put the app's previous modules
// back under its new release. A deploy uploads wearing `WRAP` already, so the
// tag is read again just before the write, and a script wearing it is left
// alone.
import {
  answered,
  type Module,
  moduleType,
  sent,
  shim,
  WRAP,
  wrapping,
} from './dispatch.ts'
import { WRAPPER } from './wrangler_app.ts'
import { caught } from './defects.ts'
import type { Env } from './env.ts'
import type { Bundle } from '@yaks/graph'

/** The directory's wrap row, and the daily pass it is seeded with. */
export let ROW = 'yak-wrap'
export let DAILY = '10 5 * * *'

/** The write that brings the wrap pass forward to `now`, for the wrap row as
 * the directory holds it: none where someone paused it (an explicit
 * `at: null`) or it is not there. */
export let forward = (
  row: Bundle | undefined,
  now: number,
): Bundle[] =>
  (row?.wake as { at?: string | null } | undefined)?.at
    ? [{ entity: { eid: ROW }, wake: { at: new Date(now).toISOString() } }]
    : []

let ENC = new TextEncoder()
let DEC = new TextDecoder()

// Where `needle` first occurs in `bytes` at or after `from`, or -1.
let find = (bytes: Uint8Array, needle: Uint8Array, from: number) => {
  let last = bytes.length - needle.length
  for (let i = bytes.indexOf(needle[0], from); i >= 0 && i <= last;) {
    let j = 1
    while (j < needle.length && bytes[i + j] == needle[j]) j++
    if (j == needle.length) return i
    i = bytes.indexOf(needle[0], i + 1)
  }
  return -1
}

/** The named parts of a multipart body, as bytes. Cloudflare's content door
 * names its parts without filenames, which `Response.formData()` reads as
 * text, and a module may be wasm. */
export let parts = (
  body: Uint8Array<ArrayBuffer>,
  boundary: string,
): Module[] => {
  let delim = ENC.encode(`--${boundary}`)
  let gap = ENC.encode('\r\n\r\n')
  let out: Module[] = []
  for (let at = find(body, delim, 0); at >= 0;) {
    let head = at + delim.length
    // `--` after a delimiter closes the body.
    if (body[head] == 0x2d && body[head + 1] == 0x2d) break
    let start = find(body, gap, head)
    let next = start < 0 ? -1 : find(body, delim, start)
    if (next < 0) break
    let said = DEC.decode(body.subarray(head, start))
    let name = /name="([^"]*)"/.exec(said)?.[1]
    // The CRLF before the next delimiter belongs to it, not to the part.
    if (name) {
      out.push({ name, bytes: body.slice(start + gap.length, next - 2) })
    }
    at = next
  }
  return out
}

// The script's modules as Cloudflare holds them.
let held = async (env: Env, name: string) => {
  let r = await sent(env, `/${name}/content`, {})
  if (!r.ok) return await answered(r) as never
  let type = r.headers.get('content-type') ?? ''
  let boundary = /boundary="?([^";]+)"?/.exec(type)?.[1]
  if (!boundary) throw new Error(`cloudflare: ${name}'s content is ${type}`)
  return parts(new Uint8Array(await r.arrayBuffer()), boundary)
}

let tags = async (env: Env, name: string) =>
  (await answered(await sent(env, `/${name}/tags`, {})) ?? []) as string[]

/** One script's wrapper made this release's: true when it was rewrapped,
 * false when it is not a script the platform wrapped or a deploy has just
 * uploaded it new. */
export let rewrap = async (env: Env, name: string): Promise<boolean> => {
  let modules = await held(env, name)
  let entry = modules.find((m) => m.name == WRAPPER)
  let was = entry && wrapping(DEC.decode(entry.bytes))
  if (!was) return false
  let worn = await tags(env, name)
  if (worn.includes(WRAP)) return false
  let body = new FormData()
  let part = (name: string, bytes: string | Uint8Array<ArrayBuffer>) =>
    body.append(name, new Blob([bytes], { type: moduleType(name) }), name)
  body.append(
    'metadata',
    new Blob([JSON.stringify({ main_module: WRAPPER })], {
      type: 'application/json',
    }),
  )
  part(WRAPPER, shim(was.main, was.tunneled, was.ai))
  for (let m of modules) if (m.name != WRAPPER) part(m.name, m.bytes)
  await answered(
    await sent(env, `/${name}/content`, { method: 'PUT', body }),
  )
  await answered(
    await sent(env, `/${name}/tags`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        ...worn.filter((t) => !t.startsWith('wrap-')),
        WRAP,
      ]),
    }),
  )
  return true
}

// How many scripts one pass rewraps: four account calls each keeps a pass
// well inside an invocation's subrequests, and a pass that leaves some asks to
// run again (`left`).
export let MOST = 100

/** Every script in the namespace not wearing this release's wrapper,
 * rewrapped, up to {@link MOST} a pass. A script that fails is reported and
 * left for the next pass; the others go on. */
export let rewrapped = async (env: Env, most = MOST) => {
  if (!env.CF_WORKERS_TOKEN) return { rewrapped: 0, failed: 0, left: 0 }
  let stale = (await answered(
    await sent(env, `?tags=${WRAP}:no`, {}),
  ) ?? []) as { id: string }[]
  let done = 0
  let failed = 0
  for (let { id } of stale.slice(0, most)) {
    try {
      if (await rewrap(env, id)) done++
    } catch (e) {
      failed++
      caught(e, { request: 'rewrap', script: id })
    }
  }
  return { rewrapped: done, failed, left: Math.max(0, stale.length - most) }
}
