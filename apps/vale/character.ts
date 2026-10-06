// Character stats and a live portrait stay beside the appearance editor.
// Mount once so frames and panel navigation preserve the canvas and draft.
import { h, render } from 'preact'
import { Section } from '@yaks/ui'
import { ABILITIES } from './abilities.ts'
import { LINES, numbers, sheetStats, stat, stats } from './compare.ts'
import type { Dress } from './figures.ts'
import { ValeKeycap } from './kit/ValeKeycap.ts'
import { ValeMeter } from './kit/ValeMeter.ts'
import { fields, type Look, lookOf, picks } from './make.ts'
import type { Page } from './panel.ts'
import type { Sheet } from './play.ts'
import { need } from './rules.ts'

export type Acts = {
  /** keep a new look */
  restyle: (look: Look) => void
  /** whether the name has the keyboard */
  typing: (on: boolean) => void
  /** draw a likeness onto a canvas (portrait.ts) */
  paint: (canvas: HTMLCanvasElement, look: Look, dress: Dress) => void
}

let same = (a: Look, b: Look) =>
  a.name == b.name && a.tint == b.tint && a.hair == b.hair && a.skin == b.skin

// The hero: their name, and how far they are toward their next level.
let who = (s: Sheet) => {
  let from = need(s.lvl), to = need(s.lvl + 1)
  return h(
    'div',
    { class: 'Character_Who' },
    h('b', { class: 'Character_Name' }, s.name),
    s.lvl == 60 ? h('small', {}, 'Max level') : h(ValeMeter, {
      label: 'XP',
      value: s.xp - from,
      max: to - from,
      tone: 'experience',
    }),
  )
}

// The numbers the hero fights by, and their abilities by the keys that use
// them.
let fights = (s: Sheet) => {
  let n = numbers(s, s.worn)
  return stats(
    [
      ...sheetStats(
        n,
        LINES.filter((l) => (l.k != 'speed' && l.k != 'twin') || n[l.k]),
      ),
      ...s.abilities.flatMap((id, i) =>
        ABILITIES[id]
          ? [
            stat(
              ABILITIES[id].icon,
              h(ValeKeycap, { keycap: String(i + 1) }),
              ' ',
              ABILITIES[id].name,
            ),
          ]
          : []
      ),
    ],
    true,
  )
}

// The tab: the hero beside their likeness and their numbers, then their
// look to change. The canvas and the form stay the same elements whatever
// is drawn around them, so a likeness drawn and a look half picked stay.
let page = (s?: Sheet) =>
  h(
    'div',
    { class: 'Split Split-both' },
    h(
      Section,
      { class: 'Split_List Character', 'aria-label': 'Character' },
      h(
        'div',
        { class: 'Character_Top' },
        h(
          'div',
          { class: 'Character_Portrait' },
          h('canvas', {
            class: 'Character_Face',
            'aria-label': 'Your portrait',
          }),
          s && h('span', { class: 'Badge' }, `Level ${s.lvl}`),
        ),
        s && who(s),
      ),
      s && fights(s),
    ),
    h(
      Section,
      { class: 'Split_Detail Character', 'aria-label': 'Appearance' },
      h(Section.Title, {}, 'Your look'),
      h('form', { class: 'Make' }),
    ),
  )

/** The Character tab, drawn into its tab (panel.ts). */
export let character = (tab: Page, acts: Acts) => {
  let box = tab.body
  box.classList.add('Split_Host')
  render(page(), box)
  let face = box.querySelector<HTMLCanvasElement>('.Character_Face')!
  let form = box.querySelector<HTMLFormElement>('.Make')!
  // Keep the unfinished look even while another panel is open.
  let picking: Look = { name: '', tint: '', hair: '', skin: '' }
  let kept: Look | null = null
  let changed = () => {
    let b = form.querySelector<HTMLButtonElement>('[data-do=keep]')
    if (b && kept) b.disabled = !picking.name || same(picking, kept)
  }
  picks(form, picking, changed, acts.typing)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!picking.name || !kept || same(picking, kept)) return
    acts.restyle({ ...picking })
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })

  let was: unknown[] = []
  let drawn = ''
  return {
    /** Show this frame without replacing the appearance draft. */
    show: (s: Sheet, look: Look) => {
      if (!tab.open) return
      if (!kept) {
        Object.assign(picking, lookOf(look))
        form.innerHTML = fields(picking) +
          `<button class="Button Button-go" data-do=keep>Keep this look</button>`
      }
      kept = look
      changed()
      let dress: Dress = Object.fromEntries(
        Object.entries(s.worn).map(([slot, h]) => [slot, h?.kind]),
      )
      // Wait for layout, and repaint only when the look, gear or size changes.
      let width = face.clientWidth
      if (width) {
        let pic = JSON.stringify([picking, dress, width])
        if (pic != drawn) {
          drawn = pic
          acts.paint(face, picking, dress)
        }
      }
      if (was[0] === s) return
      was = [s]
      render(page(s), box)
    },
  }
}
