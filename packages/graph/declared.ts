// The DECLARED rules, run. A rule is a query (./join.ts reads one into a
// plan); a storage answers the query against the batch as though it had landed
// (its `bindings` door, over a batch overlay); and this file is the other
// half — what a bound row WRITES, and how a batch settles.
//
// The emit is small on purpose. Each pattern of a rule writes what its `+`
// and `*` words said: a gated or ensured component arrives as a bare row, and
// `+result.call=$call` fills a column with what the variable took. A pattern
// that only writes MAKES its entity, and the id is DERIVED from the rule's
// name and the entities it bound (./identity.ts `derivedEid`) — so the same
// rule on the same binding names the same entity, in this batch or a later
// one, and a rule cannot make a second copy of what it already made.
//
// THE FIXPOINT, and why it is short. What a rule produces joins the batch, the
// overlay is raised again, and every rule is asked again — so a rule may fire
// on what another rule just wrote. It settles because a rule fires AT MOST
// ONCE per `(rule name, the entities it bound)`: a firing that repeats a key
// is not a slow fixpoint, it is a rule that failed to gate itself, and it is
// refused by name and by binding rather than looped over. That refusal is the
// whole termination argument; there is no round budget doing the real work.
//
// Nothing here writes rows. The patches join the batch and `mutate` writes
// them, so a rule's output is admitted, stamped, journaled, cascaded and
// answered like anything a client sent.

import type { Bundle, Comp, Eid } from './bundle.ts'
import { derivedEid } from './identity.ts'
import { type Binding, filled, type Match, match, reads } from './join.ts'
import type { Tx } from './storage.ts'
import { then } from './pipe.ts'
import type { Value } from '@yaks/query'
import type { Column, Vocab } from '@yaks/vocab'

/**
 * A rule as DECLARED: a name, the query it matches, and the rules it runs
 * before. The name is not decoration — it is half the key a rule fires once
 * per, and the word a refusal says.
 */
export type Declared = {
  name: string
  /** the query, as text: `$call .call, results=; +result.call=$call` */
  match: string
  /** rules this one runs before (their names) */
  before?: string[]
}

/** A declared rule with its match read. */
export type Ready = { rule: Declared; plan: Match }

/** Read a set of declarations, in the order they should run. */
export let ready = (rules: Declared[]): Ready[] =>
  ordered(rules).map((rule) => ({ rule, plan: match(rule.match) }))

// The declared order: alphabetical by name, refined by `before` — the same
// shape a vocabulary orders its kinds by, so nothing depends on which plugin
// was registered first. `before` names what comes AFTER, so it is read as the
// other rule's dependency and every rule is emitted once its own are out.
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

// What a written value comes to: a `$name` is what the binding bound, a
// `#Name` is the resource it stands for, and a literal is the raw token the
// grammar kept — read as the column's own type, because a query's values are
// text and a column's are not.
let worth = (
  value: Value,
  col: Column | undefined,
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

/** The key a rule fires at most once per: its name, and what it bound. */
export let firing = (rule: Declared, row: Binding): string =>
  `${rule.name}(${row.entities.map((e) => e ?? '·').join(', ')})`

/**
 * One bound row, as bundles. Every pattern writes what its own words said; a
 * pattern that makes its entity is named from the firing, so the same binding
 * always names the same entity.
 */
export let emitted = (
  { rule, plan }: Ready,
  row: Binding,
  vocab: Vocab,
  resource: (name: string) => unknown = () => undefined,
): Bundle[] => {
  let key = firing(rule, row)
  // The entities each pattern is about, the made ones named first so a `$name`
  // written into a column can point at one.
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
        vocab.column(s.comp, s.prop),
        row,
        made,
        resource,
      )
      // A resource standing for NOTHING writes nothing — `+created.by=#Actor`
      // on a batch nobody signed leaves the column alone rather than clearing
      // it, so a rule needs no conditional around the column it wanted.
      if (v !== undefined) patch[s.comp][s.prop] = v
    }
    if (Object.keys(patch).length) {
      out.push({ entity: { eid: at[i] }, ...patch })
    }
  })
  return out
}

/**
 * Run a set of declared rules over a batch until nothing new fires.
 *
 * `tx.bindings` is the storage's door: it answers each match against the graph
 * with the batch folded in. A storage that has none runs no declared rules —
 * they are a query, and a store that cannot answer one has nothing to say.
 *
 * `admit` is the graph's own admission, handed in so this file need not know
 * what a column is: what a rule wrote goes through it before it joins the
 * batch.
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
                  `${key} — a rule that has to look again is a rule that did ` +
                  `not gate itself`,
              )
            }
            fired.add(key)
            made.push(...emitted(r, row, vocab, resource))
          }
        })
        if (!made.length) return batch
        // Admitted like anything else that reaches the graph: a column this
        // vocabulary does not declare is dropped, a value it refuses refuses
        // the batch. A rule is server code, so its server-owned columns are
        // its to write.
        return round([...batch, ...admit(made)])
      },
    )
  return round(bundles)
}

/**
 * A TEMPLATE, invoked: the template's query merged with its arguments as a
 * bindings query (./join.ts `filled`), matched against the graph once, and the
 * bundles it emits — for a host to land as an ordinary batch.
 *
 * It is the same engine the rules phase runs, asked outright instead of about
 * a batch. That is the whole of what a template is: a rule with its variables
 * filled in.
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

/** The components a rule set reads — what a batch overlay has to cover. */
export let cover = (rules: Ready[], vocab: Vocab): string[] => [
  ...new Set(rules.flatMap((r) => reads(r.plan, vocab))),
]
