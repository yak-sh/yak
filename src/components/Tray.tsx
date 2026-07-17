import { useEffect, useRef } from 'preact/hooks'
import { signal } from '@preact/signals'
import { cache, clientId, ent, mutate, pinned, topZ, uuid } from '../live.ts'
import { idOf, sessionActive } from '../types.ts'
import { block } from './ui.tsx'
import { Dot } from './Dot.tsx'
import { Icon } from './icons.tsx'
import { icons } from './Card.tsx'
import { navigate } from './nav.tsx'
import { dragData, View } from './View.tsx'

// The Tray ("the Shelf"): the statusbar's right end. The strip — one
// status dot per LIVE session, one view icon per shelved card — lives IN
// the bar; clicking it opens a panel anchored above with the full rows.
// LIVE is the digest of runs that want your eyes; the SHELF is a
// per-client scratch canvas you drag cards onto and out of.

// Collapsed vs expanded, remembered across visits (default collapsed).
let expanded = signal(
  globalThis.localStorage?.getItem('tasks-tray') == 'open',
)
let toggle = (v: boolean) => {
  expanded.value = v
  localStorage.setItem('tasks-tray', v ? 'open' : 'shut')
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

// A managed run stays worth showing for a while after it ends.
let RECENT = 6 * 60 * 60 * 1000

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

// LIVE: sessions still running, plus managed ones that finished recently
// and haven't been dismissed — the digest a human wants without opening
// every session.
let live = () =>
  Object.entries(cache.value)
    .filter(([eid, r]) => {
      let s = r.session
      if (!s) return false
      if (sessionActive.includes(s.status ?? '')) return true
      return s.origin == 'managed' && !!s.finished_at &&
        Date.now() - Date.parse(s.finished_at) < RECENT &&
        !seen.value.includes(eid)
    })
    .map(([eid]) => eid)

// This client's shelf canvas, if it's been born — the canvas tagged with a
// shelf pointing back at us. null until the first drop mints one.
export let shelf = () =>
  Object.entries(cache.value)
    .find(([, r]) => r.shelf?.client_eid == clientId())?.[0] ?? null

// Mint the shelf on first use: a canvas plus the tag binding it to us.
export let shelfMint = () => {
  let eid = uuid()
  mutate(
    { eid, name: 'canvas', comp: { eid } },
    { eid, name: 'shelf', comp: { eid, client_eid: clientId() } },
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
  let { target_eid, view, pin } = JSON.parse(data)
  let sh = shelf() ?? shelfMint()
  let z = topZ(sh) + 1
  if (pin && cache.value[pin]?.pin) {
    mutate({
      eid: pin,
      name: 'pin',
      comp: { canvas_eid: sh, x: 0, y: 0, w: 0, h: 0, z },
    })
    return
  }
  let card = uuid()
  mutate(
    { eid: card, name: 'card', comp: { eid: card, target_eid, view } },
    {
      eid: card,
      name: 'pin',
      comp: { eid: card, canvas_eid: sh, x: 0, y: 0, w: 0, h: 0, z },
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
    return () => {
      mounted = null
    }
  }, [])

  let ls = live()
  let sh = shelf()
  let ps = sh ? pinned(sh).toSorted((a, b) => b.z - a.z) : []

  return (
    <Frame elRef={root} onDragOver={over} onDrop={dropIn}>
      <Strip
        type='button'
        aria-label={expanded.value ? 'close tray' : 'open tray'}
        onClick={() => toggle(!expanded.value)}
      >
        {ls.map((eid) => (
          <Dot key={eid} status={ent(eid).session?.status ?? ''} />
        ))}
        {ps.map((p) => (
          <Icon
            key={p.eid}
            name={icons[p.view] ?? 'file-text'}
          />
        ))}
        <Chevron>{expanded.value ? '⌄' : '⌃'}</Chevron>
      </Strip>
      {expanded.value && (
        <Panel>
          {ls.length > 0 && (
            <Group>
              <Label>live</Label>
              {ls.map((eid) => (
                <Row
                  key={eid}
                  draggable
                  // no pin in the payload: a live row isn't shelved, so
                  // dropping it on the canvas SPAWNS a session card
                  onDragStart={(e: DragEvent) => dragData(e, eid, 'Session')}
                  onClick={() => navigate('/' + idOf(ent(eid)))}
                >
                  <View eid={eid} view='List.Item' />
                  {
                    /* only a settled run dismisses — a live one wants your
                      eyes (stop it from its own view) */
                  }
                  {!sessionActive.includes(ent(eid).session?.status ?? '') && (
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
                    dragData(e, p.target_eid, p.view, p.w, p.eid)}
                >
                  <View eid={p.target_eid} view='List.Item' />
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
