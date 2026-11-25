// The kit's share of yaks.app's look: @yaks/ui's linen theme and pencil skin,
// and the parts the pages wear, composed as `_ui.css` in yaks.app's cascade
// layers, and the sheets of the kit's own guide (ui-guide.ts), with what they
// point at under `_ui/`. The build writes them beside the rest of the site's
// files (assets.ts), gitignored as `_client.js` is.
import { type Composition, kit as parts, linen, pencil, sheets } from '@yaks/ui'
import { dressed } from '@yaks/ui/routes'
import {
  SKINS,
  skinSheet,
  THEMES,
  themeSheet,
  UI as GUIDE,
} from './ui-guide.ts'
import type { Asset } from '@yaks/web/assets'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The kit's sheet among the sources. */
export let UI = '_ui.css'

/** The kit's parts yaks.app's pages wear, in the order their sheets go,
 * which settles a tie, the order controls.css had them in: rows before the
 * card holding them (a card's child shrinks), a card before what rides one
 * or sits in one (a report's gap, a group's margin). The style guide wears
 * the catalog and the gallery the kit shows its parts in. */
export let WORN = [
  'base',
  'Button',
  'Field',
  'Save',
  'Chip',
  'Chips',
  'Address',
  'Rows',
  'Card',
  'Layer',
  'Modal',
  'Dock',
  'Dot',
  'State',
  'Badge',
  'Group',
  'Form',
  'At',
  'Drop',
  'More',
  'Menu',
  'Body',
  'Notice',
  'Loading',
  'Copy',
  'Empty',
  'Report',
  'Chart',
  'Table',
  'Tabs',
  'Icon',
  'Logo',
  'Tip',
  'Time',
  'Overlay',
  'SideNav',
  'Contents',
  'Check',
  'Catalog',
  'Gallery',
  'Cards',
  'Identity',
  'Toolbar',
  'Transcript',
  'Attachments',
  'Annotated',
  'Preview',
  'Composer',
  'Popover',
  'Skip',
  'Head',
  'Shell',
  'Pairs',
]

/** What yaks.app wears of the kit. */
let worn: Composition = {
  kits: { base: Object.fromEntries(WORN.map((name) => [name, parts[name]])) },
  theme: linen,
  skin: pencil,
}

/** The site's kit stylesheets, by part. */
export let kitSheets = () => sheets(worn)

/** The layer of yaks.app's each piece of the kit's sheet sits in: the theme
 * its tokens, the document its base, every part a component. */
let layer = (piece: string) =>
  piece == 'theme' ? 'tokens' : piece == 'base' ? 'base' : 'components'

// A file the kit's sheet points at, which stylesheet() names by its whole
// address: it is served as `_ui/` and its path in the repository.
let REPO = fileURLToPath(new URL('../../', import.meta.url))
let FILED = /url\("(file:\/\/[^"#]+)(#[^"]*)?"\)/g

// The guide's sheets: each theme's tokens, and each skin's parts, which no
// theme changes.
let guide = (): Promise<[string, string][]> => {
  let dressing = (theme?: string, skin?: string) =>
    sheets(dressed(theme, skin, GUIDE).c)
  let tokens = THEMES.map(async (theme): Promise<[string, string]> => [
    themeSheet(theme),
    (await dressing(theme)).find(([piece]) => piece == 'theme')![1],
  ])
  let drawn = SKINS.map(async (skin): Promise<[string, string]> => [
    skinSheet(skin),
    (await dressing(undefined, skin)).filter(([piece]) => piece != 'theme')
      .map(([, css]) => css).join('\n'),
  ])
  return Promise.all([...tokens, ...drawn])
}

/** The kit's sheet in yaks.app's cascade layers, so nothing of the kit's
 * outranks a rule of the site's, the guide's sheets, and the files they point
 * at, by address. */
export let kit = async (): Promise<Asset[]> => {
  let pointed = new Map<string, URL>()
  let filed = (css: string) =>
    css.replace(FILED, (_, file, fragment = '') => {
      let at = `_ui/${relative(REPO, fileURLToPath(file))}`
      pointed.set(at, new URL(file))
      return `url("${at}${fragment}")`
    })
  let pieces = (await kitSheets()).map(([piece, css]) =>
    `@layer ${layer(piece)} {\n${css}\n}`
  )
  let css = filed(pieces.join('\n'))
  let guides = (await guide()).map(([name, sheet]) => {
    let body = filed(sheet)
    return { name, body: () => body }
  })
  return [
    {
      name: UI,
      body: () => `@layer tokens, base, components, sections;\n${css}\n`,
    },
    ...guides,
    ...[...pointed].map(([name, file]) => ({ name, file })),
  ]
}
