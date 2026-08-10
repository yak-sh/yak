import { signal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import { block, copy, setFollow } from './ui.tsx'
import { usePlaceAt } from './overlay.tsx'
import { cache, census, ent, peek, rootCanvas, trail } from '../live.ts'
import { type Action, actionsFor, resolve } from './registry.ts'
import { type Ent, idOf, SHORT } from '../types.ts'
import { dragData } from './drag.ts'

export { peek, trail }

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
  keep()
})

export let navigate = (to: string) => {
  if (!his) return
  peek.value = [] // a real root change dismisses every floating peek
  let was = screenTarget()?.eid
  his.pushState(null, '', to)
  route.value = to
  track(was)
  keep()
}

let linkAt = (ev: MouseEvent) => {
  let el = (v: EventTarget | null) =>
    typeof Element != 'undefined' && v instanceof Element ? v : null
  let current = el(ev.currentTarget)
  return current?.matches('a, [role="link"]')
    ? current
    : el(ev.target)?.closest('a, [role="link"]') ?? undefined
}

// One opener for every entity click: a fine pointer peeks, a coarse one
// navigates — fullscreen IS the phone's right answer. navigate() stays
// the deliberate root change (:open, "open here", direct urls).
export let openAt = (eid: string, ev: MouseEvent) => {
  if (globalThis.matchMedia?.('(pointer: fine)').matches) {
    let from = linkAt(ev)
    let stack = peek.peek()
    let current = stack.at(-1)
    // The peek already shows this entity. Its own id's clicks must leave
    // it mounted long enough for the deliberate double-click to navigate.
    if (current?.eid == eid && from?.closest('.Peek')) return
    let same = current?.eid == eid && current.from == from
    peek.value = same
      ? stack.slice(0, -1)
      : [...stack, { eid, x: ev.clientX, y: ev.clientY, from }]
  } else navigate(`/${idOf(ent(eid))}`)
}

// An id in the wild — T-num, bare num, raw eid, or a SHORT-eid handle (the
// 6–8 hex prefix a num-less entity wears, T-3684) — resolved against the live
// cache; undefined when unloaded, dead, or an ambiguous prefix.
export let eidOf = (id: string) => {
  let eids = census.value
  let m = id.match(/^[A-Za-z]+-(\d+)$/) ?? id.match(/^(\d+)$/)
  if (m) return eids.find((eid) => cache.peek()[eid]?.entity?.num == +m![1])
  if (eids.includes(id)) return id // a full eid, verbatim
  if (SHORT.test(id)) {
    let hits = eids.filter((eid) => eid.startsWith(id.toLowerCase()))
    return hits.length == 1 ? hits[0] : undefined // ambiguous → no navigation
  }
}

// The plain-click half of an in-app anchor: modifiers and middle-click keep
// their new-tab forms; a bare click (tap included) opens in place — peeked
// when the caller knows its entity, navigated when all it has is an href.
export let follow = (href: string, eid?: string) => (ev: MouseEvent) => {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button != 0) return
  ev.preventDefault()
  ev.stopPropagation()
  if (eid) openAt(eid, ev)
  else navigate(href)
}

// el()'s demoted links (see ui.tsx) know only an href — resolve the
// entity at click time so they peek like any chip; double click stays
// the deliberate navigate.
setFollow((href) => ({
  onClick: (ev: MouseEvent) => follow(href, eidOf(href.slice(1)))(ev),
  onDblClick: follow(href),
}))

// Markdown-rendered ids (md.ts data-ref anchors) come from innerHTML, so
// no component owns their clicks — one delegated listener gives every
// T-123 in any body the same in-app open as an Id chip. The id resolves
// against the live cache at click time; a ref the cache can't name (an
// unloaded or dead entity) falls through to its href, the honest 404.
let openRef = (ev: MouseEvent) => {
  let a = (ev.target as Element | null)?.closest?.('a[data-ref]')
  if (!a) return
  let id = a.getAttribute('data-ref')!
  let eid = eidOf(id)
  if (eid) follow(`/${id}`, eid)(ev)
}

