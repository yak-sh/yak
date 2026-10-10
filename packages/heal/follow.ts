// Tracker bugs are evidence in another store. Their work lives here, with a
// derived task and about edge; task completion and fixer history decide what
// a replay owes without a private follower checkpoint.

import {
  type Bundle,
  type Comp,
  type Graph,
  identityEid,
  token,
} from '@yaks/graph'
import type { Client } from '@yaks/client'
import { link } from '@yaks/edge'
import { and, eq, present } from '@yaks/query'
import { fixing, type Options } from './fix.ts'

/** One tracker bug always names the same work item. */
export let taskEid = (bug: string): string => identityEid('heal_task', [bug])

let comp = (row: Bundle | undefined, name: string) =>
  row?.[name] as Comp | undefined
let str = (value: unknown) => value == null ? '' : String(value)
let moment = (value: unknown) => Date.parse(str(value))

/** Reconcile a tracker answer. The caller retries either store's failed writes. */
export let follow = (
  g: Graph,
  options: Options = {},
): (bug: Bundle, url: string, mutate: Client['mutate']) => Promise<void> => {
  let { fix, home } = fixing(g, options)
  return (bug: Bundle, url: string, mutate: Client['mutate']) =>
    fix(async () => {
      if (!bug.bug || bug.archived) return
      let evidence = bug.entity.eid
      let eid = taskEid(evidence)
      let edges = await g.read(and(present('about'), eq('edge.to', evidence)))
      let linked = edges.map((edge) => str(comp(edge, 'edge')?.from))
      let task = (await g.get([...new Set([...linked, eid])]))
        .find((row) => row.task)
      if (task) {
        let reopen = !!task.completed &&
          moment(comp(bug, 'regressed')?.at) >
            moment(comp(task, 'completed')?.at)
        let mark = task.cancelled
          ? 'archived'
          : task.completed && !reopen
          ? 'resolved'
          : undefined
        if (mark && !bug[mark]) {
          await mutate([{
            entity: bug.entity,
            [mark]: {},
            // A new regression or someone else's mark invalidates this answer.
            $was: {
              bug: { fault: token(comp(bug, 'bug')?.fault) },
              resolved: { at: token(comp(bug, 'resolved')?.at) },
              archived: { at: token(comp(bug, 'archived')?.at) },
              regressed: {
                at: token(comp(bug, 'regressed')?.at),
                error: token(comp(bug, 'regressed')?.error),
              },
            },
          }], { optimistic: false })
        }
        if (task.cancelled || bug.resolved) return
        if (task.completed && !reopen) return
        return { task, bug: evidence, reopen }
      }
      if (bug.resolved) return
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
