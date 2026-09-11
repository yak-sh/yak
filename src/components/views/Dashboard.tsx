import { awake, type Ent } from '../../types.ts'
import { ent, sessionDetail } from '../../live.ts'
import { block } from '../ui.tsx'
import { Entity } from '../Entity.tsx'
import { useQueryResult } from '../useQuery.ts'
import { useInboxCount } from '../useInbox.ts'
import { SubscriptionFailure } from '../SubscriptionFailure.tsx'
import type { QueryResult } from '../useQuery.ts'

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
  { name, ids, badge, reads = [] }: {
    name: string
    ids: string[]
    badge?: number
    reads?: QueryResult[]
  },
) => (
  <Cell>
    <Name>
      {name}
      {(badge ?? 0) > 0 && <Badge>{badge}</Badge>}
    </Name>
    {reads.some((r) => r.subscription?.state.status == 'failed')
      ? reads.map((r) =>
        r.subscription && (
          <SubscriptionFailure key={r.subscription.sub} read={r.subscription} />
        )
      )
      : reads.some((r) => !r.ready)
      ? <Empty>Loading…</Empty>
      : ids.length
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
export let sessionsOf = (
  e: Ent,
  sessions: Ent[],
  claims: Ent[],
  requested: Set<string>,
  roles: Set<string>,
) => {
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
      let job = jobs.get(s.eid)
      return (job ? job.filed?.project == e.eid : requested.has(s.eid)) ||
        roles.has(s.eid)
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

export let Dashboard = ({ e }: { e: Ent }) => {
  // The sessions facet screens EVERY session down to the few serving this
  // project, then renders them as rows — so it asks for the row columns and
  // none of the history behind them (live.ts sessionDetail; unprojected this
  // one query was 6.22 MB).
  let boards = useQueryResult(`.board.query~=${e.eid}`)
  let sessions = useQueryResult(sessionDetail)
  let claims = useQueryResult(
    '.claim!&.fields=task.status,claim.session,claim.claimed_at,filed.project',
  )
  let requested = useQueryResult(
    `.session.requested_task.filed.project=${e.eid}&.fields=session.id`,
  )
  let serving = useQueryResult(
    `.session.role.role.scope=${e.eid}&.fields=session.id`,
  )
  let roles = useQueryResult(`.role.scope=${e.eid}`)
  // This facet paints eight rows, so stream only its eight warmest. Fetching
  // every task in every project card made the root canvas discard megabytes.
  let tasks = useQueryResult(
    `.filed.project=${e.eid}&.order=hot&.limit=${CAP}`,
  )
  let unread = useInboxCount(e.eid)
  return (
    <Frame>
      <Facet name='boards' ids={boards.eids} reads={[boards]} />
      <Cell>
        <Name>
          inbox
          {unread != null && unread > 0 && <Badge>{unread}</Badge>}
        </Name>
        <Entity eid={e.eid} view='Inbox' limit={CAP} />
      </Cell>
      <Facet
        name='roles'
        reads={[roles]}
        ids={rolesOf(roles.eids.map(ent)).map((r) => r.eid)}
      />
      <Facet
        name='sessions'
        reads={[sessions, claims, requested, serving]}
        ids={sessionsOf(
          e,
          sessions.eids.map(ent),
          claims.eids.map(ent),
          new Set(requested.eids),
          new Set(serving.eids),
        ).map((s) => s.eid)}
      />
      <Facet name='lately' reads={[tasks]} ids={tasks.eids} />
    </Frame>
  )
}
