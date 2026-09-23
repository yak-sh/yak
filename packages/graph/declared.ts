// Running the declared rules. A rule is a query (./join.ts parses one into a
// plan); a storage adapter evaluates that query against the graph with the
// pending change folded in (its `bindings` method, over an overlay of the
// change); and this file is the other half — what a matched row writes, and
// how the whole set of rules reaches a fixpoint.
//
// What a rule emits is deliberately small. Each of its patterns writes exactly
// what its `+` and `*` clauses declared: a `+comp` or `+!comp` component
// arrives as an empty component, and `+result.call=$call` fills a column with
// whatever the variable was bound to. A pattern that only writes creates its
// entity, and that entity's id is derived from the rule's name and the
// entities it matched (./identity.ts `derivedEid`) — so the same rule on the
// same match always produces the same entity, in this change or a later one,
// and a rule cannot create a second copy of what it already created.
//
// The fixpoint, and why it terminates quickly. What a rule produces joins the
// change, the overlay is rebuilt, and every rule is evaluated again — so a rule
// can fire on what another rule just wrote. It terminates because a rule fires
// at most once per `(rule name, the entities it matched)`: a second firing with
// the same key is not slow convergence, it is a rule that failed to exclude
// what it had already written, and it throws, naming the rule and the match,
// rather than being looped over. That refusal is the whole termination
// argument; there is no iteration limit doing the real work.
//
// Nothing here writes rows. The patches join the change and `mutate` writes
// them, so a rule's output is admitted, stamped, journaled, cascaded and
// returned exactly like anything a client sent.

import type { Bundle, Comp, Eid } from './bundle.ts'
import { derivedEid } from './identity.ts'
import { type Binding, filled, type Match, match, reads } from './join.ts'
import type { Tx } from './storage.ts'
import { then } from './pipe.ts'
import type { Value } from '@yaks/query'
import type { Prop, Vocab } from '@yaks/vocab'

/**
 * A rule as declared: a name, the query it matches, and the rules it runs
 * before. The name is not decoration — it is half of the key a rule may fire
 * only once per, and what a refusal names.
 */
export type Declared = {
  name: string
  /** the query, as text: `$call .call, results=; +result.call=$call` */
  match: string
  /** rules this one runs before (their names) */
  before?: string[]
}

/** A declared rule with its match already parsed. */
export type Ready = { rule: Declared; plan: Match }

/** Parse a set of declarations, in the order they should run. */
export let ready = (rules: Declared[]): Ready[] =>
  ordered(rules).map((rule) => ({ rule, plan: match(rule.match) }))

// The order rules run in: alphabetical by name, then adjusted by `before` —
// the same ordering a vocabulary uses for its kinds, so nothing depends on
// which plugin was registered first. `before` names the rules that come after
// this one, so it is read as those rules depending on this one, and each rule
// is emitted once every rule it depends on has been.
let ordered = (rules: Declared[]): Declared[] => {
  let by = new Map(rules.map((r) => [r.name, r]))
  let first = new Map<string, string[]>()
  for (let r of rules) {
    for (let name of r.before ?? []) {
      first.set(name, [...(first.get(name) ?? []), r.name])
    }
  }
  let out: Declared[] = []
  let done = new Set<string>()
  let open = new Set<string>()
  let visit = (r: Declared) => {
    if (done.has(r.name)) return
    if (open.has(r.name)) {
      throw new Error(`rules run before each other in a circle: ${r.name}`)
    }
    open.add(r.name)
    for (let name of [...(first.get(r.name) ?? [])].sort()) {
      let next = by.get(name)
      if (next) visit(next)
    }
    open.delete(r.name)
    done.add(r.name)
    out.push(r)
  }
  for (let r of [...rules].sort((a, b) => a.name < b.name ? -1 : 1)) visit(r)
  return out
}

// What a written value resolves to: a `$name` is whatever the match bound, a
// `#Name` is the value that resource converts to, and a literal is the raw
// token the grammar kept — parsed as the column's own type, because a query's
// values are text and a column's are not.
let worth = (
  value: Value,
  col: Prop | undefined,
  row: Binding,
  made: Record<string, Eid>,
  resource: (name: string) => unknown,
): unknown => {
  if (value.kind != 'scalar') return value.kind == 'time' ? value.raw : null
  let raw = value.raw
  if (raw.startsWith('$')) {
    let name = raw.slice(1)
    return name in made ? made[name] : row.vars[name]
  }
  if (raw.startsWith('#')) {
    let held = resource(raw.slice(1))
    return held && typeof held == 'object' && Symbol.toPrimitive in held
      ? (held as { [Symbol.toPrimitive]: () => unknown })[Symbol.toPrimitive]()
      : held
  }
  if (col?.scalar == 'number' || col?.scalar == 'priority') return Number(raw)
  if (col?.scalar == 'bool') return raw == 'true' || raw == '1'
  return raw
}

