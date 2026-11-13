// Every tool returns the same named-output value. Validate it once, then write
// retained output takes and their citations in one guarded graph batch. Each
// call has its own entity per slot, and replay keeps it: its `output_of` key
// finds it again (build.ts). A reference in one output may name a sibling of
// the same answer as `$<slot>`. Definition wiring fills reference properties
// even when the tool omits them.
//
// An answer that breaks this contract is `Malformed`, a refusal: the build
// records it as its failure, and no door asks again until its inputs change.
// A model gets the contract wrong now and then, so its malformed answer is
// only that; a code tool's is a bug in its code and is reported.
//
// A model also names a wrong thing now and then: a sibling it never wrote, a
// voice where a member belongs. One bad reference never costs its whole
// answer. The reference is left out of its output, as though the model had
// left it unsaid, and the take records what it said in `built.unresolved`.
// An output its reference owns (`death: cascade`, as a vote is its motion's)
// keeps no components at all, since it means nothing without its owner.
//
// An output wearing `edge` is a link, and a link is identified by its ends and
// its relation (@yaks/edge): it lands on that derived eid, which finds it again
// and carries its slot and output key like any output. One of its ends is
// something its answer made, which makes the link this build's alone; a later
// answer leaves its links as history and clears their choice.

import type { Binding, Bundle, Comp, Eid, ReadTx } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import type { Vocab } from '@yaks/vocab'
import { and, eq, present } from '@yaks/query'
import { EDGE, edgeEid, link, relations, unlink } from '@yaks/edge'
import { held, keyed, keyEid, unkeyed } from '@yaks/key'
import { verify } from '@yaks/kernel'
import { alive } from '@yaks/graph'
import { BUILD, BUILT, ids, OUTPUT_OF, outputOf } from './build.ts'
import { modelToolEid } from './model.ts'
import { inputKey } from './key.ts'
import { step, steps } from './steps.ts'

/** An answer that breaks the output contract, refused. */
export class Malformed extends Refused {
  constructor(message: string) {
    super(message)
    this.name = 'Malformed'
  }
}

