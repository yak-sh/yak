// What was asked of a task's work, kept on the task. Words sent to a run at
// work on a task (`session_send`) are a comment on that task as well as what
// reaches the run, one row that is both (./listen.ts says it once), so the
// task holds every ask in order. A run that starts on the task later, or a
// run that resumes or is compacted, reads them all with its brief: a respawn
// never starts from the newest ask alone.
//
// An ask is a comment on the task that was said to its run (it carries
// `knock.from`) or that a person wrote. A run's own report on the task is
// neither.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { human } from '@yaks/id'
import { line, sub } from '@yaks/query'
import { CLAIM } from './comp.ts'

let str = (v: unknown): string => typeof v == 'string' ? v : ''
let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** The task words sent to `session` are about: `task` where the caller named
 * one, else the one task the session holds. None where it holds several or
 * none, or the graph keeps no comments. */
export let askedOf = async (
  g: Pick<Graph, 'vocab' | 'read'>,
  session: Eid,
  task?: Eid,
): Promise<Eid | undefined> => {
  if (!g.vocab.comp('comment') || !g.vocab.comp(CLAIM)) return
  if (task) return task
  let held = await g.read(line`.${CLAIM}.session=${session}`)
  return held.length == 1 ? held[0].entity.eid : undefined
}

/** The comment that keeps words sent to `session` on `task`: it is also the
 * knock that carries them to the session, so it is said once. */
export let ask = (
  session: Eid,
  task: Eid,
  text: string,
  from?: Eid,
): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  doc: { body: text },
  comment: { target: task },
  knock: { target: session, ...from ? { from } : {} },
})

/** Every ask on these tasks, oldest first, each as its task's eid and the row
 * with its author's title (`by`). */
export let asksOn = async (
  g: Pick<Graph, 'vocab' | 'read' | 'get'>,
  tasks: Eid[],
): Promise<Map<Eid, Bundle[]>> => {
  let out = new Map<Eid, Bundle[]>()
  let made = !!g.vocab.prop('created', 'at')
  let sent = !!g.vocab.comp('knock')
  let person = made && !!g.vocab.comp('person')
  if (!tasks.length || !g.vocab.comp('comment') || !(sent || person)) {
    return out
  }
  let said = sent && person
    ? line`(.knock.from | .created.by.person)`
    : sent
    ? line`.knock.from`
    : line`.created.by.person`
  let order = made ? line`.order=created.at` : line``
  let rows = await g.read(
    line`.comment.target=${tasks} ${sub(said)} ${sub(order)} *`,
  )
  for (let b of rows) {
    let on = str(comp(b, 'comment').target)
    out.set(on, [...out.get(on) ?? [], b])
  }
  return out
}

/** The asks as a run reads them: one per line under its id and who asked,
 * its words whole and indented beneath. */
export let asksSaid = async (
  g: Pick<Graph, 'vocab' | 'get'>,
  rows: Bundle[],
  indent = '',
): Promise<string[]> => {
  let authors = [
    ...new Set(
      rows.map((b) => str(comp(b, 'knock').from) || str(comp(b, 'created').by)),
    ),
  ].filter(Boolean)
  let named = new Map(
    (authors.length ? await g.get(authors, ['doc']) : []).map((b) => [
      b.entity.eid,
      str(comp(b, 'doc').title) || human(g.vocab)(b),
    ]),
  )
  return rows.map((b) => {
    let by = named.get(
      str(comp(b, 'knock').from) || str(comp(b, 'created').by),
    )
    let body = str(comp(b, 'doc').body).trim().replaceAll(
      '\n',
      `\n${indent}  `,
    )
    return `${indent}- ${human(g.vocab)(b)}${by ? ` from ${by}` : ''}: ${body}`
  })
}
