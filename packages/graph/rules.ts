// The declarative way to extend a phase. A {@link Hook} is code that takes the
// bundles; a RULE is a query over one bundle in the change plus what the rule
// produces — and the query expresses both at once. `.entity, +!created` states
// what the rule needs (an entity the graph holds no `created` for) and what it
// does about it (add `created`, which is also what makes the rule fire exactly
// once, ever). A plugin declares rules beside its hooks, and the phase runs
// them.
//
// ALL RULES IN A PHASE SEE THE SAME STATE. The bundles a phase's rules are
// evaluated against are composed once — what the graph holds for each entity,
// with this change's patch folded in — before any rule fires. Two rules in one
// phase therefore see the same state and cannot react to each other's writes,
// which is exactly what the `created`/`updated` pair needs: creating an entity
// must not also count as updating it.
//
// The `*comp` write set is a rule's declaration of what it writes. The current
// version records it and refuses a `produce` or a `run` that writes outside
// it. In the effect phase it also names the writes that trigger the rule: at
// least one of them must appear in this change, so the mere presence of a
// stored component cannot re-run an effect on an unrelated edit. A rule that
// declares no write set is unchecked — declaring one is opting in.
//
// RESOURCES are the other half of a rule's match. `#Now` binds a singleton the
// phase provides — the change's timestamp, its actor, the vocabulary, the
// calling program's environment — into the bundle under its own name, so `run`
// takes the bound bundle and nothing else: everything a rule reads, it named.
// Resources are built at most once per phase and are read-only; writing one is
// refused the same way a write outside the write set is. A resource is not part
// of the vocabulary, so a rule naming a resource nobody provides is an error,
// while a rule naming an undeclared COMPONENT simply never matches.
//
// A resource name is CAPITALIZED — `#Actor`, `#Now` — because it is bound into
// the same bundle as the components, and a component name is lowercase. So
// `({ trashed, Actor, Now })` shows which is which, and a collision between
// the two is impossible rather than something to check for. A resource
// registered under a lowercase name is refused when the registry is built.
//
// A resource has the same shape as a component: an object of columns
// (`Now.at`, `Actor.by`) rather than a bare value. And like an entity written
// into a reference column, it CONVERTS TO one value when a rule writes it into
// a column: `{ at: Now, by: Actor }` writes the timestamp and the actor's eid.
// That is not special-cased per resource — each resource declares what it
// converts to (see {@link stands}), a rule's patch resolves what it wrote, and
// a resource that converts to nothing writes nothing at all.
//
// What a resource is NOT is a value the MATCH side can read:
// `expires.at<Now.at` would need a reference on the value side of a
// comparison, which the query grammar's values do not have (that is
// @yaks/logic's unification, planned). A rule that tries it is refused rather
// than silently compared against the literal text `Now.at`.

import { matcher, type Select } from '@yaks/match'
import {
  type And,
  declared,
  parse,
  type Query as Ast,
  type Value,
} from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Actor, Bundle, Comp, Eid } from './bundle.ts'
import { RESERVED } from './bundle.ts'
import { merged } from './gather.ts'
import { type Phase, PHASES } from './plugin.ts'
import type { Query, Tx } from './storage.ts'
import { each, then } from './pipe.ts'

/**
 * The context one phase's rules run in: the frozen state they are evaluated
 * against, and what they are built from. `bundles` is that state; the rest is
 * what the graph knows about the run.
 */
export type Tick = {
  /** the component vocabulary this graph uses */
  vocab: Vocab
  /** the phase's transaction (a detached one outside the change's own) */
  tx: Tx
  /** the phase running: what distinguishes a rule whose output still has to be
   * written from one whose output the `mutate` phase will write for it */
  phase: Phase
  /** the change as this phase found it — what the rules are evaluated against.
   * An effect rule with a `*write` set requires one of those components to
   * appear in this change for the matched entity, even when `of` supplies
   * more. */
  bundles: Bundle[]
  /** the singletons a rule may name with `#`, by name */
  resources: Record<string, Resource>
  /** the graph as this change found it, for the entities the change names. A
   * rule asks about a component the change does not carry — a condition on
   * `created`, say — through this; a phase with nothing gathered leaves it out,
   * and a rule then sees only the change itself. */
  of?: (eid: Eid) => Bundle | undefined
}

/**
 * A resource: a singleton built from the phase context and bound into a rule's
 * bundle by `#Name`. It is built at most once per phase and only if a rule
 * asked for it, so an expensive one costs nothing until something names it.
 */
export type Resource = (tick: Tick) => unknown

