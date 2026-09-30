// Builder dependencies are graph rows: query components find new matches,
// selected entity ids find content changes, and both survive effect workers.

import {
  type Binding,
  type Bundle,
  identityEid,
  match,
  reads,
  token,
  type Tx,
} from '@yaks/graph'
import { and, type Clause, eq, list } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'

export let DEP = 'builder_dep'

let loose = (cs: Clause[]): boolean =>
  cs.some((c) =>
    c.kind == 'and' || c.kind == 'or'
      ? loose(c.clauses)
      : c.kind == 'pred'
      ? c.not || c.op == '!=' ||
        c.op == '=' && c.value == null
      : c.kind == 'text' || c.kind == 'refs' || c.kind == 'walk'
  )

/** A query's component reads, including a wildcard for unanchored patterns. */
export let queried = (query: string, vocab: Vocab): string[] => {
  if (!query) return []
  let plan = match(query)
  let broad = (m: typeof plan): boolean =>
    m.patterns.some((p) =>
      !p.makes && (
        !reads({ ...m, patterns: [p], collections: [] }, vocab).some((name) =>
          name != 'entity'
        ) ||
        loose(p.filter.clauses)
      )
    ) || m.collections.some(broad)
  return [
    ...reads(plan, vocab).map((name) => `component:${name}`),
    ...(broad(plan) ? ['component:*'] : []),
  ]
}

let ids = (binding: Binding): string[] => [
  ...binding.entities.filter((eid): eid is string => eid != null),
  ...(binding.collections ?? []).flatMap((group) => group.members.flatMap(ids)),
]

export let inputs = (bindings: Binding[]): string[] =>
  [...new Set(bindings.flatMap(ids))].map((eid) => `entity:${eid}`)

export let sync = async (
  tx: Tx,
  builder: string,
  sources: string[],
): Promise<Bundle[]> => {
  let prior = await tx.read(and(eq(`${DEP}.builder`, builder)))
  let want = new Set(sources)
  let source = (b: Bundle): string =>
    String((b[DEP] as { source: string }).source)
  let state = prior.find((b) => source(b) == 'state')
  let have = new Set(prior.map(source))
  let changes: Bundle[] = [
    ...prior.filter((b) => source(b) != 'state' && !want.has(source(b)))
      .map((b): Bundle => ({ entity: b.entity, $delete: true, $quiet: true })),
    ...[...want].filter((source) => !have.has(source)).map((
      source,
    ): Bundle => ({
      entity: { eid: identityEid(DEP, [builder, source]) },
      [DEP]: { builder, source },
      $quiet: true,
    })),
  ]
  if (!changes.length) return []
  let version = (state?.[DEP] as { version?: string } | undefined)?.version
  return [{
    entity: { eid: identityEid(DEP, [builder, 'state']) },
    [DEP]: { builder, source: 'state', version: crypto.randomUUID() },
    $was: { [DEP]: { version: token(version) } },
    $quiet: true,
  }, ...changes]
}

export let candidates = async (
  tx: Tx,
  eid: string,
  touched: string[],
): Promise<Bundle[]> => {
  let sources = [
    `entity:${eid}`,
    'component:*',
    ...touched.map((name) => `component:${name}`),
  ]
  let deps = await tx.read(and(eq(`${DEP}.source`, list(...sources))))
  let ids = [
    ...new Set(
      deps.map((b) => String((b[DEP] as { builder: string }).builder)),
    ),
  ]
  return await tx.get(ids)
}
