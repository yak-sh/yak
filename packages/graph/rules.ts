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

import { type Filter, filter } from '@yaks/match'
import { declared, parse, type Query as Ast } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Actor, Bundle, Comp, Eid } from './bundle.ts'
import { RESERVED } from './bundle.ts'
import { merged } from './gather.ts'
import { type Phase, PHASES } from './plugin.ts'
import type { Query, Tx } from './storage.ts'
import { each, then } from './pipe.ts'

/**
 * What a rule is handed when it fires: the graph's vocabulary, the transaction
 * of the phase it is in, and the batch's own words — when it is running, and
 * who is writing.
 */
export type RuleCtx = {
  /** the component vocabulary this graph speaks */
  vocab: Vocab
  /** the transaction of the phase (detached outside the batch's own) */
  tx: Tx
  /** the phase running: what tells a rule whose output still has to be written
   * from one whose output the `mutate` phase will write for it */
  phase: Phase
  /** the instant this batch stamps with, ISO-8601 */
  now: string
  /** who is writing the batch */
  actor: Actor
  /** the graph as this batch found it, for the entities it names. A rule asks
   * about a component the batch does not carry — a gate on `created` — through
   * this; a phase with nothing to offer leaves it out, and a rule then sees the
   * batch alone. */
  of?: (eid: Eid) => Bundle | undefined
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
 */
export type Rule = {
  /** the phase it runs in */
  phase: Phase
  /** the query it matches, as text (parsed with no bare-word text terms) or an
   * already-built AST. `+comp` ensures, `+!comp` gates, `*comp` declares the
   * write set, and the rest filters. */
  match: Query
  /** components to write into the matched bundle, verbatim */
  produce?: Patch
  /** anything else: the bound bundle in, the patch to write out (or nothing) */
  run?: (
    bound: Bundle,
    ctx: RuleCtx,
  ) => Patch | undefined | Promise<Patch | undefined>
  /** a name, for the refusal that says which rule wrote outside its write set */
  name?: string
}

// A rule's match, compiled: the test, and the component names its sigils named.
type Ready = {
  test: Filter
  ensures: string[]
  gates: string[]
  allowed: Set<string>
  checked: boolean
}

// Compiled once per rule, per vocabulary. Keyed by the rule OBJECT, so this is
// a memo rather than a registry — two graphs sharing a plugin share the
// compilation only while they speak the same vocabulary.
let cache = new WeakMap<Rule, { v: Vocab; ready: Ready | null }>()

let compile = (r: Rule, v: Vocab): Ready | null => {
  let hit = cache.get(r)
  if (hit && hit.v == v) return hit.ready
  let ast: Ast = typeof r.match == 'string'
    ? parse(r.match, { text: false })
    : r.match
  let d = declared(ast)
  let named = [...d.gates, ...d.ensures, ...d.writes]
  let ready: Ready | null = null
  try {
    ready = {
      test: filter(d.filter, v),
      ensures: d.ensures,
      gates: d.gates,
      allowed: new Set(named),
      checked: d.writes.length > 0,
    }
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
  bundles: Bundle[],
  ctx: RuleCtx,
): Bundle[] | Promise<Bundle[]> => {
  if (!rules.length) return bundles
  // One view per ENTITY, not per patch: the phases add their bundles to the
  // batch as they go, and a rule is about the entity, so it must not fire once
  // per patch that mentions it.
  let seen = new Map<Eid, Bundle>()
  for (let b of bundles) {
    let eid = b.entity.eid
    seen.set(eid, merged(seen.get(eid) ?? ctx.of?.(eid) ?? null, b))
  }
  let views = [...seen.values()]
  // The tick: every match is judged before any rule acts.
  let hits: [Rule, Ready, number][] = []
  for (let r of rules) {
    let ready = compile(r, ctx.vocab)
    if (!ready) continue
    views.forEach((v, i) => {
      if (ready.test(v, views)) hits.push([r, ready, i])
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
      let bound: Bundle = { ...views[i], ...patch }
      return then(r.run?.(bound, ctx), (made) => {
        Object.assign(patch, made)
        let names = wrote(patch)
        if (ready.checked) {
          let stray = names.filter((c) => !ready.allowed.has(c))
          if (stray.length) {
            throw new Error(
              `rule ${r.name ?? r.match} wrote outside its *write set: ` +
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
      let late = PHASES.indexOf(ctx.phase) >= PHASES.indexOf('mutate')
      return late
        ? then(ctx.tx.patch(made), () => [...bundles, ...made])
        : [...bundles, ...made]
    },
  )
}
