// The step runner: a step is a rule stored as a row, and this is what runs it.
//
// For each binding of a step's match, its `write` is filled (./fill.ts) and
// written. When depends on the step:
//
// - `when: 'write'` runs in the `rules` phase of the write that made it match,
//   anchored to that batch, so what it writes commits with it or not at all.
//   What it writes joins the batch and the steps are asked again, so one step
//   can feed the next inside the same write.
// - `when: 'commit'` (the default) runs after that write commits, as a write
//   of its own signed by the same actor. The write that matched owes it, in its
//   own transaction: one `step_due` per binding, naming the step, the binding's
//   entities and the actor, which owes the `step_run` effect (@yaks/effects),
//   so the pool runs it with its retries and a crash or restart never drops
//   it. The run asks the match again anchored to those entities, so it acts on
//   the present, and deletes the `step_due` in the same write.
// - A step carrying `wake` or `watch` (@yaks/wake) runs when one fires: the
//   firing writes `fired` on the step, which owes `step_fire`, and the step's
//   match is asked of the whole graph.
//
// A step a workflow `contains` acts for a case: the case one of the matched
// entities was made for in that workflow, else a new one for the first matched
// entity, its eid derived from the workflow and that item. It runs at most
// once per case for what its match bound (`bindingKey`: the entities, the
// variables and the brackets' members), so touching a row it read starts
// nothing, and changing a value it bound runs it again for that case. It
// stamps `made{case, step, binding}` on each row it creates. A bare
// step writes no case and no `made`; like a declared rule, its own output is
// what must stop it matching.

import { after, each } from '@yaks/fp'
import {
  type Access,
  admit,
  type Binding,
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  type Hook,
  identityEid,
  type Match,
  match,
  mint,
  type Plugin,
  reads,
  type ReadTx,
  sha256,
  signed,
} from '@yaks/graph'
import type { Actor } from '@yaks/graph'
import { and, limit, parse, whole } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Handlers } from '@yaks/effects'
import { fill } from './fill.ts'
import { CASE } from './map.ts'

/** A step as the runner holds it: its row, read, with its match parsed and
 * the workflow containing it. */
export type Step = {
  eid: Eid
  match: string
  plan: Match
  write: Bundle[]
  when: 'write' | 'commit'
  /** it carries a `wake` or a `watch`, so it runs when that fires */
  fires: boolean
  workflow?: Eid
  /** who wrote it, which a firing writes as */
  by?: Eid
}

/** How deep a chain of after-commit writes may run before it is taken for a
 * step whose output keeps matching it. */
export const DEPTH = 32
const GEN = '$step'
/** The component an owed after-commit run is, and the effects that run steps
 * after a commit and on a firing. */
export const DUE = 'step_due', RUN = 'step_run', FIRE = 'step_fire'

type Row = { step: Step; binding: Binding }

let q = <T>(tx: ReadTx, query: string): Bundle[] | Promise<Bundle[]> =>
  tx.read(whole(query)) as Bundle[] | Promise<Bundle[]>

let parsed = new Map<string, Match>()
let plan = (text: string): Match => {
  let held = parsed.get(text)
  if (!held) parsed.set(text, held = match(text))
  return held
}

// Whether a graph holds any step: one row, read on every write, so a store
// with none pays an index probe rather than a whole read.
let any = and(...parse('.step').clauses, limit(1))

/** The steps a graph holds, each with the workflow that contains it. */
export let steps = (tx: ReadTx): Step[] | Promise<Step[]> =>
  after(
    tx.read(any) as Bundle[] | Promise<Bundle[]>,
    (one) => one.length ? held(tx) : [],
  )

let held = (tx: ReadTx): Step[] | Promise<Step[]> =>
  after(q(tx, '.step'), (rows) => {
    if (!rows.length) return []
    return after(q(tx, '.workflow'), (flows) =>
      after(
        each(flows, [] as Bundle[], (all, w) =>
          after(
            q(tx, `.contains, edge.from=${w.entity.eid}&?edge`),
            (edges) => [...all, ...edges],
          )),
        (edges) => {
          let within = new Map<Eid, Eid>()
          for (let e of edges) {
            let edge = e.edge as { from: Eid; to: Eid }
            within.set(edge.to, edge.from)
          }
          return rows.flatMap((b): Step[] => {
            let s = b.step as Comp
            if (typeof s.match != 'string') return []
            return [{
              eid: b.entity.eid,
              match: s.match,
              plan: plan(s.match),
              write: (s.write ?? []) as Bundle[],
              when: s.when == 'write' ? 'write' : 'commit',
              fires: !!(b.wake || b.watch),
              workflow: within.get(b.entity.eid),
              by: (b.created as Comp | undefined)?.by as Eid | undefined,
            }]
          })
        },
      ))
  })

