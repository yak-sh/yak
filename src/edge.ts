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
