/** The running Vale and its guide consume the same kits, skin and UX words. */
import { type Composition, themes } from '@yaks/ui'
import { ux as base } from '@yaks/ux/ui'
import { composition } from './ui-kit.ts'
import { ux } from './ux-kit.ts'

export let guideComposition = (theme = 'vale', skin = 'vale'): Composition => ({
  ...composition,
  theme: theme == 'vale'
    ? composition.theme
    : themes[theme] ?? composition.theme,
  skin: skin == 'base' ? undefined : composition.skin,
  ux: { ...base, ...ux },
})
