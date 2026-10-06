// The panels: the sheets that open over the glass, the map, the hero's and
// every one after them (hud.ts lists them). One is open at a time, and opening
// another folds it away. Its keys, Escape, a tap beside it or its close button
// fold it away too, and Escape with nothing open opens the panel that lists
// Escape among its keys. Each is a head, its title and whatever its owner
// puts beside it, over a body its owner draws into while it is open.
//
// A panel with tabs (`book`) is one sheet whose head is a row of tabs, each
// with a body and keys of its own, one shown at a time: its key or its tab
// opens the panel on it, and its key again, while it shows, folds it away.
// Each tab's owner holds it as it would a panel of its own.
import type { Glyph } from './glyphs.ts'
import { h, render } from 'preact'
import {
  batch,
  computed,
  effect,
  type ReadonlySignal,
  type Signal,
  signal,
} from '@preact/signals'
import { Body, Button, Head, Tabs } from '@yaks/ui'
import { ValeKeycap } from './kit/ValeKeycap.ts'
import { type PageState, pageState } from './page-state.ts'
import { mark } from './tile.ts'

/** Where an owner draws, and whether it shows: a panel, or one tab of one. */
export type Page = {
  /** where its owner draws */
  body: HTMLElement
  readonly open: boolean
  show: () => void
  close: () => void
  toggle: () => void
}

/** One panel, as its owner holds it. */
export type Panel = Page & {
  /** what its head says, as HTML: a title, and anything beside it */
  head: (html: string) => void
}

/** One tab of a panel with tabs: open while the panel is open on it. */
export type Tab = Panel & {
  /** dot it, while something new waits behind it */
  mark: (on: boolean) => void
}

/** What a panel is before anything is drawn in it. */
export type Spec = {
  title: string
  /** the keys that open it and fold it away, as `KeyboardEvent.code`s */
  keys?: string[]
  /** how tall its sheet stands, whatever is picked or shown in it, as CSS
   * (ui/Panel.css `--tall`): `auto` for one whose body is one size whatever
   * happens in it, which is then as tall as its body */
  tall?: string
}

/** A tab, before anything is drawn in it: its name, its glyph, and the keys
 * that open the panel on it. */
export type TabSpec = { title: string; icon: Glyph; keys: string[] }

// Native bodies belong to their page owners, not to Preact's child diff.
let body = (doc: Document, tab = false) => {
  let node = doc.createElement('div')
  node.className = 'Panel_Body'
  if (tab) node.setAttribute('role', 'tabpanel')
  let mount = (host: HTMLDivElement | null) => {
    if (host && node.parentNode != host) host.append(node)
  }
  return { node, mount }
}

type Leaf = {
  name?: string
  spec?: TabSpec
  page: Page
  mount: ReturnType<typeof body>['mount']
}

/** The panels over `glass`. Navigation, headings and marks live in `state`;
 * native page bodies stay mounted even while their sheet is folded away. */