// The case a binding of a workflow's step is for: the case one of its matched
// entities was made for in that workflow, else the one derived from the
// workflow and the first matched entity. `pending` is what this write already
// holds, so a case made a moment ago is found. `known` says the case row
// exists already.
type Case = { eid: Eid; item: Eid; known: boolean }
let caseOf = (
  tx: ReadTx,
  w: Eid,
  binding: Binding,
  pending: Bundle[],
): Case | Promise<Case> => {
  let ids = binding.entities.filter((e): e is Eid => !!e)
  let held = (rows: Bundle[], eid: Eid) => [
    ...rows.filter((b) => b.entity.eid == eid),
    ...pending.filter((b) => b.entity.eid == eid),
  ]
  let comp = (rows: Bundle[], eid: Eid, name: string, prop: string) =>
    held(rows, eid).map((b) => (b[name] as Comp | undefined)?.[prop])
      .findLast((x) => x) as Eid | undefined
  return after(tx.get(ids, ['made']), (marks) => {
    let cases = ids.map((id) => comp(marks, id, 'made', 'case'))
      .filter((c): c is Eid => !!c)
    let item = ids[0]
    let derived = identityEid(CASE, [w, item])
    return after(tx.get([...cases, derived], [CASE]), (rows) => {
      let found = cases.find((c) => comp(rows, c, CASE, 'workflow') == w)
      let eid = found ?? derived
      return { eid, item, known: !!comp(rows, eid, CASE, 'workflow') }
    })
  })
}

// JSON with each object's keys in order, so equal values say the same.
let canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v == 'object'
    ? `{${
      Object.keys(v).sort().map((k) =>
        `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`
      ).join(',')
    }}`
    : JSON.stringify(v ?? null)

/** What a binding bound, as a short key: two bindings with the same
 * entities, variables and bracket members have the same key. */
export let bindingKey = ({ entities, vars, collections }: Binding): string =>
  sha256(canon([entities, vars, collections ?? []])).slice(0, 32)

// What one binding writes, each row it creates stamped with its case, step
// and binding. A workflow's step writes nothing for a case it already made
// something for from the same binding, unless `again` (a rerun) says to.
let wrote = (
  tx: ReadTx,
  { step, binding }: Row,
  pending: Bundle[],
  again = false,
): Bundle[] | Promise<Bundle[]> => {
  let { bundles, fresh } = fill(step.write, binding.vars)
  let w = step.workflow
  if (!w) return bundles
  let bk = bindingKey(binding)
  return after(caseOf(tx, w, binding, pending), (kase) => {
    let made = { case: kase.eid, step: step.eid, binding: bk }
    let mine = (b: Bundle) => {
      let m = b.made as Comp | undefined
      return m?.case == made.case && m?.step == made.step &&
        m?.binding == made.binding
    }
    let ran = again || !kase.known ? [] : q(
      tx,
      `.made.case=${kase.eid}, made.step=${step.eid}, made.binding=${bk}`,
    )
    return after(ran, (before) => {
      if (!again && (before.length || pending.some(mine))) return []
      let stamped = bundles.map((b) =>
        fresh.includes(b.entity.eid) ? { ...b, made } : b
      )
      return kase.known ? stamped : [
        { entity: { eid: kase.eid }, [CASE]: { workflow: w, for: kase.item } },
        ...stamped,
      ]
    })
  })
}

/** Where a step that cannot run is reported. */
export type Report = (error: unknown) => void

// A step that cannot be asked (its match names a word the store does not
// have) is told once to `report`, and runs nowhere: it never refuses a write,
// the write that fixes it included.
let told = new Set<string>()
let tell = (s: Step, e: unknown, report?: Report) => {
  let said = `${s.eid} ${s.match}`
  if (!report || told.has(said)) return
  told.add(said)
  report(
    new Error(
      `step ${s.eid} cannot run: ${e instanceof Error ? e.message : e}`,
      { cause: e },
    ),
  )
}

// `f`, or what `fail` makes of its error, thrown or rejected.
let attempt = <T>(
  f: () => T | Promise<T>,
  fail: (e: unknown) => T | Promise<T>,
): T | Promise<T> => {
  try {
    let r = f()
    return r instanceof Promise ? r.catch(fail) as Promise<T> : r
  } catch (e) {
    return fail(e)
  }
}

// A match widened by one of its brackets: the bracket's patterns joined to
// the outer ones, so a member the batch touches anchors it. Its bindings'
// first entities are the outer match's.
let widened = (plan: Match): Match[] =>
  plan.collections.filter((c) => !c.none && !c.empty).map((c) => ({
    patterns: [...plan.patterns, ...c.patterns],
    collections: c.collections,
    vars: [...new Set([...plan.vars, ...c.vars])],
  }))

