// The declarative half of the phase seam. A {@link Hook} is code that takes the
// batch; a RULE is a query over one bundle in it plus what comes out — and the
// query says both things at once. `.entity, +!created` is what the rule needs
// (an entity the graph holds no `created` for) and what it does about it (add
// `created`, which is what makes the rule fire once, ever). A plugin declares
// rules beside its hooks, and the phase runs them.
//
// ONE TICK, ONE VIEW. The bundles a phase's rules are judged against are
// composed once — what the graph holds for each entity, with the batch's patch
// folded in — before any rule fires. Two rules in a phase therefore see the
// same world and cannot chase each other's writes, which is exactly what the
// `created`/`updated` pair needs: a birth is not also a touch.
//
// The `*comp` write set is a rule's declaration of what it writes. v1 records it
// and refuses a produce or a run that writes outside it; nothing schedules on it
// yet. A rule that declares none is unchecked — declaring is opting in.
//
// RESOURCES are the other half of a rule's match. `#Now` binds a singleton the
// tick provides — the batch's instant, its actor, the vocabulary, a host's
// environment — into the bundle under its own name, so `run` takes the bound
// bundle and nothing else: everything a rule reads, it named. They are made at
// most once per tick and read-only; writing one is refused like a write outside
// the write set. A resource is not vocabulary, so a rule naming one nobody
// provides is an error where a rule naming an unknown COMPONENT is inert.
//
// A resource is CAPITALIZED — `#Actor`, `#Now` — because it is bound into the
// same bundle as the components, and a component is a lowercase word. So
// `({ trashed, Actor, Now })` reads which is which, and a collision between the
// two is impossible rather than checked for. A resource registered under a
// lowercase name is refused where the registry is composed.
//
// A resource is COMPONENT-SHAPED, like everything else in a bundle: a bag of
// columns (`Now.at`, `Actor.by`) rather than a bare value. And like an entity
// written into a reference column, it STANDS FOR one value when a rule writes
// it as a column: `{ at: Now, by: Actor }` writes the instant and the actor's
// eid. That is not per-resource sugar — each resource says what it stands for
// (see {@link stands}), a rule's patch resolves what it wrote, and a resource
// standing for nothing writes nothing at all.
//
// What a resource is NOT is a value the MATCH can see: `expires.at<Now.at`
// would need a value-side reference, which the grammar's values do not have
// (that is @yaks/logic's unification, v2). A rule that writes one is refused
// where it would otherwise have compared against the literal text.

import { type Filter, filter } from '@yaks/match'
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
 * One phase's TICK: the frozen world its rules are judged against, and what
 * they are made of. The batch is the world's contents; the rest is what the
 * host knows about the run.
 */
export type Tick = {
  /** the component vocabulary this graph speaks */
  vocab: Vocab
  /** the transaction of the phase (detached outside the batch's own) */
  tx: Tx
  /** the phase running: what tells a rule whose output still has to be written
   * from one whose output the `mutate` phase will write for it */
  phase: Phase
  /** the batch as this phase found it — what the rules are judged against */
  bundles: Bundle[]
  /** the singletons a rule may name with `#`, by name */
  resources: Record<string, Resource>
  /** the graph as this batch found it, for the entities it names. A rule asks
   * about a component the batch does not carry — a gate on `created` — through
   * this; a phase with nothing to offer leaves it out, and a rule then sees the
   * batch alone. */
  of?: (eid: Eid) => Bundle | undefined
}

/**
 * A resource: a singleton made from the tick, bound into a rule's bundle by
 * `#Name`. It is made at most once per tick and only if a rule asked, so an
 * expensive one costs nothing until something names it.
 */
export type Resource = (tick: Tick) => unknown

/**
 * A resource's value: its columns, and the one value it STANDS FOR when a rule
 * writes it into a column — the instant for `#Now`, the eid for `#Actor`. It
 * says so the way any JavaScript value says what it is worth as a primitive,
 * so `${Now}` and a written `at: Now` agree by construction.
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
 * resource means and what `{at}` and `{by, via}` both want; a resource whose
 * columns do not lead with the value it stands for names it outright.
 */
