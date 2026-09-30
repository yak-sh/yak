// Every tool returns the same named-output value. Validate it once, then write
// stable built rows and their citations in one guarded graph change.

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
import { EDGE, link, unlink } from '@yaks/edge'
import { verify } from '@yaks/kernel'
import { BUILD, BUILT, ids, output } from './build.ts'

export type Spec = {
  slot: string
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

/** The one output contract for a model adapter and any registered code tool. */
export let parse = (
  value: unknown,
  selected: Eid[],
  vocab: Vocab,
): Spec[] => {
  if (!object(value) || !Array.isArray(value.outputs)) {
    throw new Error('builder tool answer needs an outputs array')
  }
  if (value.cost != null && dollars(value) == null) {
    throw new Error('builder tool answer cost must be dollars')
  }
  let allowed = new Set(selected)
  let slots = new Set<string>()
  let out: Spec[] = []
  for (let item of value.outputs) {
    if (
      !object(item) || typeof item.slot != 'string' || !item.slot ||
      slots.has(item.slot) || !Array.isArray(item.inputs) ||
      !object(item.components)
    ) {
      throw new Error('each output needs a unique slot, inputs and components')
    }
    slots.add(item.slot)
    let inputs: Eid[] = []
    for (let eid of item.inputs) {
      if (typeof eid != 'string' || !allowed.has(eid)) {
        throw new Error(`${item.slot} cites an input its build did not select`)
      }
      if (!inputs.includes(eid)) inputs.push(eid)
    }
    let components: Record<string, Comp | null> = {}
    for (let [name, value] of Object.entries(item.components)) {
      let info = vocab.comp(name)
      if (
        !info?.wire || [BUILD, BUILT, 'builder', EDGE].includes(name) ||
        (value != null && !object(value))
      ) throw new Error(`${item.slot} has no writable ${name} component`)
      if (value != null) {
        for (let prop of Object.keys(value)) {
          if (!info.writable.includes(prop)) {
            throw new Error(`${item.slot} cannot write ${name}.${prop}`)
          }
        }
      }
      components[name] = value as Comp | null
    }
    if (item.artifact != null && typeof item.artifact != 'string') {
      throw new Error(`${item.slot} has no artifact id`)
    }
    out.push({
      slot: item.slot,
      inputs,
      components,
      ...(item.artifact ? { artifact: item.artifact } : {}),
    })
  }
  return out
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
  let specs = parse(value, ids(args.binding), vocab)
  let eids = specs.map((s) => output(source, s.slot))
  let prior = await tx.get(eids)
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
  }]
  for (let spec of specs) {
    let eid = output(source, spec.slot)
    let before = comp(have.get(eid), BUILT)
    if (spec.artifact && !comp(found.get(spec.artifact), 'artifact')) {
      throw new Error(`${spec.slot} names a missing artifact`)
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
      if (!target) throw new Error(`${spec.slot} cites missing input ${to}`)
      let cite = link(eid, 'cites', to)
      writes.push({ ...cite, ...verify(cite, target, vocab) })
    }
  }
  return writes
}
