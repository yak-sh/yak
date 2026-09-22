// The canonical form of a page's address, and the entity id derived from it.
//
// A page recorded from a browser and the same page looked up an hour later have
// to resolve to one entity, or a citation is a guess and a "what references
// this?" query lies by omission. So canonicalization happens in one place —
// here — and the entity's id is derived from the result (`web.url` is declared
// `identity`, ./vocab.json): recording a page twice writes one row by
// construction, with no lookup to race and no uniqueness index anybody has to
// remember. Nothing else rewrites an address, and every code path gets the
// canonical form, because the plugin canonicalizes in the `normalize` phase
// (./plugin.ts) — the earliest one, before the id is minted from the value.
//
// What carries no identity is dropped: a fragment names a spot inside a page,
// campaign parameters name the trip rather than the destination, credentials
// are never part of a page's name, and a trailing slash is a server's habit.
// What might carry identity is kept: query parameters stay, in the order they
// arrived — sorting them would re-encode the string, and no site shuffles them
// between visits.
//
// Anything that is not an http(s) URL is returned exactly as it came. Canonical
// form is a fact about the web's own schemes; for a `file:` address, or an
// application's own scheme, the text is the address and rewriting it would be
// the bug.

import { type Eid, identityEid } from '@yaks/graph'
import { WEB } from './comp.ts'

// The parameters that name the trip rather than the destination: ad networks'
// click ids and every campaign prefix. Matched by prefix where there is one
// (the `utm_`-style families), by exact name where there is not.
let JUNK =
  /^(?:utm_|ga_|mc_|pk_|piwik_|hsa_|_hs|vero_)|^(?:gclid|dclid|gbraid|wbraid|fbclid|msclkid|yclid|twclid|mkt_tok|igshid|ref_src|ref_url|s_cid|si|scid|spm|cmpid)$/i

/**
 * One address in canonical form. Idempotent: canonicalizing a canonical address
 * returns that address.
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
  // The root keeps its slash — that is the canonical root — and every deeper
  // path drops one: `/a` and `/a/` are one page everywhere it matters, and a
  // refetch follows the redirect either way.
  if (u.pathname != '/') u.pathname = u.pathname.replace(/\/+$/, '')
  return u.href.replace(/\?$/, '')
}

/**
 * The entity id one address names: `sha256("web|<canonical address>")`
 * formatted as a UUID. It is the same derivation @yaks/graph performs when a
 * `web` row arrives under an alias, so an id computed here and an id minted
 * there are the same id — which is what lets a client link to a page nobody has
 * recorded yet.
 */
export let pageEid = (url: string): Eid => identityEid(WEB, [canon(url)])

/** Whether this package can fetch an address: the web's own schemes. */
export let fetchable = (url: string): boolean => /^https?:\/\/./.test(url)
