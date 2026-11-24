/** The app's theme, the platform's kit, and the app's skin and parts, in
 * cascade order for both server-rendered pages and the studio. */
import { Fragment, h } from 'preact'

let ui = '__packages/@yaks/ui/'

export let stylesheets = [
  'look/crayon.css',
  ui + 'derived.css',
  ui + 'base.css',
  'look/skin/base.css',
  ui + 'Surface.css',
  'look/skin/Surface.css',
  ui + 'Skip.css',
  ui + 'Button.css',
  'look/skin/Button.css',
  ui + 'Card.css',
  'look/skin/Card.css',
  ui + 'Cards.css',
  'look/skin/Cards.css',
  ui + 'Field.css',
  'look/skin/Field.css',
  ui + 'Form.css',
  'look/skin/Form.css',
  ui + 'Check.css',
  'look/skin/Check.css',
  ui + 'Chip.css',
  'look/skin/Chip.css',
  ui + 'Chips.css',
  ui + 'Dot.css',
  ui + 'State.css',
  ui + 'Body.css',
  'look/skin/Body.css',
  ui + 'Notice.css',
  'look/skin/Notice.css',
  ui + 'Empty.css',
  'look/skin/Empty.css',
  'look/parts/Mast.css',
  'look/parts/Foot.css',
  'look/parts/Band.css',
  'look/parts/Lead.css',
  'look/parts/Kicker.css',
  'look/parts/Squig.css',
  'look/parts/Hero.css',
  'look/parts/Doodles.css',
  'look/parts/Wave.css',
  'look/parts/Spark.css',
  'look/parts/Steps.css',
  'look/parts/Sheet.css',
  'look/parts/Ticks.css',
  'look/parts/Desk.css',
  'look/parts/Tray.css',
]

export let styleLinks = (href: (path: string) => string) =>
  h(
    Fragment,
    {},
    stylesheets.map((path) =>
      h('link', { rel: 'stylesheet', href: href(path) })
    ),
  )