export let panels = (
  glass: HTMLElement,
  busy: () => boolean,
  state: PageState = pageState(),
) => {
  let doc = glass.ownerDocument
  let all: { keys?: string[]; page: Page }[] = []
  let clean: (() => void)[] = []
  // What the sheets show, as signals the state's rows set: which panel is
  // open, on which tab, and each panel's and tab's heading and mark. A sheet
  // is drawn once; each of its parts draws again only as what it shows
  // changes, and showing or hiding one changes only its `hidden`.
  let opened = signal(state.opened), pane = signal(state.pane)
  let watch = state.watch()
  clean.push(watch.subscribe(() =>
    batch(() => {
      opened.value = state.opened
      pane.value = state.pane
    })
  ))
  clean.push(() => watch.close())
  let rows = new Map<
    string,
    { head: Signal<string>; marked: Signal<boolean> }
  >()
  let row = (eid: string) => {
    let r = rows.get(eid)
    if (r) return r
    let seen = {
      head: signal(state.heading(eid)),
      marked: signal(state.marked(eid)),
    }
    rows.set(eid, seen)
    let watched = state.watchPanel(eid)
    clean.push(
      watched.subscribe(() =>
        batch(() => {
          seen.head.value = state.heading(eid)
          seen.marked.value = state.marked(eid)
        })
      ),
      () => watched.close(),
    )
    return seen
  }

  // A tab of a sheet, drawn again only as it is picked or marked.
  let TabView = (
    { leaf, on, marked }: {
      leaf: Leaf
      on: ReadonlySignal<boolean>
      marked: ReadonlySignal<boolean>
    },
  ) => {
    let keycap = leaf.spec!.keys[0] && cap(leaf.spec!.keys[0])
    return h(
      Tabs.Tab,
      {
        type: 'button',
        mod: on.value && 'on',
        role: 'tab',
        'aria-selected': String(on.value),
        'aria-label': leaf.spec!.title,
        'data-tip': leaf.spec!.title,
        'data-tip-key': keycap || undefined,
        onClick: leaf.page.show,
      },
      mark(leaf.spec!.icon),
      h('span', { class: 'Panel_TabLabel' }, leaf.spec!.title),
      keycap && h(ValeKeycap, { keycap }),
      marked.value && h(Tabs.Badge, {}),
    )
  }
  // A heading its owner writes as HTML, drawn again as it changes.
  let Title = (
    { head, sub }: { head: ReadonlySignal<string>; sub?: boolean },
  ) =>
    !sub || head.value
      ? h('h2', {
        class: sub ? 'Panel_Title Panel_Subtitle' : 'Panel_Title',
        dangerouslySetInnerHTML: { __html: head.value },
      })
      : null

  let sheet = (id: string, spec: Spec, leaves: Leaf[]) => {
    let host = doc.createElement('div')
    host.className = 'Panel_Mount'
    glass.append(host)
    let tabs = leaves.some((leaf) => leaf.name !== undefined)
    let key = tabs ? 'Esc' : cap(spec.keys?.[0] ?? 'Escape')
    let shut = computed(() => opened.value != id)
    let shown = leaves.map((leaf) => {
      let on = computed(() => pane.value == leaf.name)
      let hidden = computed(() => tabs && !on.value)
      // The owner's native body hides with its tab.
      clean.push(effect(() => {
        leaf.page.body.hidden = hidden.value
      }))
      return { leaf, on, hidden, ...(tabs && row(`${id}/${leaf.name}`)) }
    })
    let title = row(id).head
    render(
      h(
        'section',
        {
          class: `Panel Panel-${id}${tabs ? ' Panel-tabs' : ''}`,
          hidden: shut,
          'aria-label': spec.title,
          style: spec.tall ? { '--tall': spec.tall } : undefined,
          onpointerdown: (event: PointerEvent) => {
            event.stopPropagation()
            if (event.target == event.currentTarget) state.close(id)
          },
        },
        h(
          'div',
          { class: 'Panel_Sheet' },
          h(
            Head,
            { class: 'Panel_Head' },
            tabs
              ? h(
                Tabs,
                { class: 'Panel_Tabs', role: 'tablist' },
                shown.map(({ leaf, on, marked }) =>
                  h(TabView, { key: leaf.name, leaf, on, marked: marked! })
                ),
              )
              : h(Title, { head: title }),
            h(
              Button,
              {
                type: 'button',
                mod: 'quiet',
                class: 'Panel_Close',
                'aria-label': 'Close',
                'data-tip': 'Close',
                'data-tip-key': key,
                onClick: () => state.close(id),
              },
              mark('x'),
            ),
          ),
          shown.map(({ leaf, hidden, head }) =>
            h(
              Body,
              { key: leaf.name ?? id, class: 'Panel_Content', hidden },
              head && h(Title, { head, sub: true }),
              h('div', { class: 'Panel_Native', ref: leaf.mount }),
            )
          ),
        ),
      ),
      host,
    )
    clean.push(() => {
      render(null, host)
      host.remove()
    })
  }

  let add = (id: string, spec: Spec): Panel => {
    if (!state.heading(id)) {
      state.head(
        id,
        spec.title.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`),
      )
    }
    let native = body(doc)
    let panel: Panel = {
      body: native.node,
      get open() {
        return state.opened == id
      },
      show: () => {
        state.open(id)
      },
      close: () => {
        state.close(id)
      },
      toggle: () => {
        state.toggle(id)
      },
      head: (html) => {
        state.head(id, html)
      },
    }
    all.push({ keys: spec.keys, page: panel })
    sheet(id, spec, [{ page: panel, mount: native.mount }])
    return panel
  }

  let book = <T extends string>(
    id: string,
    spec: Spec & { tabs: Record<T, TabSpec> },
  ): Record<T, Tab> => {
    if (!state.heading(id)) state.head(id, spec.title)
    let leaves = Object.entries<TabSpec>(spec.tabs).map(([name, tab]) => {
      let native = body(doc, true)
      let page: Tab = {
        body: native.node,
        head: (html) => {
          state.head(`${id}/${name}`, html)
        },
        get open() {
          return state.opened == id && state.pane == name
        },
        show: () => {
          state.open(id, name)
        },
        close: () => {
          if (state.pane == name) state.close(id)
        },
        toggle: () => {
          state.toggle(id, name)
        },
        mark: (on) => {
          state.mark(`${id}/${name}`, on)
        },
      }
      all.push({ keys: tab.keys, page })
      return { name, spec: tab, page, mount: native.mount }
    })
    sheet(id, spec, leaves)
    return Object.fromEntries(
      leaves.map((leaf) => [leaf.name, leaf.page]),
    ) as Record<T, Tab>
  }

  let keys = (event: KeyboardEvent) => {
    if (event.code == 'Escape' && doc.pointerLockElement) return
    if (
      glass.hidden || event.metaKey || event.ctrlKey || event.altKey ||
      event.repeat
    ) return
    let target = event.target
    if (
      target instanceof doc.defaultView!.HTMLElement &&
      (target.matches('input, textarea') || target.isContentEditable)
    ) return
    let open = all.find((row) => row.page.open)?.page
    if (event.code == 'Escape' && open) {
      event.preventDefault()
      return open.close()
    }
    if (busy()) return
    let hit = all.find((row) => row.keys?.includes(event.code))?.page
    if (!hit) return
    event.preventDefault()
    hit.toggle()
  }
  doc.defaultView?.addEventListener('keydown', keys)
  return {
    add,
    book,
    get open() {
      return all.find((row) => row.page.open)?.page ?? null
    },
    dispose: () => {
      doc.defaultView?.removeEventListener('keydown', keys)
      clean.splice(0).forEach((off) => off())
    },
  }
}

/** How a key is written on a cap: `KeyB` is B, `Digit1` is 1.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   ['KeyB', 'Digit1', 'ShiftLeft', 'Escape', 'Space', 'Enter'].map(cap),
 *   ['B', '1', 'Shift', 'Esc', 'Space', 'Enter'],
 * )
 * ```
 */
export let cap = (code: string): string =>
  code.startsWith('Key')
    ? code.slice(3)
    : code.startsWith('Digit')
    ? code.slice(5)
    : code == 'Escape'
    ? 'Esc'
    : code.replace(/(Left|Right)$/, '')
