import { useEffect, useRef } from 'preact/hooks'
import { signal } from '@preact/signals'
import {
  clientId,
  ent,
  mode,
  pinned,
  sessionDetail,
  shelfFor,
} from '../live.ts'
import type { Ent } from '../types.ts'
import { leaseEid } from '../../effects/lease.ts'
import { block } from '@yaks/ui'
import { dragData } from './drag.ts'
import { Entity } from './Entity.tsx'
import { SessionDot } from './session_status.tsx'
import { Card, icons } from './Card.tsx'
import { useEntity, usePinTargets } from './subscriptions.ts'
import { Icon } from './icons.tsx'
import { shelfHost, shelfOpen, shelve } from './shelf.ts'
import { useQueryEids } from './useQuery.ts'
import {
  trayActiveQuery,
  trayProcessQuery,
  trayRecentQuery,
} from '../tray_query.ts'

// The Tray is bottom-right screen chrome: live-session attention plus a
// per-client Shelf. A shelved entity is a normal Card while open and one icon
// while minimized; navigation remains the durable place-finding surface.

// Collapsed vs expanded, remembered across visits (default collapsed).
export let trayOpen = signal(
  globalThis.localStorage?.getItem('tasks-tray') == 'open',
)
let toggle = (v: boolean) => {
  trayOpen.value = v
  globalThis.localStorage?.setItem('tasks-tray', v ? 'open' : 'shut')
}

export let trayKey = (
  key: string,
  repeat = false,
  typing = false,
  modified = false,
) => {
  if (mode.value != 'normal' || repeat || typing || modified || key != 't') {
    return false
  }
  toggle(!trayOpen.value)
  return true
}

// A run stays worth showing for a while around its latest activity.
let RECENT = 6 * 60 * 60 * 1000

export let trayRecent = (e: Ent, now = Date.now()) => {
  let at = e.created?.at
  return !!at && now - Date.parse(at) < RECENT
}

// Dismissed rows — "seen", per browser. The ✕ on a settled row lands its
// eid here; the session entity is history and never touched. A signal so
// the strip and panel repaint on dismiss; localStorage so it sticks.
let seen = signal<string[]>(
  JSON.parse(globalThis.localStorage?.getItem('tasks-tray-seen') ?? '[]'),
)
let dismiss = (eid: string) => {
  seen.value = [...seen.value, eid].slice(-100)
  localStorage.setItem('tasks-tray-seen', JSON.stringify(seen.value))
}

// A transcript's status is history, not evidence that its runner is alive.
// A lease is a separate entity; its deadline also has to be checked locally,
// since expiration need not produce a graph write.
type RunnerLease = { holder?: string; until?: string }
let leases = signal<Record<string, RunnerLease>>({})

export let trayLive = (e: Ent, lease?: RunnerLease, now = Date.now()) =>
  (!!lease?.holder && !!lease.until && Date.parse(lease.until) > now) ||
  (!!e.process?.pid && !e.exit)

// Each candidate owns a narrow subscription, rather than subscribing to all
// leases (or calling a hook in a variable-length loop).
let LeaseWatch = ({ eid }: { eid: string }) => {
  let lease = useEntity(
    leaseEid(`@yaks/session/run/${eid}`),
    'lease.holder,lease.until',
  )?.value?.lease
  let holder = lease?.holder
  let until = lease?.until
  // Do not keep a former candidate's lease in the tray after its watcher goes.
  useEffect(() => () => {
    if (eid in leases.value) {
      let next = { ...leases.value }
      delete next[eid]
      leases.value = next
    }
  }, [eid])
  useEffect(() => {
    if (holder && until) {
      leases.value = { ...leases.value, [eid]: { holder, until } }
    } else if (eid in leases.value) {
      let next = { ...leases.value }
      delete next[eid]
      leases.value = next
    }
    let delay = until ? Date.parse(until) - Date.now() : NaN
    let timer = Number.isFinite(delay) && delay > 0
      ? setTimeout(() => {
        if (leases.value[eid]?.until == until) {
          let next = { ...leases.value }
          delete next[eid]
          leases.value = next
        }
      }, Math.min(delay, 2147483647))
      : undefined
    return () => clearTimeout(timer)
  }, [eid, holder, until])
  return null
}

export let trayShown = (
  eid: string,
  e: Ent,
  lease = leases.value[eid],
  now = Date.now(),
) =>
  trayLive(e, lease, now) || (trayRecent(e, now) && !seen.value.includes(eid))

// Live sessions first, then recent sessions, each newest first.
let started = (e: Ent) => Date.parse(e.created?.at ?? '') || 0

export let traySessions = (
  rows: [string, Ent][],
  current: Record<string, RunnerLease> = leases.value,
  now = Date.now(),
) =>
  rows.toSorted(([aid, a], [bid, b]) =>
    Number(trayLive(b, current[bid], now)) -
      Number(trayLive(a, current[aid], now)) || started(b) - started(a)
  )

let useLive = () => {
  let active = useQueryEids(trayActiveQuery, true)
  let process = useQueryEids(trayProcessQuery, true)
  let recent = useQueryEids(trayRecentQuery, true)
  let ids = [...new Set([...active, ...process, ...recent])]
  return {
    ids,
    rows: traySessions(ids.flatMap((eid) => {
      let e = ent(eid)
      return e.session && trayShown(eid, e) ? [[eid, e] as [string, Ent]] : []
    })),
  }
}