export let stands = <T extends Comp>(comp: T, value?: unknown): T =>
  Object.assign(comp, {
    [Symbol.toPrimitive]: () =>
      value === undefined ? Object.values(comp)[0] : value,
  })

// What a resource written into a column comes to. Anything else is itself.
let worth = (v: unknown): unknown =>
  v && typeof v == 'object' && Symbol.toPrimitive in v
    ? (v as { [Symbol.toPrimitive]: () => unknown })[Symbol.toPrimitive]()
    : v

/**
 * The resources of a tick, composed from what each provider offers — the
 * plugins, then the graph's own, which have the last word. A name that is not
 * capitalized is refused here: the capital is the whole reason a resource and
 * a component can share one bundle without colliding.
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
          }): a lowercase word is a component`,
        )
      }
      out[name] = make
    }
  }
  return out
}

/**
 * What a rule's `run` is handed: the bundle it matched — the entity's
 * components, with the match's ensures and gate already on — plus the resources
 * its `#names` named, under those names. There is nothing else; a rule reads
 * what it declared.
 *
 * The three @yaks/graph provides itself are typed here because the core's own
 * rules read them; a host's own resource is reached by name, like a component.
 * The capital is what tells them apart: `({ trashed, Actor, Now })`.
 */
export type Bound = Bundle & {
  /** `#Vocab` — the component vocabulary this graph speaks */
  Vocab: Vocab
  /** `#Now` — the instant this batch stamps with; `Now.at` reads it, and a
   * column written `at: Now` gets it */
  Now: { at: string }
  /** `#Actor` — who is writing the batch; a column written `by: Actor` gets
   * the eid, and nothing at all when nobody is named */
  Actor: Actor
}

/**
 * What a rule writes: components by name (or `null` to drop one), with no
 * identity of its own — the bundle it matched says who it is about. A rule
 * writes to the entity it matched and nowhere else; making OTHER entities is
 * what a hook is still for.
 */
export type Patch = Record<string, Comp | null>

/**
 * A rule: a query over one bundle in the batch, and what comes out of it.
 *
 * `produce` is the no-code case — a bundle template merged into the matched
 * bundle — and `run` is the rest, a function of the bound bundle. The ensures
 * and the gate of the match are applied BEFORE either, so a gated rule's `run`
 * already sees the component that will stop it firing again.
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
  /** the query it matches, as text (parsed with no bare-word text terms) or an
   * already-built AST. `+comp` ensures, `+!comp` gates, `*comp` declares the
   * write set (and says the component is present), `#Name` binds a resource,
   * and the rest filters. */
  match: Query
  /** components to write into the matched bundle, verbatim */
  produce?: Patch
  /** anything else: the bound bundle in, the patch to write out (or nothing) */
  run?: (bound: Bound) => Patch | undefined | Promise<Patch | undefined>
  /** a name, for the refusal that says which rule wrote outside its write set */
  name?: string
}

// A rule's match, compiled: the test, and the names its sigils named. A `test`
// of null is a rule this graph has no vocabulary for — inert, not wrong.
type Ready = {
  test: Filter | null
  ensures: string[]
  gates: string[]
  resources: string[]
  cites: string[]
  allowed: Set<string>
  checked: boolean
}

// The capitalized words a match COMPARES against: `expires.at<Now.at` reads as
// the literal text `Now.at`, because a value in this grammar is a value. Which
// of them is a resource only the tick knows, so the names travel and `fire`
// refuses the ones it provides rather than comparing against their spelling.
let cited = (f: And): string[] =>
  f.clauses.flatMap((c) => c.kind == 'pred' ? raws(c.value) : [])
    .filter((raw) => /^[A-Z][A-Za-z_]*(\.|$)/.test(raw))
    .map((raw) => raw.split('.')[0])

// Every literal in a value, however it is spelled — one, a list of them, the
// ends of a range.
let raws = (v: Value | null): string[] =>
  !v
    ? []
    : v.kind == 'scalar' || v.kind == 'time'
    ? [v.raw]
    : v.kind == 'list'
    ? v.items.flatMap(raws)
    : [...raws(v.lo), ...raws(v.hi)]

