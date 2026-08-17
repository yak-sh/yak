// The Usage view on a project card: what the agent work homed here cost and
// how fast it ran. A pure READ over usage.ts — it projects the token counts
// already stamped on the project's settled sessions (each reached through its
// requested_task → task.project, the same edge the Dashboard walks) and rolls
// them up by model. Membership is never stored: a session shows here because it
// worked a task of this project, so the view can't drift. Absent beats zero —
// an unreported facet reads `—`, never 0, and an unpriced model shows no cost.
import { type Ent, sessionOf } from '../../types.ts'
import { ent } from '../../live.ts'
import { useQuery } from '../useQuery.ts'
import { report, type Use, use } from '../../usage.ts'
import { block } from '../ui.tsx'

let Frame = block('section', 'Usage', {
  Head: 'header',
  Table: 'pre',
  Empty: 'div',
})
let { Head, Table, Empty } = Frame

export let Usage = ({ e }: { e: Ent }) => {
  // Every session, screened to those that worked a task homed on this project.
  let sessions = useQuery('.session!')
  let uses: Use[] = []
  for (let s of sessions) {
    let task = s.session?.requested_task
    if (!task || ent(task).task?.project != e.eid) continue
    let u = use(sessionOf(s)!)
    if (u) uses.push(u)
  }
  return (
    <Frame>
      <Head>usage · by model</Head>
      {uses.length
        ? <Table>{report(uses, 'model')}</Table>
        : <Empty>no settled sessions with usage yet</Empty>}
    </Frame>
  )
}
