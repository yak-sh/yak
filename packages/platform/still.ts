// A page as one document that looks the same wherever it is opened: its
// stylesheets written into it with what they import, its scripts left out,
// and its own site's addresses made relative, so they resolve against
// whatever address shows it. A page the in-process kernel renders from a
// checkout, made still this way, is what `yak admin browse --html` shows in
// Cloudflare's browser at the live page's address: the change seen before it
// deploys, its images and fonts from yaks.app.

type Fetch = (url: string) => Promise<Response>

let SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>\s*/gi
let LINK = /<link\b[^>]*>/gi
let IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?[^;]*;/g
let URL_IN_CSS = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

let attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, 'i'))?.[2]

let read = async (fetch: Fetch, url: string) => {
  let r = await fetch(url)
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r.text()
}

// A sheet with what it imports written in its place, and every address in it
// absolute, since once in the page they would resolve against the page.
let sheet = async (
  fetch: Fetch,
  url: string,
  seen: Set<string>,
): Promise<string> => {
  if (seen.has(url)) return ''
  seen.add(url)
  let text = await read(fetch, url)
  let imported = await Promise.all(
    [...text.matchAll(IMPORT)].map(([, , href]) =>
      sheet(fetch, new URL(href, url).href, seen)
    ),
  )
  let i = 0
  return text.replace(IMPORT, () => imported[i++])
    .replace(
      URL_IN_CSS,
      (whole, _, href: string) =>
        /^(data|#)/.test(href) ? whole : `url("${new URL(href, url).href}")`,
    )
}

/**
 * The page at `at`, its document `html`, made still: each stylesheet it links
 * fetched and written in, its scripts dropped, and `at`'s origin cut from
 * every address.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let files: Record<string, string> = {
 *   'https://a.test/pages.css': "@import url('kit.css'); p { background: url(dot.png) }",
 *   'https://a.test/kit.css': 'b { color: red }',
 * }
 * let fetch = (url: string) => Promise.resolve(new Response(files[url]))
 * assertEquals(
 *   await still(
 *     '<head><link rel="stylesheet" href="/pages.css"><script src="x.js"></script></head><a href="https://a.test/b">b</a>',
 *     'https://a.test/manage',
 *     fetch,
 *   ),
 *   '<head><style>b { color: red } p { background: url("/dot.png") }</style></head><a href="/b">b</a>',
 * )
 * ```
 */
export let still = async (
  html: string,
  at: string,
  fetch: Fetch,
): Promise<string> => {
  let seen = new Set<string>()
  let sheets = [...html.matchAll(LINK)]
    .filter(([tag]) => /\bstylesheet\b/i.test(attr(tag, 'rel') ?? ''))
  let styles = new Map(
    await Promise.all(sheets.map(async ([tag]) =>
      [
        tag,
        `<style>${await sheet(
          fetch,
          new URL(attr(tag, 'href')!, at).href,
          seen,
        )}</style>`,
      ] as const
    )),
  )
  let origin = new URL(at).origin
  return html.replace(SCRIPT, '')
    .replace(LINK, (tag) => styles.get(tag) ?? tag)
    .replaceAll(`${origin}/`, '/')
}
