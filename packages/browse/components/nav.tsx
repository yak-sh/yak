import { hosting, localPath } from '../hosting.ts'
import { addressId, entityPath, searchAt } from '../url.ts'
import { signal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import * as ui from '@yaks/ui'
import { copy } from '../clipboard.ts'
import { usePlaceAt } from '@yaks/ui'
import {
  cache,
  capable,
  clientId,
  ent,
  findEid,
  mutate,
  myCursor,
  owner,
  peek,
  resolveEid,
  resolvingId,
  serverEid,
  trail,
} from '../live.ts'
import { type Action, actionsFor, resolve } from './registry.ts'
import { SHORT } from '@yaks/id'
import { type Change, type Ent, IdError, idOf, vocab } from '../types.ts'
import { dragData } from './drag.ts'
import { cursorEid } from '../edge.ts'
import { allSessionsAt } from '../tray_query.ts'

export { peek, trail }

// The door keeps history; browse writes the controlled Stack through it.
export { route } from '../history.ts'
import { go, route } from '../history.ts'
import { historyPort } from '@yaks/ui/history'

export let navigate = (to: string, options: { replace?: boolean } = {}) => {
  let url = new URL(to, 'http://x')
  let target = localPath(url.pathname) + url.search + url.hash
  let was = screenTarget()?.eid
  peek.value = []
  go(target, options.replace)
  track(was)
  mark()
}

// Whether a path is the app's own route shape — `/` or ONE extensionless
// segment (`/T-123`, `/home`). Multi-segment and dotted paths are real
// resources (/blob/<sha>, /logs/…, files) and keep native navigation.
export let appRoute = (path: string) =>
  /^\/[^/?#.]*$/.test(path) &&
  path != localPath(hosting().inspect ?? '/inspect')

// Following an entity link stacks its page, on either pointer kind.
export let openAt = (eid: string, _ev: MouseEvent) =>
  navigate(entityPath(idOf(ent(eid))))

// An id in the wild — T-num, bare num, raw eid, a sigilled eid fragment, or
// an alias — resolved in the host's order; undefined while unloaded or dead.
// An ambiguous fragment is refused, never treated as a miss. An alias resolves
// here as it does at the CLI and MCP id doors.
// Cache misses fall to serverEid — live.ts's addressed-sub sidecar —
// so a token naming a live-but-unloaded entity still navigates once the boot
// flip (T-18059) serves a partial working set. The fallback is async: it
// returns undefined the first miss and the eid once its one-row subscription
// lands (the caller re-renders on resolveGen). Fragments always ask the server
// because a partial cache cannot prove global uniqueness.
export let eidOf = (id: string) => {
  // A partial cache cannot prove uniqueness across the graph.
  if (SHORT.test(id)) return serverEid(id)
  return findEid(id) ?? serverEid(id)
}

// Whether the route names an id the server is still resolving — the App shows
// a resolving state instead of a premature Lost while its one-row sub is open.
export let screenResolving = (at = route.value) => {
  let id = addressId(
    decodeURIComponent(new URL(at, 'http://x').pathname.slice(1)),
  )
  return !!id && resolvingId(id)
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

// A link inside another link keeps its tag and says data-href (@yaks/ui el),
// and no component owns its clicks. It resolves its entity at click time, so
// it peeks like any chip, and double click stays the deliberate navigate.
// Heard in the capture phase, ahead of the link around it, which would
// otherwise take the click as its own.
let demoted =
  (open: (href: string) => (ev: MouseEvent) => void) => (ev: MouseEvent) => {
    let href = (ev.target as Element | null)?.closest?.('[data-href]')
      ?.getAttribute('data-href')
    if (href) open(href)(ev)
  }
let openDemoted = demoted((href) =>
  follow(href, eidOf(decodeURIComponent(href.slice(1))))
)
let navigateDemoted = demoted((href) => follow(href))

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
  if (eid) follow(entityPath(id), eid)(ev)
}

// Component-owned entity links carry menuAt directly. Rendered prose and
// other native anchors have no component to do that, so their root-relative
// entity href resolves here. External and app-chrome links fall through.
let menuRef = (ev: MouseEvent) => {
  let a = (ev.target as Element | null)?.closest?.('a[href]')
  let href = a?.getAttribute('href') ?? ''
  let id = localPath(href).match(/^\/([^/?#]+)(?:\?[^#]*)?$/)?.[1]
  let eid = id && eidOf(decodeURIComponent(id))
  if (eid) menuAt(ent(eid))(ev)
}

// Startup, exported so either host's document can be proven against it. The
// TUI's fake document (tui/dom.ts) carries only what preact reaches for, so
// an object guard is not enough here — `document?.member(…)` passes it and
// then throws on the missing member. Guard the METHOD, always.
type Host = {
  addEventListener?: (
    t: string,
    fn: (ev: MouseEvent) => void,
    capture?: boolean,
  ) => void
}

export let wire = (doc: Host | undefined = globalThis.document) => {
  doc?.addEventListener?.('click', openRef)
  doc?.addEventListener?.('contextmenu', menuRef)
  doc?.addEventListener?.('click', openDemoted, true)
  doc?.addEventListener?.('dblclick', navigateDemoted, true)
}

wire()

// The pointer half of the internal-link contract: a real href keeps native
// new-tab gestures, plain click follows in place, double click is the
// deliberate fullscreen, and right-click opens the target entity's menu.
// For tiles whose wrapper already owns the drag (a board Item, a List Row).
export let clickProps = (e: Ent) => {
  let href = entityPath(idOf(e))
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
  draggable: capable('canvas'),
  onDragStart: (ev: DragEvent) =>
    capable('canvas') && dragData(ev, e.eid, resolve(e).view),
})

// Resolve a route to {eid, view}: bare `/` means the owner inbox; an
// id is T-num / bare num / eid, looked up in the live cache. The argument
// is how a REMEMBERED route (below) is screened against the same resolver
// the screen uses — a route naming a dead entity resolves to nothing.
export let screenTarget = (at = route.value) => {
  if (allSessionsAt(at) || searchAt(at) != null) return null
  let url = new URL(at, 'http://x')
  let id = addressId(decodeURIComponent(url.pathname.slice(1)))
  if (!id && !vocab.comp('subscription')) return null
  let view = url.searchParams.get('v') ?? undefined
  let eid = id ? routed(id) : owner.value
  if (!id) view = 'Inbox'
  return eid ? { eid, view } : null
}

// A route whose id the finder refuses (a handle written with a letter, an
// ambiguous fragment) names nothing the page can draw: the Lost face, as the
// host's own 404 for that path says, rather than an exception mid-render.
let routed = (id: string) => {
  try {
    return eidOf(id)
  } catch (error) {
    if (error instanceof IdError) return undefined
    throw error
  }
}

// Writing the trail (live.ts holds it, above the hot-swap boundary): both
// route writers above call track() with where they WERE — landing somewhere
// already on the trail (a crumb click, the back button) cuts back to it, so
// the trail never loops and never holds the present. The owner inbox never
// rides — the brand is that crumb.
let track = (was?: string) => {
  let now = screenTarget()?.eid
  if (!now || now == was) return
  let i = trail.value.indexOf(now)
  if (i >= 0) trail.value = trail.value.slice(0, i)
  else if (was && was != owner.value) trail.value = [...trail.value, was]
}

// Home always opens the inbox. An explicit entity URL stays put; old ?task=
// links still resolve through their original door.
export let restore = () => {
  let legacy = new URL(route.peek(), 'http://x').searchParams.get('task')
  if (legacy) void grandfather(legacy)
}
let grandfather = async (legacy: string) => {
  let at = route.peek()
  let eid = await resolveEid(legacy)
  if (eid && route.peek() == at) {
    navigate(entityPath(idOf(ent(eid))), { replace: true })
  }
}

// The cursor: publish WHERE this client now looks into the
// GRAPH (T-12788), so the fleet can see it (ui_state reports every open tab).
// UPDATE-ONLY: this write publishes position, and nothing reads it back to
// drive navigation — a cursor read must never influence rendering.
// One row per client, minted lazily beside the client
// entity the way the camera mints on first pan. Written on navigation only,
// never mid-gesture at navigation boundaries, and IDEMPOTENT: a
// write naming where the cursor already points is skipped, so a re-render never
// churns the row. Guarded for the TUI (no client, no localStorage) via loc/his.
let mark = () => {
  let t = screenTarget()
  if (!capable('canvas') || !historyPort()) return
  if (!t) return // chrome and dead ends are not places
  let client = clientId()
  let cur = myCursor(client)
  if (cur?.target == t.eid && (cur.view ?? null) == (t.view ?? null)) return
  let eid = cursorEid(client) // identity never waits for the client-row sub
  let batch: Change[] = []
  // Mint the client entity when a cursor beats the canvas to it — a deep link
  // never mounts the Canvas that otherwise mints it, so the reference would
  // name a bare spine. Idempotent: skipped once the client row exists.
  if (!cache.peek()[client]?.client) {
    batch.push({
      eid: client,
      name: 'client',
      comp: { eid: client, user_agent: navigator.userAgent },
    })
  }
  batch.push({
    eid,
    name: 'cursor',
    comp: { eid, client, target: t.eid, view: t.view ?? null },
  })
  // Publishing the cursor is a nicety, never a failure — the graph twin of
  // guarded position write. A cursor write must never break the
  // navigation that triggered it, so a bad graph state swallows here rather
  // than throwing out of navigate().
  try {
    mutate(...batch)
  } catch { /* the position is published best-effort, like navigation */ }
}

// The cursor is UPDATE-ONLY: the client PUBLISHES where it looks
// (mark() above) but never reads a cursor back to drive navigation. The read
// half — an effect that navigated the tab wherever the graph moved this
// client's cursor — let any writer (an agent's `show`, a stale server row)
// yank the tab, and did: a cursor left pointing at P-19 pulled every attempt to
// open something else straight back. Rendering answers to the URL and to
// gestures, not to graph state, so the coupling is gone rather than guarded.
// The `show` tool's "move a human's tab" rides on this read half and is
// withdrawn with it (see nav follow-up if it's ever wanted back read-free).

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
  menu.value = {
    x: ev.clientX,
    y: ev.clientY,
    href: entityPath(idOf(e)),
    eid: e.eid,
  }
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

let { Item, Rule } = ui.Menu

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
    <ui.Menu
      class='Overlay'
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
            copy {idOf(ent(m.eid))}
          </Item>
        </>
      )}
      {m.eid && acts.length > 0 && <Rule />}
      {acts.map((a, i) => (
        <Item
          key={i}
          type='button'
          mod={a.mod}
          onClick={() => {
            a.run()
            close()
          }}
        >
          {a.label}
        </Item>
      ))}
    </ui.Menu>
  )
}