/**
 * A resource's value: its columns, plus the one value it CONVERTS TO when a
 * rule writes it into a column — the timestamp for `#Now`, the eid for
 * `#Actor`. It declares that the way any JavaScript value declares its
 * primitive conversion, so `${Now}` and a written `at: Now` agree by
 * construction.
 *
 * ```ts
 * import { stands } from '@yaks/graph'
 *
 * let Now = stands({ at: '2026-09-07T00:00:00.000Z' })
 * Now.at // '2026-09-07T00:00:00.000Z'
 * `${Now}` // '2026-09-07T00:00:00.000Z'
 * ```
 *
 * The default is the component's FIRST column, which is what a one-column
 * resource means and what both `{at}` and `{by, via}` want; a resource whose
 * first column is not the value it converts to passes that value explicitly.
 */
export let stands = <T extends Comp>(comp: T, value?: unknown): T =>
  Object.assign(comp, {
    [Symbol.toPrimitive]: () =>
      value === undefined ? Object.values(comp)[0] : value,
  })

// What a resource written into a column converts to. Anything else is itself.
let worth = (v: unknown): unknown =>
  v && typeof v == 'object' && Symbol.toPrimitive in v
    ? (v as { [Symbol.toPrimitive]: () => unknown })[Symbol.toPrimitive]()
    : v

/**
 * The resources available to a phase, merged from what each provider offers —
 * the plugins first, then the graph's own, which take precedence. A name that
 * is not capitalized is refused here: the capital letter is the whole reason a
 * resource and a component can share one bundle without colliding.
 */
export let registry = (
  sets: (Record<string, Resource> | undefined)[],
): Record<string, Resource> => {
  let out: Record<string, Resource> = {}
  for (let set of sets) {
    for (let [name, make] of Object.entries(set ?? {})) {
      if (!/^[A-Z]/.test(name)) {
        throw new Error(
          `resource ${name} must be capitalized (#${
            name.slice(0, 1).toUpperCase() + name.slice(1)
          }): a lowercase name is a component`,
        )
      }
      out[name] = make
    }
  }
  return out
}

/**
 * What a rule's `run` is handed: the bundle it matched — the entity's
 * components, with the match's `+` components and its condition already
 * applied — plus the resources its `#names` referred to, under those names.
 * There is nothing else; a rule reads only what it declared.
 *
 * The three resources @yaks/graph provides itself are typed here because the
 * core's own rules read them; a resource the calling program adds is reached by
 * name, like a component. The capital letter is what tells the two apart:
 * `({ trashed, Actor, Now })`.
 */
export type Bound = Bundle & {
  /** `#Vocab` — the component vocabulary this graph uses */
  Vocab: Vocab
  /** `#Now` — the timestamp this transaction stamps with; `Now.at` reads it,
   * and a column written `at: Now` is given it */
  Now: { at: string }
  /** `#Actor` — who is writing this change; a column written `by: Actor` is
   * given the eid, and nothing at all when no actor is named */
  Actor: Actor
}

/**
 * What a rule writes: components by name (or `null` to remove one), with no
 * identity of its own — the bundle it matched determines which entity it is
 * about. A rule writes to the entity it matched and nowhere else; creating
 * OTHER entities is still a hook's job.
 */
export type Patch = Record<string, Comp | null>

/**
 * A rule: a query over one bundle in the change, plus what it produces.
 *
 * `produce` is the no-code case — a bundle template merged into the matched
 * bundle — and `run` covers everything else, as a function of the bound
 * bundle. The match's `+` components and its `!` condition are applied BEFORE
 * either, so the `run` of a rule that fires once already sees the component
 * that will stop it firing again.
 *
 * ```ts
 * import type { Rule } from '@yaks/graph'
 *
 * let dated: Rule = {
 *   name: 'trashed',
 *   phase: 'stamp',
 *   match: '*trashed, trashed.at=, #Now',
 *   run: ({ Now }) => ({ trashed: { at: Now } }),
 * }
 * ```
 */
export type Rule = {
  /** the phase it runs in */
  phase: Phase
  /** the query it matches, as text (parsed with bare-word text terms
   * disabled) or an already-parsed AST. `+comp` ensures the component exists,
   * `+!comp` also requires it did not already, so the rule fires once; `*comp`
   * declares the write set (and requires the component to be present);
   * `#Name` binds a resource; the rest filters. An effect rule with a write
   * set only runs when this change writes one of those components on the
   * matched entity. */
  match: Query
  /** components to merge into the matched bundle, verbatim */
  produce?: Patch
  /** anything else: the bound bundle in, the patch to write out (or nothing) */
  run?: (bound: Bound) => Patch | undefined | Promise<Patch | undefined>
  /** a name, used by the refusal that reports which rule wrote outside its
   * write set */
  name?: string
}

