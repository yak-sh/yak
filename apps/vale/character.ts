// The hero themselves, drawn into their panel's Character tab: their
// likeness (portrait.ts), their name and level with the xp to the next, how
// they fight in what they wear and the abilities it gives them, and the name
// and colours they were made with, to change (make.ts). What is picked shows
// on the likeness at once; keeping it writes a look row (net.ts `restyle`),
// and everyone near sees it. H or a tap on the hero's frame on the glass
// opens it. What changes with the hero is written again only when it
// changed, and the picking only as the tab opens, so a name being written is
// never written over.
import { ABILITIES } from './abilities.ts'
import { LINES, numbers, said } from './compare.ts'
import type { Dress } from './figures.ts'
import { glyphText } from './glyphs.ts'
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
  box.innerHTML = `<div class=Character>` +
    `<div class=Character_Top><canvas class=Character_Face></canvas><div class=Character_Who></div></div>` +
    `<h3 class=Pack_Head>Your look</h3><form class=Make></form></div>`
  let face = box.querySelector<HTMLCanvasElement>('.Character_Face')!
  let who = box.querySelector<HTMLElement>('.Character_Who')!
  let form = box.querySelector<HTMLFormElement>('.Make')!
  // The look being picked, and the one kept, while the tab is open.
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
    /** show this frame's sheet and the look kept, when the tab is open;
     * what was picked is let go once it folds away */
    show: (s: Sheet, look: Look) => {
      if (!tab.open) {
        kept = null
        was = []
        drawn = ''
        return
      }
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
      let pic = JSON.stringify([picking, dress, face.clientWidth])
      if (pic != drawn) {
        drawn = pic
        acts.paint(face, picking, dress)
      }
      if (was[0] === s) return
      was = [s]
      let n = numbers(s, s.worn)
      let from = need(s.lvl), to = need(s.lvl + 1)
      let nums =
        LINES.filter((l) => (l.k != 'speed' && l.k != 'twin') || n[l.k])
          .map((l) => `<span class=Pack_Num>${said(l, n[l.k])}</span>`).join(
            '',
          ) +
        s.abilities.map((id, i) =>
          ABILITIES[id]
            ? `<span class=Pack_Num><kbd class=Key>${i + 1}</kbd> ${
              glyphText(ABILITIES[id].icon)
            } ${esc(ABILITIES[id].name)}</span>`
            : ''
        ).join('')
      who.innerHTML = `<b class=Character_Name>${
        esc(s.name)
      }</b><span class=Character_Level><span class=Badge>Level ${s.lvl}</span><small>${
        s.xp - from
      } / ${to - from} xp</small></span><div class=Pack_Nums>${nums}</div>`
    },
  }
}
