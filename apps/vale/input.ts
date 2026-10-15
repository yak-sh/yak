// What the player asks for, from whichever hands they use: keys and a mouse,
// or a thumb on a stick and another on the buttons. The frame reads it once
// (`read`) and gets one answer: which way to move or turn, what was pressed
// since the last frame, and how far the view was dragged.

import { cursor, type Point } from '@yaks/stage/aim'
import {
  type ControlsBundle,
  listen as controls,
  movement as axes,
} from '@yaks/game/controls'

export type Intent = {
  /** World point beneath the mouse, filled by the stage before simulation. */
  point?: Point
  /** A click carries its press position, before steering can lock the cursor. */
  pick?: [number, number]
  target?: string
  friendly?: string
  /** right and forward axes, at most 1 long */
  move: [number, number]
  /** turn in radians/second; the camera and hero turn together */
  turn: number
  /** the thumbstick faces the direction it moves */
  faceMove: boolean
  jump: boolean
  strike: boolean
  /** the ability asked for, by its slot on the bar, 1 to 3, or 0 */
  ability: number
  dodge: boolean
  talk: boolean
  /** work the node near enough to work (work.ts) */
  gather: boolean
  drink: boolean
  /** swing the camera behind the hero */
  snap: boolean
  /** turn the microphone on, or off */
  mic: boolean
  /** how far the view was turned since the last read: yaw, pitch */
  orbit: [number, number]
  /** a look drag holds the hero's heading while the camera turns */
  look: boolean
  /** how far it was pulled in or out */
  zoom: number
}

export type Action =
  | 'jump'
  | 'strike'
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'dodge'
  | 'talk'
  | 'gather'
  | 'drink'
  | 'snap'
  | 'mic'

// The keys for each action; the panels' keys are their own (hud.ts).
let KEYS: Record<string, Action> = {
  Space: 'jump',
  KeyF: 'strike',
  KeyJ: 'strike',
  ShiftLeft: 'dodge',
  ShiftRight: 'dodge',
  KeyE: 'talk',
  KeyG: 'gather',
  Digit1: 'ability1',
  Digit2: 'ability2',
  Digit3: 'ability3',
  KeyQ: 'drink',
  KeyC: 'snap',
  KeyT: 'mic',
}

/** The keys that press `a`, as `KeyboardEvent.code`s, the first the one a
 * button shows.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(keysOf('strike'), ['KeyF', 'KeyJ'])
 * ```
 */
export let keysOf = (a: Action): string[] =>
  Object.keys(KEYS).filter((k) => KEYS[k] == a)

let AXES: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
}

let TURNS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
}

export let movement = (
  held: Iterable<string>,
  strafe: boolean,
  stick?: [number, number],
  mouseWalk = false,
) => axes(held, strafe, stick, mouseWalk, { axes: AXES, turns: TURNS })
export { lookDrag, mouseButtons } from '@yaks/game/controls'

/** Mossvale alone names its verbs, screen projection and graph entity. */
export let listen = (
  stage: HTMLElement,
  glass: HTMLElement,
  busy: () => boolean,
  state: { get: () => ControlsBundle; onChange: (b: ControlsBundle) => void },
) => {
  let hands = controls(stage, glass, busy, {
    ...state,
    keys: KEYS,
    axes: AXES,
    turns: TURNS,
    tap: { 0: 'strike', 2: 'dodge' },
    gamepad: {
      move: [0, 1],
      look: [2, 3],
      buttons: {
        0: 'jump',
        1: 'dodge',
        2: 'strike',
        3: 'talk',
        4: 'ability1',
        5: 'ability2',
        6: 'drink',
        7: 'ability3',
        9: 'snap',
      },
    },
    cursor: (x, y, locked) =>
      cursor(x, y, innerWidth, globalThis.innerHeight ?? innerWidth, locked),
  })
  return {
    ...hands,
    read: (dt = 1 / 60): Intent => {
      let i = hands.read(dt)
      return {
        ...i,
        jump: i.actions.includes('jump') || i.held.includes('jump'),
        strike: i.actions.includes('strike'),
        ability: [1, 2, 3].find((n) => i.actions.includes(`ability${n}`)) ?? 0,
        dodge: i.actions.includes('dodge'),
        talk: i.actions.includes('talk'),
        gather: i.actions.includes('gather'),
        drink: i.actions.includes('drink'),
        snap: i.actions.includes('snap'),
        mic: i.actions.includes('mic'),
      }
    },
  }
}