// A rule's match, compiled: the test, plus the names its sigils referred to. A
// `test` of null means this graph's vocabulary declares none of the components
// the rule is about — the rule never fires, which is not an error.
type Ready = {
  test: Select | null
  ensures: string[]
  gates: string[]
  resources: string[]
  writes: string[]
  cites: string[]
  allowed: Set<string>
  checked: boolean
}

// The capitalized names a match COMPARES against: `expires.at<Now.at` parses
// as a comparison with the literal text `Now.at`, because a value in this
// grammar is always a literal. Only the running phase knows which of these
// names is a resource, so the names are carried along and `fire` refuses the
// ones the phase provides rather than comparing against their text.
let cited = (f: And): string[] =>
  f.clauses.flatMap((c) => c.kind == 'pred' ? raws(c.value) : [])
    .filter((raw) => /^[A-Z][A-Za-z_]*(\.|$)/.test(raw))
    .map((raw) => raw.split('.')[0])

// Every literal inside a value, in any of its forms — a single value, a list
// of them, or the two ends of a range.
let raws = (v: Value | null): string[] =>
  !v
    ? []
    : v.kind == 'scalar' || v.kind == 'time'
    ? [v.raw]
    : v.kind == 'list'
    ? v.items.flatMap(raws)
    : [...raws(v.lo), ...raws(v.hi)]

// Every component a match NAMES, wherever it names it: the filter reads them,
// and the `+`/`!` parts write and test them. Which components a rule is about
// decides whether it can ever fire in a given graph — a store whose vocabulary
// has no `sweep` component cannot have a rule about one, and asking for it
// there is not an error.
let words = (f: And): string[] =>
  f.clauses.flatMap((c) => c.kind == 'pred' && c.path.length ? [c.path[0]] : [])

// Compiled once per rule, per vocabulary. Keyed by the rule OBJECT, so this is
// a memo rather than a registry — two graphs sharing a plugin share the
// compilation only while they use the same vocabulary.
let cache = new WeakMap<Rule, { v: Vocab; ready: Ready }>()

let compile = (r: Rule, v: Vocab): Ready => {
  let hit = cache.get(r)
  if (hit && hit.v == v) return hit.ready
  let ast: Ast = typeof r.match == 'string'
    ? parse(r.match, { text: false })
    : r.match
  let d = declared(ast)
  let named = [...d.gates, ...d.ensures, ...d.writes]
  let ready: Ready = {
    test: null,
    ensures: d.ensures,
    gates: d.gates,
    resources: d.resources,
    writes: d.writes,
    cites: cited(d.filter),
    allowed: new Set(named),
    checked: d.writes.length > 0,
  }
  try {
    // A phase selects from one frozen set of bundles. Building the reference
    // index once per rule, rather than once per entity, keeps the cost linear
    // in the size of the change. Rules are predicates: ordering and windowing
    // do not decide which entities fire, so those clauses are dropped.
    ready.test = matcher({
      ...d.filter,
      clauses: d.filter.clauses.filter((c) =>
        !['order', 'limit', 'after'].includes(c.kind)
      ),
    }, v)
  } catch (e) {
    // A rule about a component this graph does not declare never fires, and
    // that is not an error: the stamp rules ship with the core, and a
    // vocabulary need not declare `created` at all. Every component the rule
    // names counts, including the ones it only READS — one store's `schedule`
    // is a component another store has never heard of, and both hold the same
    // rule list. A rule whose components all exist and still will not compile
    // is a mistake, and throws.
    if ([...named, ...words(d.filter)].every((c) => !!v.comp(c))) throw e
  }
  cache.set(r, { v, ready })
  return ready
}

// How a refusal identifies a rule: its name, or its query, which identifies it
// well enough.
let named = (r: Rule): string => r.name ?? String(r.match)

// A resource written into a column becomes the value it converts to — `at:
// Now` the timestamp, `by: Actor` the eid — and a resource that converts to
// nothing writes nothing, so a rule needs no `actor.by ? … : {}` around the
// column it wanted to write. A component containing one is rebuilt rather than
// edited in place, because a `produce` template is the rule's own object and a
// rule fires more than once.
let resolved = (p: Patch): Patch => {
  let out: Patch = {}
  for (let [name, comp] of Object.entries(p)) {
    if (!comp) {
      out[name] = comp
      continue
    }
    let made: Comp = {}
    let moved = false
    for (let [col, v] of Object.entries(comp)) {
      let stood = worth(v)
      if (stood !== v) moved = true
      if (stood !== undefined) made[col] = stood
    }
    out[name] = moved ? made : comp
  }
  return out
}

// The components a rule's patch writes, ignoring the identity and the `$`
// keys.
let wrote = (p: Patch): string[] =>
  Object.keys(p).filter((k) => !RESERVED.includes(k) && !k.startsWith('$'))

