import { Fragment, h } from 'preact'
import partsBand from './parts/Band.css' with { type: 'text' }
import partsDesk from './parts/Desk.css' with { type: 'text' }
import partsDoodles from './parts/Doodles.css' with { type: 'text' }
import partsFoot from './parts/Foot.css' with { type: 'text' }
import partsHero from './parts/Hero.css' with { type: 'text' }
import partsKicker from './parts/Kicker.css' with { type: 'text' }
import partsLead from './parts/Lead.css' with { type: 'text' }
import partsMast from './parts/Mast.css' with { type: 'text' }
import partsSheet from './parts/Sheet.css' with { type: 'text' }
import partsSpark from './parts/Spark.css' with { type: 'text' }
import partsSquig from './parts/Squig.css' with { type: 'text' }
import partsSteps from './parts/Steps.css' with { type: 'text' }
import partsTicks from './parts/Ticks.css' with { type: 'text' }
import partsTray from './parts/Tray.css' with { type: 'text' }
import partsWave from './parts/Wave.css' with { type: 'text' }
import skinBody from './skin/Body.css' with { type: 'text' }
import skinButton from './skin/Button.css' with { type: 'text' }
import skinCard from './skin/Card.css' with { type: 'text' }
import skinCards from './skin/Cards.css' with { type: 'text' }
import skinCheck from './skin/Check.css' with { type: 'text' }
import skinChip from './skin/Chip.css' with { type: 'text' }
import skinEmpty from './skin/Empty.css' with { type: 'text' }
import skinField from './skin/Field.css' with { type: 'text' }
import skinForm from './skin/Form.css' with { type: 'text' }
import skinNotice from './skin/Notice.css' with { type: 'text' }
import skinSurface from './skin/Surface.css' with { type: 'text' }
import skinBase from './skin/base.css' with { type: 'text' }
import kitBody from '@yaks/ui/Body.css' with { type: 'text' }
import kitButton from '@yaks/ui/Button.css' with { type: 'text' }
import kitCard from '@yaks/ui/Card.css' with { type: 'text' }
import kitCards from '@yaks/ui/Cards.css' with { type: 'text' }
import kitCheck from '@yaks/ui/Check.css' with { type: 'text' }
import kitChip from '@yaks/ui/Chip.css' with { type: 'text' }
import kitChips from '@yaks/ui/Chips.css' with { type: 'text' }
import kitDot from '@yaks/ui/Dot.css' with { type: 'text' }
import kitEmpty from '@yaks/ui/Empty.css' with { type: 'text' }
import kitField from '@yaks/ui/Field.css' with { type: 'text' }
import kitForm from '@yaks/ui/Form.css' with { type: 'text' }
import kitNotice from '@yaks/ui/Notice.css' with { type: 'text' }
import kitSkip from '@yaks/ui/Skip.css' with { type: 'text' }
import kitState from '@yaks/ui/State.css' with { type: 'text' }
import kitSurface from '@yaks/ui/Surface.css' with { type: 'text' }
import kitBase from '@yaks/ui/base.css' with { type: 'text' }
import kitDerived from '@yaks/ui/derived.css' with { type: 'text' }

let theme = 'look/crayon.css'
let ui = '__packages/@yaks/ui/'

// Cascade order for server-rendered pages and the studio. These sheets
// only contain rules. The theme stays linked so its relative font URLs
// resolve against the fingerprinted stylesheet beside the fonts.
let parts = {
  [ui + 'derived.css']: kitDerived,
  [ui + 'base.css']: kitBase,
  'look/skin/base.css': skinBase,
  [ui + 'Surface.css']: kitSurface,
  'look/skin/Surface.css': skinSurface,
  [ui + 'Skip.css']: kitSkip,
  [ui + 'Button.css']: kitButton,
  'look/skin/Button.css': skinButton,
  [ui + 'Card.css']: kitCard,
  'look/skin/Card.css': skinCard,
  [ui + 'Cards.css']: kitCards,
  'look/skin/Cards.css': skinCards,
  [ui + 'Field.css']: kitField,
  'look/skin/Field.css': skinField,
  [ui + 'Form.css']: kitForm,
  'look/skin/Form.css': skinForm,
  [ui + 'Check.css']: kitCheck,
  'look/skin/Check.css': skinCheck,
  [ui + 'Chip.css']: kitChip,
  'look/skin/Chip.css': skinChip,
  [ui + 'Chips.css']: kitChips,
  [ui + 'Dot.css']: kitDot,
  [ui + 'State.css']: kitState,
  [ui + 'Body.css']: kitBody,
  'look/skin/Body.css': skinBody,
  [ui + 'Notice.css']: kitNotice,
  'look/skin/Notice.css': skinNotice,
  [ui + 'Empty.css']: kitEmpty,
  'look/skin/Empty.css': skinEmpty,
  'look/parts/Mast.css': partsMast,
  'look/parts/Foot.css': partsFoot,
  'look/parts/Band.css': partsBand,
  'look/parts/Lead.css': partsLead,
  'look/parts/Kicker.css': partsKicker,
  'look/parts/Squig.css': partsSquig,
  'look/parts/Hero.css': partsHero,
  'look/parts/Doodles.css': partsDoodles,
  'look/parts/Wave.css': partsWave,
  'look/parts/Spark.css': partsSpark,
  'look/parts/Steps.css': partsSteps,
  'look/parts/Sheet.css': partsSheet,
  'look/parts/Ticks.css': partsTicks,
  'look/parts/Desk.css': partsDesk,
  'look/parts/Tray.css': partsTray,
}
let rules = Object.values(parts).join('\n')

export let stylesheets = [theme, ...Object.keys(parts)]

export let styleLinks = (href: (path: string) => string) =>
  h(
    Fragment,
    {},
    h('link', { rel: 'stylesheet', href: href(theme) }),
    h('style', { dangerouslySetInnerHTML: { __html: rules } }),
  )
