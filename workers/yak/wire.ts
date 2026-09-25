// The `/api/*` wire an app's pages speak, and the translation between it and
// the Store's own (T-33815). Two wires meet at the app door, and they are not
// the same shape:
//
//   the page      GET  ./api/query?.doc.title~=cake&limit=10
//                 POST ./api/apply  {"entities": [ …bundles… ]}
//                                → {"ok": true, "aliases": {…}, "bundles": […]}
//   the Store     GET  /query?q=<the whole line, escaped once>
//                 POST /apply       [ …bundles… ]
//                                → [ …the batch as applied… ]
//
// The page's half is fixed, and that is the whole reason this file exists: it
// is documented (public/docs/store.md), it is what `public/client.js` wraps,
// and every app already deployed imports that client and reads `aliases` off
// an answer. So the store moved and the door translates, rather than every
// page in the world being asked to move with it.
//
// Only the envelope is translated. The bundles are the same bundles either way
// — `{entity: {eid}, ...components}`, a `$alias` wherever an eid goes — and the
// filter grammar is the same grammar; what differs is that a page writes its
// line as the query string itself and the Store takes it as one parameter, and
// three of the page's riders lost their leading dot on the way over.
import type { Bundle } from '@yaks/graph'
import { minted } from './meta.ts'
import { refuse } from './tool.ts'

// The riders the page's grammar writes bare and the Store's writes dotted. They
// are the same three words meaning the same three things; only the syntax
// moved (@yaks/query: `.limit=`, `.after=`, and `.eid=` for an address).
let RIDERS: Record<string, string> = {
  id: '.eid',
  limit: '.limit',
  after: '.after',
}

// Where a segment's name ends and its value begins: the operators the grammar
// knows, longest first, so `!=` is not read as `!`.
let OPERATOR = /^([A-Za-z_.\-[\]][A-Za-z0-9_.\-[\]]*)(!=|~=|<=|>=|<|>|=)/

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

// A decoded value the grammar would otherwise read as structure. `&` separates
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

/** A line without the `?` a query string opens with, and any `&` after it. A
 * `?` before a word is the grammar's own (`?doc` asks for a component), so it
 * stays. */
export let bare = (line: string) =>
  line.replace(/^\?(?![A-Za-z_])/, '').replace(/^&+/, '')

/**
 * A page's filter line, off the search string it arrived as: the riders
 * rewritten and every value decoded, so the whole line can be escaped once
 * into the Store's `?q=` (meta.ts `metaOf`).
 *
 * A bare token is a full-text term and carries no operator, so it is decoded
 * whole. `*` — the page's word for "every component" — is a term the store has
 * no use for and rides across untouched, the way any word it does not know
 * would.
 */
export let lined = (search: string): string =>
  bare(search).split('&').filter(Boolean).map((seg) => {
    let m = OPERATOR.exec(seg)
    if (!m) return glued(plain(seg), true)
    return `${RIDERS[m[1]] ?? m[1]}${m[2]}${
      glued(plain(seg.slice(m[0].length)))
    }`
  }).join('&')

// The alias this door gives a bundle that names no entity: its own
// bookkeeping, never part of the answer.
let NEW = /^\$new\d+$/

// One entry of a batch. A bundle that names no entity is a page saving
// something new — the shape the guide shows first, `apply({doc: {title}})` —
// and the Store takes an alias wherever an eid goes, so it gets one. An alias
// rather than a fresh uuid, because a content-addressed component names its own
// entity (@yaks/blob) and only an alias leaves that decision to the graph.
let bundled = (one: unknown, n: number): Bundle => {
  let held = one as Record<string, unknown>
  return (held?.entity
    ? held
    : { ...held, entity: { eid: `$new${n}` } }) as Bundle
}

/** A page's batch, either way it was sent: the documented `{entities: […]}`
 * envelope, or the bare array the Store itself takes. */
export let batched = (body: unknown): Bundle[] => {
  let held = Array.isArray(body)
    ? body
    : (body as { entities?: unknown })?.entities
  if (!Array.isArray(held)) {
    throw refuse(
      'arguments',
      '/apply takes {"entities": [ … ]} — a list of bundles',
    )
  }
  return held.map(bundled)
}

/**
 * The batch as applied, as the page reads it: the Store's bundles, and the eid
 * each `$alias` the page wrote became (guide §Saving). An alias this door
 * invented for a bundle that named no entity (`bundled`) is left out of both.
 */
export let receipt = (applied: Bundle[]) => {
  let bundles = applied.map(({ $alias, ...b }) =>
    typeof $alias == 'string' && !NEW.test($alias) ? { ...b, $alias } : b
  )
  return { ok: true, aliases: minted(bundles), bundles }
}
