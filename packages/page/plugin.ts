// The package as one @yaks/graph plugin: the `web` component, and the one hook
// that makes its derived identity mean anything.
//
// The canonicalizer runs as a `normalize` hook, the earliest phase there is.
// That placement is the whole point: `web.url` is declared `identity`, so the
// mint phase names the entity from the value it finds — and it must find the
// CANONICAL form, or `https://a.com/x/` and `https://a.com/x` become two pages
// and a citation stops meaning one thing. Normalizing here rather than in each
// caller is the difference between "we tidy addresses somewhere" and "this
// graph cannot hold two rows for one page".
//
// There is no `derive` hook here. The naming comes from the VOCABULARY — the
// `identity` keyword on `web.url`, read by @yaks/graph — which is more
// trustworthy than a plugin claiming it: a page is named by its address whether
// or not anybody loaded this module.

import type { Bundle, Comp, Plugin } from '@yaks/graph'
import { pageDoc, WEB } from './comp.ts'
import { canon } from './url.ts'

let clean = (b: Bundle): Bundle => {
  let web = b[WEB] as Comp | null | undefined
  if (!web || web.url == null) return b
  return { ...b, [WEB]: { ...web, url: canon(String(web.url)) } }
}

/**
 * The page plugin: the `web` component, and the canonical address.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc, docs } from '@yaks/doc'
 * import { pageDoc, pages } from '@yaks/page'
 *
 * let vocab = loadVocab([docDoc, pageDoc])
 * // let g = graph({ storage, vocab, plugins: [docs(), pages()] })
 * ```
 *
 * {@link https://jsr.io/@yaks/doc | @yaks/doc} is loaded BESIDE it rather than
 * redefined inside it: a page's title is `doc{title}`, and a vocabulary refuses
 * a component declared twice.
 *
 * Capturing a page — fetching it and storing its bytes — is `./effects`, which
 * needs an archiver named in the configuration.
 */
export let pages = (): Plugin => ({
  name: '@yaks/page',
  vocab: [pageDoc],
  hooks: { normalize: (bundles) => bundles.map(clean) },
})
