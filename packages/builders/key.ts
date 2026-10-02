// Input fingerprints and definition fingerprints are independent. A run key
// identifies one attempt; definition edits never invalidate an input fingerprint.
// Nested collections change the key without changing the build's identity.

import { type Binding, type Bundle, type Eid, sha256 } from '@yaks/graph'
import { content } from '@yaks/kernel'
import type { Vocab } from '@yaks/vocab'

export { content }

// Graph admission fills absent component properties with null. Those stored
// blanks have the same meaning as omission in an authored definition.
let details = (using: unknown): [string, unknown][] =>
  using != null && typeof using == 'object' && !Array.isArray(using)
    ? Object.entries(using).filter(([, value]) => value != null)
      .toSorted(([a], [b]) => a.localeCompare(b))
    : []

let tree = (
  binding: Binding,
  rows: Map<Eid, Bundle>,
  vocab: Vocab,
): unknown => [
  binding.entities.map((eid) =>
    eid == null ? null : [eid, content(vocab)(rows.get(eid)!)]
  ),
  Object.entries(binding.vars).toSorted(([a], [b]) => a.localeCompare(b)),
  (binding.collections ?? []).map((group) =>
    group.members.map((one) => tree(one, rows, vocab))
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  ),
]

export let inputKey = (
  binding: Binding,
  rows: Map<Eid, Bundle>,
  vocab: Vocab,
): string => sha256(JSON.stringify(tree(binding, rows, vocab)))

export let definitionKey = (
  builder: Bundle,
  tool: Bundle,
  template?: string,
  using?: Record<string, unknown>,
): string =>
  sha256(JSON.stringify([
    template ?? (builder.content as { body?: string } | undefined)?.body ?? '',
    details(using ?? builder.using ?? {}),
    (builder.builder as { to?: string } | undefined)?.to,
    (tool.tool as { revision?: string }).revision ?? '',
  ]))

/** An attempt key. A nonce also distinguishes deliberate identical rerolls. */
export let key = (
  builder: Bundle,
  tool: Bundle,
  binding: Binding,
  rows: Map<Eid, Bundle>,
  vocab: Vocab,
  template?: string,
  using?: Record<string, unknown>,
  nonce = '',
): string =>
  sha256(JSON.stringify([
    definitionKey(builder, tool, template, using),
    inputKey(binding, rows, vocab),
    nonce,
  ]))
