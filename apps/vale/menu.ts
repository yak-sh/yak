// The menu, drawn into its tab (panel.ts): what a player sets for
// themselves, the vale's sound, display and camera, and every key and touch
// the vale answers, each section picked from the list beside it. A setting is
// its name beside what it is now: a choice of a few, the one taken pressed in,
// or a slider. The tray's last button opens it, and so does Escape when
// nothing else is open.
import { type ComponentChildren, h } from 'preact'
import { Button, Pairs, Rows, Section, Tile } from '@yaks/ui'
import { type Glyph, glyph } from './glyphs.ts'
import { SHEETS } from './hud.ts'
import { type Action, keysOf } from './input.ts'
import { ValeKeycap } from './kit/ValeKeycap.ts'
import { cap, type Page } from './panel.ts'
import { VOXEL, VOXELS } from './terrain.ts'
import { mark, picture } from './tile.ts'
import { split } from './ui/split.ts'

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
  hidesCursor: () => boolean
  hideCursor: () => void
  strafes: () => boolean
  strafe: () => void
  voxel: { current: number; apply: (size: number) => void }
  frames: { current: 30 | 60; set: (rate: 30 | 60) => void }
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

// Keys as caps, or a gesture in words.
type Keys = string[] | string

let keys = (swapped: boolean, strafes: boolean): [Keys, string][] => [
  [['W', 'S', '↑', '↓'], 'Walk forward or back'],
  [['A', 'D'], strafes ? 'Strafe' : 'Turn with the camera'],
  [['←', '→'], 'Turn with the camera'],
  [swapped ? 'Right drag' : 'Left drag', 'Turn the camera and your hero'],
  [swapped ? 'Left drag' : 'Right drag', 'Orbit without turning your hero'],
  ['Both mouse buttons', 'Walk forward; move the mouse to steer'],
  ['Wheel', 'Nearer or further'],
  ...DOES.map(([a, what]): [Keys, string] => [keysOf(a).map(cap), what]),
  [['Enter'], 'Chat'],
  ...Object.values(SHEETS.hero.tabs).filter((t) => t.keys.length)
    .map((t): [Keys, string] => [t.keys.map(cap), t.title]),
]

let TOUCH: [Keys, string][] = [
  ['Left thumb', 'Move, wherever it lands'],
  ['Drag on the right', 'Look around'],
  ['Tap the world', 'Strike'],
]

// What a key or a gesture does, a pair each.
let pairs = (rows: [Keys, string][]) =>
  h(
    Pairs,
    {},
    rows.map(([k, what]) => [
      h(
        Pairs.Key,
        { key: `${k}` },
        typeof k == 'string'
          ? k
          : k.map((keycap) => h(ValeKeycap, { key: keycap, keycap })),
      ),
      h(Pairs.Value, { key: `${k}:does` }, what),
    ]),
  )

let SECTIONS: [string, string, Glyph][] = [
  ['audio', 'Audio', 'sound'],
  ['display', 'Display', 'video'],
  ['controls', 'Controls', 'cog'],
  ['touch', 'Touch', 'handHeart'],
  ['keys', 'Keys', 'menu'],
]

