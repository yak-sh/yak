import { useEffect, useRef } from 'preact/hooks'
import { signal } from '@preact/signals'
import {
  clientId,
  ent,
  mode,
  pinned,
  sessionDetail,
  sessionRows,
  shelfFor,
} from '../live.ts'
import { awake, type Session } from '../types.ts'
import { block } from './ui.tsx'
import { dragData } from './drag.ts'
import { Entity } from './Entity.tsx'
import { SessionDot } from './session_status.tsx'
import { Card, icons } from './Card.tsx'
import { Icon } from './icons.tsx'
import { shelfHost, shelfOpen, shelve } from './shelf.ts'
import { useQueryEids } from './useQuery.ts'

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

export let trayRecent = (s: Session, now = Date.now()) => {
  let at = s.finished_at || s.started_at
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

// Worth a slot: somebody is home (awake — the operator's own terminal
// counts, which is the point of asking the door and never the origin), or
// it moved recently and nobody has dismissed it. Graph-native sessions rest
// between turns without a process status, so their start is activity too.
let shown = (eid: string, s: Session) =>
  awake(s) ||
  (trayRecent(s) && !seen.value.includes(eid))

// LIVE: the digest a human wants without opening every session.
let started = (s: Session) => Date.parse(s.started_at ?? '') || 0

export let traySessions = (rows: [string, Session][]) =>
  rows.toSorted(([, a], [, b]) => started(b) - started(a))

let live = () =>
  traySessions(sessionRows().filter(([eid, session]) => shown(eid, session)))

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

// The open panel's rows. Its own component so its SUBSCRIPTION lives exactly as
// long as it is on screen: the strip's dots ride a projection carrying only the
// columns a dot decides by (live.ts sessionDots), and a rendered ROW needs more
// — the identity, model and effort SessionRow shows. So the panel holds the
// fuller projection of the SAME query, which is a different sub (projection is
// part of sub identity, D-22567 §3), and gives it back when it closes. A
// collapsed tray — the default — never asks for those columns at all.
let LiveRows = ({ ls }: { ls: [string, Session][] }) => {
  useQueryEids(sessionDetail)
  return (
    <Group>
      <Label>live</Label>
      {ls.map(([eid, s]) => (
        <Row
          mod='live'
          key={eid}
          draggable
          // no pin in the payload: a live row isn't shelved, so
          // dropping it on the canvas SPAWNS a session card
          onDragStart={(e: DragEvent) => dragData(e, eid, 'Session')}
        >
          <Entity eid={eid} view='Tray.List.Tile' />
          {
            /* only a settled run dismisses — a live one wants your
              eyes (stop it from its own view) */
          }
          {!awake(s) && (
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

  let ls = live()
  let shelf = shelfFor(clientId())
  let ps = shelf ? pinned(shelf).toSorted((a, b) => b.z - a.z) : []
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
          {ls.length > 0 && <LiveRows ls={ls} />}
          {!ls.length && <Hint>no live sessions</Hint>}
        </Panel>
      )}
    </Frame>
  )
}