// Compiled once per rule, per vocabulary. Keyed by the rule OBJECT, so this is
// a memo rather than a registry — two graphs sharing a plugin share the
// compilation only while they speak the same vocabulary.
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
    cites: cited(d.filter),
    allowed: new Set(named),
    checked: d.writes.length > 0,
  }
  try {
    ready.test = filter(d.filter, v)
  } catch (e) {
    // A rule about a component this graph does not have is INERT, not an
    // error: the stamp rules ship with the core, and a vocabulary need not
    // declare `created` at all. A rule whose components all exist and still
    // will not compile is a mistake, and says so.
    if (named.every((c) => !!v.comp(c))) throw e
  }
  cache.set(r, { v, ready })
  return ready
}

// What a refusal calls a rule: its name, or the query that is its name enough.
let named = (r: Rule): string => r.name ?? String(r.match)

// A written resource becomes the value it stands for — `at: Now` the instant,
// `by: Actor` the eid — and a resource standing for nothing writes nothing, so
// a rule needs no `actor.by ? … : {}` around the column it wanted to write. A
// component that wrote one is rebuilt rather than edited, because a `produce`
// template is the rule's own object and a rule fires more than once.
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

// The components a rule's patch writes, identity and `$` sugar aside.
let wrote = (p: Patch): string[] =>
  Object.keys(p).filter((k) => !RESERVED.includes(k) && !k.startsWith('$'))

/**
 * Run the rules of one phase over a batch: the bundles in, the batch plus what
 * the rules produced out.
 *
 * Every rule is matched against the same frozen view before any of them writes,
 * and a phase that runs after `mutate` writes what its rules produced through
 * the transaction — before it, the patches simply join the batch and `mutate`
 * writes them like any other.
 */
export let fire = (
  rules: Rule[],
  tick: Tick,
): Bundle[] | Promise<Bundle[]> => {
  let { bundles } = tick
  if (!rules.length) return bundles
  // One view per ENTITY, not per patch: the phases add their bundles to the
  // batch as they go, and a rule is about the entity, so it must not fire once
  // per patch that mentions it.
  let seen = new Map<Eid, Bundle>()
  for (let b of bundles) {
    let eid = b.entity.eid
    seen.set(eid, merged(seen.get(eid) ?? tick.of?.(eid) ?? null, b))
  }
  let views = [...seen.values()]
  // Made once, however many rules name it: `#Now` is one instant for the whole
  // tick because it is one call for the whole tick.
  let held = new Map<string, unknown>()
  let hold = (name: string): unknown => {
    if (!held.has(name)) held.set(name, tick.resources[name](tick))
    return held.get(name)
  }
  // The tick: every match is judged before any rule acts.
  let hits: [Rule, Ready, number][] = []
  for (let r of rules) {
    let ready = compile(r, tick.vocab)
    // Before the match, and whether or not this rule is inert here: a resource
    // nobody provides is a rule asking for something that does not exist,
    // which is a mistake to say out loud rather than one to run silently.
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
    views.forEach((v, i) => {
      if (test(v, views)) hits.push([r, ready, i])
    })
  }
  if (!hits.length) return bundles
  return then(
    each(hits, [] as Bundle[], (out, [r, ready, i]) => {
      let patch: Patch = {}
      // The gate is absent by the match; an ensure may already be there.
      for (let c of ready.gates) patch[c] = {}
      for (let c of ready.ensures) if (!views[i][c]) patch[c] = {}
      Object.assign(patch, r.produce)
      // What the rule sees: the view, what the gate and the ensures put on,
      // and the resources it named. The cast is the seam — which resources are
      // there is the rule's own match, not something a type can carry.
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
      // The rules of a phase run AFTER its core work, so from `mutate` on the
      // batch has already been written and what a rule made has to be written
      // itself. Before it, `mutate` is still to come and will write it.
      let late = PHASES.indexOf(tick.phase) >= PHASES.indexOf('mutate')
      return late
        ? then(tick.tx.patch(made), () => [...bundles, ...made])
        : [...bundles, ...made]
    },
  )
}
