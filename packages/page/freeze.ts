// The capture: the seam an archiver plugs into, and the effect that uses it.
//
// A page is FROZEN when it has no bytes yet. That is the whole rule, and it
// is why the same landing serves both doors: a tab that posts its own DOM has
// the bytes already (nobody else can get them — a server refetching a page
// behind a login archives the login), and a page witnessed by its address
// alone is fetched afterwards by whatever archiver the host named.
//
// The fetch runs POST-COMMIT, which is the right place for it: the address is
// durable before anybody reaches for the network, a site that is down cannot
// refuse the write, and a capture that takes thirty seconds is not a request
// somebody is holding open. The outcome goes back through the graph's own
// `apply()`, so "this page is frozen now" is journaled and pushed to whoever
// is watching it. A capture that fails throws, and the effects registry
// records it: telemetry, never a broken batch.
//
// The archiver itself is INJECTED. Turning a live URL into one self-contained
// document is an external tool's job (monolith, say), and which tool — with
// which flags, under which time limit — is the host's business, named in this
// plugin's options and built in ./host.ts. This module composes the capture
// and knows nothing about processes.

import type { Bundle, Comp, Entity, Tx } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import { address, type Blobs, encode } from '@yaks/blob'
import { DOC, TITLE } from '@yaks/doc'
import { WEB } from './comp.ts'
import { scrub } from './scrub.ts'
import { fetchable } from './url.ts'

/**
 * An archiver: one address in, ONE self-contained document out. It rejects
 * when it could not get one — the rejection's message is what the host
 * records, so make it worth reading.
 */
export type Archive = (url: string) => Promise<string>

/** Where a capture goes, and what says when. */
export type Keep = {
  /** the content-addressed store the frozen document lands in */
  blobs: Blobs
  /** the clock, injected so a test can hold it still (default: now) */
  now?: () => string
}

/** How the freezing effect is built. */
export type Capture = Keep & { archive: Archive }

let clock = () => new Date().toISOString()

// The whole page as it stands, post-commit: the effect works from storage
// rather than from the patch, so it sees the address however the batch that
// wrote it was shaped.
let whole = (tx: Tx, entity: Entity) =>
  then(tx.get([entity.eid]), (found) => found[0])

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

/**
 * One page's bytes, landed: the document scrubbed of every external
 * reference, stored under its own SHA-256, and the page stamped with where it
 * went and when.
 *
 * It takes the page AS IT STANDS, because the archive's `<title>` names the
 * page only while nothing else does — a title somebody wrote by hand is never
 * overwritten by a visit.
 *
 * The bytes are content-addressed, so freezing a page whose document has not
 * changed since the last capture stores nothing new; the address in `bytes` is
 * simply the same one again.
 */
export let froze = async (
  page: Bundle,
  raw: string,
  { blobs, now = clock }: Keep,
): Promise<Bundle[]> => {
  let { html, title } = scrub(raw)
  let sha = address(html)
  await blobs.put(sha, encode(html))
  return [{
    entity: page.entity,
    [WEB]: { frozen_at: now(), bytes: sha },
    ...(title && !comp(page, DOC) ? { [DOC]: { [TITLE]: title } } : {}),
  }]
}

/**
 * The `created(web)` handler: fetch a page that was witnessed by its address
 * alone, and land its bytes.
 *
 * ```ts
 * import { effects } from '@yaks/effects'
 * import { freezing } from '@yaks/page'
 *
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * // fx.created('web', freezing({ archive, blobs }))
 * ```
 *
 * Idempotent, which is what lets a boot sweep re-run it: a page that already
 * carries `bytes` is left alone, and so is one whose address is not something
 * this package can fetch (a `file:` note, an app's own scheme).
 */
export let freezing =
  ({ archive, ...keep }: Capture): Handler => (event, tx, write) =>
    then(whole(tx, event.entity), async (page) => {
      let web = comp(page, WEB)
      if (!page || !web || web.bytes) return
      let url = String(web.url ?? '')
      if (!fetchable(url)) return
      await write(await froze(page, await archive(url), keep))
    })
