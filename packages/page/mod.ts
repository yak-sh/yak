/**
 * @yaks/page — a page as WITNESSED, not as it is now.
 *
 * Cite a URL and you have cited something that can change tonight and be gone
 * by Friday. This package is the other reading: `web{url, frozen_at, bytes}`
 * says which address was read, when a copy of the document was taken, and
 * where that copy is — so a citation keeps its meaning after the page moves
 * on.
 *
 * ```ts
 * import { canon, pageEid } from '@yaks/page'
 *
 * canon('HTTPS://Example.com/a/?utm_source=x#top') // 'https://example.com/a'
 * // pageEid(url) is the entity that address names, before anybody writes it
 * ```
 *
 * ## The address is the identity
 * `web.url` declares `identity`, so a page's entity id is derived from its
 * canonical address ({@link pageEid}). Witnessing one page twice writes one
 * row by construction — no lookup to race, no uniqueness index to remember —
 * and a client holding a URL can name its page without asking. {@link canon}
 * is the one place an address is spelled, and the plugin applies it in the
 * `normalize` phase, so every door canonicalizes.
 *
 * ## A frozen page renders from its own bytes
 * {@link scrub} removes every external reference AT FREEZE TIME — scripts,
 * embedded documents, link tags, inline handlers, every url-bearing attribute
 * that is not `data:`, and `url()` in CSS. That is the mechanism. A serving
 * CSP is defence in depth and nothing more: an archive that is mailed, copied
 * or opened from a file has no header in front of it.
 *
 * ## Two ways bytes arrive
 * A browser tab posts its own document to `POST /page` (`./routes`) — the
 * only way to archive a page behind a login. Anything else is fetched
 * afterwards by the {@link Archive} the config named, post-commit
 * (`./effects`), so a slow capture is not a request somebody is holding open.
 * Both land the same way ({@link froze}): scrubbed, stored under its own
 * SHA-256 in the host's {@link https://jsr.io/@yaks/blob | @yaks/blob} store,
 * and stamped onto the page.
 *
 * ## What it does not own
 * The title and prose are `doc{title, body}`
 * ({@link https://jsr.io/@yaks/doc | @yaks/doc}), the bytes are @yaks/blob's,
 * and a promise about source rather than about the web —
 * paths and a sha — is `anchor`, which
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