// Every binding of these steps, anchored to `batch` (or asked of the whole
// graph when it is empty), as rows in the steps' order. A row a step's
// bracket reads anchors it too: the outer entities of each binding a member
// in the batch makes are added to the anchor, so a step that waits for every
// line to be voiced runs when the last one is.
let bound = (
  tx: ReadTx,
  vocab: Vocab,
  steps: Step[],
  batch: Bundle[],
  report?: Report,
): Row[] | Promise<Row[]> => {
  let list = steps
  if (!list.length || !tx.bindings) return []
  let bindings = tx.bindings.bind(tx)
  // Every step's plan asked at once; when that fails, each alone, and those
  // that fail alone answer nothing.
  let ask = (
    plans: Match[],
    owners: Step[],
    batch: Bundle[],
    covers: string[],
  ): Binding[][] | Promise<Binding[][]> =>
    attempt(
      () => bindings(plans, batch, covers),
      () =>
        each(
          plans.map((p, i) => [p, i] as const),
          [] as Binding[][],
          (out, [p, i]) =>
            after(
              attempt(() => bindings([p], batch, covers), (e) => {
                tell(owners[i], e, report)
                return [[]]
              }),
              (one) => [...out, one[0] ?? []],
            ),
        ),
    )
  let plans = list.map((s) => s.plan)
  let covers = [...new Set(plans.flatMap((p) => reads(p, vocab)))]
  let wide = batch.length
    ? list.flatMap((s) => widened(s.plan).map((plan) => ({ s, plan })))
    : []
  let anchor = (bindings: Binding[][]) => {
    let held = new Set(batch.map((b) => b.entity.eid))
    let more = new Set<Eid>()
    wide.forEach(({ s }, i) => {
      let outer = s.plan.patterns.length
      for (let b of bindings[i] ?? []) {
        for (let e of b.entities.slice(0, outer)) {
          if (e && !held.has(e)) more.add(e)
        }
      }
    })
    return [...more].map((eid) => ({ entity: { eid } }))
  }
  return after(
    wide.length
      ? ask(wide.map((w) => w.plan), wide.map((w) => w.s), batch, covers)
      : [],
    (members) => {
      let extra = anchor(members)
      return after(
        ask(plans, list, [...batch, ...extra], covers),
        (found) =>
          list.flatMap((step, i) =>
            (found[i] ?? []).map((binding) => ({ step, binding }))
          ),
      )
    },
  )
}

let key = ({ step, binding }: Row) =>
  `${step.eid}(${binding.entities.join(',')})`

// What a set of rows writes, each seeing what the ones before it wrote.
let writing = (
  tx: ReadTx,
  rows: Row[],
  pending: Bundle[],
  again = false,
): Bundle[] | Promise<Bundle[]> =>
  after(
    each(rows, [] as Bundle[], (out, row) =>
      after(
        wrote(tx, row, [...pending, ...out], again),
        (b) => [...out, ...b],
      )),
    (out) => out,
  )

let depthOf = (bundles: Bundle[]): number =>
  Number(bundles.find((b) => b[GEN] != null)?.[GEN] ?? 0)

let actorOf = (bundles: Bundle[]): Actor | undefined =>
  bundles.find((b) => b.$actor)?.$actor as Actor | undefined

let looping = (list: Step[]) =>
  new Error(
    `steps wrote ${DEPTH} times in a chain after a commit: ` +
      list.map((s) => s.eid).join(', ') +
      ' — a step whose match does not exclude its own output',
  )

// What a set of rows writes, with `also`, applied as one write signed by
// `who`, `depth` after-commit step writes deep.
let perform = (
  g: Access,
  tx: ReadTx,
  rows: Row[],
  who: Actor | undefined,
  depth: number,
  also: Bundle[] = [],
): unknown =>
  after(writing(tx, rows, []), (wrote) => {
    let out = [...wrote, ...also]
    if (!out.length) return null
    let marked = out.map((b) => ({ ...b, [GEN]: depth }))
    return g.apply(who ? signed(marked, who) : marked)
  })

// The runs this batch owes its `commit` steps: a `step_due` for each binding
// anchored to it.
let owed = (
  tx: ReadTx,
  v: Vocab,
  list: Step[],
  batch: Bundle[],
  report?: Report,
): Bundle[] | Promise<Bundle[]> =>
  after(bound(tx, v, list, batch, report), (rows) => {
    if (!rows.length) return batch
    let depth = depthOf(batch)
    if (depth >= DEPTH) throw looping(rows.map((r) => r.step))
    let actor = actorOf(batch)
    return [
      ...batch,
      ...rows.map(({ step, binding }): Bundle => ({
        entity: { eid: mint() },
        [DUE]: {
          step: step.eid,
          binding: binding.entities.map((e) => e ?? ''),
          ...actor?.by ? { by: actor.by } : {},
          ...actor?.via ? { via: actor.via } : {},
          depth,
        },
      })),
    ]
  })

