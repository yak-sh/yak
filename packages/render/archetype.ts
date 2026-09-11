// Presence-only queries have one answer per immutable table set. Column/value
// queries still read their bundle; an unknown descriptor declines the shortcut.
import { bare, type Clause, type Query } from '@yaks/query'
import { type Bundle, filter } from '@yaks/match'
import type { Vocab } from '@yaks/vocab'

/** Resolve a wire archetype eid to its immutable physical table names. */
export type ArchetypeLookup = (eid: string) => readonly string[] | undefined

let presence = (c: Clause, vocab: Vocab): boolean => {
  if (c.kind == 'and' || c.kind == 'or') {
    return c.clauses.every((c) => presence(c, vocab))
  }
  if (c.kind == 'never') return true
  if (c.kind != 'pred' || c.path.length != 1) return false
  let hops = vocab.aim(c.path[0], bare(c))
  return hops.length == 1 && !hops[0].prop && (
    c.op == '!' && c.value == null ||
    c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == ''
  )
}

let queries = new WeakMap<
  Query,
  WeakMap<
    Vocab,
    {
      test: ReturnType<typeof filter>
      answers: WeakMap<readonly string[], boolean>
    } | null
  >
>()

/** Undefined means this query or descriptor needs ordinary bundle matching. */
export let archetypeMatch = (
  query: Query,
  bundle: Bundle,
  vocab: Vocab,
  lookup?: ArchetypeLookup,
): boolean | undefined => {
  if (!lookup) return
  let id = (bundle.entity as Record<string, unknown>).archetype
  if (typeof id != 'string') return
  let tables = lookup(id)
  if (!tables) return
  let byVocab = queries.get(query)
  if (!byVocab) queries.set(query, byVocab = new WeakMap())
  let compiled = byVocab.get(vocab)
  if (compiled === undefined) {
    compiled = presence(query, vocab)
      ? { test: filter(query, vocab), answers: new WeakMap() }
      : null
    byVocab.set(vocab, compiled)
  }
  if (!compiled) return
  let answer = compiled.answers.get(tables)
  if (answer === undefined) {
    // Use the existing evaluator once per set, preserving grouped-query rules
    // and unknown table semantics without a second predicate implementation.
    answer = compiled.test({
      ...Object.fromEntries(tables.map((name) => [name, {}])),
      entity: { eid: id },
    })
    compiled.answers.set(tables, answer)
  }
  return answer
}
