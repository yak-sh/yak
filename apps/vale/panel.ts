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
import { type Glyph, glyph } from './glyphs.ts'
import { h, render } from 'preact'
import { Body, Button, Head } from '@yaks/ui'
import { type PageState, pageState } from './page-state.ts'

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
export type Tab = Page & {
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
  let paints: (() => void)[] = []
  let clean: (() => void)[] = []
  let watch = state.watch()
  clean.push(watch.subscribe(() => paints.forEach((paint) => paint())))
  clean.push(() => watch.close())

  let sheet = (id: string, spec: Spec, leaves: Leaf[]) => {
    let host = doc.createElement('div')
    host.className = 'Panel_Mount'
    glass.append(host)
    let tabs = leaves.some((leaf) => leaf.name !== undefined)
    let key = tabs ? 'Esc' : cap(spec.keys?.[0] ?? 'Escape')
    let paint = () =>
      render(
        h(
          'section',
          {
            class: `Panel Panel-${id}${tabs ? ' Panel-tabs' : ''}`,
            hidden: state.opened != id,
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
                  'nav',
                  { class: 'Panel_Tabs', role: 'tablist' },
                  leaves.map((leaf) =>
                    h(
                      Button,
                      {
                        key: leaf.name,
                        type: 'button',
                        class: `Panel_Tab${
                          state.marked(`${id}/${leaf.name}`)
                            ? ' Panel_Tab-new'
                            : ''
                        }`,
                        role: 'tab',
                        'aria-selected': String(state.pane == leaf.name),
                        'aria-label': leaf.spec!.title,
                        'data-tip': leaf.spec!.title,
                        'data-tip-key': cap(leaf.spec!.keys[0]),
                        onClick: leaf.page.show,
                      },
                      h('span', {
                        dangerouslySetInnerHTML: {
                          __html: glyph(leaf.spec!.icon),
                        },
                      }),
                      h('span', {}, leaf.spec!.title),
                      h('kbd', { class: 'Key' }, cap(leaf.spec!.keys[0])),
                    )
                  ),
                )
                : h('h2', {
                  class: 'Panel_Title',
                  dangerouslySetInnerHTML: { __html: state.heading(id) },
                }),
              h(Button, {
                type: 'button',
                class: 'Orb Orb-small Panel_Close',
                'aria-label': 'Close',
                'data-tip': 'Close',
                'data-tip-key': key,
                onClick: () => state.close(id),
                dangerouslySetInnerHTML: { __html: glyph('x') },
              }),
            ),
            leaves.map((leaf) => {
              leaf.page.body.hidden = tabs && state.pane != leaf.name
              return h(
                Body,
                { key: leaf.name ?? id, class: 'Panel_Content' },
                h('div', { class: 'Panel_Native', ref: leaf.mount }),
              )
            }),
          ),
        ),
        host,
      )
    paints.push(paint)
    let ids = [
      id,
      ...leaves.filter((leaf) => leaf.name !== undefined)
        .map((leaf) => `${id}/${leaf.name}`),
    ]
    for (let eid of ids) {
      let row = state.watchPanel(eid)
      clean.push(row.subscribe(paint), () => row.close())
    }
    clean.push(() => {
      render(null, host)
      host.remove()
    })
    paint()
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
    let leaves = Object.entries<TabSpec>(spec.tabs).map(([name, tab]) => {
      let native = body(doc, true)
      let page: Tab = {
        body: native.node,
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
