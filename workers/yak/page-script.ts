// The platform's own script in every page an app serves: the reporter
// (public/report.js) and the release listener (public/release.js), and the
// badge (public/badge.js) in a page of a space on the free plan, woven into
// the page's text rather than named by a `src`. Both must run before the
// page's own code, which made them blocking scripts, and a blocking script is
// a round trip the parser waits on before anything paints, on every load,
// warm or cold. Inline, they cost the page a few kilobytes and no request.
//
// Each tag says where its app is mounted for this browser (`data-yak-at`) and
// which release the page is (`data-yak-version`): the scripts read their doors
// off the first, and client.js sends the second with every request.
//
// A page with a Content-Security-Policy of its own may refuse inline scripts.
// Its policy is given the scripts' hashes (`admitted`), which lets these run
// and nothing else.
import { caught } from './defects.ts'

type Assets = { fetch: (req: Request) => Promise<Response> }
type Script = { text: string; hash: string }

let FILES = ['/report.js', '/release.js', '/badge.js']

let digest = async (text: string) =>
  `'sha256-${
    btoa(String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
      ),
    ))
  }'`

let read = (assets: Assets) =>
  Promise.all(FILES.map(async (path): Promise<Script> => {
    let res = await assets.fetch(new Request(`https://assets.invalid${path}`))
    if (!res.ok) throw new Error(`page script ${path}: ${res.status}`)
    // `</script` inside the text would end the element early; `<\/` is the
    // same string to JavaScript.
    let text = (await res.text()).replace(/<\/(script)/gi, '<\\/$1')
    return { text, hash: await digest(text) }
  }))

// Read once per isolate: the files are the deploy's own and never change
// under it. A failed read is not kept, so the next page asks again.
let held = new WeakMap<Assets, Promise<Script[]>>()
let scripts = (assets: Assets) => {
  let got = held.get(assets)
  if (!got) {
    held.set(assets, got = read(assets))
    got.catch(() => held.delete(assets))
  }
  return got
}

/** The tags for a page mounted at `at`, of release `version`, wearing the
 * badge when `badged`, and the hashes a policy needs to admit them. A page
 * whose scripts could not be read is served without them, and the failure is
 * reported: a page that paints without its reporter beats one that fails. */
export let pageScript = async (
  assets: Assets,
  at: string,
  version: number,
  badged: boolean,
) => {
  try {
    let [report, release, badge] = await scripts(assets)
    let all = badged ? [report, release, badge] : [report, release]
    return {
      tags: all.map(({ text }) =>
        `<script data-yak-at="${at}" data-yak-version="${version}">${text}</script>`
      ).join(''),
      hashes: all.map(({ hash }) => hash),
    }
  } catch (e) {
    caught(e, { request: 'page script' })
    return { tags: '', hashes: [] }
  }
}

// One directive's sources with the hashes added, unless adding them would
// change what the author allowed: `'unsafe-inline'` stops counting once a
// hash is present, and `'none'` means no script at all.
let admit = (directive: string, hashes: string[]) => {
  let words = directive.split(/\s+/)
  let inline = words.includes("'unsafe-inline'") &&
    !words.some((w) => /^'(sha\d+|nonce)-/.test(w))
  return inline || words.includes("'none'")
    ? directive
    : [...words, ...hashes].join(' ')
}

/**
 * A Content-Security-Policy that also runs the platform's inline scripts.
 * Each comma-separated policy is enforced on its own, so each is given the
 * hashes in whichever directive governs a `<script>` element.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let h = ["'sha256-a'"]
 * assertEquals(
 *   admitted("default-src 'self'; script-src 'self'", h),
 *   "default-src 'self'; script-src 'self' 'sha256-a'",
 * )
 * assertEquals(
 *   admitted("default-src 'self'", h),
 *   "default-src 'self'; script-src 'self' 'sha256-a'",
 * )
 * assertEquals(admitted("img-src 'self'", h), "img-src 'self'")
 * assertEquals(
 *   admitted("script-src 'self' 'unsafe-inline'", h),
 *   "script-src 'self' 'unsafe-inline'",
 * )
 * assertEquals(
 *   admitted("script-src 'none', script-src-elem 'self'", h),
 *   "script-src 'none', script-src-elem 'self' 'sha256-a'",
 * )
 * ```
 */
export let admitted = (policy: string, hashes: string[]) =>
  !hashes.length ? policy : policy.split(',').map((one) => {
    let parts = one.split(';').map((d) => d.trim()).filter(Boolean)
    let named = (name: string) =>
      parts.findIndex((d) => d.split(/\s+/)[0].toLowerCase() == name)
    let at = named('script-src-elem')
    if (at < 0) at = named('script-src')
    if (at >= 0) parts[at] = admit(parts[at], hashes)
    else {
      let fallback = named('default-src')
      if (fallback < 0) return one.trim()
      let copy = parts[fallback].replace(/^\S+/, 'script-src')
      let made = admit(copy, hashes)
      if (made == copy) return one.trim()
      parts.push(made)
    }
    return parts.join('; ')
  }).join(', ')
