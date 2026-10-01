// Every tool returns the same named-output value. Validate it once, then write
// stable built rows and their citations in one guarded graph change. An
// output lands on the entity its slot already has in its build, or a new one,
// and keeps it: its `output_of` key finds it again (build.ts). A reference in
// one output may name a sibling of the same answer as `$<slot>`.
//
// An output wearing `edge` is a link, and a link is identified by its ends and
// its relation (@yaks/edge): it lands on that derived eid, which finds it again
// and carries its slot and output key like any output. One of its ends is
// something its answer made, which makes the link this build's alone; a later
// answer that no longer states it deletes it.

import {
  type Binding,
  type Bundle,
  type Comp,
  type Eid,
  Refused,
  token,
  type Tx,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { and, eq, present } from '@yaks/query'
import { EDGE, edgeEid, link, relations, unlink } from '@yaks/edge'
import { held, keyed, keyEid, unkeyed } from '@yaks/key'
import { verify } from '@yaks/kernel'
import { BUILD, BUILT, ids, OUTPUT_OF, outputOf } from './build.ts'

export type Spec = {
  /** where it lands: its slot's entity, or a link's ends and relation */
  eid: Eid
  slot: string
  /** a link: its identity is its ends, and its key locates its slot */
  link: boolean
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
 * `place` says where an output in a slot lands. A reference naming a sibling
 * output by `$<slot>` comes back as that output's eid; one naming no sibling
 * is refused. An output wearing `edge` is a link: it carries one relation
 * beside its ends, and one of its ends is a sibling, so it lands on the eid
 * those derive. */
export let parse = (
  value: unknown,
  selected: Eid[],
  vocab: Vocab,
  place: (slot: string) => Eid,
): Spec[] => {
  if (!object(value) || !Array.isArray(value.outputs)) {
    throw new Error('builder tool answer needs an outputs array')
  }
  if (value.cost != null && dollars(value) == null) {
    throw new Error('builder tool answer cost must be dollars')
  }
  let allowed = new Set(selected)
  let slots = new Set<string>()
  // The slots of what this answer made, which a reference may name.
  let made = new Set<string>()
  let out: Omit<Spec, 'eid'>[] = []
  for (let item of value.outputs) {
    if (
      !object(item) || !Array.isArray(item.inputs) ||
      !object(item.components) || typeof item.slot != 'string' ||
      !item.slot || slots.has(item.slot)
    ) {
      throw new Error('each output needs inputs, components and a unique slot')
    }
    let linked = item.components[EDGE] != null
    let named = item.slot
    slots.add(named)
    if (!linked) made.add(named)
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
      slot: named,
      link: linked,
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
        if (!made.has(slot)) {
          throw new Error(`${spec.slot} names no sibling output ${v}`)
        }
        c![prop] = place(slot)
      }
    }
  }
  let ours = new Set([...made].map(place))
  let tags = new Set(Object.values(relations(vocab)))
  let specs = out.map((spec): Spec => ({
    ...spec,
    eid: spec.link ? linkOf(spec.components, tags, ours) : place(spec.slot),
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
  let args = comp(call, 'call')?.args as {
    binding?: Binding
    key?: string
    supplied?: boolean
  }
  if (!args?.binding || args.key != b.key) return []
  return [{
    entity: run.entity,
    [BUILD]: { call: call.entity.eid },
    $was: {
      [BUILD]: {
        call: token(call.entity.eid),
        key: token(b.key),
        stale: token(b.stale ?? null),
      },
    },
  }, ...await outputs(tx, run, call, value, vocab, !args.supplied)]
}

/** Write an answer's slots using their output_of keys. A supplied slot leaves
 * every other slot alone; a full tool answer drops links it no longer states. */
export let outputs = async (
  tx: Tx,
  run: Bundle,
  call: Bundle,
  value: unknown,
  vocab: Vocab,
  drop = true,
): Promise<Bundle[]> => {
  let source = run.entity.eid
  let b = comp(run, BUILD)!
  let args = comp(call, 'call')?.args as { binding: Binding }
  // Only a nonedge slot's output_of key chooses its owner. Enumeration below
  // is history for dropped links, never a second way to locate an output.
  let slots = object(value) && Array.isArray(value.outputs)
    ? value.outputs.flatMap((item) =>
      object(item) && object(item.components) &&
        item.components[EDGE] == null && typeof item.slot == 'string'
        ? [item.slot]
        : []
    )
    : []
  let owners = await held(
    tx,
    OUTPUT_OF,
    slots.map((slot) => outputOf(source, slot)),
  )
  let at = new Map(slots.flatMap((slot) => {
    let owner = owners.get(outputOf(source, slot))
    return owner ? [[slot, owner] as const] : []
  }))
  let place = (slot: string) => {
    if (!at.has(slot)) at.set(slot, crypto.randomUUID())
    return at.get(slot)!
  }
  let specs = parse(value, ids(args.binding), vocab, place)
  let eids = specs.map((s) => s.eid)
  let prior = await tx.get(eids)
  // The links an earlier answer of this build stated and this one does not.
  let made = await tx.read(`.${BUILT}.build=${source}&*`)
  let dropped = made.filter((row) =>
    drop &&
    row[EDGE] && !eids.includes(row.entity.eid)
  )
  let have = new Map(prior.map((row) => [row.entity.eid, row]))
  let targets = await tx.get([
    ...new Set(
      specs.flatMap((s) => [...s.inputs, ...s.artifact ? [s.artifact] : []]),
    ),
  ])
  let found = new Map(targets.map((row) => [row.entity.eid, row]))
  let writes: Bundle[] = dropped.map((row) => ({
    entity: row.entity,
    $delete: true,
  }))
  for (let spec of specs) {
    let eid = spec.eid
    let named = spec.slot
    let before = comp(have.get(eid), BUILT)
    if (spec.artifact && !comp(found.get(spec.artifact), 'artifact')) {
      throw new Error(`${named} names a missing artifact`)
    }
    writes.push({
      entity: { eid },
      ...spec.components,
      [BUILT]: {
        build: source,
        slot: spec.slot,
        key: b.key,
        call: call.entity.eid,
        artifact: spec.artifact ?? null,
      },
      $was: { [BUILT]: { call: token(before?.call) } },
    })
    // A retained link keeps its eid. Legacy links may have no slot or key;
    // release only a key that still names this link, guarding its owner.
    let old = str(before?.slot)
    if (spec.link && before?.build == source && old && old != spec.slot) {
      let value = outputOf(source, old)
      let [row] = await tx.get([keyEid(OUTPUT_OF, value)])
      let owner = comp(row, 'key')?.of
      if (owner != null && owner != eid) {
        throw new Refused(`${OUTPUT_OF} ${value} is ${owner}'s`)
      }
      if (owner == eid) {
        writes.push({
          ...unkeyed(OUTPUT_OF, value),
          $was: { key: { of: token(eid) } },
        })
      }
    }
    writes.push(keyed(OUTPUT_OF, eid, outputOf(source, spec.slot)))
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
