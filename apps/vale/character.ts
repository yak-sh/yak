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
import { split } from './ui/split.ts'

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
  let panes = split(box)
  // Mount both sections once: navigation must not replace the canvas or draft.
  panes.render(
    `<button class=Split_Row type=button data-select=overview>Overview</button>` +
      `<button class=Split_Row type=button data-select=appearance>Appearance</button>`,
    `<section data-section=overview><div class=Character>` +
      `<div class=Character_Top><canvas class=Character_Face></canvas><div class=Character_Who></div></div></div></section>` +
      `<section data-section=appearance hidden><div class=Character>` +
      `<h3 class=Pack_Head>Your look</h3><form class=Make></form></div></section>`,
    'overview',
  )
  panes.list.addEventListener('click', (e) => {
    let row = (e.target as HTMLElement).closest<HTMLElement>('[data-select]')
    if (!row) return
    let picked = row.dataset.select
    for (
      let section of panes.detail.querySelectorAll<HTMLElement>(
        '[data-section]',
      )
    ) {
      section.hidden = section.dataset.section != picked
    }
    for (
      let choice of panes.list.querySelectorAll<HTMLElement>('[data-select]')
    ) {
      let on = choice.dataset.select == picked
      choice.classList.toggle('Split_Row-on', on)
      choice.setAttribute('aria-pressed', String(on))
    }
    box.querySelector('.Split')!.classList.add('Split-picked')
  })
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
      // A hidden overview has no layout width; leave its canvas intact until
      // it is visible again, then paint any changes made in Appearance.
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
      }</b><span class=Character_Level><span class=Badge>Level ${s.lvl}</span><small>${xp}</small></span><div class=Pack_Nums>${nums}</div>`
    },
  }
}
