// A named output is a stable entity owned by its build and slot. Each answer
// replaces what the previous answer wrote; sibling references keep those ids.
// Links derive their ids from their ends and relation, so changed or omitted
// links are deleted. Calls retain their answers, not additional live outputs.

import {
  type Binding,
  type Bundle,
  type Comp,
  type Eid,
  type ReadTx,
  token,
} from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { and, eq, present } from '@yaks/query'
import { EDGE, edgeEid, link, relations, unlink } from '@yaks/edge'
import { held, keyed, unkeyed } from '@yaks/key'
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

/** Output slot -> component.property -> sibling output slot. */
export type Wiring = Record<string, Record<string, string>>

let object = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v == 'object' && !Array.isArray(v)
let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined
let str = (v: unknown): string => v == null ? '' : String(v)
let writable = (vocab: Vocab, name: string) => {
  let info = vocab.comp(name)
  return info?.wire && ![BUILD, BUILT, 'builder', 'chosen'].includes(name)
    ? info
    : undefined
}

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
  wiring: Wiring = {},
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
    let inputs: Eid[] = []
    for (let eid of item.inputs) {
      if (typeof eid != 'string' || !allowed.has(eid)) {
        throw new Error(`${named} cites an input its build did not select`)
      }
      if (!inputs.includes(eid)) inputs.push(eid)
    }
    let components: Record<string, Comp | null> = {}
    for (let [name, value] of Object.entries(item.components)) {
      let info = writable(vocab, name)
      if (
        !info ||
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
  let bySlot = new Map(out.map((spec) => [spec.slot, spec]))
  for (let [slot, refs] of Object.entries(wiring)) {
    let spec = bySlot.get(slot)
    if (!spec) throw new Error(`wiring names no output ${slot}`)
    for (let [path, target] of Object.entries(refs)) {
      let [name, prop, ...rest] = path.split('.')
      let info = writable(vocab, name)
      if (
        !prop || rest.length || !info ||
        !info.writable.includes(prop) ||
        vocab.prop(name, prop)?.category != 'ref'
      ) {
        throw new Error(
          `${slot} cannot wire ${path}: needs a writable reference`,
        )
      }
      if (!bySlot.has(target)) {
        throw new Error(`${slot} wiring names no sibling output ${target}`)
      }
      spec.components[name] = {
        ...spec.components[name],
        [prop]: place(target),
      }
    }
    spec.link = spec.components[EDGE] != null
  }
  // Links derive their identities from nonedge siblings, never each other.
  let made = new Set(out.filter((spec) => !spec.link).map((spec) => spec.slot))
  for (let [slot, refs] of Object.entries(wiring)) {
    for (let target of Object.values(refs)) {
      if (!made.has(target)) {
        throw new Error(`${slot} wiring cannot name edge output ${target}`)
      }
    }
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
  tx: ReadTx,
  call: Bundle,
  value: unknown,
  vocab: Vocab,
): Promise<Bundle[]> => {
  let source = str(comp(call, 'call')?.source)
  let [run] = await tx.get([source])
  let b = comp(run, BUILD)
  if (!b) return []
  let args = comp(call, 'call')?.args as {
    binding?: Binding
    key?: string
    inputs?: string
    definition?: string
    supplied?: boolean
  }
  if (!args?.binding || !args.key) return []
  if (b.call != call.entity.eid) return []
  let wanted = {
    ...run!,
    [BUILD]: {
      ...b,
      key: args.key,
      inputs: args.inputs ?? b.inputs,
      definition: args.definition ?? b.definition,
    },
  }
  // The build guard keeps a concurrent newer call from being overwritten.
  let writes = [{
    entity: run.entity,
    [BUILD]: { call: call.entity.eid, key: args.key },
    failed: null,
    $was: {
      [BUILD]: {
        call: token(call.entity.eid),
        key: token(b.key),
        stale: token(b.stale ?? null),
      },
    },
  }]
  return [
    ...writes,
    ...await outputs(tx, wanted, call, value, vocab, !args.supplied),
  ]
}

// Remove only properties the previous answer owned. Other writers may have
// added components or properties to this stable entity in the meantime.
let replaced = async (
  tx: ReadTx,
  before: Bundle | undefined,
  spec: Spec,
  vocab: Vocab,
): Promise<Record<string, Comp | null>> => {
  let built = comp(before, BUILT)
  if (!built?.call) return {}
  let slot = str(built.slot)
  let replies = await tx.read(`.output.source=${built.call}&*`)
  let owned: Record<string, Comp> = {}
  for (let reply of replies) {
    let value = comp(reply, 'output')?.value
    if (!object(value) || !Array.isArray(value.outputs)) continue
    let item = value.outputs.find((item) => object(item) && item.slot == slot)
    if (!object(item) || !object(item.components)) continue
    for (let [name, c] of Object.entries(item.components)) {
      if (object(c) && writable(vocab, name)) owned[name] = c as Comp
    }
  }
  let [call] = await tx.get([String(built.call)])
  let args = comp(call, 'call')?.args as { wiring?: Wiring } | undefined
  for (let path of Object.keys(args?.wiring?.[slot] ?? {})) {
    let [name, prop] = path.split('.')
    owned[name] = { ...owned[name], [prop]: null }
  }
  let clear: Record<string, Comp | null> = {}
  for (let [name, previous] of Object.entries(owned)) {
    let next = spec.components[name]
    let removed = Object.keys(previous).filter((prop) =>
      !(prop in (next ?? {}))
    )
    if (!removed.length && next != null) continue
    let kept = Object.keys(comp(before, name) ?? {}).filter((prop) =>
      !removed.includes(prop) && comp(before, name)?.[prop] != null
    )
    clear[name] = next == null && !kept.length
      ? null
      : Object.fromEntries(removed.map((prop) => [prop, null]))
  }
  return clear
}

/** Replace one call's named outputs. Supply leaves other slots alone; a full
 * answer deletes the outputs and links for slots it omits. */
export let outputs = async (
  tx: ReadTx,
  run: Bundle,
  call: Bundle,
  value: unknown,
  vocab: Vocab,
  drop = true,
): Promise<Bundle[]> => {
  let source = run.entity.eid
  let b = comp(run, BUILD)!
  let args = comp(call, 'call')?.args as { binding: Binding; wiring?: Wiring }
  if (b.call != call.entity.eid) return []
  let made = await tx.read(`.${BUILT}.build=${source}&*`)
  // Replay never rewrites an output. Its frozen answer remains on the call.
  if (made.some((row) => comp(row, BUILT)?.call == call.entity.eid)) return []
  // Nonedge slots keep their entity ids. Adopt the chosen legacy output when
  // it has no stable key, so references held by consumers keep pointing at it.
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
    let owner = owners.get(outputOf(source, slot)) ??
      made.find((row) => row.chosen && comp(row, BUILT)?.slot == slot)?.entity
        .eid
    return owner ? [[slot, owner] as const] : []
  }))
  let place = (slot: string) => {
    if (!at.has(slot)) at.set(slot, crypto.randomUUID())
    return at.get(slot)!
  }
  let specs = parse(value, ids(args.binding), vocab, place, args.wiring ?? {})
  let eids = specs.map((s) => s.eid)
  let prior = await tx.get(eids)
  let have = new Map(prior.map((row) => [row.entity.eid, row]))
  let targets = await tx.get([
    ...new Set(
      specs.flatMap((s) => [...s.inputs, ...s.artifact ? [s.artifact] : []]),
    ),
  ])
  let found = new Map(targets.map((row) => [row.entity.eid, row]))
  let slotsMade = new Set(specs.map((spec) => spec.slot))
  let keep = new Set(eids)
  let writes: Bundle[] = made.filter((row) =>
    !keep.has(row.entity.eid) &&
    (drop || slotsMade.has(str(comp(row, BUILT)?.slot)))
  ).map((row) => ({
    entity: row.entity,
    $delete: true,
    $was: { [BUILT]: { call: token(comp(row, BUILT)?.call) } },
  }))
  for (let spec of specs) {
    let eid = spec.eid
    let named = spec.slot
    let before = comp(have.get(eid), BUILT)
    if (spec.artifact && !comp(found.get(spec.artifact), 'artifact')) {
      throw new Error(`${named} names a missing artifact`)
    }
    let components = await replaced(tx, have.get(eid), spec, vocab)
    for (let [name, c] of Object.entries(spec.components)) {
      components[name] = c == null ? null : { ...components[name], ...c }
    }
    writes.push({
      entity: { eid },
      ...components,
      chosen: {},
      [BUILT]: {
        build: source,
        slot: spec.slot,
        key: b.key,
        definition: b.definition ?? null,
        inputs: b.inputs ?? null,
        call: call.entity.eid,
        artifact: spec.artifact ?? null,
      },
      $was: {
        [BUILT]: { call: token(before?.call) },
        ...Object.fromEntries(
          Object.entries(components).filter(([, c]) => c == null).map((
            [name],
          ) => [
            name,
            Object.fromEntries(
              vocab.props(name).map((prop) => [
                prop,
                token(comp(have.get(eid), name)?.[prop]),
              ]),
            ),
          ]),
        ),
      },
    })
    // Retire per-call aliases when adopting a stable slot key. Links whose
    // slot changes release their previous stable key in the same batch.
    let value = outputOf(source, spec.slot)
    let aliases = await tx.read(`.output_of&.key.of=${eid}&*`)
    for (let alias of aliases) {
      let old = str(comp(alias, 'key')?.value)
      if (old && old != value) {
        writes.push({
          ...unkeyed(OUTPUT_OF, old),
          $was: { key: { of: token(eid) } },
        })
      }
    }
    writes.push(keyed(OUTPUT_OF, eid, value))
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
