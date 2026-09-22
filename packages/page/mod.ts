/**
 * @yaks/page — records a web page as it was seen, not as it is now.
 *
 * Cite a URL and you have cited something that can change tonight and be gone
 * by Friday. This package records the other reading. Its `web` component holds
 * which address was read (`url`), when a copy of the document was taken
 * (`frozen_at`) and where that copy is stored (`bytes`) — so a citation keeps
 * its meaning after the page moves on.
 *
 * ```ts
 * import { canon, pageEid } from '@yaks/page'
 *
 * canon('HTTPS://Example.com/a/?utm_source=x#top') // 'https://example.com/a'
 * // pageEid(url) is the entity that address names, before anybody writes it
 * ```
 *
 * ## The address is the identity
 * `web.url` is declared `identity`, so a page's entity id is derived from its
 * canonical address ({@link pageEid}). Recording one page twice writes one row
 * by construction — no lookup to race, no uniqueness index to remember — and a
 * client holding a URL can compute its entity id without asking. {@link canon}
 * is the only place an address is rewritten, and the plugin calls it in
 * @yaks/graph's `normalize` phase, so every code path gets the canonical form.
 *
 * ## An archived page renders from its own bytes
 * {@link scrub} removes every external reference at freeze time — scripts,
 * embedded documents, `link` tags, inline event handlers, every URL-bearing
 * attribute that is not `data:`, and `url()` in CSS. That is the mechanism. A
 * Content-Security-Policy header at serving time is defence in depth and
 * nothing more: an archive that is mailed, copied or opened from a file has no
 * header in front of it.
 *
 * ## Two ways the bytes arrive
 * A browser tab posts its own document to `POST /page` (`./routes`) — the only
 * way to archive a page behind a login. Any other page is fetched afterwards by
 * the {@link Archive} named in the configuration, in a handler that runs after
 * the commit (`./effects`), so a slow capture is not a request somebody is
 * holding open. Both end up the same way ({@link froze}): scrubbed, stored
 * under its own SHA-256 in the server's
 * {@link https://jsr.io/@yaks/blob | @yaks/blob} store, and stamped onto the
 * page entity.
 *
 * ## What this package does not own
 * The title and prose are `doc{title, body}`
 * ({@link https://jsr.io/@yaks/doc | @yaks/doc}), the bytes belong to
 * @yaks/blob, and a record of source code rather than of a web page — paths
 * plus a git sha — is the `anchor` component, which
 * {@link https://jsr.io/@yaks/git | @yaks/git} owns.
 *
 * @module
 */

export * from './comp.ts'
export * from './url.ts'
export * from './scrub.ts'
export * from './freeze.ts'
export * from './host.ts'
export * from './plugin.ts'
