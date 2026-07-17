import { signal } from '@preact/signals'
import { block } from './ui.tsx'
import { cache, ent, rootCanvas } from '../live.ts'
import { actionsFor } from './registry.ts'

// The URL is the root card: `/` shows the root canvas, `/T-123` (or any
// id form) shows that entity fullscreened, `?v=List` picks its view.
// Navigation is therefore ordinary anchors — cmd/middle-click opens a
// tab natively — plus pushState for the rare in-place root change.
// Everything is guarded for hosts without a location (the TUI).
let loc = (globalThis as { location?: Location }).location
let his = (globalThis as { history?: History }).history

export let route = signal(loc ? loc.pathname + loc.search : '/')
globalThis.addEventListener?.('popstate', () => {
  route.value = loc!.pathname + loc!.search
})

export let navigate = (to: string) => {
  if (!his) return
  his.pushState(null, '', to)
  route.value = to
}

// Resolve the route to {eid, view}: bare `/` means the root canvas; an
// id is T-num / bare num / eid, looked up in the live cache.
export let screenTarget = () => {
  let url = new URL(route.value, 'http://x')
  let id = decodeURIComponent(url.pathname.slice(1))
  let view = url.searchParams.get('v') ?? undefined
  if (!id) {
    let eid = rootCanvas()
    return eid ? { eid, view } : null
  }
  let m = id.match(/^[A-Za-z]+-(\d+)$/) ?? id.match(/^(\d+)$/)
  if (!m) return cache.value[id] ? { eid: id, view } : null
  let hit = Object.entries(cache.value)
    .find(([, r]) => r.entity?.num == +m![1])
  return hit ? { eid: hit[0], view } : null
}

// The card's context menu: navigation first ("open here" is the
// deliberate in-place root change; new tab beside it), then whatever
// verbs the entity's components contribute (registry actionsFor —
// a task offers its status moves, a claim its release, …).
export let menu = signal<
  { x: number; y: number; href: string; eid: string } | null
>(null)

let Frame = block('div', 'Menu', { Item: 'button' })
let { Item } = Frame

export let Menu = () => {
  let m = menu.value
  if (!m) return null
  let close = () => {
    menu.value = null
  }
  let acts = actionsFor(ent(m.eid))
  return (
    <Frame
      style={`left:${m.x}px;top:${m.y}px`}
      onPointerDown={(e: Event) => e.stopPropagation()}
    >
      <Item
        type='button'
        onClick={() => {
          navigate(m.href)
          close()
        }}
      >
        open here
      </Item>
      <Item
        type='button'
        onClick={() => {
          globalThis.open?.(m.href)
          close()
        }}
      >
        open in new tab
      </Item>
      {acts.map((a, i) => (
        <Item
          key={i}
          type='button'
          mod={[a.mod, !i && 'first'] as string[]}
          onClick={() => {
            a.run()
            close()
          }}
        >
          {a.label}
        </Item>
      ))}
    </Frame>
  )
}