/** The menu, answering `o`. */
export let menu = (panel: Page, o: Settings) => {
  let panes = split(panel.body)
  let picked = 'audio'
  // The ground's voxel size picked, which shows only once applied.
  let voxel = VOXELS.includes(o.voxel.current) ? o.voxel.current : VOXEL
  let was = ''

  // A setting: its name beside its control.
  let setting = (icon: Glyph, name: string, control: ComponentChildren) => [
    h(Pairs.Key, { key: name }, mark(icon), name),
    h(Pairs.Value, { key: `${name}:is` }, control),
  ]
  // A choice of a few, the one taken pressed in.
  let choice = (act: string, options: [string, boolean, () => void][]) =>
    h(
      'span',
      { class: 'Settings_Choice' },
      options.map(([words, on, take]) =>
        h(Button, {
          key: words,
          type: 'button',
          'data-do': act,
          'aria-pressed': on,
          onClick: () => {
            if (!on) take()
            paint()
          },
        }, words)
      ),
    )
  let onOff = (act: string, on: boolean, flip: () => void) =>
    choice(act, [['On', on, flip], ['Off', !on, flip]])
  let slider = (name: string, level: Level) => {
    let value = Math.round(level.level * 100)
    return h(
      'span',
      { class: 'Settings_Slider' },
      h('input', {
        type: 'range',
        min: 0,
        max: 100,
        value,
        'aria-label': name,
        'data-volume': name,
        onInput: (e: Event) => {
          level.set(Number((e.target as HTMLInputElement).value) / 100)
          paint()
        },
      }),
      h('output', {}, `${value}%`),
    )
  }

  let section = (id: string, ...body: ComponentChildren[]) => {
    let [, title, icon] = SECTIONS.find(([s]) => s == id)!
    return h(
      Section,
      { 'data-section': id },
      h(Section.Title, {}, mark(icon), title),
      ...body,
    )
  }
  let ground = () =>
    h(
      Section,
      {},
      h(
        Section.Title,
        {},
        mark('mountain'),
        'Ground detail',
        h(Section.Count, { 'data-voxel-choice': '' }, `${voxel} m`),
      ),
      h(
        'span',
        { class: 'Settings_Slider' },
        h('input', {
          type: 'range',
          min: 0,
          max: VOXELS.length - 1,
          step: 1,
          value: VOXELS.indexOf(voxel),
          'aria-label': 'Terrain voxel size',
          'data-voxel': '',
          onInput: (e: Event) => {
            let at = Number((e.target as HTMLInputElement).value)
            voxel = VOXELS[at] ?? o.voxel.current
            paint()
          },
        }),
      ),
      h(Section.Sub, {}, 'Fine, 0.125 m, to chunky, 2 m.'),
      h(
        Section.Sub,
        {},
        `Now ${o.voxel.current} m. Reloads at your spot to compare. The ` +
          `layout and placements stay; terrain steps can shift as the surface ` +
          `is sampled and rounded.`,
      ),
      voxel == 0.125 &&
        h(
          Section.Sub,
          { 'data-voxel-cost': '' },
          '0.125 m makes about four times as much ground geometry as ' +
            '0.25 m, and nearby trees and rocks gain detail. Loading can ' +
            'take several seconds and frame rate may drop.',
        ),
      h(Button, {
        type: 'button',
        mod: 'go',
        class: 'Settings_Apply',
        'data-do': 'voxel',
        disabled: voxel == o.voxel.current,
        onClick: () => o.voxel.apply(voxel),
      }, 'Apply and reload'),
    )

  let detail = () => {
    let swapped = o.swapped(), strafes = o.strafes()
    if (picked == 'audio') {
      return section(
        'audio',
        h(
          Pairs,
          {},
          setting(
            o.muted() ? 'soundOff' : 'sound',
            'Sound',
            onOff('sound', !o.muted(), o.mute),
          ),
          setting(
            o.music.muted ? 'soundOff' : 'sound',
            'Music',
            onOff('music', !o.music.muted, o.music.toggle),
          ),
          setting('sound', 'Music volume', slider('music', o.music)),
          setting('sound', 'Effects volume', slider('effects', o.effects)),
          setting('talk', 'Voice volume', slider('voice', o.voice)),
        ),
      )
    }
    if (picked == 'display') {
      let rate = o.frames.current
      let set = (r: 30 | 60) => () => o.frames.set(r)
      return [
        section(
          'display',
          h(
            Pairs,
            {},
            setting(
              'video',
              'Frame rate',
              choice('frames', [
                ['60 fps', rate == 60, set(60)],
                ['30 fps', rate == 30, set(30)],
              ]),
            ),
          ),
          h(
            Section.Sub,
            {},
            '60 fps moves more smoothly; 30 fps spends less power.',
          ),
        ),
        ground(),
      ]
    }
    if (picked == 'controls') {
      return section(
        'controls',
        h(
          Pairs,
          {},
          setting(
            'video',
            'Steer with',
            choice('swap', [
              ['Left drag', !swapped, o.swap],
              ['Right drag', swapped, o.swap],
            ]),
          ),
          setting(
            'eye',
            'Cursor when steering',
            choice('hideCursor', [
              ['Hidden', o.hidesCursor(), o.hideCursor],
              ['Shown', !o.hidesCursor(), o.hideCursor],
            ]),
          ),
          setting(
            'footprints',
            'A and D',
            choice('strafe', [
              ['Turn', !strafes, o.strafe],
              ['Strafe', strafes, o.strafe],
            ]),
          ),
        ),
      )
    }
    if (picked == 'touch') return section('touch', pairs(TOUCH))
    return section('keys', pairs(keys(swapped, strafes)))
  }

  let list = () =>
    h(
      Rows,
      {},
      SECTIONS.map(([id, title, icon]) =>
        h(
          Tile,
          {
            key: id,
            mod: id == picked && 'on',
            'data-select': id,
            onClick: () => {
              picked = id
              paint()
            },
          },
          picture(glyph(icon)),
          h(Tile.Title, {}, title),
        )
      ),
    )
  let paint = () => panes.render(list(), h('div', {}, detail()), picked)

  return {
    /** show what is set, when the menu is open and it changed */
    show: () => {
      if (!panel.open) return
      let key = [
        o.muted(),
        o.music.muted,
        o.swapped(),
        o.strafes(),
        o.frames.current,
        o.hidesCursor(),
      ].join()
      if (key == was) return
      was = key
      paint()
    },
  }
}
