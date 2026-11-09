// A file a package ships beside its modules, exported as `@yaks/api/asset`:
// a page, a stylesheet, an icon, what a route answers with. Read through the
// module loader, as an import of the file's text or bytes, wherever the
// package is served from: a checkout reads its own file, and a package from
// JSR reads Deno's module cache, which fetches it from jsr.io once and keeps
// it. A `fetch` of the same address goes to jsr.io in every process, and fails
// offline. The workspace runs with Deno's `raw-imports`, which these need.
// A browser has no text or bytes imports, so a page reads a web address with
// `fetch`, which its own cache serves: the kit's stylesheets on an app page.

let fetched = (url: URL) =>
  !('Deno' in globalThis) && /^https?:$/.test(url.protocol)

/** The text of the file at `url`.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * assert((await text(new URL('./asset.ts', import.meta.url))).includes('raw-imports'))
 * ```
 */
export let text = async (url: URL): Promise<string> =>
  fetched(url)
    ? await (await answered(url)).text()
    : (await import(url.href, { with: { type: 'text' } })).default

/** The bytes of the file at `url`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals((await bytes(new URL('data:,yak'))).length, 3)
 * ```
 */
export let bytes = async (url: URL): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    fetched(url)
      ? await (await answered(url)).arrayBuffer()
      : (await import(url.href, { with: { type: 'bytes' } })).default,
  )

// A page's fetch of a file it ships, refused rather than read as its error page.
let answered = async (url: URL) => {
  let res = await fetch(url)
  if (!res.ok) throw new Error(`${url.href} answered ${res.status}`)
  return res
}