/** The `rules` hook: the `write` steps, run over the batch until they write
 * nothing more (each binding once in a write), then the runs the `commit`
 * steps are owed. A batch only checked (`admission`, such as a peer's relayed
 * value) is never kept, so no step acts on it, and it reads nothing. */
let inWrite = (report?: Report): Hook => (bundles, tx, _err, context) => {
  let v = (context?.graph as Graph | undefined)?.vocab
  if (!v || !tx.bindings || context?.admission) return bundles
  return after(steps(tx), (all) => {
    let list = all.filter((s) => s.when == 'write' && !s.fires)
    let commit = all.filter((s) => s.when == 'commit' && !s.fires)
    if (!list.length && !commit.length) return bundles
    let ran = new Set<string>()
    let round = (batch: Bundle[]): Bundle[] | Promise<Bundle[]> =>
      after(bound(tx, v, list, batch, report), (rows) => {
        let next = rows.filter((r) => !ran.has(key(r)))
        for (let r of next) ran.add(key(r))
        if (!next.length) return batch
        return after(writing(tx, next, batch), (out) => {
          if (!out.length) return batch
          return round([...batch, ...admit(out, v)])
        })
      })
    return after(
      list.length ? round(bundles) : bundles,
      (batch) => commit.length ? owed(tx, v, commit, batch, report) : batch,
    )
  })
}

/** The workflow plugin: runs the graph's steps in each write, and owes the
 * runs of those that run after it commits. A step that cannot run is told
 * to `report`. */
export let workflows = (report: Report = console.error): Plugin => ({
  name: 'workflow',
  requests: [GEN],
  // A check keeps nothing, and the steps leave it alone (`inWrite`), so it
  // needs no dry run of its own.
  admission: () => true,
  hooks: { rules: inWrite(report) },
})

/**
 * The code of `step_run` and `step_fire`, writing through `g`.
 *
 * `step_run` runs one owed binding: the step's match asked again anchored to
 * the entities the binding named, the rows that still bind them written,
 * signed as the write that matched, with its `step_due` deleted in the same
 * write, so a run repeated after a crash finds nothing owed. `step_fire` runs
 * a step whose wake or watch fired, its match asked of the whole graph,
 * written as the step's writer. A step deleted or changed since does what it
 * now says.
 */
export let handlers = (g: Access): Handlers => ({
  [RUN]: (e, tx) => {
    // Run already, or its step deleted with it: nothing is owed.
    if (!e.comp) return null
    let due = e.comp
    let binding = (due.binding ?? []) as string[]
    let done = [{ entity: { eid: e.entity.eid }, $delete: true }]
    let who = due.by
      ? { by: due.by as Eid, ...due.via ? { via: due.via as Eid } : {} }
      : undefined
    let depth = Number(due.depth ?? 0) + 1
    return after(steps(tx), (all) => {
      let s = all.find((x) => x.eid == due.step)
      let anchor = binding.filter((x) => x).map((eid) => ({ entity: { eid } }))
      let same = (r: Row) =>
        r.binding.entities.every((x, i) => (x ?? '') == (binding[i] ?? ''))
      return after(
        s ? bound(tx, g.vocab, [s], anchor) : [],
        (rows) => perform(g, tx, rows.filter(same), who, depth, done),
      )
    })
  },
  [FIRE]: (e, tx) =>
    after(steps(tx), (all) => {
      let s = all.find((x) => x.eid == e.entity.eid)
      if (!s?.fires) return null
      return after(
        bound(tx, g.vocab, [s], []),
        (rows) => perform(g, tx, rows, s.by ? { by: s.by } : undefined, 1),
      )
    }),
})

/**
 * Run a step again for the cases chosen, whatever it made for them before:
 * its match asked of the whole graph, the bindings kept whose case is one of
 * `cases`, and what they write applied as one write. Answers what applied.
 */
export let rerun = (
  g: Access,
  step: Eid,
  cases: Eid[],
): Bundle[] | Promise<Bundle[]> => {
  let tx = g.outside
  return after(steps(tx), (all) => {
    let s = all.find((x) => x.eid == step)
    if (!s) throw new Error(`no step ${step}`)
    let w = s.workflow
    if (!w) {
      throw new Error(`step ${step} is in no workflow, so it has no cases`)
    }
    return after(bound(tx, g.vocab, [s], []), (rows) =>
      after(
        each(rows, [] as Bundle[], (out, row) =>
          after(caseOf(tx, w, row.binding, out), (kase) =>
            cases.includes(kase.eid)
              ? after(wrote(tx, row, out, true), (b) => [...out, ...b])
              : out)),
        (out) =>
          out.length ? g.apply(out) : [],
      ))
  })
}
