// The step runner: a step is a rule stored as a row, and this is what runs it.
//
// For each binding of a step's match, its `write` is filled (./fill.ts) and
// written. When depends on the step:
//
// - `when: 'write'` runs in the `rules` phase of the write that made it match,
//   anchored to that batch, so what it writes commits with it or not at all.
//   What it writes joins the batch and the steps are asked again, so one step
//   can feed the next inside the same write.
// - `when: 'commit'` (the default) runs after that write commits, anchored to
//   it, as a write of its own, signed by the same actor.
// - A step carrying `wake` or `watch` (@yaks/wake) runs when one fires: the
//   firing writes `fired` on the step, and the step's match is asked of the
//   whole graph.
//
// A step a workflow `contains` acts for a case: the case one of the matched
// entities was made for in that workflow, else a new one for the first matched
// entity, its eid derived from the workflow and that item. It runs at most
// once per case, and stamps `made{case, step}` on each row it creates. A bare
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
  type Plugin,
  reads,
  type ReadTx,
  signed,
} from '@yaks/graph'
import type { Actor } from '@yaks/graph'
import { whole } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { fill } from './fill.ts'

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

type Row = { step: Step; binding: Binding }

let q = <T>(tx: ReadTx, query: string): Bundle[] | Promise<Bundle[]> =>
  tx.read(whole(query)) as Bundle[] | Promise<Bundle[]>

let parsed = new Map<string, Match>()
let plan = (text: string): Match => {
  let held = parsed.get(text)
  if (!held) parsed.set(text, held = match(text))
  return held
}

/** The steps a graph holds, each with the workflow that contains it. */
export let steps = (tx: ReadTx): Step[] | Promise<Step[]> =>
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
    let derived = identityEid('workflow_case', [w, item])
    return after(tx.get([...cases, derived], ['workflow_case']), (rows) => {
      let found = cases.find((c) =>
        comp(rows, c, 'workflow_case', 'workflow') == w
      )
      let eid = found ?? derived
      return {
        eid,
        item,
        known: !!comp(rows, eid, 'workflow_case', 'workflow'),
      }
    })
  })
}

// What one binding writes, each row it creates stamped with its case and
// step. A workflow's step writes nothing for a case it already made something
// for, unless `again` (a rerun) says to.
let wrote = (
  tx: ReadTx,
  { step, binding }: Row,
  pending: Bundle[],
  again = false,
): Bundle[] | Promise<Bundle[]> => {
  let { bundles, fresh } = fill(step.write, binding.vars)
  let w = step.workflow
  if (!w) return bundles
  return after(caseOf(tx, w, binding, pending), (kase) => {
    let mine = (b: Bundle) => {
      let m = b.made as Comp | undefined
      return m?.case == kase.eid && m?.step == step.eid
    }
    let ran = again || !kase.known
      ? []
      : q(tx, `.made.case=${kase.eid}, made.step=${step.eid}`)
    return after(ran, (before) => {
      if (!again && (before.length || pending.some(mine))) return []
      let stamped = bundles.map((b) =>
        fresh.includes(b.entity.eid)
          ? { ...b, made: { case: kase.eid, step: step.eid } }
          : b
      )
      return kase.known ? stamped : [
        {
          entity: { eid: kase.eid },
          workflow_case: { workflow: w, for: kase.item },
        },
        ...stamped,
      ]
    })
  })
}

// Every binding of these steps, anchored to `batch` (or asked of the whole
// graph when it is empty), as rows in the steps' order.
let bound = (
  tx: ReadTx,
  vocab: Vocab,
  list: Step[],
  batch: Bundle[],
): Row[] | Promise<Row[]> => {
  if (!list.length || !tx.bindings) return []
  let plans = list.map((s) => s.plan)
  let covers = [...new Set(plans.flatMap((p) => reads(p, vocab)))]
  return after(
    tx.bindings(plans, batch, covers),
    (found) =>
      list.flatMap((step, i) =>
        (found[i] ?? []).map((binding) => ({ step, binding }))
      ),
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

/** The `rules` hook: the `write` steps, run over the batch until they write
 * nothing more. Each binding runs once in a write. */
let inWrite: Hook = (bundles, tx, _err, context) => {
  let v = (context?.graph as Graph | undefined)?.vocab
  if (!v || !tx.bindings) return bundles
  return after(steps(tx), (all) => {
    let list = all.filter((s) => s.when == 'write' && !s.fires)
    if (!list.length) return bundles
    let ran = new Set<string>()
    let round = (batch: Bundle[]): Bundle[] | Promise<Bundle[]> =>
      after(bound(tx, v, list, batch), (rows) => {
        let next = rows.filter((r) => !ran.has(key(r)))
        for (let r of next) ran.add(key(r))
        if (!next.length) return batch
        return after(writing(tx, next, batch), (out) => {
          if (!out.length) return batch
          return round([...batch, ...admit(out, v)])
        })
      })
    return round(bundles)
  })
}

let actorOf = (bundles: Bundle[]): Actor | undefined =>
  bundles.find((b) => b.$actor)?.$actor as Actor | undefined

/** The `effect` hook: after a commit, the `commit` steps anchored to it, and
 * each step whose wake or watch the commit fired, over the whole graph. What
 * they write is one more write, signed by the commit's actor (a firing by the
 * step's writer). */
let afterCommit: Hook = (bundles, tx, _err, context) => {
  let g = context?.graph as Graph | undefined
  if (!g || !tx.bindings) return bundles
  let gen = Number(bundles.find((b) => b[GEN] != null)?.[GEN] ?? 0)
  let v = g.vocab
  let actor = actorOf(context?.bundles ?? bundles)
  let fired = new Set(bundles.filter((b) => b.fired).map((b) => b.entity.eid))
  return after(steps(tx), (all) => {
    let commit = all.filter((s) => s.when == 'commit' && !s.fires)
    let firing = all.filter((s) => s.fires && fired.has(s.eid))
    if (!commit.length && !firing.length) return bundles
    if (gen >= DEPTH) {
      throw new Error(
        `steps wrote ${DEPTH} times in a chain after a commit: ` +
          commit.map((s) => s.eid).join(', ') +
          ' — a step whose match does not exclude its own output',
      )
    }
    // Each run: its steps, the batch they are anchored to (none for a firing),
    // and whom they write as.
    let runs: [Step[], Bundle[], Actor | undefined][] = [
      [commit, bundles, actor],
      ...firing.map((s): [Step[], Bundle[], Actor | undefined] => [
        [s],
        [],
        s.by ? { by: s.by } : actor,
      ]),
    ]
    return after(
      each(
        runs,
        null as null,
        (_, [list, batch, who]) =>
          after(
            bound(tx, v, list, batch),
            (rows) =>
              after(writing(tx, rows, []), (out) => {
                if (!out.length) return null
                let marked = out.map((b) => ({ ...b, [GEN]: gen + 1 }))
                return after(
                  g.apply(who ? signed(marked, who) : marked),
                  () => null,
                )
              }),
          ),
      ),
      () => bundles,
    )
  })
}

/** The workflow plugin: runs the graph's steps in each write, after each
 * commit, and on a step's wake firing. */
export let workflows = (): Plugin => ({
  name: 'workflow',
  requests: [GEN],
  hooks: { rules: inWrite, effect: afterCommit },
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
