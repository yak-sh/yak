// The `/api/*` wire an app's PAGES speak, and the translation between it and
// the Store's own (T-33815). Two wires meet at the app door, and they are not
// the same shape:
//
//   the page      GET  ./api/query?.doc.title~=cake&limit=10
//                 POST ./api/apply  {"entities": [ …bundles… ]}
//                                → {"ok": true, "changes": […], "aliases": {…}}
//   the Store     GET  /query?q=<the whole line, escaped once>
//                 POST /apply       [ …bundles… ]
//                                → [ …the batch as applied… ]
//
// The page's half is FIXED, and that is the whole reason this file exists: it
// is documented (public/guide.md), it is what `public/client.js` wraps, and
// every app already deployed imports that client and reads `aliases` off an
// answer. So the store moved and the door translates, rather than every page
// in the world being asked to move with it.
//
// Only the ENVELOPE is translated. The bundles are the same bundles either way
// — `{entity: {eid}, ...components}`, a `$alias` wherever an eid goes — and the
// filter grammar is the same grammar; what differs is that a page spells its
// line as the query string itself and the Store takes it as one parameter, and
// three of the page's riders lost their leading dot on the way over.
import type { Bundle } from '@yaks/graph'

// The riders the page's grammar spells bare and the Store's spells dotted. They
// are the same three words meaning the same three things; only the spelling
// moved (@yaks/query: `.limit=`, `.after=`, and `.eid=` for an address).
let RIDERS: Record<string, string> = {
  id: '.eid',
  limit: '.limit',
  after: '.after',
}

// Where a segment's NAME ends and its value begins: the operators the grammar
// spells, longest first, so `!=` is not read as `!`.
let OPERATOR = /^([A-Za-z_.\-[\]][A-Za-z0-9_.\-[\]]*)(!=|~=|<=|>=|<|>|=|!|\?)/

// One value, as the page wrote it. A page builds its own line, so a value may
// be escaped (`search()` escapes what it is given) or plain (a filter typed
// into the source); an escape that will not decode is a value with a stray `%`
// in it and is kept as it stands.
let plain = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// A decoded value the grammar would otherwise read as STRUCTURE. `&` separates
// segments, and a ` .` inside one splits it into words; quotes glue a value
// across both (@yaks/query `segments`/`words`), and a dot-param's own spaces
// survive unquoted, which is why a bare term is left alone for them. There is
// no escape for a quote inside a quoted run, so a value carrying one is handed
// over as it stands rather than silently mangled into a different value.
let glued = (value: string, term = false) =>
  (value.includes('&') || (!term && /\s\./.test(value))) &&
    !value.includes('"')
    ? `"${value}"`
    : value

/**
 * A page's filter line, off the search string it arrived as: the riders
 * re-spelled and every value decoded, so the whole line can be escaped ONCE
 * into the Store's `?q=` (meta.ts `metaOf`).
 *
 * A bare token is a full-text term and carries no operator, so it is decoded
 * whole. `*` — the page's word for "every component" — is a term the store has
 * no use for and rides across untouched, the way any word it does not know
 * would.
 */
export let lined = (search: string): string =>
  search.replace(/^[?&]+/, '').split('&').filter(Boolean).map((seg) => {
    let m = OPERATOR.exec(seg)
    if (!m) return glued(plain(seg), true)
    return `${RIDERS[m[1]] ?? m[1]}${m[2]}${
      glued(plain(seg.slice(m[0].length)))
    }`
  }).join('&')

/** A page's batch, either way it was sent: the documented `{entities: […]}`
 * envelope, or the bare array the Store itself takes. */
export let batched = (body: unknown): Bundle[] => {
  if (Array.isArray(body)) return body as Bundle[]
  let held = (body as { entities?: unknown })?.entities
  if (Array.isArray(held)) return held as Bundle[]
  throw new Error('/apply takes {"entities": [ … ]} — a list of bundles')
}

// The keys of a bundle that are not a component: its address, and the wire's
// own sugar. `tombstone` IS one — a death is a change like any other, and a
// page folding an answer needs to hear it.
let SPINE = ['entity', 'kind', '$alias', '$was', '$actor', '$delete']

/**
 * The batch as applied, in the page's own words: one `change` per component
 * written, and the eid each `$alias` in the batch became.
 *
 * A page reads `aliases` to find what it just minted (guide §Saving) and
 * `changes` to know what moved, including the casualties a death took with it —
 * both are what the answer has always said, so a page written a year ago still
 * reads this one.
 */
export let lowered = (applied: Bundle[]) => ({
  ok: true,
  changes: applied.flatMap((b) =>
    Object.entries(b)
      .filter(([name]) => !SPINE.includes(name))
      .map(([name, comp]) => ({ eid: b.entity.eid, name, comp }))
  ),
  aliases: Object.fromEntries(
    applied.flatMap((b) =>
      typeof b.$alias == 'string' ? [[b.$alias, b.entity.eid]] : []
    ),
  ),
})
