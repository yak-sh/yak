// The menu, drawn into its panel (panel.ts): what a player sets for
// themselves, the vale's sound and whether the camera follows them, and every
// key and touch the vale answers. The tray's last button opens it, and so does
// Escape when nothing else is open.
import { glyph } from './glyphs.ts'
import { SHEETS } from './hud.ts'
import { type Action, keysOf } from './input.ts'
import { cap, type Panel } from './panel.ts'

/** What the menu sets, and how it reads what is set. */
export type Settings = {
  muted: () => boolean
  mute: () => void
  follows: () => boolean
  follow: () => void
}

// Each key and what it does, the actions' keys read from input.ts.
let DOES: [Action, string][] = [
  ['strike', 'Strike'],
  ['ability1', 'The first of your abilities'],
  ['ability2', 'The second'],
  ['ability3', 'The third, from your other hand'],
  ['dodge', 'Dodge'],
  ['jump', 'Jump'],
  ['talk', 'Talk, or work what is near'],
  ['gather', 'Gather, or work a station'],
  ['drink', 'Drink a tonic'],
  ['snap', 'Camera behind you'],
  ['follow', 'Camera follows you, or stays'],
  ['mic', 'Microphone'],
]

let kbd = (keys: string[]) =>
  keys.map((k) => `<kbd class=Key>${k}</kbd>`).join(' ')

let KEYS = [
  [kbd(['W', 'A', 'S', 'D']), 'Move'],
  [`drag`, 'Look around'],
  [`wheel`, 'Nearer or further'],
  ...DOES.map(([a, what]) => [kbd(keysOf(a).map(cap)), what]),
  [kbd(['Enter']), 'Chat'],
  ...Object.values(SHEETS).flatMap((s) =>
    'keys' in s
      ? [[kbd(s.keys.map(cap)), s.title]]
      : 'tabs' in s
      ? Object.values(s.tabs).map((t) => [kbd(t.keys.map(cap)), t.title])
      : []
  ),
].map(([k, what]) => `<dt>${k}</dt><dd>${what}</dd>`).join('')

let TOUCH = [
  ['Left thumb', 'Move, wherever it lands'],
  ['Drag on the right', 'Look around'],
  ['Tap the world', 'Strike'],
].map(([k, what]) => `<dt>${k}</dt><dd>${what}</dd>`).join('')

/** The menu, answering `o`. */
export let menu = (panel: Panel, o: Settings) => {
  let was = ''
  panel.body.addEventListener('click', (e) => {
    let act = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-do]')?.dataset.do
      : null
    if (act == 'sound') o.mute()
    if (act == 'follow') o.follow()
    was = ''
  })
  let toggle = (act: string, on: boolean, icon: string, what: string) =>
    `<button class="Menu_Set${
      on ? ' Menu_Set-on' : ''
    }" data-do=${act} aria-pressed=${on}>${icon}<span>${what}</span></button>`
  return {
    /** show what is set, when the menu is open and it changed */
    show: () => {
      if (!panel.open) return
      let sound = !o.muted(), follows = o.follows()
      let html = `<div class=Menu>` +
        toggle(
          'sound',
          sound,
          glyph(sound ? 'sound' : 'soundOff'),
          sound ? 'Sound is on' : 'Sound is off',
        ) +
        toggle(
          'follow',
          follows,
          glyph(follows ? 'video' : 'videoOff'),
          follows
            ? 'The camera follows you'
            : 'The camera stays where you turn it',
        ) +
        `<h3 class=Menu_Head>Touch</h3><dl class="Menu_Keys Menu_Keys-touch">${TOUCH}</dl>` +
        `<h3 class=Menu_Head>Keys</h3><dl class="Menu_Keys Menu_Keys-keys">${KEYS}</dl>` +
        `</div>`
      if (html == was) return
      was = html
      panel.body.innerHTML = html
    },
  }
}