export type Spec = {
  /** where it lands: its slot's entity, or a link's ends and relation */
  eid: Eid
  slot: string
  /** a link: its identity is its ends, and its key locates its slot */
  link: boolean
  inputs: Eid[]
  components: Record<string, Comp | null>
  artifact?: Eid
  /** `comp.prop` -> what a model's answer said there, for each reference it
   * named wrong and that was left out */
  unresolved?: Record<string, string>
  /** `comp.prop` -> the `$<slot>` a reference said, before it was placed */
  said?: Record<string, string>
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

// The entity ids an output's reference properties hold.
let references = (vocab: Vocab, spec: Spec): string[] =>
  Object.entries(spec.components).flatMap(([name, c]) =>
    Object.entries(c ?? {}).flatMap(([prop, v]) =>
      vocab.prop(name, prop)?.category == 'ref' && typeof v == 'string'
        ? [v]
        : []
    )
  )

/** The one output contract for a model adapter and any registered code tool.
 * `place` says where an output in a slot lands. A reference naming a sibling
 * output by `$<slot>` comes back as that output's eid; one naming no sibling
 * is refused, or for a `model`'s answer left out as `unresolved`. An output
 * wearing `edge` is a link: it carries one relation beside its ends, and one
 * of its ends is a sibling, so it lands on the eid those derive. */
export let parse = (
  value: unknown,
  selected: Eid[],
  vocab: Vocab,
  place: (slot: string) => Eid,
  wiring: Wiring = {},
  model = false,
): Spec[] => {
  if (!object(value) || !Array.isArray(value.outputs)) {
    throw new Malformed('builder tool answer needs an outputs array')
  }
  if (value.cost != null && dollars(value) == null) {
    throw new Malformed('builder tool answer cost must be dollars')
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
      throw new Malformed(
        'each output needs inputs, components and a unique slot',
      )
    }
    let linked = item.components[EDGE] != null
    let named = item.slot
    slots.add(named)
    let inputs: Eid[] = []
    for (let eid of item.inputs) {
      if (typeof eid != 'string' || !allowed.has(eid)) {
        throw new Malformed(`${named} cites an input its build did not select`)
      }
      if (!inputs.includes(eid)) inputs.push(eid)
    }
    let components: Record<string, Comp | null> = {}
    for (let [name, value] of Object.entries(item.components)) {
      let info = writable(vocab, name)
      if (
        !info ||
        (value != null && !object(value))
      ) throw new Malformed(`${named} has no writable ${name} component`)
      if (value != null) {
        for (let prop of Object.keys(value)) {
          if (!info.writable.includes(prop)) {
            throw new Malformed(`${named} cannot write ${name}.${prop}`)
          }
        }
      }
      components[name] = value == null ? null : { ...value as Comp }
    }
    if (item.artifact != null && typeof item.artifact != 'string') {
      throw new Malformed(`${named} has no artifact id`)
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
    if (!spec) throw new Malformed(`wiring names no output ${slot}`)
    for (let [path, target] of Object.entries(refs)) {
      let [name, prop, ...rest] = path.split('.')
      let info = writable(vocab, name)
      if (
        !prop || rest.length || !info ||
        !info.writable.includes(prop) ||
        vocab.prop(name, prop)?.category != 'ref'
      ) {
        throw new Malformed(
          `${slot} cannot wire ${path}: needs a writable reference`,
        )
      }
      if (!bySlot.has(target)) {
        throw new Malformed(`${slot} wiring names no sibling output ${target}`)
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
        throw new Malformed(`${slot} wiring cannot name edge output ${target}`)
      }
    }
  }
  for (let spec of out) {
    for (let [name, c] of Object.entries(spec.components)) {
      for (let [prop, v] of Object.entries(c ?? {})) {
        let slot = sibling(vocab, name, prop, v)
        if (slot == null) continue
        let path = `${name}.${prop}`
        if (made.has(slot)) {
          c![prop] = place(slot)
          if (model) spec.said = { ...spec.said, [path]: String(v) }
        } else if (model && !spec.link) {
          delete c![prop]
          spec.unresolved = { ...spec.unresolved, [path]: String(v) }
        } else {
          throw new Malformed(`${spec.slot} names no sibling output ${v}`)
        }
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
  if (twice) throw new Malformed(`an answer states ${twice.eid} twice`)
  return specs
}

/** A model's answer with each reference checked against what it names: an
 * entity alive in `held` or a sibling the answer made, wearing the kind the
 * property takes (any, for `entity`). One that names nothing, or the wrong
 * kind, is left out and recorded in `unresolved`; one that owns its output
 * (`death: cascade`) leaves the output no components, which may in turn leave
 * a sibling's reference to it naming the wrong kind. Wired references are the
 * design's, and a link's ends make its identity, so neither is checked. */
export let resolve = (
  specs: Spec[],
  held: Bundle[],
  vocab: Vocab,
  wiring: Wiring = {},
): Spec[] => {
  let out = specs.map((spec) => ({
    ...spec,
    components: Object.fromEntries(
      Object.entries(spec.components).map(([n, c]) => [n, c && { ...c }]),
    ),
  }))
  let worn = (row: { components: Record<string, Comp | null> }) =>
    new Set(Object.keys(row.components).filter((n) => row.components[n]))
  let wears = new Map<Eid, Set<string>>(
    held.filter(alive).map((row) => [
      row.entity.eid,
      new Set(Object.keys(row).filter((n) => row[n] != null)),
    ]),
  )
  let owns = (path: string) =>
    vocab.prop(...path.split('.') as [string, string])?.death == 'cascade'
  let own = out.filter((spec) => !spec.link)
  for (let spec of own) {
    if (Object.keys(spec.unresolved ?? {}).some(owns)) spec.components = {}
    wears.set(spec.eid, worn(spec))
  }
  for (let again = true; again;) {
    again = false
    outputs: for (let spec of own) {
      let wired = new Set(Object.keys(wiring[spec.slot] ?? {}))
      for (let [name, c] of Object.entries(spec.components)) {
        for (let [prop, v] of Object.entries(c ?? {})) {
          let path = `${name}.${prop}`
          let info = vocab.prop(name, prop)
          if (info?.category != 'ref' || wired.has(path)) continue
          let kind = String(info.ref ?? 'entity')
          let on = typeof v == 'string' ? wears.get(v) : undefined
          if (on && (kind == 'entity' || on.has(kind))) continue
          spec.unresolved = {
            ...spec.unresolved,
            [path]: spec.said?.[path] ?? str(v),
          }
          delete c![prop]
          again = true
          if (owns(path)) spec.components = {}
          wears.set(spec.eid, worn(spec))
          if (owns(path)) continue outputs
        }
      }
    }
  }
  return out
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
    throw new Malformed('an edge output carries one relation beside its edge')
  }
  if (typeof from != 'string' || typeof to != 'string' || !from || !to) {
    throw new Malformed(`a ${relation} edge output needs both ends`)
  }
  if (!ours.has(from) && !ours.has(to)) {
    throw new Malformed(
      `a ${relation} edge output joins nothing its answer made`,
    )
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
  let latest = b.call == call.entity.eid
  let wanted = {
    ...run!,
    [BUILD]: {
      ...b,
      key: args.key,
      inputs: inputKey(args.binding),
      definition: args.definition ?? b.definition,
    },
  }
  // A late answer is another retained take, never the choice or desired key.
  let writes = latest
    ? [{
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
    : []
  return [
    ...writes,
    ...await outputs(tx, wanted, call, value, vocab, !args.supplied),
  ]
}

/** Write one call's takes. Supply leaves other slot choices alone; a full
 * answer clears choices for slots it omits without deleting old takes. */
export let outputs = (
  tx: ReadTx,
  run: Bundle,
  call: Bundle,
  value: unknown,
  vocab: Vocab,
  drop = true,
): Bundle[] | Promise<Bundle[]> =>
  steps(function* () {
    let source = run.entity.eid
    let b = comp(run, BUILD)!
    let args = comp(call, 'call')?.args as { binding: Binding; wiring?: Wiring }
    // Only a nonedge slot's take key chooses its owner. Links derive from the
    // siblings this call made; enumeration below changes choices, never ids.
    let slots = object(value) && Array.isArray(value.outputs)
      ? value.outputs.flatMap((item) =>
        object(item) && object(item.components) &&
          item.components[EDGE] == null && typeof item.slot == 'string'
          ? [item.slot]
          : []
      )
      : []
    let owners = yield* step(held(
      tx,
      OUTPUT_OF,
      slots.map((slot) => outputOf(source, slot, call.entity.eid)),
    ))
    let at = new Map(slots.flatMap((slot) => {
      let owner = owners.get(outputOf(source, slot, call.entity.eid))
      return owner ? [[slot, owner] as const] : []
    }))
    let place = (slot: string) => {
      if (!at.has(slot)) at.set(slot, crypto.randomUUID())
      return at.get(slot)!
    }
    let model = str(comp(call, 'call')?.to) == modelToolEid()
    let wiring = args.wiring ?? {}
    let specs = parse(value, ids(args.binding), vocab, place, wiring, model)
    if (model) {
      let named = specs.flatMap((s) => s.link ? [] : references(vocab, s))
      specs = resolve(
        specs,
        yield* step(tx.get([...new Set(named)])),
        vocab,
        wiring,
      )
    }
    let eids = specs.map((s) => s.eid)
    let prior = yield* step(tx.get(eids))
    // The links an earlier answer of this build stated and this one does not.
    let made = yield* step(tx.read(`.${BUILT}.build=${source}&*`))
    let have = new Map(prior.map((row) => [row.entity.eid, row]))
    let targets = yield* step(tx.get([
      ...new Set(
        specs.flatMap((s) => [...s.inputs, ...s.artifact ? [s.artifact] : []]),
      ),
    ]))
    let found = new Map(targets.map((row) => [row.entity.eid, row]))
    // A replay never rewrites a take or changes the person's choice.
    if (made.some((row) => comp(row, BUILT)?.call == call.entity.eid)) return []
    let newest = b.call == call.entity.eid
    let slotsMade = new Set(specs.map((spec) => spec.slot))
    let writes: Bundle[] = !newest
      ? []
      : made.filter((row) =>
        row.chosen && (drop || slotsMade.has(str(comp(row, BUILT)?.slot)))
      )
        .map((row) => ({ entity: row.entity, chosen: null }))
    for (let spec of specs) {
      let eid = spec.eid
      let named = spec.slot
      let before = comp(have.get(eid), BUILT)
      if (spec.artifact && !comp(found.get(spec.artifact), 'artifact')) {
        throw new Malformed(`${named} names a missing artifact`)
      }
      writes.push({
        entity: { eid },
        ...spec.components,
        ...newest ? { chosen: {} } : {},
        [BUILT]: {
          build: source,
          slot: spec.slot,
          key: b.key,
          definition: b.definition ?? null,
          inputs: b.inputs ?? null,
          call: call.entity.eid,
          artifact: spec.artifact ?? null,
          unresolved: spec.unresolved ?? null,
        },
        $was: { [BUILT]: { call: token(before?.call) } },
      })
      // A retained link keeps its eid. Legacy links may have no slot or key;
      // release only a key that still names this link, guarding its owner.
      let old = str(before?.slot)
      if (spec.link && before?.build == source && old && old != spec.slot) {
        let value = outputOf(source, old, call.entity.eid)
        let [row] = yield* step(tx.get([keyEid(OUTPUT_OF, value)]))
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
      writes.push(
        keyed(OUTPUT_OF, eid, outputOf(source, spec.slot, call.entity.eid)),
      )
      let citations = yield* step(tx.read(
        and(eq(`${EDGE}.from`, eid), present('cites')),
      ))
      for (let cited of citations) {
        let to = str(comp(cited, EDGE)?.to)
        if (to && !spec.inputs.includes(to)) {
          writes.push({ ...unlink(eid, 'cites', to), verified: null })
        }
      }
      for (let to of spec.inputs) {
        let target = found.get(to)
        if (!target) throw new Malformed(`${named} cites missing input ${to}`)
        let cite = link(eid, 'cites', to)
        writes.push({ ...cite, ...verify(cite, target, vocab) })
      }
    }
    return writes
  })
