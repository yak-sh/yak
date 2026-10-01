// A builder is a query-to-tool definition. Each outer binding has one stable
// build; its changing content asks the tool through a fresh recorded call.

import {
  type Binding,
  type Bundle,
  type Comp,
  type Eid,
  identityEid,
  match,
  reads,
  token,
  type Tx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { next } from '@yaks/wake'
import { key } from './key.ts'
import { inputs, queried, sync } from './deps.ts'

export let BUILDER = 'builder'
export let BUILD = 'build'
export let BUILT = 'built'

export type Options = {
  vocab: Vocab
  rest?: string
  now?: () => string
  eid?: () => Eid
  variant?: string
  template?: string
  using?: Comp
  /** build only the bindings whose outer entities these name */
  only?: Eid[]
  /** build only the first n bindings */
  limit?: number
}

export type Plan = {
  builder: Eid
  build: Eid
  match: string
  variant: string
  binding: Binding
  key: string
  to: Eid
  template: string
  using: Comp
}

export let clock = (): string => new Date().toISOString()
let mint = (): Eid => crypto.randomUUID()
let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let str = (c: Comp | undefined, prop: string): string =>
  c?.[prop] == null ? '' : String(c[prop])

export let due = (builder: Comp | undefined, at: string): boolean => {
  let floor = Date.parse(str(builder, 'floor'))
  return Number.isNaN(floor) || floor <= Date.parse(at)
}

/** An outer entity tuple names one build, regardless of nested collections. */
export let run = (
  builder: Eid,
  entities: (Eid | null)[],
  variant = 'main',
): Eid => identityEid(BUILD, [builder, JSON.stringify(entities), variant])

/** One output slot belongs to its build, including its variant. */
export let output = (build: Eid, slot = 'main'): Eid =>
  identityEid(BUILT, [build, slot])

export let current = (build: Comp, built: Comp): boolean =>
  !build.stale && build.key != null && built.key == build.key

/** The entity a binding is built for: the first its outer tuple holds, which
 * `build.for` names so a query can reach it. A builder with no query has
 * none. */
export let subject = (binding: Binding): Eid | null =>
  binding.entities.find((eid) => eid != null) ?? null

export let ids = (binding: Binding): Eid[] => [
  ...binding.entities.filter((eid): eid is Eid => eid != null),
  ...(binding.collections ?? []).flatMap((group) => group.members.flatMap(ids)),
]

// A shadow or this builder's own output is history, never a selected input.
// Nested collection members are removed individually; the outer binding
// remains a build even when its collection becomes empty.
let selectedRow = (rows: Map<Eid, Bundle>, builder: Eid, eid: Eid) => {
  let row = rows.get(eid)
  let built = comp(row, BUILT)
  let parent = built && rows.get(str(built, 'build'))
  return row && !row.tombstone && !row.builder_dep && eid != builder &&
    (!built || str(comp(parent, BUILD), 'variant') == 'main' &&
        str(comp(parent, BUILD), 'builder') != builder)
}
let prune = (
  binding: Binding,
  rows: Map<Eid, Bundle>,
  builder: Eid,
): Binding | undefined =>
  binding.entities.every((eid) =>
      eid == null || selectedRow(rows, builder, eid)
    )
    ? {
      ...binding,
      collections: binding.collections?.map((group) => ({
        ...group,
        members: group.members.flatMap((member) => {
          let kept = prune(member, rows, builder)
          return kept ? [kept] : []
        }),
      })),
    }
    : undefined

/** Read the complete binding tree and the content of every entity it names. */
export let selected = async (
  tx: Tx,
  builder: Bundle,
  vocab: Vocab,
): Promise<{ binding: Binding; rows: Map<Eid, Bundle> }[]> => {
  let query = str(comp(builder, BUILDER), 'query')
  if (!query) return [{ binding: { entities: [], vars: {} }, rows: new Map() }]
  if (!tx.bindings) throw new Error('builder storage cannot evaluate bindings')
  let plan = match(query)
  let [found] = await tx.bindings([plan], [], reads(plan, vocab))
  let all = [...new Set(found.flatMap(ids))]
  let rows = new Map((await tx.get(all)).map((b) => [b.entity.eid, b]))
  let builds = [
    ...new Set(
      [...rows.values()].map((b) => str(comp(b, BUILT), 'build')).filter(
        Boolean,
      ),
    ),
  ]
  for (let b of await tx.get(builds)) rows.set(b.entity.eid, b)
  return found.flatMap((binding) => {
    let kept = prune(binding, rows, builder.entity.eid)
    return kept ? [{ binding: kept, rows }] : []
  })
}

/** The bindings a partial run builds: those whose outer entities include one
 * `only` names, then the first `limit` of them. Every binding without either. */
export let narrow = <T extends { binding: Binding }>(
  chosen: T[],
  only?: Eid[],
  limit?: number,
): T[] => {
  let named = only
    ? chosen.filter(({ binding }) =>
      binding.entities.some((eid) => eid != null && only.includes(eid))
    )
    : chosen
  return limit == null ? named : named.slice(0, limit)
}

/** A tool call freezes one binding tree and the key it was selected under. */
export let start = (
  p: Plan,
  prior: Comp | undefined,
  eid: () => Eid = mint,
): Bundle[] => {
  let call = eid()
  return [
    {
      entity: { eid: p.build },
      [BUILD]: {
        builder: p.builder,
        match: p.match,
        variant: p.variant,
        for: subject(p.binding),
        key: p.key,
        call,
        stale: false,
      },
      $was: {
        [BUILD]: {
          key: token(prior?.key),
          call: token(prior?.call),
          stale: token(prior?.stale),
        },
      },
    },
    {
      entity: { eid: call },
      call: {
        to: p.to,
        source: p.build,
        args: {
          binding: p.binding,
          key: p.key,
          template: p.template,
          using: p.using,
        },
      },
    },
  ]
}

/** Bring every desired build current and mark vanished bindings stale. An
 * archived builder is put away: every door reconciles through here, so none
 * of them builds it until the mark is removed. A partial run (`only`,
 * `limit`) builds some bindings and leaves every other build as it is, never
 * stale, since a binding it skipped has not vanished. */
export let reconcile = async (
  tx: Tx,
  builder: Bundle,
  o: Options,
  at: string = (o.now ?? clock)(),
  scheduled = true,
  retry = false,
): Promise<{ plans: Plan[]; writes: Bundle[] }> => {
  let definition = comp(builder, BUILDER)
  if (!definition || builder.archived) return { plans: [], writes: [] }
  let to = str(definition, 'to')
  let immediate = definition.immediate == true
  let ready = !scheduled || due(definition, at)
  let chosen = immediate || ready && to
    ? await selected(tx, builder, o.vocab)
    : undefined
  let dep = await sync(
    tx,
    builder.entity.eid,
    immediate
      ? [
        ...queried(str(definition, 'query'), o.vocab),
        ...inputs(chosen?.map((row) => row.binding) ?? []),
      ]
      : [],
  )
  if (!ready || !to) return { plans: [], writes: dep }
  let [tool] = await tx.get([to])
  if (!tool?.tool) throw new Error(`builder tool ${to} is missing`)
  let variant = o.variant ?? 'main'
  chosen ??= await selected(tx, builder, o.vocab)
  let prior = await tx.read(
    `.build.builder=${builder.entity.eid}&.build.variant=${
      encodeURIComponent(variant)
    }&*`,
  )
  let held = new Map(prior.map((b) => [b.entity.eid, b]))
  let partial = o.only != null || o.limit != null
  let plans: Plan[] = []
  let writes: Bundle[] = [...dep]
  for (let { binding, rows } of narrow(chosen, o.only, o.limit)) {
    let entities = binding.entities
    let match = JSON.stringify(entities)
    let build = run(builder.entity.eid, entities, variant)
    let p: Plan = {
      builder: builder.entity.eid,
      build,
      match,
      variant,
      binding,
      key: key(builder, tool, binding, rows, o.vocab, o.template, {
        ...comp(builder, 'using'),
        ...o.using,
      }),
      to,
      template: o.template ?? str(comp(builder, 'content'), 'body'),
      using: { ...comp(builder, 'using'), ...o.using },
    }
    plans.push(p)
    let before = comp(held.get(build), BUILD)
    held.delete(build)
    let same = str(before, 'key') == p.key
    if (same && before?.stale) {
      writes.push({
        entity: { eid: build },
        [BUILD]: { stale: false },
        $was: { [BUILD]: { stale: token(true) } },
      })
    }
    let failed = false
    if (retry && same && before?.call) {
      let [call] = await tx.get([String(before.call)])
      failed = comp(call, 'execution')?.state == 'failed'
    }
    if (!same || failed) writes.push(...start(p, before, o.eid))
  }
  for (let old of partial ? [] : held.values()) {
    let b = comp(old, BUILD)
    if (b?.stale) continue
    writes.push({
      entity: old.entity,
      [BUILD]: { stale: true },
      $was: { [BUILD]: { stale: token(b?.stale) } },
    })
  }
  let floor = o.rest && writes.some((b) => b.call)
    ? next(o.rest, Date.parse(at))
    : null
  if (floor) {
    writes.push({
      entity: builder.entity,
      [BUILDER]: { floor },
    })
  }
  return { plans, writes }
}
