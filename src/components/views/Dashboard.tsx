import { awake, type Ent } from '../../types.ts'
import {
  backlinks,
  boardsOver,
  byWarmth,
  ent,
  jobOf,
  rows,
  unreadFor,
} from '../../live.ts'
import { block } from '../ui.tsx'
import { Entity } from '../Entity.tsx'

// The Project Cockpit (D-14587): a project's facets in a fixed grid —
// Boards · Inbox · Roles · Sessions · Lately — the same vocabulary in the
// same order on every project, so the eye learns one layout. Every cell is
// a LIVE QUERY rendered through the shared rows at summary density
// (--density, styles.css): membership is never stored, exactly as a
// board's isn't, and each row keeps Tile's click and menu contract —
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
            <Entity key={id} eid={id} view='Tile' />
          ))}
          {ids.length > CAP && <More>+{ids.length - CAP} more</More>}
        </Rows>
      )
      : <Empty>none</Empty>}
  </Cell>
)

// The sessions serving this project: through the task each one is ON
// (jobOf — the claim first, the managed request as fallback) or the role
// it serves; both walks end at an eid naming this project. Awake first.
let sessionsOf = (e: Ent) =>
  rows()
    .filter((r) => r.comps.session)
    .map((r) => ent(r.eid))
    .filter((s) => {
      let job = jobOf(s)
      let role = s.session?.role_eid
      return (job != null && ent(job).task?.project_eid == e.eid) ||
        (!!role && ent(role).role?.scope_eid == e.eid)
    })
    .sort((a, b) =>
      Number(awake(b.session!)) - Number(awake(a.session!)) || b.num - a.num
    )

// The roles scoped here, running first.
let rolesOf = (e: Ent) =>
  backlinks(e.eid)
    .filter((b) => b.via == 'role.scope_eid')
    .map((b) => ent(b.from))
    .sort((a, b) =>
      Number(b.role?.state == 'running') -
        Number(a.role?.state == 'running') || a.num - b.num
    )

// The digest's "lately", as a widget: the tasks homed here, warm first —
// settled ones included, because recent work IS the news.
let latelyOf = (e: Ent) =>
  backlinks(e.eid)
    .filter((b) => b.via == 'task.project_eid')
    .map((b) => ent(b.from))
    .filter((t) => !!t.task)
    .sort(byWarmth(Date.now()))

export let Dashboard = ({ e }: { e: Ent }) => (
  <Frame>
    <Facet name='boards' ids={boardsOver(e.eid)} />
    <Cell>
      <Name>
        inbox
        {unreadFor(e.eid) > 0 && <Badge>{unreadFor(e.eid)}</Badge>}
      </Name>
      <Entity eid={e.eid} view='Inbox' />
    </Cell>
    <Facet name='roles' ids={rolesOf(e).map((r) => r.eid)} />
    <Facet name='sessions' ids={sessionsOf(e).map((s) => s.eid)} />
    <Facet name='lately' ids={latelyOf(e).map((t) => t.eid)} />
  </Frame>
)
