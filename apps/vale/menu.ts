// The menu, drawn into its panel (panel.ts): what a player sets for
// themselves, the vale's sound and camera controls, and every
// key and touch the vale answers. The tray's last button opens it, and so does
// Escape when nothing else is open.
import { glyph } from './glyphs.ts'
import { SHEETS } from './hud.ts'
import { type Action, keysOf } from './input.ts'
import { cap, type Panel } from './panel.ts'
import { VOXEL, VOXELS } from './terrain.ts'

/** What the menu sets, and how it reads what is set. */
type Level = { readonly level: number; set: (value: number) => void }

export type Settings = {
  muted: () => boolean
  mute: () => void
  music: Level & {
    readonly muted: boolean
    toggle: () => void
  }
  effects: Level
  voice: Level
  swapped: () => boolean
  swap: () => void
  strafes: () => boolean
  strafe: () => void
  voxel: { current: number; apply: (size: number) => void }
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
  ['mic', 'Microphone'],
]

let kbd = (keys: string[]) =>
  keys.map((k) => `<kbd class=Key>${k}</kbd>`).join(' ')

let keys = (swapped: boolean, strafes: boolean) =>
  [
    [kbd(['W', 'S', '↑', '↓']), 'Walk forward or back'],
    [kbd(['A', 'D']), strafes ? 'Strafe' : 'Turn with the camera'],
    [kbd(['←', '→']), 'Turn with the camera'],
    [swapped ? 'right drag' : 'left drag', 'Turn the camera and your hero'],
    [swapped ? 'left drag' : 'right drag', 'Orbit without turning your hero'],
    ['left + right mouse buttons', 'Walk forward; move the mouse to steer'],
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
  let selected = VOXELS.includes(o.voxel.current) ? o.voxel.current : VOXEL
  let volumes = { music: o.music, effects: o.effects, voice: o.voice }
  panel.body.addEventListener('click', (e) => {
    let act = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-do]')?.dataset.do
      : null
    if (act == 'sound') o.mute()
    if (act == 'music') o.music.toggle()
    if (act == 'swap') o.swap()
    if (act == 'strafe') o.strafe()
    if (act == 'voxel' && selected != o.voxel.current) {
      o.voxel.apply(selected)
    }
    if (
      act == 'sound' || act == 'music' || act == 'swap' ||
      act == 'strafe'
    ) {
      was = ''
    }
  })
  panel.body.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return
    if (e.target.dataset.voxel != null) {
      selected = VOXELS[Number(e.target.value)] ?? o.voxel.current
      let choice = panel.body.querySelector('[data-voxel-choice]')
      if (choice) choice.textContent = `${selected} m`
      let apply = panel.body.querySelector<HTMLButtonElement>('[data-do=voxel]')
      if (apply) apply.disabled = selected == o.voxel.current
      let cost = panel.body.querySelector<HTMLElement>('[data-voxel-cost]')
      if (cost) cost.hidden = selected != 0.125
      return
    }
    let name = e.target.dataset.volume
    let level = name == 'music'
      ? volumes.music
      : name == 'effects'
      ? volumes.effects
      : name == 'voice'
      ? volumes.voice
      : null
    if (!level) return
    level.set(Number(e.target.value) / 100)
    let value = e.target.parentElement?.querySelector('output')
    if (value) value.textContent = `${e.target.value}%`
  })
  let toggle = (act: string, on: boolean, icon: string, what: string) =>
    `<button class="Menu_Set${
      on ? ' Menu_Set-on' : ''
    }" data-do=${act} aria-pressed=${on}>${icon}<span>${what}</span></button>`
  let slider = (name: keyof typeof volumes, label: string) => {
    let value = Math.round(volumes[name].level * 100)
    return `<div class=Menu_Volume>` +
      `<label for=Menu_${name}>${label}</label>` +
      `<output for=Menu_${name}>${value}%</output>` +
      `<input id=Menu_${name} type=range data-volume=${name} ` +
      `min=0 max=100 value=${value}></div>`
  }
  let voxel = () => {
    let index = VOXELS.indexOf(selected)
    return `<div class="Menu_Volume Menu_Voxel">` +
      `<label for=Menu_voxel>Terrain voxel size</label>` +
      `<output for=Menu_voxel data-voxel-choice>${selected} m</output>` +
      `<input id=Menu_voxel type=range data-voxel min=0 max=${
        VOXELS.length - 1
      } step=1 value=${index}>` +
      `<div class=Menu_VoxelTicks><span>Fine · 0.125 m</span>` +
      `<span>Chunky · 2 m</span></div>` +
      `<p class=Menu_VoxelNote>Current: ${o.voxel.current} m. Reloads at your ` +
      `spot to compare. The layout and placements stay; terrain steps can ` +
      `shift as the surface is sampled and rounded.</p>` +
      `<p class=Menu_VoxelNote data-voxel-cost${
        selected == 0.125 ? '' : ' hidden'
      }>0.125 m makes about four times as much ground geometry as 0.25 m, ` +
      `and nearby trees and rocks gain detail. Loading can take several ` +
      `seconds and frame rate may drop.</p>` +
      `<button class="Btn Btn-go" data-do=voxel${
        selected == o.voxel.current ? ' disabled' : ''
      }>Apply and reload</button></div>`
  }
  return {
    /** show what is set, when the menu is open and it changed */
    show: () => {
      if (!panel.open) return
      let sound = !o.muted(), swapped = o.swapped()
      let strafes = o.strafes()
      let playing = !o.music.muted
      let key = `${sound} ${playing} ${swapped} ${strafes}`
      if (key == was) return
      was = key
      let html = `<div class=Menu>` +
        toggle(
          'sound',
          sound,
          glyph(sound ? 'sound' : 'soundOff'),
          sound ? 'Sound is on' : 'Sound is off',
        ) +
        toggle(
          'music',
          playing,
          glyph(playing ? 'sound' : 'soundOff'),
          playing ? 'Music is on' : 'Music is off',
        ) +
        slider('music', 'Music volume') +
        slider('effects', 'Effects and ambience volume') +
        slider('voice', 'Player voice volume') +
        voxel() +
        toggle(
          'swap',
          swapped,
          glyph('video'),
          swapped
            ? 'Right drag steers; left drag looks'
            : 'Left drag steers; right drag looks',
        ) +
        toggle(
          'strafe',
          strafes,
          glyph('footprints'),
          strafes ? 'A/D strafes' : 'A/D turns',
        ) +
        `<h3 class=Menu_Head>Touch</h3><dl class="Menu_Keys Menu_Keys-touch">${TOUCH}</dl>` +
        `<h3 class=Menu_Head>Keys</h3><dl class="Menu_Keys Menu_Keys-keys">${
          keys(swapped, strafes)
        }</dl>` +
        `</div>`
      panel.body.innerHTML = html
    },
  }
}
