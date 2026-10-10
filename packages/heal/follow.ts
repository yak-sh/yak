// Tracker bugs are evidence in another store. Their work lives here, with a
// derived task and about edge; task completion and fixer history decide what
// a replay owes without a private follower checkpoint.

import { type Bundle, type Comp, type Graph, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { and, eq, present } from '@yaks/query'
import { fixing, type Options } from './fix.ts'

/** One tracker bug always names the same work item. */
export let taskEid = (bug: string): string => identityEid('heal_task', [bug])

let comp = (row: Bundle | undefined, name: string) =>
  row?.[name] as Comp | undefined
let str = (value: unknown) => value == null ? '' : String(value)
let moment = (value: unknown) => Date.parse(str(value))

/** Reconcile a tracker answer. The caller retries after a failed box write. */
export let follow = (
  g: Graph,
  options: Options = {},
): (bug: Bundle, url: string) => Promise<void> => {
  let { fix, home } = fixing(g, options)
  return (bug: Bundle, url: string) =>
    fix(async () => {
      if (!bug.bug || bug.resolved || bug.archived) return
      let evidence = bug.entity.eid
      let edges = await g.read(and(present('about'), eq('edge.to', evidence)))
      let linked = edges.map((edge) => str(comp(edge, 'edge')?.from))
      let task = (await g.get([...linked, taskEid(evidence)]))
        .find((row) => row.task)
      if (task) {
        let reopen = !!task.completed &&
          moment(comp(bug, 'regressed')?.at) >
            moment(comp(task, 'completed')?.at)
        if (task.completed && !reopen) return
        return { task, bug: evidence, reopen }
      }
      let eid = taskEid(evidence)
      let project = await home()
      let pointer =
        new URL(encodeURIComponent(evidence), `${url.replace(/\/$/, '')}/`).href
      task = {
        entity: { eid },
        task: {},
        doc: {
          title: str(comp(bug, 'doc')?.title).split('\n')[0] ||
            'Fix tracker bug',
          body: `Fix the bug recorded at [the tracker](${pointer}).`,
        },
        filed: { ...(project ? { project } : {}), priority: 1 },
        $was: { doc: { title: null } },
      }
      return {
        task,
        bug: evidence,
        writes: [task, link(eid, 'about', evidence)],
      }
    })
}
