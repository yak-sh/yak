// Tracker bugs are evidence in another store. Their work lives here, with a
// derived task and about edge; task completion and fixer history decide what
// a replay owes without a private follower checkpoint.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { Client } from '@yaks/client'
import { link } from '@yaks/edge'
import { human } from '@yaks/id'
import { absent, and, eq, fields, list, present } from '@yaks/query'
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

// What a task neither completed nor cancelled is about.
let opened = and(
  present('about'),
  present('edge.from.task'),
  absent('edge.from.completed'),
  absent('edge.from.cancelled'),
  fields('edge.to'),
)

/** What the box's open work is about. Among it is every bug whose
 * resolution or archival still has a task to close, however long ago the bug
 * left its tracker's open answer, so a follower asks its trackers for these
 * by id rather than following every bug ever filed. */
export let owed = async (g: Graph): Promise<string[]> => [
  ...new Set(
    (await g.read(opened)).map((edge) => str(comp(edge, 'edge')?.to)),
  ),
]

// A later service pass can resend a mark while the headless client's unknown
// outcome is still queued. The same guarded intent must keep the same receipt;
// an opening after a regression is a different intent, even for the same task.
let mark = (mutate: Client['mutate'], rows: Bundle[], opening?: unknown) =>
  mutate(rows, {
    optimistic: false,
    key: `outbox:heal:${token([rows, opening ?? null])}`,
  })

// Each opening is news for the project, including a regression while fixer
// starts are paused. Its knock is the receipt a replay reads before sending.
let knockEid = (bug: Bundle) =>
  identityEid('heal_knock', [
    bug.entity.eid,
    ...bug.regressed ? [str(comp(bug, 'regressed')?.at)] : [],
  ])

let knock = (
  g: Graph,
  project: string | undefined,
  bug: Bundle,
  title: string,
  where: string,
): Bundle[] =>
  project && g.vocab.comp('knock')
    ? [{
      entity: { eid: knockEid(bug) },
      $was: { knock: { target: null } },
      knock: { target: project },
      doc: {
        title: '',
        body: `${bug.regressed ? 'Regressed bug' : 'New bug'}: ${
          title.length > 240 ? `${title.slice(0, 240)}…` : title
        } (${where})`,
      },
    }]
    : []

// A running fixer holding the bug's task has taken the bug, and the tracker
// tells the bug's letter thread. It is news once per opening: a bug with no
// `taken` mark, or one that came back after it, both times read off the
// tracker's own clock. A replay or a stale answer sends nothing new. A holder
// that is none of the bug's fixers has not taken it.
let take = async (
  g: Graph,
  bug: Bundle,
  task: Bundle | undefined,
  fixers: (bug: string) => Promise<Bundle[]>,
  mutate: Client['mutate'],
) => {
  let holder = str(comp(task, 'claim')?.session)
  if (!task || !holder || bug.resolved || bug.archived) return
  let back = moment(comp(bug, 'regressed')?.at)
  if (bug.taken && !(back > moment(comp(bug, 'taken')?.at))) return
  let fixer = (await fixers(bug.entity.eid))
    .find((f) => f.entity.eid == holder)
  if (!fixer || fixer.exit || fixer.native && !active(fixer)) return
  await mark(mutate, [{
    entity: { eid: bug.entity.eid },
    taken: { task: task.entity.num ? human(g.vocab)(task) : task.entity.eid },
  }], [bug.regressed ?? null, bug.taken ?? null])
}

/** Reconcile one tracker's answer a pass at a time: a pass reads the work of
 * all its bugs at once and answers how to reconcile each. The caller retries
 * either store's failed writes. */
