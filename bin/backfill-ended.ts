// T-133617: a session is live until it has `session.ended`, so the sessions
// already over get the mark. Replies held for them are marked seen first, so
// the mark sends no months-old mail to project listeners. A session holding a
// claim is skipped. The next commit deletes this.
//
//   deno run -A bin/backfill-ended.ts CONFIG check|apply
import { compose } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { type Bundle, type Comp } from '@yaks/graph'
import { arrived, commented, deliver } from '../packages/session/listen.ts'
import { goneSessions } from '../packages/session/ended.ts'
import { claudeProjects, claudeRunning } from '../packages/session/files.ts'
import { stringify } from '@yaks/query'

let [config, mode = 'check'] = Deno.args
if (!config || !['check', 'apply'].includes(mode)) {
  throw Error('Usage: backfill-ended.ts CONFIG check|apply')
}
let actor = {
  by: '4431cca9-5405-49e9-960b-1722db3ec41b',
  via: '0bc899da-ec83-4405-bd06-c3279434a2a3',
}
let BATCH = 50
let host = await compose(read(config), ['graph'])
let g = host.graph
try {
  let t0 = performance.now()
  let holders = new Set(
    (await g.read('.claim.session .fields=claim.session')).map((b) =>
      String((b.claim as Comp).session)
    ),
  )
  let all = await goneSessions(g, {
    projects: claudeProjects(),
    running: claudeRunning(),
  })
  let gone = all.filter((eid) => !holders.has(eid))
  let over = new Set(gone)
  console.log(JSON.stringify({
    found: all.length,
    skippedHolders: all.length - gone.length,
    gone: gone.length,
    seconds: Math.round((performance.now() - t0) / 1000),
  }))

  let mail: Bundle[] = await g.read(stringify(arrived()))
  let comments: Bundle[] = await g.read(stringify(commented()))
  let to = (b: Bundle) =>
    String((b.mail as Comp)?.reply_to ?? (b.comment as Comp)?.target ?? '')
  let replies = [...mail, ...comments]
  let named = [...new Set(replies.map(to).filter(Boolean))]
  let writer = new Map<string, string>()
  for (let i = 0; i < named.length; i += 500) {
    for (let b of await g.get(named.slice(i, i + 500), ['created'])) {
      if (b) writer.set(b.entity.eid, String((b.created as Comp)?.via ?? ''))
    }
  }
  let held = replies.filter((b) => over.has(writer.get(to(b)) ?? ''))
  console.log(JSON.stringify({
    unsaidMail: mail.length,
    unsaidComments: comments.length,
    heldForGone: held.length,
  }))
  if (mode == 'apply') {
    let seen = 0
    for (let b of held) if (await deliver(g, actor, b)) seen++
    for (let i = 0; i < gone.length; i += BATCH) {
      await g.apply(
        gone.slice(i, i + BATCH).map((eid) => ({
          entity: { eid },
          session: { ended: true },
          $actor: actor,
        })),
        { trusted: true },
      )
    }
    console.log(JSON.stringify({
      seen,
      marked: gone.length,
      seconds: Math.round((performance.now() - t0) / 1000),
    }))
  }
} finally {
  await host.close()
}
