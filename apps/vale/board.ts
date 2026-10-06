// The skill board, drawn into the hero's Skills tab: the points to spend,
// then each discipline's skills in a list, from the first row down, each
// with what it does; a learned one is checked, and one shut until what it
// needs is learned or a point comes is faded, saying what it waits on. Tap
// one to see what it does and learn it. By a village's fire, every skill can
// be forgotten, free, to spend the points again. K or the tray's sparkles
// opens it. It is written again only when what it shows changed.
import { h } from 'preact'
import { Body, Button, Rows, Section, Tile } from '@yaks/ui'
import { ABILITIES, OFF } from './abilities.ts'
import { glyph } from './glyphs.ts'
import type { Page } from './panel.ts'
import type { Frame, Sheet } from './play.ts'
import { canLearn, DISCIPLINES, SKILLS } from './skills.ts'
import { skillDetail } from './skill-detail.ts'
import { hint, mark, picture } from './tile.ts'
import { split } from './ui/split.ts'

export type Learning = {
  learn: (skill: string) => void
  respec: () => void
}

// Each discipline, and its skills from its first row down.
let COLS = Object.entries(DISCIPLINES).map(([d, about]) => ({
  ...about,
  skills: Object.keys(SKILLS).filter((id) => SKILLS[id].discipline == d)
    .sort((a, b) => SKILLS[a].row - SKILLS[b].row),
}))

/** The board, drawn into its tab (panel.ts). */
export let board = (panel: Page, acts: Learning) => {
  let box = panel.body
  let panes = split(box)
  let picked = ''
  let was: unknown[] = []
  box.addEventListener('click', (e) => {
    let t = e.target instanceof Element ? e.target : null
    let act = t?.closest<HTMLElement>('[data-do]')?.dataset.do
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
    let k = SKILLS[id], known = s.learned.includes(id)
    let open = canLearn(id, s.learned, s.lvl)
    let waits = !known && !open && k.after && !s.learned.includes(k.after)
    return h(
      Tile,
      {
        key: id,
        mod: [picked == id && 'on', !known && !open && 'dim'],
        'data-skill': id,
        onClick: () => {
          picked = id
          was = []
        },
      },
      picture(glyph(k.icon), { mod: known && 'positive' }),
      h(Tile.Title, {}, k.name),
      h(Tile.Sub, {}, waits ? `Needs ${SKILLS[k.after!].name} first` : k.says),
      known
        ? h(Tile.End, {
          'aria-label': 'Learned',
          dangerouslySetInnerHTML: { __html: glyph('done') },
        })
        : null,
    )
  }
  // What the picked skill does, what it needs, and learning it.
  let card = (s: Sheet) => {
    let k = SKILLS[picked]
    if (!k) {
      return hint(
        'Tap a skill to see what it does. Deeper ones need the one above them first.',
      )
    }
    let known = s.learned.includes(picked)
    let open = canLearn(picked, s.learned, s.lvl)
    let a = k.ability ? ABILITIES[k.ability] : undefined
    let second = k.hand ? ABILITIES[OFF[k.hand]] : undefined
    let what = a
      ? `${a.name}, made stronger`
      : second
      ? `The second gives ${second.name}`
      : 'Always on'
    let why = known || open
      ? ''
      : k.after && !s.learned.includes(k.after)
      ? `Needs ${SKILLS[k.after].name} first.`
      : 'No points left. A level brings one.'
    return [
      h(
        Tile,
        { mod: 'head' },
        picture(glyph(k.icon), { mod: known && 'positive' }),
        h(Tile.Title, {}, k.name),
        h(
          Tile.Sub,
          {},
          `${DISCIPLINES[k.discipline].name} · ${
            k.boon ? 'Passive' : k.hand ? 'Second weapon' : 'Ability'
          }`,
        ),
        why && h(Tile.Sub, { mod: 'negative' }, why),
        h(
          Tile.End,
          {},
          known
            ? 'Learned.'
            : open && h(Button, { mod: 'go', 'data-do': 'learn' }, 'Learn it'),
        ),
      ),
      h(Body, {}, h('p', {}, `${k.says} ${what}.`)),
      ...skillDetail(s, picked),
    ]
  }

  let draw = (s: Sheet, f: Frame) => {
    let forget = !s.learned.length ? null : f.rack
      ? h(
        Button,
        { 'data-do': 'respec' },
        'Forget them all, to choose again',
      )
      : hint(
        "By a village's fire you can forget them all, free, to choose again.",
      )
    panes.render(
      h(
        'div',
        { class: 'Pack Board' },
        h(
          'span',
          { class: `Badge Board_Points${s.points ? ' Badge-points' : ''}` },
          `✦ ${s.points} to spend`,
        ),
        COLS.map((c) =>
          h(
            Section,
            { key: c.name },
            h(Section.Title, {}, mark(c.icon), c.name),
            h(Section.Sub, {}, c.says),
            h(Rows, {}, c.skills.map((id) => tile(s, id))),
          )
        ),
        forget,
      ),
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
