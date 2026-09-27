// The panels: the sheets that open over the glass, the map, the pack and every
// one after them (hud.ts lists them). One is open at a time, and opening
// another folds it away. Its keys, Escape, a tap beside it or its close button
// fold it away too, and Escape with nothing open opens the panel that lists
// Escape among its keys. Each is a head, its title and whatever its owner
// puts beside it, over a body its owner draws into while it is open.
import { glyph } from './glyphs.ts'
import { tip } from './tip.ts'

/** One panel, as its owner holds it. */
export type Panel = {
  /** where its owner draws */
  body: HTMLElement
  readonly open: boolean
  show: () => void
  close: () => void
  toggle: () => void
  /** what its head says, as HTML: a title, and anything beside it */
  head: (html: string) => void
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

let el = (tag: string, cls: string) => {
  let e = document.createElement(tag)
  e.className = cls
  return e
}

/** The panels over `glass`. `busy` says when the keyboard belongs to
 * something else: a line being written, someone being talked to. */
export let panels = (glass: HTMLElement, busy: () => boolean) => {
  let all: [Spec, Panel][] = []

  let add = (id: string, spec: Spec): Panel => {
    let box = el('section', `Panel Panel-${id}`)
    box.hidden = true
    box.setAttribute('aria-label', spec.title)
    if (spec.tall) box.style.setProperty('--tall', spec.tall)
    let sheet = el('div', 'Panel_Sheet')
    let top = el('header', 'Panel_Head')
    let title = el('h2', 'Panel_Title')
    title.textContent = spec.title
    let shut = el('button', 'Orb Orb-small Panel_Close')
    shut.innerHTML = glyph('x')
    tip(shut, {
      name: 'Close',
      key: spec.keys?.length ? cap(spec.keys[0]) : 'Esc',
    })
    let body = el('div', 'Panel_Body')
    top.append(title, shut)
    sheet.append(top, body)
    box.append(sheet)
    glass.append(box)
    let was = ''
    let panel: Panel = {
      body,
      get open() {
        return !box.hidden
      },
      show: () => {
        for (let [, p] of all) if (p != panel) p.close()
        box.hidden = false
      },
      close: () => {
        box.hidden = true
      },
      toggle: () => panel.open ? panel.close() : panel.show(),
      head: (html) => {
        if (html == was) return
        was = html
        title.innerHTML = html
      },
    }
    // A tap beside the sheet folds it away, and no tap on it reaches the
    // scene.
    box.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      if (e.target == box) panel.close()
    })
    shut.addEventListener('click', panel.close)
    all.push([spec, panel])
    return panel
  }

  addEventListener('keydown', (e) => {
    if (glass.hidden || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
    if (e.target instanceof HTMLInputElement) return
    let open = all.find(([, p]) => p.open)?.[1]
    if (e.code == 'Escape' && open) {
      e.preventDefault()
      return open.close()
    }
    if (busy()) return
    let hit = all.find(([s]) => s.keys?.includes(e.code))?.[1]
    if (!hit) return
    e.preventDefault()
    hit.toggle()
  })

  return {
    add,
    /** the panel open now, if one */
    get open() {
      return all.find(([, p]) => p.open)?.[1] ?? null
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
