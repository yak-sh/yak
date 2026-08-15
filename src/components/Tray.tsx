import { useEffect, useRef } from 'preact/hooks'
import { signal } from '@preact/signals'
import {
  cache,
  clientId,
  ent,
  mode,
  mutate,
  pinned,
  sessionRows,
  shelfFor,
  topZ,
  uuid,
} from '../live.ts'
import { awake, type Session } from '../types.ts'
import { block } from './ui.tsx'
import { Icon } from './icons.tsx'
import { icons } from './Card.tsx'
import { dragData } from './drag.ts'
import { Entity } from './Entity.tsx'
import { SessionDot } from './session_status.tsx'

// The Tray ("the Shelf"): the statusbar's right end. The strip — one
// status dot per LIVE session, one view icon per shelved card — lives IN
// the bar; clicking it opens a panel anchored above with the full rows.
// LIVE is the digest of runs that want your eyes; the SHELF is a
// per-client scratch canvas you drag cards onto and out of.

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

// The mounted tray, for drop hit-testing. A titlebar drag asks overTray
// on release: the strip in the bar and the open panel both catch.
let mounted: HTMLElement | null = null
export let overTray = (x: number, y: number) => {
  if (!mounted) return false
  return [mounted, ...mounted.querySelectorAll('.Tray_Panel')]
    .map((n) => n.getBoundingClientRect())
    .some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
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
let live = () => sessionRows().filter(([eid, session]) => shown(eid, session))

// This client's shelf canvas, if it's been born — the canvas tagged with a
// shelf pointing back at us. null until the first drop mints one.
export let shelf = () => shelfFor(clientId()) ?? null

// Mint the shelf on first use: a canvas plus the tag binding it to us.
export let shelfMint = () => {
  let eid = uuid()
  mutate(
    { eid, name: 'canvas', comp: { eid } },
    { eid, name: 'shelf', comp: { eid, client: clientId() } },
  )
  return eid
}

let Frame = block('div', 'Tray', {
  Strip: 'button',
  Chevron: 'span',
  Panel: 'div',
  Group: 'section',
  Label: 'span',
  Row: 'div',
  X: 'button',
  Hint: 'div',
})
let { Strip, Chevron, Panel, Group, Label, Row, X, Hint } = Frame

// Drop a card payload onto the shelf: repin an existing card ({pin} in the
// payload) or mint a fresh card+pin for the target. The shelf is born here,
// never on render.
let dropIn = (ev: DragEvent) => {
  let data = ev.dataTransfer?.getData('application/x-tasks-card')
  if (!data) return
  ev.preventDefault()
  let { target, view, pin } = JSON.parse(data)
  let sh = shelf() ?? shelfMint()
  let z = topZ(sh) + 1
  if (pin && cache.value[pin]?.pin) {
    mutate({
      eid: pin,
      name: 'pin',
      comp: { canvas: sh, x: 0, y: 0, w: 0, h: 0, z },
    })
    return
  }
  let card = uuid()
  mutate(
    { eid: card, name: 'card', comp: { eid: card, target, view } },
    {
      eid: card,
      name: 'pin',
      comp: { eid: card, canvas: sh, x: 0, y: 0, w: 0, h: 0, z },
    },
  )
}

// Only our own card payload should keep the tray a drop target.
let over = (ev: DragEvent) => {
  if (ev.dataTransfer?.types.includes('application/x-tasks-card')) {
    ev.preventDefault()
  }
}

export let Tray = () => {
  let root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    mounted = root.current
    let key = (e: KeyboardEvent) => {
      let typing = e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      let modified = e.metaKey || e.ctrlKey || e.altKey
      if (trayKey(e.key, e.repeat, typing, modified)) e.preventDefault()
    }
    addEventListener('keydown', key)
    return () => {
      mounted = null
      removeEventListener('keydown', key)
    }
  }, [])

  let ls = live()
  let sh = shelf()
  let ps = sh ? pinned(sh).toSorted((a, b) => b.z - a.z) : []

  return (
    <Frame elRef={root} onDragOver={over} onDrop={dropIn}>
      <Strip
        type='button'
        aria-label={trayOpen.value ? 'close tray' : 'open tray'}
        onClick={() => toggle(!trayOpen.value)}
      >
        {ls.map(([eid]) => <SessionDot key={eid} e={ent(eid)} />)}
        {ps.map((p) => (
          <Icon
            key={p.eid}
            name={icons[p.view] ?? 'file-text'}
          />
        ))}
        <Chevron>{trayOpen.value ? '⌄' : '⌃'}</Chevron>
      </Strip>
      {trayOpen.value && (
        <Panel>
          {ls.length > 0 && (
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
          )}
          {ps.length > 0 && (
            <Group>
              <Label>shelf</Label>
              {ps.map((p) => (
                <Row
                  key={p.eid}
                  draggable
                  onDragStart={(e: DragEvent) =>
                    dragData(e, p.target, p.view, p.w, p.eid)}
                >
                  <Entity eid={p.target} view='List.Tile' />
                  <X
                    type='button'
                    aria-label='remove'
                    onClick={() =>
                      mutate({ eid: p.eid, name: 'entity', comp: null })}
                  >
                    ×
                  </X>
                </Row>
              ))}
            </Group>
          )}
          {!ls.length && !ps.length && <Hint>drop things here</Hint>}
        </Panel>
      )}
    </Frame>
  )
}
