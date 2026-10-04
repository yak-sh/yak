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
import { block } from '@yaks/ui'
import { dragData } from './drag.ts'
import { Entity } from './Entity.tsx'
import { SessionDot } from './session_status.tsx'
import { Card, icons } from './Card.tsx'
import { usePinTargets } from './subscriptions.ts'
import { Icon } from './icons.tsx'
import { shelfHost, shelfOpen, shelve } from './shelf.ts'
import { useQueryEids } from './useQuery.ts'
import { allSessionsPath } from '../tray_query.ts'
import { type RunnerLease, trayLive } from '../sessions.ts'
import { useSessions } from './useSessions.ts'
import { follow } from './nav.tsx'

export { trayLive, traySessions } from '../sessions.ts'

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

export let trayShown = (
  eid: string,
  e: Ent,
  lease?: RunnerLease,
  now = Date.now(),
) => trayLive(e, lease, now) || !seen.value.includes(eid)

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
  All: 'a',
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
  All,
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
  { label, ls, leases }: {
    label: 'live' | 'recent'
    ls: [string, Ent][]
    leases: Record<string, RunnerLease>
  },
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
        {!trayLive(s, leases[eid]) && (
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

export let SessionRows = (
  { ls, leases = {} }: {
    ls: [string, Ent][]
    leases?: Record<string, RunnerLease>
  },
) => {
  useQueryEids(
    `${sessionDetail}&.entity.eid=${ls.map(([eid]) => eid).join(',')}` +
      '&.edges[worked]&.edges.peers=doc.title,task.status',
    true,
  )
  let live = ls.filter(([eid, s]) => trayLive(s, leases[eid]))
  let recent = ls.filter(([eid, s]) => !trayLive(s, leases[eid]))
  return (
    <>
      {live.length > 0 && (
        <SessionGroup label='live' ls={live} leases={leases} />
      )}
      {recent.length > 0 && (
        <SessionGroup label='recent' ls={recent} leases={leases} />
      )}
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

  let { rows, leases } = useSessions()
  let ls = rows.filter(([eid, e]) => trayShown(eid, e, leases[eid]))
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
        <All href={allSessionsPath} onClick={follow(allSessionsPath)}>
          All sessions
        </All>
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
          {ls.length > 0 && <SessionRows ls={ls} leases={leases} />}
          {!ls.length && <Hint>no sessions</Hint>}
        </Panel>
      )}
    </Frame>
  )
}