export let follow = (
  g: Graph,
  options: Options & { trackers?: string[] } = {},
): (
  bugs: Bundle[],
  url: string,
  mutate: Client['mutate'],
) => Promise<(bug: Bundle) => Promise<void>> => {
  let decide = fixing(g, options)
  // What a decision reads off a task, never its computed components.
  let parts = ['task', 'doc', 'filed', 'claim', 'completed', 'cancelled']
    .filter((name) => g.vocab.comp(name))
  // A tracker graph has a page per bug. The platform's Worker answers only
  // signed reads, so its bugs open on a tracker web's side for them, and
  // without one they are read with a command.
  let base = (at: string) => at.replace(/\/$/, '')
  let web = options.trackers?.find((at) => /^https?:/.test(at))
  // What a fixer does last: resolve its bug in the tracker, explained, which
  // completes the task once the follower hears it. A bug is resolved only
  // with its explanation, so the fixer, who knows why, writes it.
  let last = (bug: string, url: string) => {
    // A harness's remote host must not redirect a bare box command. Keep the
    // configured command/config; only the platform tracker takes a source flag.
    let cli = `env -u YAKS_HOST ${options.cli ?? 'yak'}`
    let source = url == 'yaks.app' ? ' --source yaks.app' : ''
    return [
      `The authoritative tracker for this task is ${url}. ` +
      (source
        ? 'Use its explicit platform source below.'
        : 'Use the configured box tracker below, not the platform source. ' +
          'A resolution in another tracker does not complete this bug.'),
      'Once the fix is live, your last step is to resolve the bug with its ' +
      'explanation, which completes this task:',
      `${cli} bug resolve ${bug}${source} --broke '…' --cause '…' --since <sha> --fix <sha> --recur '…'`,
      'Read back the resolved state from this same tracker before reporting completion:',
      `${cli} bug show ${bug}${source}`,
      'The commands remove inherited YAKS_HOST defensively for a bare yak; an explicit --config already selects its graph.',
      'Write each for the owner in plain words, a sentence or two: what ' +
      'broke and whom it reached, why it broke, and whether it can come ' +
      'back. --since is the full sha of the commit that introduced it, left ' +
      'out when unknown; --fix the one that fixed it.',
      'Resolve it only once you have fixed its cause and seen the fix live. ' +
      'A bug that stopped, went quiet or passed on a rerun is not fixed: ' +
      'find why it happened and fix that.',
    ].join('\n\n')
  }
  return async (bugs, url, mutate) => {
    bugs = bugs.filter((bug) => bug.bug)
    let { fix, home, fixers } = decide(
      bugs.filter((bug) => !bug.resolved && !bug.archived)
        .map((bug) => bug.entity.eid),
    )
    // Where each bug's work item may be: a task an about edge links, or the
    // derived one. A pass writes only derived tasks and their edges, so one
    // read of the links serves the whole pass.
    let candidates = new Map<string, string[]>()
    let locate = async (evidence: string[]) => {
      if (!evidence.length) return
      let edges = await g.read(
        and(present('about'), eq('edge.to', list(...evidence))),
      )
      let from = new Map(evidence.map((eid) => [eid, [] as string[]]))
      for (let edge of edges) {
        from.get(str(comp(edge, 'edge')?.to))
          ?.push(str(comp(edge, 'edge')?.from))
      }
      for (let [eid, tasks] of from) {
        candidates.set(eid, [...new Set([...tasks, taskEid(eid)])])
      }
    }
    // The candidates as the pass found them, read together. A decision that
    // wrote, or failed to, reads its own again.
    let known = new Map<string, Bundle | undefined>()
    let taskIn = async (eids: string[]) => {
      let unread = eids.filter((eid) => !known.has(eid))
      if (unread.length) {
        let rows = await g.get(unread, parts)
        let found = new Map(rows.map((row) => [row.entity.eid, row]))
        for (let eid of unread) known.set(eid, found.get(eid))
      }
      return eids.map((eid) => known.get(eid)).find((row) => row?.task)
    }
    let announced = new Set(
      (await g.get(bugs.filter((bug) => bug.regressed).map(knockEid), [
        'knock',
      ]))
        .filter((row) => row.knock).map((row) => row.entity.eid),
    )
    let news = async (bug: Bundle) => {
      let project = await home()
      let evidence = bug.entity.eid
      let page = /^https?:/.test(url)
        ? `${base(url)}/${encodeURIComponent(evidence)}`
        : web && `${base(web)}${remoteBug(url, evidence)}`
      let where = page
        ? `[the tracker](${page})`
        : `${url}'s tracker: \`yak bug show ${evidence} --source ${url}\``
      let title = str(comp(bug, 'doc')?.title).split('\n')[0] ||
        'Fix tracker bug'
      return {
        project,
        where,
        title,
        knocks: knock(g, project, bug, title, where),
      }
    }
    // Whether the decision wrote the box.
    let reconcile = async (bug: Bundle, eids: string[]) => {
      let closed = false
      return await fix(async () => {
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
            closed = true
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
          return {
            task,
            bug: evidence,
            reopen,
            opening: str(comp(bug, 'regressed')?.at),
            open: true,
            last: last(evidence, url),
            writes: [
              ...reopen
                ? [{
                  entity: task.entity,
                  completed: null,
                  $was: {
                    completed: { at: token(comp(task, 'completed')?.at) },
                    cancelled: { at: token(comp(task, 'cancelled')?.at) },
                  },
                }]
                : [],
              ...bug.regressed && !announced.has(knockEid(bug))
                ? (await news(bug)).knocks
                : [],
            ],
          }
        }
        if (bug.resolved || bug.archived) return
        let { project, where, title, knocks } = await news(bug)
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
            ...knocks,
          ],
        }
      }) || closed
    }
    await locate(bugs.map((bug) => bug.entity.eid))
    await taskIn([...candidates.values()].flat())
    // The work commits first; telling the tracker a fixer took the bug comes
    // after, so a tracker that cannot take the mark yet (an older Worker
    // during a deploy) never holds back a fixer. A later pass sends what
    // failed. A bug the pass was not given is located alone.
    return async (bug: Bundle) => {
      if (!bug.bug) return
      if (!candidates.has(bug.entity.eid)) await locate([bug.entity.eid])
      let eids = candidates.get(bug.entity.eid)!
      let wrote = true
      try {
        wrote = await reconcile(bug, eids)
        if (wrote) announced.add(knockEid(bug))
      } finally {
        if (wrote) { for (let eid of eids) known.delete(eid) }
      }
      if (bug.resolved || bug.archived) return
      await take(g, bug, await taskIn(eids), fixers, mutate)
    }
  }
}
