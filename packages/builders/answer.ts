// Every tool returns the same named-output value. Validate it once, then write
// stable built rows and their citations in one guarded graph change. An
// output's eid derives from its build and slot, so a reference in one output
// may name a sibling of the same answer as `$<slot>`.
//
// An output wearing `edge` is a link, and a link is identified by its ends and
// its relation (@yaks/edge), not by a slot: it lands on that derived eid, and
// its `built` names no slot, so the two derivations never meet. One of its
// ends is something its answer made, which makes the link this build's alone;
// a later answer that no longer states it deletes it.

import {
  type Binding,
  type Bundle,
  type Comp,
  type Eid,
  token,
  type Tx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { and, eq, present } from '@yaks/query'
import { EDGE, edgeEid, link, relations, unlink } from '@yaks/edge'
import { verify } from '@yaks/kernel'
import { BUILD, BUILT, ids, output } from './build.ts'

export type Spec = {
  /** where it lands: its build and slot, or a link's ends and relation */
  eid: Eid
  /** absent on a link, which no slot names */
  slot?: string
  inputs: Eid[]
  components: Record<string, Comp | null>
  artifact?: Eid
}

let object = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v == 'object' && !Array.isArray(v)
let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let str = (v: unknown): string => v == null ? '' : String(v)

// The dollars an answer says its call spent, where it says any.
let dollars = (value: unknown): number | undefined =>
  object(value) && typeof value.cost == 'number' &&
    Number.isFinite(value.cost) && value.cost >= 0
    ? value.cost
    : undefined

// The slot a reference names by `$<slot>`, where the value is one.
let sibling = (vocab: Vocab, comp: string, prop: string, v: unknown) =>
  typeof v == 'string' && v.startsWith('$') &&
    vocab.prop(comp, prop)?.category == 'ref'
    ? v.slice(1)
    : undefined

/** The one output contract for a model adapter and any registered code tool.
 * A reference naming a sibling output by `$<slot>` comes back as that
 * output's eid in `build`; one naming no sibling is refused. An output wearing
 * `edge` is a link: it names no slot, carries one relation beside its ends,
 * and one of its ends is a sibling, so it lands on the eid those derive. */
export let parse = (
  value: unknown,
  selected: Eid[],
  vocab: Vocab,
  build: Eid,
): Spec[] => {
  if (!object(value) || !Array.isArray(value.outputs)) {
    throw new Error('builder tool answer needs an outputs array')
  }
  if (value.cost != null && dollars(value) == null) {
    throw new Error('builder tool answer cost must be dollars')
  }
  let allowed = new Set(selected)
  let slots = new Set<string>()
  let out: Omit<Spec, 'eid'>[] = []
  for (let item of value.outputs) {
    let linked = object(item) && object(item.components) &&
      item.components[EDGE] != null
    if (
      !object(item) || !Array.isArray(item.inputs) ||
      !object(item.components) || !linked &&
        (typeof item.slot != 'string' || !item.slot || slots.has(item.slot))
    ) {
      throw new Error(
        'each output needs inputs, components, and a unique slot or an edge',
      )
    }
    let named = linked ? 'an edge' : String(item.slot)
    if (!linked) slots.add(named)
    let inputs: Eid[] = []
    for (let eid of item.inputs) {
      if (typeof eid != 'string' || !allowed.has(eid)) {
        throw new Error(`${named} cites an input its build did not select`)
      }
      if (!inputs.includes(eid)) inputs.push(eid)
    }
    let components: Record<string, Comp | null> = {}
    for (let [name, value] of Object.entries(item.components)) {
      let info = vocab.comp(name)
      if (
        !info?.wire || [BUILD, BUILT, 'builder'].includes(name) ||
        (value != null && !object(value))
      ) throw new Error(`${named} has no writable ${name} component`)
      if (value != null) {
        for (let prop of Object.keys(value)) {
          if (!info.writable.includes(prop)) {
            throw new Error(`${named} cannot write ${name}.${prop}`)
          }
        }
      }
      components[name] = value == null ? null : { ...value as Comp }
    }
    if (item.artifact != null && typeof item.artifact != 'string') {
      throw new Error(`${named} has no artifact id`)
    }
    out.push({
      ...linked ? {} : { slot: named },
      inputs,
      components,
      ...(item.artifact ? { artifact: item.artifact } : {}),
    })
  }
  for (let spec of out) {
    for (let [name, c] of Object.entries(spec.components)) {
      for (let [prop, v] of Object.entries(c ?? {})) {
        let slot = sibling(vocab, name, prop, v)
        if (slot == null) continue
        if (!slots.has(slot)) {
          throw new Error(
            `${spec.slot ?? 'an edge'} names no sibling output ${v}`,
          )
        }
        c![prop] = output(build, slot)
      }
    }
  }
  let ours = new Set([...slots].map((slot) => output(build, slot)))
  let tags = new Set(Object.values(relations(vocab)))
  let specs = out.map((spec): Spec => ({
    ...spec,
    eid: spec.slot == null
      ? linkOf(spec.components, tags, ours)
      : output(build, spec.slot),
  }))
  let twice = specs.find((s, i) => specs.findIndex((t) => t.eid == s.eid) < i)
  if (twice) throw new Error(`an answer states ${twice.eid} twice`)
  return specs
}

// Where a link output lands: the eid its ends and its one relation derive.
// One end is a sibling, so no other build or writer holds the same link.
let linkOf = (
  components: Record<string, Comp | null>,
  tags: Set<string>,
  ours: Set<Eid>,
): Eid => {
  let { from, to } = components[EDGE] ?? {}
  let [relation, ...more] = Object.keys(components).filter((n) => tags.has(n))
  if (!relation || more.length) {
    throw new Error('an edge output carries one relation beside its edge')
  }
  if (typeof from != 'string' || typeof to != 'string' || !from || !to) {
    throw new Error(`a ${relation} edge output needs both ends`)
  }
  if (!ours.has(from) && !ours.has(to)) {
    throw new Error(`a ${relation} edge output joins nothing its answer made`)
  }
  return edgeEid(from, relation, to)
}

/** What a tool's answer says its call spent (`cost` beside `outputs`, in
 * dollars), as the `cost` the call stores. It is the call's whatever became of
 * the build: a moved key or a malformed output spent it all the same. */
export let spent = (call: Bundle, value: unknown): Bundle[] => {
  let n = dollars(value)
  return n == null
    ? []
    : [{ entity: call.entity, cost: { dollars: n, reported: true } }]
}

/** A completed call's output value, with its build as a concurrency guard. An
 * answer whose binding vanished while it was asked is kept, not current, so a
 * binding that returns under the same key has it without asking again. */
export let answer = async (
  tx: Tx,
  call: Bundle,
  value: unknown,
  vocab: Vocab,
): Promise<Bundle[]> => {
  let source = str(comp(call, 'call')?.source)
  let [run] = await tx.get([source])
  let b = comp(run, BUILD)
  if (!b || b.call != call.entity.eid) return []
  let args = comp(call, 'call')?.args as { binding?: Binding; key?: string }
  if (!args?.binding || args.key != b.key) return []
  let specs = parse(value, ids(args.binding), vocab, source)
  let eids = specs.map((s) => s.eid)
  let prior = await tx.get(eids)
  // The links an earlier answer of this build stated and this one does not.
  let dropped =
    (await tx.read(and(eq(`${BUILT}.build`, source), present(EDGE))))
      .filter((row) => !eids.includes(row.entity.eid))
  let have = new Map(prior.map((row) => [row.entity.eid, row]))
  let targets = await tx.get([
    ...new Set(
      specs.flatMap((s) => [...s.inputs, ...s.artifact ? [s.artifact] : []]),
    ),
  ])
  let found = new Map(targets.map((row) => [row.entity.eid, row]))
  let writes: Bundle[] = [{
    entity: run.entity,
    [BUILD]: { call: call.entity.eid },
    $was: {
      [BUILD]: {
        call: token(call.entity.eid),
        key: token(b.key),
        stale: token(b.stale ?? null),
      },
    },
  }, ...dropped.map((row): Bundle => ({ entity: row.entity, $delete: true }))]
  for (let spec of specs) {
    let eid = spec.eid
    let named = spec.slot ?? eid
    let before = comp(have.get(eid), BUILT)
    if (spec.artifact && !comp(found.get(spec.artifact), 'artifact')) {
      throw new Error(`${named} names a missing artifact`)
    }
    writes.push({
      entity: { eid },
      ...spec.components,
      [BUILT]: {
        build: source,
        slot: spec.slot ?? null,
        key: b.key,
        call: call.entity.eid,
        artifact: spec.artifact ?? null,
      },
      $was: { [BUILT]: { call: token(before?.call) } },
    })
    let citations = await tx.read(
      and(eq(`${EDGE}.from`, eid), present('cites')),
    )
    for (let cited of citations) {
      let to = str(comp(cited, EDGE)?.to)
      if (to && !spec.inputs.includes(to)) {
        writes.push({ ...unlink(eid, 'cites', to), verified: null })
      }
    }
    for (let to of spec.inputs) {
      let target = found.get(to)
      if (!target) throw new Error(`${named} cites missing input ${to}`)
      let cite = link(eid, 'cites', to)
      writes.push({ ...cite, ...verify(cite, target, vocab) })
    }
  }
  return writes
}
