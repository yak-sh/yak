// The skill board, drawn into the hero's Skills tab as a pack is: the points
// to spend, and the three disciplines side by side, each skill a tile in its
// row, gold once learned, bright while a point can go on it, dim until what
// it needs is learned. Tap one to see what it does and learn it. By a village's fire, every skill can
// be forgotten, free, to spend the points again. K or the tray's sparkles
// opens it. It is written again only when what it shows changed.
import { ABILITIES, OFF } from './abilities.ts'
import { glyph, glyphText } from './glyphs.ts'
import type { Page } from './panel.ts'
import type { Frame, Sheet } from './play.ts'
import { canLearn, DISCIPLINES, SKILLS } from './skills.ts'
import { tipped } from './tip.ts'
import { split } from './ui/split.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export type Learning = {
  learn: (skill: string) => void
  respec: () => void
}

// Each discipline, and its skills row by row.
let COLS = Object.entries(DISCIPLINES).map(([d, about]) => {
  let ids = Object.keys(SKILLS).filter((id) => SKILLS[id].discipline == d)
  let rows = [...new Set(ids.map((id) => SKILLS[id].row))].sort((a, b) => a - b)
  return {
    ...about,
    rows: rows.map((r) => ids.filter((id) => SKILLS[id].row == r)),
  }
})

/** The board, drawn into its tab (panel.ts). */
export let board = (panel: Page, acts: Learning) => {
  let box = panel.body
  let panes = split(box)
  let picked = ''
  let was: unknown[] = []
  box.addEventListener('click', (e) => {
    let t = e.target instanceof Element ? e.target : null
    let pick = t?.closest<HTMLElement>('[data-skill]')?.dataset.skill
    let act = t?.closest<HTMLElement>('[data-do]')?.dataset.do
    if (pick) picked = pick
    if (act == 'learn' && picked) acts.learn(picked)
    if (act == 'respec') {
      acts.respec()
      picked = ''
    }
    was = []
  })

  // A skill as a tile: learned, open to learn now, or shut until what it
  // needs is learned or a point comes.
  let tile = (s: Sheet, id: string) => {
    let k = SKILLS[id]
    let state = s.learned.includes(id)
      ? 'known'
      : canLearn(id, s.learned, s.lvl)
      ? 'open'
      : 'shut'
    return `<button class="Board_Skill Board_Skill-${state}${
      picked == id ? ' Board_Skill-on' : ''
    }" data-skill=${id}${tipped({ name: k.name, says: k.says })}><i>${
      glyph(k.icon)
    }</i><span>${esc(k.name)}</span></button>`
  }

  // What the picked skill does, what it needs, and learning it.
  let card = (s: Sheet) => {
    let k = SKILLS[picked]
    if (!k) {
      return `<p class=Pack_Hint>Tap a skill to see what it does. Deeper ones need the one above them first.</p>`
    }
    let a = k.ability ? ABILITIES[k.ability] : undefined
    let second = k.hand ? ABILITIES[OFF[k.hand]] : undefined
    let what = a
      ? `${glyphText(a.icon)} ${esc(a.name)}, made stronger`
      : second
      ? `The second gives ${glyphText(second.icon)} ${esc(second.name)}`
      : 'Always on'
    let need = k.after && !s.learned.includes(k.after)
      ? `<span class=Pack_Hint>Needs ${esc(SKILLS[k.after].name)} first.</span>`
      : ''
    let act = s.learned.includes(picked)
      ? `<span class=Pack_Hint>Learned.</span>`
      : canLearn(picked, s.learned, s.lvl)
      ? `<button class="Btn Btn-go Btn-small" data-do=learn>Learn it</button>`
      : need ||
        `<span class=Pack_Hint>No points left. A level brings one.</span>`
    return `<div class=Pack_Card><i class=Pack_Big>${
      glyph(k.icon)
    }</i><div><b>${esc(k.name)}</b><span>${
      esc(k.says)
    } ${what}.</span></div>${act}</div>`
  }

  let draw = (s: Sheet, f: Frame) => {
    let cols = COLS.map((c) =>
      `<div class=Board_Col><div class=Board_Head><b>${
        glyph(c.icon)
      }${c.name}</b><small>${esc(c.says)}</small></div>${
        c.rows.map((row) =>
          `<div class=Board_Row>${row.map((id) => tile(s, id)).join('')}</div>`
        ).join('')
      }</div>`
    ).join('')
    let forget = !s.learned.length
      ? ''
      : f.rack
      ? `<button class="Btn Btn-small" data-do=respec>Forget them all, to choose again</button>`
      : `<p class=Pack_Hint>By a village's fire you can forget them all, free, to choose again.</p>`
    panes.render(
      `<div class="Pack Board">` +
        `<span class="Badge Board_Points${
          s.points ? ' Badge-points' : ''
        }">✦ ${s.points} to spend</span>` +
        `<div class=Board_Cols>${cols}</div>${forget}</div>`,
      card(s),
      picked || null,
    )
  }

  return {
    /** show this frame's sheet, when the board is open and it changed; what
     * was picked is let go once it folds away */
    show: (f: Frame) => {
      if (!panel.open) {
        picked = ''
        was = []
        return
      }
      let key = [f.sheet, f.rack, picked]
      if (key.every((k, i) => k === was[i])) return
      was = key
      draw(f.sheet, f)
    },
  }
}
