// Recover a native reply that left its claim open. A recovery input is durable
// and belongs to one claim. If its answer still leaves the claim open, keep
// the reply on the task and release the claim in one write.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { Host } from '@yaks/host'
import { human } from '@yaks/id'
import { line } from '@yaks/query'
import {
  currentStatus,
  openOf,
  reach,
  steered,
  workingChildren,
} from '@yaks/session'

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

type Report = Host['report']

// A comment-started session keeps its claim once it has answered the comment.
// Heal's follower owns the continuation of its fixer unless muted or stopped.
let candidates = async (g: Graph, session: string): Promise<Bundle[]> => {
  if (!g.vocab.comp('task') || !g.vocab.comp('native')) return []
  let [native] = await g.read(
    line`.entity.eid=${session}&.native&!session.ended&.fields=entity.eid,session.source`,
  )
  if (!native) return []
  let tasks = await g.read(
    line`.task&.claim.session=${session}&!completed&!cancelled&!blocked&.fields=entity,doc.title,claim.at`,
  )
  if (!tasks.length) return []
  let source = comp(native, 'session')?.source
  let [asked] = source ? await g.get([String(source)], ['comment']) : []
  let answering = comp(asked, 'comment')?.target
  let [fixer] = g.vocab.comp('fixer')
    ? await g.get([session], ['fixer', 'stop', 'exit'])
    : []
  let bug = comp(fixer, 'fixer')?.bug
  let open = []
  for (let task of tasks) {
    let id = task.entity.eid
    if (id == answering) {
      let [answer] = await g.read(
        line`.comment.target=${id}&.created.via=${session}&.fields=entity.eid&.limit=1`,
      )
      if (answer) continue
    }
    if (bug && !fixer?.stop && !fixer?.exit) {
      let [muted] = await g.read(
        line`.entity.eid=${id}&.filed.project.nofix&.fields=entity.eid`,
      )
      let [owned] = await g.read(
        line`.about&.edge.from=${id}&.edge.to=${
          String(bug)
        }&.fields=entity.eid&.limit=1`,
      )
      if (!muted && (owned || id == bug)) continue
    }
    let [waiting] = await g.read(
      line`(.requires|.contains)&.edge.from=${id}&.edge.to.task&!edge.to.completed&!edge.to.cancelled&.fields=entity.eid&.limit=1`,
    )
    if (!waiting) open.push(task)
  }
  return open
}

let guard = (session: string, task: Bundle): Bundle => ({
  entity: task.entity,
  $was: {
    claim: { session: token(session), at: token(comp(task, 'claim')?.at) },
    completed: { at: token(null) },
    cancelled: { at: token(null) },
    blocked: { since: token(null) },
  },
})

let recovery = (session: string, task: Bundle) =>
  derivedEid(
    `native-recovery|${session}|${task.entity.eid}|${comp(task, 'claim')?.at}`,
  )

let reminder = (
  g: Graph,
  session: string,
  task: Bundle,
  eid: string,
  heard: boolean,
): Bundle => ({
  entity: { eid },
  entry: { session },
  system: {},
  ...heard ? { heard: {} } : {},
  $was: { entry: { session: token(null) } },
  content: {
    body:
      `You still hold ${
        human(g.vocab)(task)
      }. If its requested work is complete, mark it done. ` +
      'Otherwise keep working. If you cannot continue, comment on the task with what you finished, ' +
      'what remains and the next step, then release its claim with claim_release. ' +
      'If it is waiting on a dependency, record the dependency on the task.',
  },
})

let handBack = async (
  g: Graph,
  report: Report,
  session: string,
  task: Bundle,
  reply: Bundle,
) => {
  let id = task.entity.eid
  let ask = String(comp(reply, 'output')?.source ?? reply.entity.eid)
  let eid = derivedEid(`native-unfinished|${session}|${id}|${ask}`)
  let [owner] = await g.get([session], ['filed', 'session'])
  let by = comp(owner, 'filed')?.project ?? comp(owner, 'session')?.persona ??
    comp(reply, 'created')?.by
  let body = String(comp(reply, 'content')?.body ?? '')
  await g.apply([
    { ...guard(session, task), claim: null },
    {
      entity: { eid: derivedEid(`native-handoff|${eid}`) },
      comment: { target: id },
      doc: {
        body:
          `The harness released this claim after the session ended with the task open. See session ${session}, reply ${reply.entity.eid}.` +
          (body
            ? '\n\n' + body.split('\n').map((s) => `> ${s}`).join('\n')
            : ''),
      },
      $actor: { ...by ? { by: String(by) } : {}, via: session },
    },
  ], { trusted: true })
  await report?.(
    new Error(
      `Native session settled with unfinished claimed work: ${
        String(comp(task, 'doc')?.title ?? id)
      }`,
    ),
    {
      eid,
      during: { session, entity: id },
      tags: { step: ask, condition: 'settled-unfinished' },
    },
  )
}

/** Ask once for each open claim, then hand it back if the session still ends
 * with it. Pending tool results and working children can wake the session on
 * their own. Completed, blocked and explicitly released work is left alone. */
export let recoverSettled = (g: Graph, report?: Report) => {
  let recover = async (session: string): Promise<boolean> => {
    let tasks = await candidates(g, session)
    if (!tasks.length) return false
    if (
      await workingChildren(g, session, true) ||
      (await openOf(g, session)).length
    ) return false
    let [reply] = await g.read(
      line`.entry.session=${session}&.output&.content&!result&!reasoning&!notice&!lines&.order=-entry.seq&.limit=1&.fields=entity.eid,output.source,content.body,created.by`,
    )
    if (!reply || await currentStatus(g, session) != 'settled') return false
    let owed: [Bundle, string][] = []
    let used: Bundle[] = []
    for (let task of tasks) {
      let eid = recovery(session, task)
      let [sent] = await g.get([eid], ['entry'])
      if (sent?.entry) used.push(task)
      else owed.push([task, eid])
    }
    try {
      if (owed.length) {
        let heard = steered(await reach(g, session, { call: true }), undefined)
        if (await currentStatus(g, session) != 'settled') return true
        await g.apply(
          owed.flatMap(([task, eid]) => [
            guard(session, task),
            reminder(g, session, task, eid, heard),
          ]),
          { trusted: true },
        )
        return true
      }
      for (let task of used) await handBack(g, report, session, task, reply)
    } catch (error) {
      if (!(error instanceof Stale)) throw error
      return await currentStatus(g, session) != 'settled' ||
        await recover(session)
    }
    return false
  }
  return recover
}
