import { signal } from '@preact/signals'
import { block, copy, setFollow } from './ui.tsx'
import { cache, ent, rootCanvas } from '../live.ts'
import { actionsFor, resolve } from './registry.ts'
import { type Ent, idOf } from '../types.ts'
import { dragData } from './drag.ts'

// The URL is the root card: `/` shows the root canvas, `/T-123` (or any
// id form) shows that entity fullscreened, `?v=List` picks its view.
// Navigation is therefore ordinary anchors — cmd/middle-click opens a
// tab natively — plus pushState for the rare in-place root change.
// Everything is guarded for hosts without a location (the TUI).
let loc = (globalThis as { location?: Location }).location
let his = (globalThis as { history?: History }).history

export let route = signal(loc ? loc.pathname + loc.search : '/')
globalThis.addEventListener?.('popstate', () => {
  let was = screenTarget()?.eid
  route.value = loc!.pathname + loc!.search
  track(was)
})

export let navigate = (to: string) => {
  if (!his) return
  peek.value = null // a real root change dismisses any floating peek
  let was = screenTarget()?.eid
  his.pushState(null, '', to)
  route.value = to
  track(was)
}

// A peeked entity: desktop's answer to clicking a link — a popover card
// at the pointer instead of a fullscreen root swap (Peek.tsx renders it).
export let peek = signal<{ eid: string; x: number; y: number } | null>(null)

// One opener for every entity click: a fine pointer peeks, a coarse one
// navigates — fullscreen IS the phone's right answer. navigate() stays
// the deliberate root change (:open, "open here", direct urls).
export let openAt = (eid: string, ev: MouseEvent) => {
  if (globalThis.matchMedia?.('(pointer: fine)').matches) {
    peek.value = { eid, x: ev.clientX, y: ev.clientY }
  } else navigate(`/${idOf(ent(eid))}`)
}

// The plain-click half of an in-app anchor: modifiers, middle-click and
// the native context menu keep their new-tab forms; a bare click (tap
// included) opens in place — peeked when the caller knows its entity,
// navigated when all it has is an href.
export let follow = (href: string, eid?: string) => (ev: MouseEvent) => {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
  ev.preventDefault()
  ev.stopPropagation()
  if (eid) openAt(eid, ev)
  else navigate(href)
}
setFollow(follow) // el()'s demoted links click through here (see ui.tsx)

// Markdown-rendered ids (md.ts data-ref anchors) come from innerHTML, so
// no component owns their clicks — one delegated listener gives every
// T-123 in any body the same in-app open as an Id chip. The id resolves
// against the live cache at click time; a ref the cache can't name (an
// unloaded or dead entity) falls through to its href, the honest 404.
globalThis.document?.addEventListener?.('click', (ev: MouseEvent) => {
  let a = (ev.target as Element | null)?.closest?.('a[data-ref]')
  if (!a) return
  let id = a.getAttribute('data-ref')!
  let m = id.match(/^[A-Za-z]+-(\d+)$/)
  let hit = m &&
    Object.entries(cache.value).find(([, c]) => c.entity?.num == Number(m![1]))
  if (hit) follow(`/${id}`, hit[0])(ev)
})

// The whole internal-link contract, spreadable onto any anchor: a real
// href (new-tab forms and the native menu stay native), plain click
// follows in place, double click is the deliberate fullscreen (follow
// with only the href navigates — the same root change as "open here"),
// and dragging it onto the canvas makes a card.
export let linkProps = (e: Ent) => {
  let href = `/${idOf(e)}`
  return {
    href,
    onClick: follow(href, e.eid),
    onDblClick: follow(href),
    draggable: true,
    onDragStart: (ev: DragEvent) => dragData(ev, e.eid, resolve(e).view),
  }
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

// The trail: roots passed through in place, oldest first — the App bar
// wears the last few as breadcrumbs (the TUI keeps its own). Both route
// writers above call track() with where they WERE: landing somewhere
// already on the trail (a crumb click, the back button) cuts back to it,
// so the trail never loops and never holds the present. The root canvas
// never rides — the brand is that crumb.
export let trail = signal<string[]>([])
let track = (was?: string) => {
  let now = screenTarget()?.eid
  if (!now || now == was) return
  let i = trail.value.indexOf(now)
  if (i >= 0) trail.value = trail.value.slice(0, i)
  else if (was && was != rootCanvas()) trail.value = [...trail.value, was]
}

// The entity context menu: navigation first ("open here" is the
// deliberate in-place root change; new tab beside it), then whatever
// verbs the entity's components contribute (registry actionsFor —
// a task offers its status moves, a claim its release, …). align
// 'right' hangs the menu leftward from x — the titlebar dropdown
// anchors at the screen's far edge.
export let menu = signal<
  { x: number; y: number; href: string; eid: string; align?: 'right' } | null
>(null)

// Right-click serving the app menu instead of the browser's — for faces
// that are themselves links (tiles) so the native menu never fires.
export let menuAt = (e: Ent) => (ev: MouseEvent) => {
  ev.preventDefault()
  ev.stopPropagation()
  menu.value = { x: ev.clientX, y: ev.clientY, href: `/${idOf(e)}`, eid: e.eid }
}

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
      style={(m.align == 'right'
        ? `right:${innerWidth - m.x}px`
        : `left:${m.x}px`) + `;top:${m.y}px`}
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
      <Item
        type='button'
        onClick={() => {
          copy(location.origin + m.href)
          close()
        }}
      >
        copy link
      </Item>
      <Item
        type='button'
        onClick={() => {
          copy(idOf(ent(m.eid)))
          close()
        }}
      >
        copy id
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
