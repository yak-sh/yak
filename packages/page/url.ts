// THE canonical spelling of a page's address, and the entity it names.
//
// A page filed from a browser and the same page asked about an hour later
// have to come to ONE entity, or a citation is a guess and a "what references
// this?" answer lies by omission. So the spelling is decided in one place —
// here — and the entity's id is DERIVED from it (`web.url` declares
// `identity`, ./vocab.json): witnessing a page twice writes one row by
// construction, with no lookup to race and no uniqueness index anybody has to
// remember. Nothing else may spell an address, and every door normalizes,
// because the plugin canonicalizes in the `normalize` phase (./plugin.ts) —
// the earliest there is, before the id is minted from the value.
//
// What carries no identity goes: a fragment names a spot INSIDE a page,
// campaign parameters name the trip rather than the destination, credentials
// are never part of a page's name, and a trailing slash is a server's habit.
// What might carries on: query parameters stay, in the order they arrived —
// sorting re-encodes, and no site shuffles them between visits.
//
// Anything that is not an http(s) URL is left exactly as it came. Canonical
// spelling is a fact about the web's own scheme; for a `file:` address, or an
// app's own, the text IS the address and mangling it would be the bug.

import { type Eid, identityEid } from '@yaks/graph'
import { WEB } from './comp.ts'

// The parameters that name the trip rather than the destination: ad networks'
// click ids and every campaign prefix. Matched by SHAPE where there is one
// (the `utm_`-style prefixes), by name where there is not.
let JUNK =
  /^(?:utm_|ga_|mc_|pk_|piwik_|hsa_|_hs|vero_)|^(?:gclid|dclid|gbraid|wbraid|fbclid|msclkid|yclid|twclid|mkt_tok|igshid|ref_src|ref_url|s_cid|si|scid|spm|cmpid)$/i

/**
 * One address, canonically spelled. Idempotent: canonicalizing a canonical
 * address is that address.
 *
 * ```ts
 * import { canon } from '@yaks/page'
 *
 * canon('HTTPS://Example.com/a/?utm_source=x#top') // 'https://example.com/a'
 * ```
 */
export let canon = (raw: string): string => {
  let text = raw.trim()
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return text
  }
  if (u.protocol != 'http:' && u.protocol != 'https:') return text
  u.hash = ''
  u.username = u.password = ''
  for (let k of [...u.searchParams.keys()]) {
    if (JUNK.test(k)) u.searchParams.delete(k)
  }
  // The root keeps its slash — that IS the canonical root — and every deeper
  // path drops one: `/a` and `/a/` are one page everywhere it matters, and a
  // refetch follows the redirect either way.
  if (u.pathname != '/') u.pathname = u.pathname.replace(/\/+$/, '')
  return u.href.replace(/\?$/, '')
}

/**
 * The entity one address names: `sha256("web|<canonical address>")` worn as a
 * UUID. The same derivation the graph itself performs when a `web` bundle
 * arrives under an alias, so an id computed here and an id minted there are
 * one id — which is what lets a client link to a page it has never seen.
 */
export let pageEid = (url: string): Eid => identityEid(WEB, [canon(url)])

/** Whether an address is one this package can fetch: the web's own schemes. */
export let fetchable = (url: string): boolean => /^https?:\/\/./.test(url)