/** The key a rule may fire at most once per: its name, and the entities it
 * matched. */
export let firing = (rule: Declared, row: Binding): string =>
  `${rule.name}(${row.entities.map((e) => e ?? '·').join(', ')})`

/**
 * One matched row, as bundles. Every pattern writes what its own clauses
 * declared; a pattern that creates its entity derives that entity's id from
 * this key, so the same match always produces the same entity.
 */
export let emitted = (
  { rule, plan }: Ready,
  row: Binding,
  vocab: Vocab,
  resource: (name: string) => unknown = () => undefined,
): Bundle[] => {
  let key = firing(rule, row)
  // The entity each pattern is about. The ids of created entities are derived
  // first, so a `$name` written into a column can reference one.
  let at: Eid[] = plan.patterns.map((p, i) =>
    p.makes ? derivedEid(`${key}#${i}`) : row.entities[i]!
  )
  let made: Record<string, Eid> = {}
  plan.patterns.forEach((p, i) => {
    if (p.makes && p.entity) made[p.entity] = at[i]
  })
  let out: Bundle[] = []
  plan.patterns.forEach((p, i) => {
    let patch: Record<string, Comp> = {}
    for (let comp of [...p.gates, ...p.ensures]) patch[comp] ??= {}
    for (let s of p.sets) {
      patch[s.comp] ??= {}
      let v = worth(
        s.value,
        vocab.prop(s.comp, s.prop),
        row,
        made,
        resource,
      )
      // A resource that converts to nothing writes nothing —
      // `+created.by=#Actor` on a change nobody signed leaves the column alone
      // rather than clearing it, so a rule needs no conditional around the
      // column it wanted to write.
      if (v !== undefined) patch[s.comp][s.prop] = v
    }
    if (Object.keys(patch).length) {
      out.push({ entity: { eid: at[i] }, ...patch })
    }
  })
  return out
}

/**
 * Run a set of declared rules over a change until nothing new fires.
 *
 * `tx.bindings` is the storage adapter's method: it evaluates each match
 * against the graph with the pending change folded in. A storage adapter
 * without it runs no declared rules — a rule is a query, and a store that
 * cannot evaluate one can say nothing about it.
 *
 * `admit` is the graph's own admission function, passed in so this file need
 * not know what a column is: whatever a rule wrote goes through it before it
 * joins the change.
 */
export let settle = (
  rules: Ready[],
  bundles: Bundle[],
  tx: Tx,
  vocab: Vocab,
  resource: (name: string) => unknown = () => undefined,
  admit: (made: Bundle[]) => Bundle[] = (made) => made,
): Bundle[] | Promise<Bundle[]> => {
  if (!rules.length || !tx.bindings) return bundles
  let ask = tx.bindings
  let fired = new Set<string>()
  let round = (batch: Bundle[]): Bundle[] | Promise<Bundle[]> =>
    then(
      ask(rules.map((r) => r.plan), batch, cover(rules, vocab)),
      (found) => {
        let made: Bundle[] = []
        rules.forEach((r, i) => {
          for (let row of found[i] ?? []) {
            let key = firing(r.rule, row)
            if (fired.has(key)) {
              throw new Error(
                `rule ${r.rule.name} fired twice on the same binding: ` +
                  `${key} — a rule that matches again after it has written ` +
                  `is a rule whose match does not exclude its own output`,
              )
            }
            fired.add(key)
            made.push(...emitted(r, row, vocab, resource))
          }
        })
        if (!made.length) return batch
        // Admitted like anything else that reaches the graph: a column this
        // vocabulary does not declare is dropped, and a value it rejects
        // refuses the whole change. A rule is server code, so it is allowed to
        // write server-owned columns.
        return round([...batch, ...admit(made)])
      },
    )
  return round(bundles)
}

/**
 * A template, invoked: the template's query merged with its arguments as a
 * bindings query (./join.ts `filled`), matched against the graph once, and the
 * bundles it emits — for the caller to apply as an ordinary change.
 *
 * It is the same engine the `rules` phase runs, called directly instead of
 * being asked about a pending change. That is all a template is: a rule with
 * its variables filled in.
 */
export let invoked = (
  tx: Tx,
  vocab: Vocab,
  template: string | Match,
  args: Record<string, unknown> | string,
  name = 'template',
  resource: (name: string) => unknown = () => undefined,
): Bundle[] | Promise<Bundle[]> => {
  if (!tx.bindings) return []
  let plan = filled(template, args)
  let rule: Ready = { rule: { name, match: '' }, plan }
  return then(
    tx.bindings([plan], [], reads(plan, vocab)),
    ([rows]) =>
      (rows ?? []).flatMap((row) => emitted(rule, row, vocab, resource)),
  )
}

/** The components a set of rules reads — what storage's overlay of the pending
 * change has to cover. */
export let cover = (rules: Ready[], vocab: Vocab): string[] => [
  ...new Set(rules.flatMap((r) => reads(r.plan, vocab))),
]
