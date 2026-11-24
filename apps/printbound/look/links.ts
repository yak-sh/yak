/** The app's theme, the platform's kit, and the app's skin and parts, in
 * cascade order for both server-rendered pages and the studio. */
import { Fragment, h } from 'preact'

let ui = '__packages/@yaks/ui/'

export let stylesheets = [
  'look/spellbound.css',
  ui + 'derived.css',
  ui + 'base.css',
  ui + 'Surface.css',
  ui + 'Skip.css',
  ui + 'Button.css',
  ui + 'Field.css',
  ui + 'Form.css',
  ui + 'Notice.css',
  ui + 'Rows.css',
  ui + 'Card.css',
  ui + 'Cards.css',
  ui + 'Empty.css',
  ui + 'Body.css',
  'look/skin.css',
  'look/site.css',
  'look/studio.css',
]

export let styleLinks = (href: (path: string) => string) =>
  h(
    Fragment,
    {},
    stylesheets.map((path) =>
      h('link', { rel: 'stylesheet', href: href(path) })
    ),
  )