// Component-owned entity links carry menuAt directly. Rendered prose and
// other native anchors have no component to do that, so their root-relative
// entity href resolves here. External and app-chrome links fall through.
let menuRef = (ev: MouseEvent) => {
  let a = (ev.target as Element | null)?.closest?.('a[href]')
  let href = a?.getAttribute('href') ?? ''
  let id = href.match(/^\/([^/?#]+)(?:\?[^#]*)?$/)?.[1]
  let eid = id && eidOf(id)
  if (eid) menuAt(ent(eid))(ev)
}

// Startup, exported so either host's document can be proven against it. The
// TUI's fake document (tui/dom.ts) carries only what preact reaches for, so
// an object guard is not enough here — `document?.member(…)` passes it and
// then throws on the missing member. Guard the METHOD, always.
type Host = {
  addEventListener?: (t: string, fn: (ev: MouseEvent) => void) => void
}

export let wire = (doc: Host | undefined = globalThis.document) => {
  doc?.addEventListener?.('click', openRef)
  doc?.addEventListener?.('contextmenu', menuRef)
}

wire()

// The pointer half of the internal-link contract: a real href keeps native
// new-tab gestures, plain click follows in place, double click is the
// deliberate fullscreen, and right-click opens the target entity's menu.
// For tiles whose wrapper already owns the drag (a board Item, a List Row).
export let clickProps = (e: Ent) => {
  let href = `/${idOf(e)}`
  return {
    href,
    onClick: follow(href, e.eid),
    onDblClick: follow(href),
    onContextMenu: menuAt(e),
  }
}

// The whole contract, spreadable onto any anchor: the clicks above plus
// dragging it onto the canvas makes a card.
export let linkProps = (e: Ent) => ({
  ...clickProps(e),
  draggable: true,
  onDragStart: (ev: DragEvent) => dragData(ev, e.eid, resolve(e).view),
})

// Resolve a route to {eid, view}: bare `/` means the root canvas; an
// id is T-num / bare num / eid, looked up in the live cache. The argument
// is how a REMEMBERED route (below) is screened against the same resolver
// the screen uses — a route naming a dead entity resolves to nothing.
export let screenTarget = (at = route.value) => {
  let url = new URL(at, 'http://x')
  let id = decodeURIComponent(url.pathname.slice(1))
  let view = url.searchParams.get('v') ?? undefined
  let eid = id ? eidOf(id) : rootCanvas()
  return eid ? { eid, view } : null
}

// Writing the trail (live.ts holds it, above the hot-swap boundary): both
// route writers above call track() with where they WERE — landing somewhere
// already on the trail (a crumb click, the back button) cuts back to it, so
// the trail never loops and never holds the present. The root canvas never
// rides — the brand is that crumb.
let track = (was?: string) => {
  let now = screenTarget()?.eid
  if (!now || now == was) return
  let i = trail.value.indexOf(now)
  if (i >= 0) trail.value = trail.value.slice(0, i)
  else if (was && was != rootCanvas()) trail.value = [...trail.value, was]
}

// WHERE THIS DEVICE WAS. `at` is the last route that named something;
// `home` is the last one that named the root canvas — the canvas in the
// view it was left in, which is what a restored card sits on top of.
// Per device rather than in the graph on purpose: a phone and a desktop
// want different last positions, and a graph row would cost a write per
// navigation (broadcast to every other client) to buy a cross-device
// continuity nobody asked for. Storage is read inside the functions —
// the TUI imports this module and has no localStorage.
type Where = { at: string; home: string }
let WHERE = 'tasks-where'
let WARM = 'tasks-warm'

let kept = (): Where => {
  try {
    return { at: '/', home: '/', ...JSON.parse(localStorage.getItem(WHERE)!) }
  } catch {
    return { at: '/', home: '/' }
  }
}

// Every landing writes it — both route writers above, plus boot. A route
// that resolves to nothing (/admin, a 404) leaves the memory alone:
// chrome and dead ends are not places you were.
let keep = () => {
  let t = screenTarget()
  if (!loc || !t) return
  try {
    let at = route.value
    let home = t.eid == rootCanvas() ? at : kept().home
    localStorage.setItem(WHERE, JSON.stringify({ at, home }))
  } catch { /* private mode: the memory is a nicety, never a failure */ }
}

// A COLD launch at bare `/` resumes where the device left off; anything
// else wins over the memory. A deep link carries a path or a query and
// never reaches the restore. `/` itself is the subtle one — the brand is
// a native anchor, so tapping home is a page LOAD at `/`, and bouncing
// that back to the card would make the canvas unreachable. So a browsing
// context marks itself warm on its first boot: the fresh tab (or app
// launch) restores, every later `/` in that tab shows the canvas.
//
// main.tsx calls this once, after boot() has filled the cache and before
// the first render — so a remembered entity that has since been DELETED
// resolves to nothing here and falls back to the canvas, and the URL is
// rewritten before anything paints. Back is a real history entry: home
// goes under the card, so one gesture returns to the canvas.
export let restore = () => {
  if (!loc || !his) return
  let warm = false
  try {
    warm = !!sessionStorage.getItem(WARM)
    sessionStorage.setItem(WARM, '1')
  } catch { /* no storage, no memory — kept() defaults to the canvas */ }
  if (warm || loc.pathname != '/' || loc.search) {
    keep()
    return
  }
  let w = kept()
  let home = screenTarget(w.home) ? w.home : '/'
  let at = screenTarget(w.at) ? w.at : home
  if (home != '/') his.replaceState(null, '', home)
  if (at != home) his.pushState(null, '', at)
  route.value = at
  keep()
}

// The entity context menu: navigation first ("open here" is the
// deliberate in-place root change; new tab beside it), then whatever
// verbs the entity's components contribute (registry actionsFor —
// a task offers its status moves, a claim its release, …). align
// 'right' hangs the menu leftward from x — the titlebar dropdown
// anchors at the screen's far edge.
type MenuState = {
  x: number
  y: number
  href: string
  eid: string
  acts?: never
  align?: 'right'
} | {
  x: number
  y: number
  acts: Action[]
  href?: never
  eid?: never
  align?: 'right'
}
export let menu = signal<MenuState | null>(null)

// Right-click serving the entity's app menu instead of the browser's.
export let menuAt = (e: Ent) => (ev: MouseEvent) => {
  ev.preventDefault()
  ev.stopPropagation()
  menu.value = { x: ev.clientX, y: ev.clientY, href: `/${idOf(e)}`, eid: e.eid }
}

// A point on empty canvas has no entity navigation, only the verbs its host
// gives it. The shared Menu still owns placement, dismissal and row styling.
export let actionsAt = (acts: Action[]) => (ev: MouseEvent) => {
  ev.preventDefault()
  ev.stopPropagation()
  menu.value = { x: ev.clientX, y: ev.clientY, acts }
}

// A card is the menu target except where a nested control or link owns
// the gesture. Pinned and temporary cards share this boundary.
export let cardMenuAt = (e: Ent) => (ev: MouseEvent) => {
  if (
    ev.target instanceof Element &&
    ev.target.closest('a, input, textarea, [contenteditable]')
  ) return
  menuAt(e)(ev)
}

let Frame = block('div', 'Menu', { Item: 'button' })
let { Item } = Frame

export let Menu = () => {
  let m = menu.value
  let root = useRef<HTMLDivElement>(null)
  usePlaceAt(root, m)
  if (!m) return null
  let close = () => {
    menu.value = null
  }
  let acts = m.acts ?? actionsFor(ent(m.eid))
  return (
    <Frame
      elRef={root}
      onPointerDown={(e: Event) => e.stopPropagation()}
    >
      {m.eid && (
        <>
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
        </>
      )}
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
