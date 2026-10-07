// Input fingerprints and definition fingerprints are independent. A run key
// identifies one attempt; definition edits never invalidate an input fingerprint.
// Nested collections change the key without changing the build's identity.

import { type Binding, type Bundle, sha256 } from '@yaks/graph'
import type { Wiring } from './answer.ts'

export { content } from '@yaks/kernel'

// Graph admission fills absent component properties with null. Those stored
// blanks have the same meaning as omission in an authored definition.
let details = (using: unknown): [string, unknown][] =>
  using != null && typeof using == 'object' && !Array.isArray(using)
    ? Object.entries(using).filter(([, value]) => value != null)
      .toSorted(([a], [b]) => a.localeCompare(b))
    : []

let tree = (binding: Binding): unknown => [
  binding.entities,
  Object.entries(binding.vars).toSorted(([a], [b]) => a.localeCompare(b)),
  (binding.collections ?? []).map((group) =>
    group.members.map(tree)
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  ),
]

// A tool receives the frozen binding, not the rest of its entities. Hash only
// those values, so gameplay and bookkeeping cannot redo unrelated work.
export let inputKey = (binding: Binding): string =>
  `binding:${sha256(JSON.stringify(tree(binding)))}`

export let definitionKey = (
  builder: Bundle,
  tool: Bundle,
  template?: string,
  using?: Record<string, unknown>,
): string => {
  let definition = builder.builder as
    | { to?: string; wiring?: Wiring }
    | undefined
  let wiring = details(definition?.wiring).map((
    [slot, refs],
  ) => [slot, details(refs)])
  return sha256(JSON.stringify([
    template ?? (builder.content as { body?: string } | undefined)?.body ?? '',
    details(using ?? builder.using ?? {}),
    definition?.to,
    (tool.tool as { revision?: string }).revision ?? '',
    ...wiring.length ? [wiring] : [],
  ]))
}

/** An attempt key. A nonce also distinguishes deliberate identical rerolls. */
export let key = (
  builder: Bundle,
  tool: Bundle,
  binding: Binding,
  template?: string,
  using?: Record<string, unknown>,
  nonce = '',
): string =>
  sha256(JSON.stringify([
    definitionKey(builder, tool, template, using),
    inputKey(binding),
    nonce,
  ]))
