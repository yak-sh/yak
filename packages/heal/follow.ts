// Tracker bugs are evidence in another store. Their work lives here, with a
// derived task and about edge; task completion and fixer history decide what
// a replay owes without a private follower checkpoint.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { Client } from '@yaks/client'
import { link } from '@yaks/edge'
import { human } from '@yaks/id'
import { and, eq, present } from '@yaks/query'
import { remoteBug } from '@yaks/tracker'
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

// A running fixer holding the bug's task has taken the bug, and the tracker
// tells the bug's letter thread. It is news once per opening: a bug with no
// `taken` mark, or one that came back after it, both times read off the
// tracker's own clock. A replay or a stale answer sends nothing new.
let take = async (
  g: Graph,
  bug: Bundle,
  task: Bundle | undefined,
  mutate: Client['mutate'],
) => {
  let holder = str(comp(task, 'claim')?.session)
  if (!task || !holder || bug.resolved || bug.archived) return
  let [fixer] = await g.get([holder])
  if (str(comp(fixer, 'fixer')?.bug) != bug.entity.eid || fixer.exit) return
  let back = moment(comp(bug, 'regressed')?.at)
  if (bug.taken && !(back > moment(comp(bug, 'taken')?.at))) return
  await mutate([{
    entity: { eid: bug.entity.eid },
    taken: { task: task.entity.num ? human(g.vocab)(task) : task.entity.eid },
  }], { optimistic: false })
}

/** Reconcile a tracker answer. The caller retries either store's failed writes. */
export let follow = (
  g: Graph,
  options: Options & { trackers?: string[] } = {},
): (bug: Bundle, url: string, mutate: Client['mutate']) => Promise<void> => {
  let { fix, home } = fixing(g, options)
  // A tracker graph has a page per bug. The platform's Worker answers only
  // signed reads, so its bugs open on a tracker web's side for them, and
  // without one they are read with a command.
  let base = (at: string) => at.replace(/\/$/, '')
  let web = options.trackers?.find((at) => /^https?:/.test(at))
  let reconcile = (bug: Bundle, url: string, mutate: Client['mutate']) =>
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
        await take(g, bug, task, mutate)
        return { task, bug: evidence, reopen }
      }
      if (bug.resolved || bug.archived) return
      let project = await home()
      let page = /^https?:/.test(url)
        ? `${base(url)}/${encodeURIComponent(evidence)}`
        : web && `${base(web)}${remoteBug(url, evidence)}`
      let where = page
        ? `[the tracker](${page})`
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
  // A fixer this pass started is news at once; a replay re-sends it.
  return async (bug: Bundle, url: string, mutate: Client['mutate']) => {
    let wrote = await reconcile(bug, url, mutate)
    let held = wrote.find((row) => row.claim)
    if (held && wrote.some((row) => row.fixer)) {
      await take(g, bug, (await g.get([held.entity.eid]))[0], mutate)
    }
  }
}
