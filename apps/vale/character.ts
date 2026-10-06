// Character stats and a live portrait stay beside the appearance editor.
// Mount once so frames and panel navigation preserve the canvas and draft.
import { h, render } from 'preact'
import { ABILITIES } from './abilities.ts'
import { LINES, numbers, sheetStats, stat, stats } from './compare.ts'
import type { Dress } from './figures.ts'
import { ValeKeycap } from './kit/ValeKeycap.ts'
import { fields, type Look, lookOf, picks } from './make.ts'
import type { Page } from './panel.ts'
import type { Sheet } from './play.ts'
import { need } from './rules.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

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

/** The Character tab, drawn into its tab (panel.ts). */
export let character = (tab: Page, acts: Acts) => {
  let box = tab.body
  box.innerHTML = `<div class=Character_Panes>` +
    `<section class=Character aria-label=Character>` +
    `<div class=Character_Top><div class=Character_Portrait>` +
    `<canvas class=Character_Face aria-label="Your portrait"></canvas></div>` +
    `<div class=Character_Who></div></div><div class=Character_Stats></div></section>` +
    `<section class=Character aria-label=Appearance>` +
    `<h3 class=Pack_Head>Your look</h3><form class=Make></form>` +
    `</section></div>`
  let face = box.querySelector<HTMLCanvasElement>('.Character_Face')!
  let who = box.querySelector<HTMLElement>('.Character_Who')!
  let numbersBox = box.querySelector<HTMLElement>('.Character_Stats')!
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
          `<button class="Btn Btn-go" data-do=keep>Keep this look</button>`
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
      let n = numbers(s, s.worn)
      let from = need(s.lvl), to = need(s.lvl + 1)
      let xp = s.lvl == 60 ? 'Max level' : `${s.xp - from} / ${to - from} xp`
      let lines = LINES.filter((l) =>
        (l.k != 'speed' && l.k != 'twin') || n[l.k]
      )
      who.innerHTML = `<b class=Character_Name>${
        esc(s.name)
      }</b><span class=Character_Level><span class=Badge>Level ${s.lvl}</span><small>${xp}</small></span>`
      render(
        stats(
          [
            ...sheetStats(n, lines),
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
        ),
        numbersBox,
      )
    },
  }
}
