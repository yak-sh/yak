// An edge's identity, and the transition table between the two edge stores
// (D-23820, T-23825). An edge entity is content-addressed from its SENTENCE,
// the way a blob's eid is its bytes' hash and a commit's is its sha: writing
// the same sentence twice finds one entity, and an unlink names it with no
// lookup. This is THE derivation — apply()'s dual-write, the CLI and any client
// compute it here and nowhere else.
import { sha } from './sha.ts'
import { edges } from './types.ts'

// eid = the leading 16 bytes of sha256(`${from}|${nature}|${to}`), worn as a
// UUID: version nibble 8 (RFC 9562's custom-derivation version) and the
// variant bits stamped, so it passes every uuid door and can never collide
// with a minted v4. Direction is part of the sentence: `a requires b` and
// `b requires a` are two edges.
export let edgeEid = (from: string, nature: string, to: string): string => {
  let h = sha(`${from}|${nature}|${to}`).slice(0, 32)
  let variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  let s = `${h.slice(0, 12)}8${h.slice(13, 16)}${variant}${h.slice(17)}`
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${
    s.slice(16, 20)
  }-${s.slice(20)}`
}

// The transition table, dual-write only (T-23825; T-23821 removes it with the
// dependency table): each `dependency.type` and its nature comp, present tense
// for a live relationship (`references` for `referenced`). `recalled` keeps its
// past tense because it is the one nature that is an EVENT: the edge wears
// `recalled{at}` — the case D-23820 names, a relation with a time carried by
// the sentence rather than forced onto either end (T-32471).
export let natureOf: Record<string, string> = Object.fromEntries(
  edges.map((t) => [t, t == 'referenced' ? 'references' : t]),
)
export let typeOf: Record<string, string> = Object.fromEntries(
  Object.entries(natureOf).map(([t, n]) => [n, t]),
)
export let natures = Object.values(natureOf)

// The sentence store as SQL, read from the edge ENTITIES (T-23824). `edge`
// names the two ends and its listing order; the nature comp names the verb. The
// columns are exactly what `dependency` had — parent, type, child, ord — so
// every reader keeps the shape it has always spoken and no client learns a new
// word. `type` is the WIRE's spelling (`referenced`, never `references`): the
// read shape is what it was. The nature list is the vocabulary's, so a new
// nature joins every reader here with no further edit.
//
// `only` is a WHERE over the EDGE's own columns (`g."from"`, `g."to"`,
// `g.entity`), and it belongs INSIDE: a narrowing left to the caller's outer
// query is applied only after the whole store is built, which measured 26ms
// against 1.4ms for one entity's edges on the live graph.
//
// Three shapes, because sqlite answers them differently:
//   - a NAMED nature is its own table, so the join IS the type test — no union,
//     and no `+d.type` trick needed to stop the planner preferring the type
//     over the endpoint it should be seeking.
//   - NARROWED and untyped: seek `edge` once and ask each nature table for the
//     verb — twelve primary-key probes over the few rows found (0.2ms).
//   - WHOLE and untyped: one branch per nature, unioned, so each nature table
//     is walked once (56ms) instead of 125k rows being probed twelve times
//     over (265ms).
export let sentences = (type?: string, only = '') => {
  let head = (verb: string) =>
    `select g."from" as parent, ${verb} as type,` +
    ` g."to" as child, g.ord as ord from edge g`
  let where = only ? ` where ${only}` : ''
  if (type) {
    return `${head(`'${type}'`)}` +
      ` join "${natureOf[type]}" n on n.entity = g.entity${where}`
  }
  if (!only) {
    return natures.map((n) =>
      `${head(`'${typeOf[n]}'`)} join "${n}" n on n.entity = g.entity`
    ).join(' union all ')
  }
  // An `edge` row always wears a nature — every door writes both or neither —
  // so a null verb is an anomaly, and it leaves here rather than reaching a
  // reader as a sentence with no word in the middle.
  let verb = `(case ${
    natures.map((n) =>
      `when exists (select 1 from "${n}" x where x.entity = g.entity)` +
      ` then '${typeOf[n]}'`
    ).join(' ')
  } end)`
  return `select parent, type, child, ord from (${head(verb)}${where})` +
    ` where type is not null`
}
