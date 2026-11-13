// The ids a model reads, short. A binding's eids are 36 characters and some
// twenty tokens each, so in a prompt over many rows they are most of what is
// sent, and what a small model copies wrong. The model is shown each as a
// handle instead, `@1`, `@2`, …, numbered in the order the frozen binding
// holds them, and its answer is read back through the same numbering: the
// call keeps the binding, so the handles are never stored.

import type { Binding } from '@yaks/graph'

// A value that names an entity though the binding does not select it: a
// reference a variable reads, such as the speaker of a turn.
let EID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})$/

let walk = (binding: Binding, see: (eid: string) => void, own: Set<string>) => {
  for (let eid of binding.entities) if (eid != null) see(eid)
  for (let value of Object.values(binding.vars)) {
    if (typeof value == 'string' && (own.has(value) || EID.test(value))) {
      see(value)
    }
  }
  for (let group of binding.collections ?? []) {
    for (let member of group.members) walk(member, see, own)
  }
}

let entities = (binding: Binding, into = new Set<string>()): Set<string> => {
  for (let eid of binding.entities) if (eid != null) into.add(eid)
  for (let group of binding.collections ?? []) {
    for (let member of group.members) entities(member, into)
  }
  return into
}

/** Each id the binding holds and the handle it is shown as, both ways.
 *
 * ```ts
 * import { handles } from '@yaks/builders/model'
 * import { equal } from '@yaks/testing'
 *
 * let h = handles({ entities: ['a'], vars: { s: 'a' } })
 * equal([h.short.get('a'), h.long.get('@1')], ['@1', 'a'])
 * ```
 */
export let handles = (
  binding: Binding,
): { short: Map<string, string>; long: Map<string, string> } => {
  let short = new Map<string, string>()
  let own = entities(binding)
  walk(binding, (eid) => {
    if (!short.has(eid)) short.set(eid, `@${short.size + 1}`)
  }, own)
  return { short, long: new Map([...short].map(([eid, h]) => [h, eid])) }
}

let swap = (value: unknown, to: Map<string, string>): unknown =>
  typeof value == 'string'
    ? to.get(value) ?? value
    : Array.isArray(value)
    ? value.map((v) => swap(v, to))
    : value && typeof value == 'object'
    ? Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, swap(v, to)]),
    )
    : value

/** The binding as the model is shown it: every id it holds its handle. */
export let shortened = (binding: Binding): Binding => {
  let { short } = handles(binding)
  let go = (b: Binding): Binding => ({
    ...b,
    entities: b.entities.map((eid) => eid == null ? eid : short.get(eid)!),
    vars: swap(b.vars, short) as Binding['vars'],
    ...b.collections
      ? {
        collections: b.collections.map((c) => ({
          ...c,
          members: c.members.map(go),
        })),
      }
      : {},
  })
  return go(binding)
}

/** A model's answer read back: every string in it that is a handle of
 * `binding` is the id it stands for, and everything else as it was said. */
export let lengthened = (value: unknown, binding: Binding): unknown =>
  swap(value, handles(binding).long)
