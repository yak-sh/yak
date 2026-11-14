/** Vale's display-only parts and their carried stylesheet addresses, which
 * the game, the guide and the style guide draw with. */
import { beside, type Composition, type Kit, kits as base } from '@yaks/ui'
import * as meter from './kit/ValeMeter.ts'
import * as keycap from './kit/ValeKeycap.ts'
import * as toast from './kit/ValeToast.ts'
import * as orb from './kit/ValeOrb.ts'
import * as recording from './kit/ValeRecording.ts'
import * as compass from './kit/ValeCompass.ts'
import { kit as game } from '@yaks/game/hud'
import * as badge from './kit/ValeBadge.ts'
import { skin, theme } from './skin.ts'

let here = beside(import.meta.url)

export { ValeMeter } from './kit/ValeMeter.ts'
export { ValeKeycap } from './kit/ValeKeycap.ts'
export { ValeToast } from './kit/ValeToast.ts'
export { ValeOrb } from './kit/ValeOrb.ts'
export { ValeRecording } from './kit/ValeRecording.ts'
export { ValeCompass } from './kit/ValeCompass.ts'
export { Grid, Stats, Stick } from '@yaks/game/hud'
export { ValeBadge } from './kit/ValeBadge.ts'

export let kit: Kit = {
  ValeRecording: {
    ...recording,
    Component: recording.ValeRecording,
    css: here('./kit/ValeRecording.css'),
  },
  ValeMeter: {
    ...meter,
    Component: meter.ValeMeter,
    css: here('./kit/ValeMeter.css'),
  },
  ValeKeycap: {
    ...keycap,
    Component: keycap.ValeKeycap,
    css: here('./kit/ValeKeycap.css'),
  },
  ValeToast: {
    ...toast,
    Component: toast.ValeToast,
    css: here('./kit/ValeToast.css'),
  },
  ValeOrb: {
    ...orb,
    Component: orb.ValeOrb,
    css: here('./kit/ValeOrb.css'),
  },
  ValeCompass: {
    ...compass,
    Component: compass.ValeCompass,
    css: here('./kit/ValeCompass.css'),
  },
  ValeBadge: {
    ...badge,
    Component: badge.ValeBadge,
    css: here('./kit/ValeBadge.css'),
  },
}
export let kits = { game, vale: kit }
export let composition: Composition = {
  kits: { ...base, ...kits },
  theme,
  skin,
}
