// Tracker bugs are evidence in another store. Their work lives here, with a
// derived task and about edge; task completion and fixer history decide what
// a replay owes without a private follower checkpoint.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
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

// A new bug is news for whoever works for the project: a knock at it, which a
// session of the project hears on its bus (@yaks/session). It lands with the
// task, so a replay that finds the task knocks no second time.
let knock = (
  g: Graph,
  project: string | undefined,
  bug: string,
  title: string,
  where: string,
): Bundle[] =>
  project && g.vocab.comp('knock')
    ? [{
      entity: { eid: identityEid('heal_knock', [bug]) },
      knock: { target: project },
      doc: {
        title: '',
        body: `New bug: ${
          title.length > 240 ? `${title.slice(0, 240)}…` : title
        } (${where})`,
      },
    }]
    : []

/** Reconcile a tracker answer. The caller retries either store's failed writes. */
export let follow = (
  g: Graph,
  options: Options = {},
): (bug: Bundle, url: string, mutate: Client['mutate']) => Promise<void> => {
  let { fix, home } = fixing(g, options)
  return (bug: Bundle, url: string, mutate: Client['mutate']) =>
    fix(async () => {
      if (!bug.bug) return
      let evidence = bug.entity.eid
      let eid = taskEid(evidence)
      let edges = await g.read(and(present('about'), eq('edge.to', evidence)))
      let linked = edges.map((edge) => str(comp(edge, 'edge')?.from))
      let task = (await g.get([...new Set([...linked, eid])]))
        .find((row) => row.task)
      if (task) {
        let close = bug.archived && !task.cancelled
          ? 'cancelled'
          : bug.resolved && !task.completed && !task.cancelled
          ? 'completed'
          : undefined
        if (close) {
          let source = close == 'cancelled' ? 'archived' : 'resolved'
          await g.apply([{
            entity: task.entity,
            [close]: { at: comp(bug, source)?.at },
            ...(close == 'cancelled' ? { completed: null } : {}),
            $was: {
              completed: { at: token(comp(task, 'completed')?.at) },
              cancelled: { at: token(comp(task, 'cancelled')?.at) },
            },
          }], { trusted: true })
          return
        }
        if (bug.archived) return
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
            entity: { eid: bug.entity.eid },
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
      if (bug.resolved || bug.archived) return
      let project = await home()
      // A tracker graph has a page per bug; the platform's is read with a
      // command, since its Worker answers only signed reads.
      let where = /^https?:/.test(url)
        ? `[the tracker](${
          new URL(encodeURIComponent(evidence), `${url.replace(/\/$/, '')}/`)
            .href
        })`
        : `${url}'s tracker: \`yak bug show ${evidence} --source ${url}\``
      let title = str(comp(bug, 'doc')?.title).split('\n')[0] ||
        'Fix tracker bug'
      task = {
        entity: { eid },
        task: {},
        doc: { title, body: `Fix the bug recorded at ${where}.` },
        filed: { ...(project ? { project } : {}), priority: 1 },
        $was: { doc: { title: null } },
      }
      return {
        task,
        bug: evidence,
        writes: [
          task,
          link(eid, 'about', evidence),
          ...knock(g, project, evidence, title, where),
        ],
      }
    })
}
