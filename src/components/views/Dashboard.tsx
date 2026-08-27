import { awake, type Ent } from '../../types.ts'
import { boardsOver, byWarmth, ent, sessionDetail } from '../../live.ts'
import { block } from '../ui.tsx'
import { Entity } from '../Entity.tsx'
import { useQuery } from '../useQuery.ts'
import { useInbox } from '../useInbox.ts'
import { isUnread } from '../../client.ts'

// The Project Cockpit (D-14587): a project's facets in a fixed grid —
// Boards · Inbox · Roles · Sessions · Lately — the same vocabulary in the
// same order on every project, so the eye learns one layout. Every cell is
// a LIVE QUERY rendered through the shared rows at summary density
// (--density, styles.css): membership is never stored, exactly as a
// board's isn't, and each row keeps List.Tile's click and menu contract —
// the cockpit arranges renderers, it adds none.

let Frame = block('div', 'Dash', {
  Cell: 'section',
  Name: 'h2',
  Badge: 'span',
  Rows: 'div',
  More: 'div',
  Empty: 'div',
})
let { Cell, Name, Badge, Rows, More, Empty } = Frame

// Enough to glance; the facet's own view holds the rest.
let CAP = 8

let Facet = (
  { name, ids, badge }: { name: string; ids: string[]; badge?: number },
) => (
  <Cell>
    <Name>
      {name}
      {(badge ?? 0) > 0 && <Badge>{badge}</Badge>}
    </Name>
    {ids.length
      ? (
        <Rows>
          {ids.slice(0, CAP).map((id) => (
            <Entity key={id} eid={id} view='List.Tile' />
          ))}
          {ids.length > CAP && <More>+{ids.length - CAP} more</More>}
        </Rows>
      )
      : <Empty>none</Empty>}
  </Cell>
)

// The sessions serving this project: through the task each one is ON
// (the newest claim first, the managed request as fallback) or the role it
// serves; both walks end at an eid naming this project. Awake first.
let sessionsOf = (e: Ent, sessions: Ent[], claims: Ent[]) => {
  let jobs = new Map<string, Ent>()
  for (let task of claims) {
    if (!task.task || !task.claim) continue
    let prior = jobs.get(task.claim.session)
    if (
      !prior || String(task.claim.claimed_at ?? '') >
        String(prior.claim?.claimed_at ?? '')
    ) jobs.set(task.claim.session, task)
  }
  return sessions
    .filter((s) => {
      let job = jobs.get(s.eid)?.eid ?? s.session?.requested_task
      let role = s.session?.role
      return (job != null && ent(job).task?.project == e.eid) ||
        (!!role && ent(role).role?.scope == e.eid)
    })
    .sort((a, b) =>
      Number(awake(b.session!)) - Number(awake(a.session!)) || b.num - a.num
    )
}

// The roles scoped here, running first.
let rolesOf = (roles: Ent[]) =>
  roles
    .toSorted((a, b) =>
      Number(b.role?.state == 'running') -
        Number(a.role?.state == 'running') || a.num - b.num
    )

// The digest's "lately", as a widget: the tasks homed here, warm first —
// settled ones included, because recent work IS the news.
let latelyOf = (tasks: Ent[]) => tasks.toSorted(byWarmth(Date.now()))

export let Dashboard = ({ e }: { e: Ent }) => {
  // The sessions facet screens EVERY session down to the few serving this
  // project, then renders them as rows — so it asks for the row columns and
  // none of the history behind them (live.ts sessionDetail; unprojected this
  // one query was 6.22 MB).
  let sessions = useQuery(sessionDetail)
  let claims = useQuery('.claim!')
  let roles = useQuery(`.role.scope=${e.eid}`)
  let tasks = useQuery(`.task.project=${e.eid}`)
  let unread = useInbox(e.eid).filter(isUnread).length
  return (
    <Frame>
      <Facet name='boards' ids={boardsOver(e.eid)} />
      <Cell>
        <Name>
          inbox
          {unread > 0 && <Badge>{unread}</Badge>}
        </Name>
        <Entity eid={e.eid} view='Inbox' limit={CAP} />
      </Cell>
      <Facet name='roles' ids={rolesOf(roles).map((r) => r.eid)} />
      <Facet
        name='sessions'
        ids={sessionsOf(e, sessions, claims).map((s) => s.eid)}
      />
      <Facet name='lately' ids={latelyOf(tasks).map((t) => t.eid)} />
    </Frame>
  )
}