let Frame = block('div', 'Tray', {
  Strip: 'div',
  Live: 'button',
  Items: 'span',
  Item: 'button',
  Dots: 'span',
  Chevron: 'span',
  Panel: 'div',
  Pop: 'div',
  Group: 'section',
  Label: 'span',
  Row: 'div',
  X: 'button',
  Hint: 'div',
})
let {
  Strip,
  Live,
  Items,
  Item,
  Dots,
  Chevron,
  Panel,
  Pop,
  Group,
  Label,
  Row,
  X,
  Hint,
} = Frame

let over = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('application/x-tasks-card')) {
    e.preventDefault()
  }
}

let drop = (e: DragEvent) => {
  let data = e.dataTransfer?.getData('application/x-tasks-card')
  if (!data) return
  e.preventDefault()
  let { target, view, pin } = JSON.parse(data)
  shelve(target, view, pin)
}

// The open panel's rows. Its own component so its subscription lives exactly as
// long as it is on screen: the strip's dots ride a projection carrying only the
// columns a dot decides by (live.ts sessionDots), and a rendered ROW needs more
// — the work SessionRow shows. So the panel holds the
// fuller projection of the selected eids, which is a different sub, and gives
// it back when it closes. A
// collapsed tray — the default — never asks for those columns at all.
let SessionGroup = (
  { label, ls }: { label: 'live' | 'recent'; ls: [string, Ent][] },
) => (
  <Group>
    <Label>{label}</Label>
    {ls.map(([eid, s]) => (
      <Row
        mod='session'
        key={eid}
        draggable
        // no pin in the payload: a session row isn't shelved, so
        // dropping it on the canvas spawns a session card
        onDragStart={(e: DragEvent) => dragData(e, eid, 'Session')}
      >
        <Entity eid={eid} view='Tray.List.Tile' />
        {!trayLive(s, leases.value[eid]) && (
          <X
            type='button'
            aria-label='dismiss'
            onClick={(e: MouseEvent) => {
              e.stopPropagation()
              dismiss(eid)
            }}
          >
            ×
          </X>
        )}
      </Row>
    ))}
  </Group>
)

export let SessionRows = ({ ls }: { ls: [string, Ent][] }) => {
  useQueryEids(
    `.eid=${ls.map(([eid]) => eid).join(',')}&` +
      sessionDetail.split('&')[1] +
      '&.edges[worked]&.edges.peers=doc.title,task.status',
    true,
  )
  let live = ls.filter(([eid, s]) => trayLive(s, leases.value[eid]))
  let recent = ls.filter(([eid, s]) => !trayLive(s, leases.value[eid]))
  return (
    <>
      {live.length > 0 && <SessionGroup label='live' ls={live} />}
      {recent.length > 0 && <SessionGroup label='recent' ls={recent} />}
    </>
  )
}

export let Tray = () => {
  let root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    shelfHost(root.current)
    let key = (e: KeyboardEvent) => {
      let typing = e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      let modified = e.metaKey || e.ctrlKey || e.altKey
      if (trayKey(e.key, e.repeat, typing, modified)) e.preventDefault()
    }
    addEventListener('keydown', key)
    return () => {
      shelfHost(null)
      removeEventListener('keydown', key)
    }
  }, [])

  let { ids, rows: ls } = useLive()
  let shelf = shelfFor(clientId())
  let ps = shelf ? pinned(shelf).toSorted((a, b) => b.z - a.z) : []
  // Shelved cards are painted as chips, not Cards, so the tray holds their
  // targets — the boot no longer preseeds what a card points at (T-22371).
  usePinTargets(ps)
  let open = ps.find((p) => p.eid == shelfOpen.value)

  return (
    <Frame elRef={root} onDragOver={over} onDrop={drop}>
      {open && (
        <Pop>
          <Card
            p={open}
            docked
            onMinimize={() => shelfOpen.value = null}
          />
        </Pop>
      )}
      {ids.map((eid) => <LeaseWatch key={eid} eid={eid} />)}
      <Strip>
        <Live
          type='button'
          aria-label={trayOpen.value ? 'close tray' : 'open tray'}
          onClick={() => toggle(!trayOpen.value)}
        >
          <Dots>
            {ls.map(([eid]) => <SessionDot key={eid} e={ent(eid)} />)}
          </Dots>
          <Chevron>{trayOpen.value ? '⌄' : '⌃'}</Chevron>
        </Live>
        <Items>
          {ps.map((p) => (
            <Item
              key={p.eid}
              type='button'
              mod={p.eid == open?.eid && 'open'}
              aria-label={`open ${
                ent(p.target).doc?.title ?? ent(p.target).kind
              }`}
              onClick={() =>
                shelfOpen.value = p.eid == open?.eid ? null : p.eid}
            >
              <Icon name={icons[p.view] ?? 'file-text'} />
            </Item>
          ))}
        </Items>
      </Strip>
      {trayOpen.value && (
        <Panel>
          {ls.length > 0 && <SessionRows ls={ls} />}
          {!ls.length && <Hint>no sessions</Hint>}
        </Panel>
      )}
    </Frame>
  )
}
