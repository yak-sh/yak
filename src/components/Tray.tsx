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

// The Tray ("the Shelf"): screen-space chrome in the bottom-right corner,
// floating above the statusbar. Two self-gating groups — LIVE sessions that
// want your eyes, and the SHELF, a per-client scratch canvas you drag cards
// onto. Collapsed by default to a slim strip of dots + icons.

// Where the tray sits, kept fresh so Card.tsx can hit-test a titlebar drag
// against it; null while unmounted.
export let trayRect = signal<DOMRect | null>(null)

// Collapsed vs expanded, remembered across visits (default collapsed).
let expanded = signal(
  globalThis.localStorage?.getItem('tasks-tray') == 'open',
)
let toggle = (v: boolean) => {
  expanded.value = v
  localStorage.setItem('tasks-tray', v ? 'open' : 'shut')
}

// A managed run stays worth showing for a while after it ends.
let RECENT = 6 * 60 * 60 * 1000

// LIVE: sessions still running, plus managed ones that finished recently —
// the digest a human wants without opening every session.
let live = () =>
  Object.entries(cache.value)
    .filter(([, r]) => {
      let s = r.session
      if (!s) return false
      if (sessionActive.includes(s.status ?? '')) return true
      return s.origin == 'managed' && !!s.finished_at &&
        Date.now() - Date.parse(s.finished_at) < RECENT
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
  Head: 'header',
  Chevron: 'button',
  Group: 'section',
  Label: 'span',
  Row: 'div',
  X: 'button',
  Hint: 'div',
  Strip: 'div',
})
let { Head, Chevron, Group, Label, Row, X, Hint, Strip } = Frame

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

  // Publish the tray's box for hit-testing — remeasured whenever it resizes
  // (a row lands, a group appears) or the window does.
  useEffect(() => {
    let node = root.current
    if (!node) return
    let sync = () => (trayRect.value = node.getBoundingClientRect())
    sync()
    let ro = new ResizeObserver(sync)
    ro.observe(node)
    addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      removeEventListener('resize', sync)
      trayRect.value = null
    }
  }, [])

  let ls = live()
  let sh = shelf()
  let ps = sh ? pinned(sh).toSorted((a, b) => b.z - a.z) : []

  return (
    <Frame elRef={root} onDragOver={over} onDrop={dropIn}>
      {expanded.value
        ? (
          <>
            <Head>
              <Label>shelf</Label>
              <Chevron
                type='button'
                aria-label='collapse'
                onClick={() => toggle(false)}
              >
                ⌄
              </Chevron>
            </Head>
            {ls.length > 0 && (
              <Group>
                <Label>live</Label>
                {ls.map((eid) => (
                  <Row
                    key={eid}
                    onClick={() => navigate('/' + idOf(ent(eid)))}
                  >
                    <View eid={eid} view='List.Item' />
                  </Row>
                ))}
              </Group>
            )}
            {ps.length > 0 && (
              <Group>
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
          </>
        )
        : (
          <Strip onClick={() => toggle(true)}>
            {ls.map((eid) => (
              <Dot key={eid} status={ent(eid).session?.status ?? ''} />
            ))}
            {ps.map((p) => (
              <Icon key={p.eid} name={icons[p.view] ?? 'file-text'} />
            ))}
          </Strip>
        )}
    </Frame>
  )
}
