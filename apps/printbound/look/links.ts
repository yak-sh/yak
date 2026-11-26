import { Fragment, h } from 'preact'
import kitDerived from '@yaks/ui/derived.css' with { type: 'text' }
import kitBase from '@yaks/ui/base.css' with { type: 'text' }
import kitSurface from '@yaks/ui/Surface.css' with { type: 'text' }
import kitSkip from '@yaks/ui/Skip.css' with { type: 'text' }
import kitButton from '@yaks/ui/Button.css' with { type: 'text' }
import kitField from '@yaks/ui/Field.css' with { type: 'text' }
import kitForm from '@yaks/ui/Form.css' with { type: 'text' }
import kitNotice from '@yaks/ui/Notice.css' with { type: 'text' }
import kitRows from '@yaks/ui/Rows.css' with { type: 'text' }
import kitCard from '@yaks/ui/Card.css' with { type: 'text' }
import kitCards from '@yaks/ui/Cards.css' with { type: 'text' }
import kitEmpty from '@yaks/ui/Empty.css' with { type: 'text' }
import kitBody from '@yaks/ui/Body.css' with { type: 'text' }
import skin from './skin.css' with { type: 'text' }
import site from './site.css' with { type: 'text' }
import studio from './studio.css' with { type: 'text' }

let theme = 'look/spellbound.css'
let ui = '__packages/@yaks/ui/'

// Keep the theme's relative font URLs in the release stylesheet. The rest
// of the cascade can paint from the page's own bytes.
let parts = {
  [ui + 'derived.css']: kitDerived,
  [ui + 'base.css']: kitBase,
  [ui + 'Surface.css']: kitSurface,
  [ui + 'Skip.css']: kitSkip,
  [ui + 'Button.css']: kitButton,
  [ui + 'Field.css']: kitField,
  [ui + 'Form.css']: kitForm,
  [ui + 'Notice.css']: kitNotice,
  [ui + 'Rows.css']: kitRows,
  [ui + 'Card.css']: kitCard,
  [ui + 'Cards.css']: kitCards,
  [ui + 'Empty.css']: kitEmpty,
  [ui + 'Body.css']: kitBody,
  'look/skin.css': skin,
  'look/site.css': site,
  'look/studio.css': studio,
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
