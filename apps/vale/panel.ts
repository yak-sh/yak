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
import { tip } from './tip.ts'

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

let el = (tag: string, cls: string) => {
  let e = document.createElement(tag)
  e.className = cls
  return e
}

/** The panels over `glass`. `busy` says when the keyboard belongs to
 * something else: a line being written, someone being talked to. */
export let panels = (glass: HTMLElement, busy: () => boolean) => {
  // Every page, the keys that open it, and the box it shows in.
  let all: { keys?: string[]; page: Page; box: HTMLElement }[] = []

  // A sheet over the glass, its head holding its close button, and its box
  // shown, folding every other away, or hidden.
  let sheet = (id: string, spec: Spec, key: string) => {
    let box = el('section', `Panel Panel-${id}`)
    box.hidden = true
    box.setAttribute('aria-label', spec.title)
    if (spec.tall) box.style.setProperty('--tall', spec.tall)
    let paper = el('div', 'Panel_Sheet')
    let top = el('header', 'Panel_Head')
    let shut = el('button', 'Orb Orb-small Panel_Close')
    shut.innerHTML = glyph('x')
    tip(shut, { name: 'Close', key })
    top.append(shut)
    paper.append(top)
    box.append(paper)
    glass.append(box)
    let hide = () => {
      box.hidden = true
    }
    let show = () => {
      for (let o of all) if (o.box != box) o.box.hidden = true
      box.hidden = false
    }
    // A tap beside the sheet folds it away, and no tap on it reaches the
    // scene.
    box.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      if (e.target == box) hide()
    })
    shut.addEventListener('click', hide)
    return { box, paper, top, show, hide }
  }

  let add = (id: string, spec: Spec): Panel => {
    let s = sheet(id, spec, spec.keys?.length ? cap(spec.keys[0]) : 'Esc')
    let title = el('h2', 'Panel_Title')
    title.textContent = spec.title
    s.top.prepend(title)
    let body = el('div', 'Panel_Body')
    s.paper.append(body)
    let was = ''
    let panel: Panel = {
      body,
      get open() {
        return !s.box.hidden
      },
      show: s.show,
      close: s.hide,
      toggle: () => panel.open ? s.hide() : s.show(),
      head: (html) => {
        if (html == was) return
        was = html
        title.innerHTML = html
      },
    }
    all.push({ keys: spec.keys, page: panel, box: s.box })
    return panel
  }

  /** A panel with tabs, in the order its spec gives them. Its sheet keeps
   * one size whichever shows (ui/Panel.css `Panel-tabs`). */
  let book = <T extends string>(
    id: string,
    spec: Spec & { tabs: Record<T, TabSpec> },
  ): Record<T, Tab> => {
    let s = sheet(id, spec, 'Esc')
    s.box.classList.add('Panel-tabs')
    let row = el('nav', 'Panel_Tabs')
    row.setAttribute('role', 'tablist')
    s.top.prepend(row)
    let on = ''
    let made = Object.entries<TabSpec>(spec.tabs).map(([name, t]) => {
      let key = cap(t.keys[0])
      let b = el('button', 'Panel_Tab')
      b.setAttribute('role', 'tab')
      b.innerHTML = `${
        glyph(t.icon)
      }<span>${t.title}</span><kbd class=Key>${key}</kbd>`
      tip(b, { name: t.title, key })
      row.append(b)
      let body = el('div', 'Panel_Body')
      body.setAttribute('role', 'tabpanel')
      body.hidden = true
      s.paper.append(body)
      let page: Tab = {
        body,
        get open() {
          return !s.box.hidden && on == name
        },
        show: () => {
          on = name
          for (let m of made) {
            m.body.hidden = m.name != name
            m.b.setAttribute('aria-selected', String(m.name == name))
          }
          s.show()
        },
        close: () => {
          if (on == name) s.hide()
        },
        toggle: () => page.open ? page.close() : page.show(),
        mark: (yes) => {
          b.classList.toggle('Panel_Tab-new', yes)
        },
      }
      b.addEventListener('click', page.show)
      all.push({ keys: t.keys, page, box: s.box })
      return { name, b, body, page }
    })
    return Object.fromEntries(made.map((m) => [m.name, m.page])) as Record<
      T,
      Tab
    >
  }

  addEventListener('keydown', (e) => {
    if (glass.hidden || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    if (e.target instanceof HTMLInputElement) return
    let open = all.find((o) => o.page.open)?.page
    if (e.code == 'Escape' && open) {
      e.preventDefault()
      return open.close()
    }
    if (busy()) return
    let hit = all.find((o) => o.keys?.includes(e.code))?.page
    if (!hit) return
    e.preventDefault()
    hit.toggle()
  })

  return {
    add,
    book,
    /** the page open now, if one */
    get open() {
      return all.find((o) => o.page.open)?.page ?? null
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
