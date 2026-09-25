// The capture: the `Archive` interface an archiver implements, the function
// that stores one document, and the effect handler that calls both.
//
// A page is archived when it has no bytes yet. That is the whole rule, and it
// is why both ways in end up here: a browser tab that posts its own DOM already
// has the bytes (nobody else can get them — a server refetching a page behind a
// login archives the login), and a page recorded by its address alone is
// fetched afterwards by whatever archiver the server was configured with.
//
// The fetch runs after the commit, which is the right place for it: the address
// is durable before anybody reaches for the network, a site that is down cannot
// cause the write to fail, and a capture that takes thirty seconds is not a
// request somebody is holding open. The result goes back through the graph's
// own `apply()`, so "this page is archived now" is journaled and pushed to
// whoever is subscribed to it. A capture that fails throws, and the effects
// registry records the failure: telemetry, never a rolled-back transaction.
//
// The archiver itself is injected. Turning a live URL into one self-contained
// document is an external tool's job (monolith, say), and which tool — with
// which arguments, under which time limit — is the server's business, named in
// this plugin's options and built in ./host.ts. This module composes the
// capture and knows nothing about processes.

import type { Bundle, Comp, Entity, Tx } from '@yaks/graph'
import { then } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import { address, type Blobs, encode } from '@yaks/blob'
import { DOC, TITLE } from '@yaks/doc'
import { WEB } from './comp.ts'
import { fetchable } from './url.ts'

/**
 * An archiver: one address in, one self-contained document out. It rejects when
 * it could not produce one — the rejection's message is what the server
 * records, so make it worth reading.
 */
export type Archive = (url: string) => Promise<string>

/** Where a capture is stored, and what supplies the timestamp. */
export type Keep = {
  /** the content-addressed store the archived document is written to */
  blobs: Blobs
  /** the clock, injected so a test can hold it still (default: now) */
  now?: () => string
}

/** Everything the freezing effect handler is built from. */
export type Capture = Keep & { archive: Archive }

let clock = () => new Date().toISOString()

// The whole page as it stands after the commit: the handler reads it back from
// storage rather than from the change that triggered it, so it sees the address
// however the transaction that wrote it was shaped.
let whole = (tx: Tx, entity: Entity) =>
  then(tx.get([entity.eid]), (found) => found[0])

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

/**
 * Store one page's bytes: scrub the document of every external reference, write
 * it under its own SHA-256, and return the changes that stamp the page with
 * where it went and when.
 *
 * It is given the page as it stands, because the archive's `<title>` names the
 * page only while nothing else does — a title somebody wrote by hand is never
 * overwritten by a later capture.
 *
 * The bytes are content-addressed, so archiving a page whose document has not
 * changed since the last capture stores nothing new; `bytes` is simply the same
 * address again.
 */
export let froze = async (
  page: Bundle,
  raw: string,
  { blobs, now = clock }: Keep,
): Promise<Bundle[]> => {
  // The HTML parser is imported by the first page stored, not by every host
  // that composes this package and may never store one.
  let { scrub } = await import('./scrub.ts')
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
 * The `created(web)` handler: fetch a page that was recorded by its address
 * alone, and store its bytes.
 *
 * ```ts
 * import { effects } from '@yaks/effects'
 * import { freezing } from '@yaks/page'
 *
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * // fx.created('web', freezing({ archive, blobs }))
 * ```
 *
 * Idempotent, which is what lets a start-up sweep re-run it: a page that
 * already carries `bytes` is left alone, and so is one whose address is not
 * something this package can fetch (a `file:` note, an application's own
 * scheme).
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
