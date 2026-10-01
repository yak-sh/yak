/** Vale's display-only parts and their carried stylesheet addresses. No
 * game entrypoint imports this foundation until the corresponding port. */
import { type Composition, type Kit, kits as base } from '@yaks/ui'
import * as meter from './kit/ValeMeter.ts'
import * as keycap from './kit/ValeKeycap.ts'
import * as toast from './kit/ValeToast.ts'
import * as orb from './kit/ValeOrb.ts'
import * as compass from './kit/ValeCompass.ts'
import { skin, theme } from './skin.ts'

export { ValeMeter } from './kit/ValeMeter.ts'
export { ValeKeycap } from './kit/ValeKeycap.ts'
export { ValeToast } from './kit/ValeToast.ts'
export { ValeOrb } from './kit/ValeOrb.ts'
export { ValeCompass } from './kit/ValeCompass.ts'

export let kit: Kit = {
  ValeMeter: {
    ...meter,
    Component: meter.ValeMeter,
    css: new URL('./kit/ValeMeter.css', import.meta.url),
  },
  ValeKeycap: {
    ...keycap,
    Component: keycap.ValeKeycap,
    css: new URL('./kit/ValeKeycap.css', import.meta.url),
  },
  ValeToast: {
    ...toast,
    Component: toast.ValeToast,
    css: new URL('./kit/ValeToast.css', import.meta.url),
  },
  ValeOrb: {
    ...orb,
    Component: orb.ValeOrb,
    css: new URL('./kit/ValeOrb.css', import.meta.url),
  },
  ValeCompass: {
    ...compass,
    Component: compass.ValeCompass,
    css: new URL('./kit/ValeCompass.css', import.meta.url),
  },
}
export let kits = { vale: kit }
export let composition: Composition = {
  kits: { ...base, ...kits },
  theme,
  skin,
}