/**
 * Run the rules of one phase over a change: the bundles in, the bundles plus
 * what the rules produced out.
 *
 * Every rule is matched against the same frozen state before any of them
 * writes. A phase that runs after `mutate` writes what its rules produced
 * through the transaction; before `mutate`, the patches simply join the change
 * and `mutate` writes them like any other.
 */
export let fire = (
  rules: Rule[],
  tick: Tick,
): Bundle[] | Promise<Bundle[]> => {
  let { bundles } = tick
  if (!rules.length) return bundles
  // One view per ENTITY, not per patch: the phases add bundles to the change
  // as they go, and a rule is about the entity, so it must not fire once per
  // patch that mentions that entity.
  let seen = new Map<Eid, Bundle>()
  let written = new Map<Eid, Set<string>>()
  for (let b of bundles) {
    let eid = b.entity.eid
    seen.set(eid, merged(seen.get(eid) ?? tick.of?.(eid) ?? null, b))
    let names = written.get(eid) ?? new Set<string>()
    for (let name of Object.keys(b)) names.add(name)
    written.set(eid, names)
  }
  let views = [...seen.values()]
  let positions = new Map(views.map((v, i) => [v.entity.eid, i]))
  // Built once, however many rules name it: `#Now` is a single timestamp for
  // the whole phase because the resource is called once for the whole phase.
  let held = new Map<string, unknown>()
  let hold = (name: string): unknown => {
    if (!held.has(name)) held.set(name, tick.resources[name](tick))
    return held.get(name)
  }
  // Every match is evaluated before any rule acts.
  let hits: [Rule, Ready, number][] = []
  for (let r of rules) {
    let ready = compile(r, tick.vocab)
    // Checked before the match, and whether or not this rule could ever fire
    // here: a resource nobody provides means the rule asks for something that
    // does not exist, which should throw rather than silently do nothing.
    for (let name of ready.resources) {
      if (!(name in tick.resources)) {
        throw new Error(
          `rule ${named(r)} names #${name}, which nothing provides`,
        )
      }
    }
    for (let name of ready.cites) {
      if (name in tick.resources) {
        throw new Error(
          `rule ${
            named(r)
          } compares against #${name}, which the match cannot ` +
            `see: read it in run()`,
        )
      }
    }
    let test = ready.test
    if (!test) continue
    test(views).forEach((v) => {
      if (
        tick.phase == 'effect' && ready.checked &&
        !ready.writes.some((name) => written.get(v.entity.eid)?.has(name))
      ) return
      hits.push([r, ready, positions.get(v.entity.eid)!])
    })
  }
  if (!hits.length) return bundles
  return then(
    each(hits, [] as Bundle[], (out, [r, ready, i]) => {
      let patch: Patch = {}
      // The match guarantees a `+!` component is absent; a `+` component may
      // already be present.
      for (let c of ready.gates) patch[c] = {}
      for (let c of ready.ensures) if (!views[i][c]) patch[c] = {}
      Object.assign(patch, r.produce)
      // What the rule sees: the entity's view, the components the `+` and `+!`
      // clauses just added, and the resources it named. The cast is
      // unavoidable — which resources are present depends on the rule's own
      // match, which no static type can express.
      let got: Record<string, unknown> = {}
      for (let name of ready.resources) got[name] = hold(name)
      let bound = { ...views[i], ...patch, ...got } as Bound
      return then(r.run?.(bound), (made) => {
        Object.assign(patch, made)
        patch = resolved(patch)
        let names = wrote(patch)
        let read = names.filter((c) => c in tick.resources)
        if (read.length) {
          throw new Error(
            `rule ${named(r)} wrote the resource ${
              read.map((c) => `#${c}`).join(', ')
            }: resources are read-only`,
          )
        }
        if (ready.checked) {
          let stray = names.filter((c) => !ready.allowed.has(c))
          if (stray.length) {
            throw new Error(
              `rule ${named(r)} wrote outside its *write set: ` +
                stray.join(', '),
            )
          }
        }
        if (!names.length) return out
        return [...out, { entity: { eid: views[i].entity.eid }, ...patch }]
      })
    }),
    (made) => {
      if (!made.length) return bundles
      // A phase's rules run AFTER its core work, so from `mutate` onwards the
      // change has already been written and whatever a rule produced has to be
      // written here. Before `mutate`, it is still to come and will write it.
      let late = PHASES.indexOf(tick.phase) >= PHASES.indexOf('mutate')
      return late
        ? then(tick.tx.patch(made), () => [...bundles, ...made])
        : [...bundles, ...made]
    },
  )
}
