// Self-containment, enforced at FREEZE TIME.
//
// THE INVARIANT: a frozen page renders from its OWN bytes. An archiver
// inlines what it could reach, but everything it could not — a 404'd asset, a
// preload hint, a `srcset` variant, a favicon, a tracking pixel — keeps its
// URL and would fetch the live web the moment somebody opened the archive,
// years later, announcing the reader to whoever is still serving it. So every
// remaining external reference is REMOVED here, once, before the bytes are
// stored. A serving CSP is defence in depth and never the mechanism: an
// archive handed to a person, mailed, or opened from a file has no header in
// front of it.
//
// It is a parse and not a pass of regular expressions: an attribute's value
// is decided by the HTML parser's reading of the document, not by ours, and a
// scrubber that disagrees with the parser about where an attribute ends is a
// scrubber that leaves one behind.
//
// What survives: text, structure, `data:` URIs, and CSS with its `url()`
// values emptied. What goes: scripts and every other document a page can
// embed, link tags that are not data, meta refresh, inline handlers, and
// every url-bearing attribute pointing anywhere but at the document itself.

import { parseHTML } from 'linkedom'

/** An archive, and the title the document gave itself. */
export type Scrubbed = {
  /** the document with every external reference removed */
  html: string
  /** its `<title>`, when it had one — what a page is known by */
  title?: string
}

// The attributes that can name something to fetch. `data` and `background`
// are old, and still honoured by browsers; `xlink:href` is how an SVG points.
let URLISH = [
  'src',
  'href',
  'srcset',
  'poster',
  'action',
  'formaction',
  'ping',
  'background',
  'data',
  'xlink:href',
]

// A reference that goes nowhere outside these bytes: the document's own
// fragments, and content carried inline.
let INSIDE = /^\s*(?:data:|#|about:)/i

// `url(…)` in CSS is a fetch like any other. Emptying it rather than dropping
// the declaration keeps the cascade the page was laid out under.
let cssScrub = (css: string): string =>
  css.replace(/url\(\s*(?!['"]?\s*data:)[^)]*\)/gi, 'url()')

/**
 * One document, scrubbed of every external reference, and its title.
 *
 * ```ts
 * import { scrub } from '@yaks/page'
 *
 * scrub('<title>Hi</title><img src="https://elsewhere/x.png">').title // 'Hi'
 * ```
 */
export let scrub = (raw: string): Scrubbed => {
  let { document } = parseHTML(raw)
  let all = (sel: string) => [...document.querySelectorAll(sel)]
  // A document a page EMBEDS is a document this one cannot vouch for, and a
  // script is the one thing no attribute sweep can make inert.
  for (let el of all('script, base, iframe, frame, embed, object')) el.remove()
  for (let el of all('link')) {
    if (!(el.getAttribute('href') ?? '').startsWith('data:')) el.remove()
  }
  for (let el of all('meta[http-equiv]')) {
    if (/refresh/i.test(el.getAttribute('http-equiv') ?? '')) el.remove()
  }
  for (let el of all('*')) {
    for (let { name } of [...el.attributes]) {
      if (name.toLowerCase().startsWith('on')) el.removeAttribute(name)
    }
    for (let a of URLISH) {
      let v = el.getAttribute(a)
      if (v && !INSIDE.test(v)) el.removeAttribute(a)
    }
    let style = el.getAttribute('style')
    if (style?.includes('url(')) el.setAttribute('style', cssScrub(style))
  }
  for (let el of all('style')) el.textContent = cssScrub(el.textContent ?? '')
  return {
    html: document.toString(),
    title: document.querySelector('title')?.textContent?.trim() || undefined,
  }
}
