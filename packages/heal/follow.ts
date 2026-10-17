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
import { active, fixing, type Options } from './fix.ts'

// Only the platform's tracker records failures in people's apps (tagged
// `source: app`); cancelling the task archives the platform's record alone.
let APP = ' If its occurrences are tagged `source: app`, it broke in a ' +
  "person's yaks app: fix yaks.app if yaks.app caused it, never change the " +
  "app, and if the app's own code did, cancel this task saying why."

/** One tracker bug always names the same work item. */
export let taskEid = (bug: string): string => identityEid('heal_task', [bug])

let comp = (row: Bundle | undefined, name: string) =>
  row?.[name] as Comp | undefined
let str = (value: unknown) => value == null ? '' : String(value)
let moment = (value: unknown) => Date.parse(str(value))

// A later service pass can resend a mark while the headless client's unknown
// outcome is still queued. The same guarded intent must keep the same receipt;
// an opening after a regression is a different intent, even for the same task.
let mark = (mutate: Client['mutate'], rows: Bundle[], opening?: unknown) =>
  mutate(rows, {
    optimistic: false,
    key: `outbox:heal:${token([rows, opening ?? null])}`,
  })

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
  if (
    !fixer || str(comp(fixer, 'fixer')?.bug) != bug.entity.eid || fixer.exit ||
    fixer.native && !active(fixer)
  ) return
  let back = moment(comp(bug, 'regressed')?.at)
  if (bug.taken && !(back > moment(comp(bug, 'taken')?.at))) return
  await mark(mutate, [{
    entity: { eid: bug.entity.eid },
    taken: { task: task.entity.num ? human(g.vocab)(task) : task.entity.eid },
  }], [bug.regressed ?? null, bug.taken ?? null])
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
  // Where the bug's work item may be: the derived task, or one an about edge
  // links. A pass writes only the derived task and its edge, so one read of
  // the links serves the whole pass.
  let linked = async (evidence: string) => {
    let edges = await g.read(and(present('about'), eq('edge.to', evidence)))
    let from = edges.map((edge) => str(comp(edge, 'edge')?.from))
    return [...new Set([...from, taskEid(evidence)])]
  }
  let taskIn = async (eids: string[]) =>
    (await g.get(eids)).find((row) => row.task)
  // What a fixer does last: resolve its bug in the tracker, explained, which
  // completes the task once the follower hears it. A bug is resolved only
  // with its explanation, so the fixer, who knows why, writes it.
  let last = (bug: string, url: string) =>
    [
      'Once the fix is live, your last step is to resolve the bug with its ' +
      'explanation, which completes this task:',
      `${options.cli ?? 'yak'} bug resolve ${bug}${
        /^https?:/.test(url) ? '' : ` --source ${url}`
      } --broke '…' --cause '…' --since <sha> --fix <sha> --recur '…'`,
      'Write each for the owner in plain words, a sentence or two: what ' +
      'broke and whom it reached, why it broke, and whether it can come ' +
      'back. --since is the full sha of the commit that introduced it, left ' +
      'out when unknown; --fix the one that fixed it. If nothing needed ' +
      'changing because it was a one-off, leave out --fix and say in ' +
      '--recur why it is believed to be one.',
    ].join('\n\n')
  let reconcile = (
    bug: Bundle,
    url: string,
    mutate: Client['mutate'],
    eids: string[],
  ) =>
    fix(async () => {
      let evidence = bug.entity.eid
      let eid = taskEid(evidence)
      let task = await taskIn(eids)
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
        // Cancelled work archives its bug. Completed work resolves nothing:
        // a resolution needs its explanation, which the resolver writes on
        // the bug itself, and that resolution completes the task above.
        if (task.cancelled) {
          await mark(mutate, [{
            entity: { eid: bug.entity.eid },
            archived: {},
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
          }])
        }
        if (task.cancelled || bug.resolved) return
        if (task.completed && !reopen) return
        return { task, bug: evidence, reopen, last: last(evidence, url) }
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
        doc: {
          title,
          body: `Fix the bug recorded at ${where}.${
            /^https?:/.test(url) ? '' : APP
          }`,
        },
        filed: { ...(project ? { project } : {}), priority: 1 },
        $was: { doc: { title: null } },
      }
      return {
        task,
        bug: evidence,
        last: last(evidence, url),
        writes: [
          task,
          link(eid, 'about', evidence),
          ...knock(g, project, evidence, title, where),
        ],
      }
    })
  // The work commits first; telling the tracker a fixer took the bug comes
  // after, so a tracker that cannot take the mark yet (an older Worker during
  // a deploy) never holds back a fixer. A later pass sends what failed.
  return async (bug: Bundle, url: string, mutate: Client['mutate']) => {
    if (!bug.bug) return
    let eids = await linked(bug.entity.eid)
    await reconcile(bug, url, mutate, eids)
    if (bug.resolved || bug.archived) return
    await take(g, bug, await taskIn(eids), mutate)
  }
}
