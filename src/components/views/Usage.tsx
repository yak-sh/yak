// The Usage view on a project card: what the agent work homed here cost and
// how fast it ran. A pure READ over usage.ts — it projects the token counts
// already stamped on the project's settled sessions (each reached through its
// requested_task → filed.project, the same edge the Dashboard walks) and rolls
// them up by model. Membership is never stored: a session shows here because it
// worked a task of this project, so the view can't drift. Absent beats zero —
// an unreported facet reads `—`, never 0, and an unpriced model shows no cost.
import { type Ent, sessionOf } from '../../types.ts'
import { ent } from '../../live.ts'
import { useQueryResult } from '../useQuery.ts'
import { SubscriptionFailure } from '../SubscriptionFailure.tsx'
import { report, type Use, use } from '../../usage.ts'
import { block } from '../ui.tsx'

let Frame = block('section', 'Usage', {
  Head: 'header',
  Table: 'pre',
  Empty: 'div',
})
let { Head, Table, Empty } = Frame

// Exactly what use() reads off a session (usage.ts) plus the requested_task the
// screen below walks — a PROJECTION, so the one view that legitimately wants
// usage_json still leaves final_text, stderr, transcript and the whole
// created/updated/worktree provenance off the wire (D-22567 §3).
let usageFields = '.session!&.fields=' + [
  'session.id',
  'session.usage_json',
  'session.provider',
  'session.model',
  'session.serving_model',
  'session.persona',
  'session.requested_task',
  'session.started_at',
  'session.finished_at',
  'spawn.provider',
  'spawn.model',
  'spawn.persona',
].join(',')

export let usageQuery = (project: string) =>
  usageFields + `&.session.requested_task.filed.project=${project}`

export let Usage = ({ e }: { e: Ent }) => {
  // Every session, screened to those that worked a task homed on this project.
  let read = useQueryResult(usageQuery(e.eid))
  let sessions = read.eids.map(ent)
  let uses: Use[] = []
  for (let s of sessions) {
    let u = use(sessionOf(s)!)
    if (u) uses.push(u)
  }
  return (
    <Frame>
      <Head>usage · by model</Head>
      {read.subscription?.state.status == 'failed'
        ? <SubscriptionFailure read={read.subscription} />
        : !read.ready
        ? <Empty>Loading usage…</Empty>
        : uses.length
        ? <Table>{report(uses, 'model')}</Table>
        : <Empty>no settled sessions with usage yet</Empty>}
    </Frame>
  )
}
