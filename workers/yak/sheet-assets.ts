// The site's stylesheets as the browser fetches them: each root with its
// `@import`s written in place, so a page waits on one fetch instead of a chain,
// under a name made of its bytes, so a later page never asks again. What a sheet
// points at (the pencil, the paper, the fonts) gets a name of its bytes too,
// beside it. public/ keeps the sources, and those keep answering at their own
// addresses.
//
// One source is made, not kept: `_ui.css`, the kit's share of the look
// (@yaks/ui's linen theme and pencil skin, and the parts the pages wear),
// composed here and written beside the rest by `written`, gitignored as
// `_client.js` is, with what it points at under `_ui/`. The plan composes it
// in memory, so a plan never waits on a build having run.
import * as io from '@yaks/file/io'
import { type Composition, halved, kit, linen, pencil, sheets } from '@yaks/ui'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

let ROOTS = ['style.css', 'pages.css']
let DIR = '_yak'

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
  'Chip',
  'Chips',
  'Address',
  'Rows',
  'Card',
  'Dot',
  'State',
  'Group',
  'Form',
  'At',
  'Drop',
  'More',
  'Body',
  'Notice',
  'Loading',
  'Copy',
  'Empty',
  'Report',
  'Chart',
  'Tabs',
  'Icon',
  'SideNav',
  'Check',
  'Catalog',
  'Gallery',
]

/** What yaks.app wears of the kit. */
let worn: Composition = {
  kits: { base: Object.fromEntries(WORN.map((name) => [name, kit[name]])) },
  theme: linen,
  skin: pencil,
}

/** The layer of yaks.app's each piece of the kit's sheet sits in: the theme
 * its tokens, the document its base, every part a component. */
let layer = (piece: string) =>
  piece == 'theme' ? 'tokens' : piece == 'base' ? 'base' : 'components'

// A file the kit's sheet points at, which stylesheet() names by its whole
// address: it is served as `_ui/` and its path in the repository.
let REPO = fileURLToPath(new URL('../../', import.meta.url))
let FILED = /url\("(file:\/\/[^"#]+)(#[^"]*)?"\)/g

/** The kit's sheet in yaks.app's cascade layers, so nothing of the kit's
 * outranks a rule of the site's, and the files it points at, by address. */
export let ui = async () => {
  let files = new Map<string, Uint8Array>()
  let pieces = (await sheets(worn)).map(([piece, css]) =>
    `@layer ${layer(piece)} {\n${css}\n}`
  )
  let css = pieces.join('\n').replace(FILED, (_, file, fragment = '') => {
    let path = fileURLToPath(file)
    let at = `_ui/${relative(REPO, path)}`
    files.set(at, io.readFileSync(path))
    return `url("${at}${fragment}")`
  })
  files.set(
    UI,
    new TextEncoder().encode(
      `@layer tokens, base, components, sections;\n${css}\n`,
    ),
  )
  return files
}

// A url() naming a file of ours: not a data: or another site's, fragment apart.
let POINTED =
  /url\((?!["']?(?:data:|[a-z]+:\/\/))["']?([^"')#]+)(#[^"')]*)?["']?\)/g

type Read = (name: string) => Uint8Array

let stamped = (name: string, bytes: Uint8Array) => {
  let hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
  return `${DIR}/${name.replace(/(\.\w+)$/, `.${hash}$1`)}`
}

/** Each source's content-named address, and the bytes to write there. */
export let plan = (read: Read) => {
  let files = new Map<string, Uint8Array>()
  let names: Record<string, string> = {}
  let place = (name: string, bytes: Uint8Array) => {
    let at = stamped(name, bytes)
    files.set(at, bytes)
    names[name] = at
    return at.slice(DIR.length + 1)
  }
  let inlined = (name: string): string =>
    new TextDecoder().decode(read(name)).replace(
      /@import url\('([^']+)'\);/g,
      (_, imported) => inlined(imported),
    )
  for (let root of ROOTS) {
    let css = halved(inlined(root)).replace(
      POINTED,
      (_, file, fragment = '') => `url(${place(file, read(file))}${fragment})`,
    )
    place(root, new TextEncoder().encode(css))
  }
  return { files, names }
}

let reading = (dir: string, made: Map<string, Uint8Array>): Read => (name) =>
  made.get(name) ?? io.readFileSync(join(dir, name))

/** Reading the sources from a directory, the kit's sheet and what it points
 * at composed. */
export let from = async (dir: string): Promise<Read> => reading(dir, await ui())

/** Write the plan into public/, leaving no earlier deploy's names behind. */
export let written = async (
  to = new URL('./public/', import.meta.url).pathname,
) => {
  for (let made of [DIR, '_ui']) {
    await io.remove(join(to, made), { recursive: true }).catch((error) => {
      if (!(error instanceof io.errors.NotFound)) throw error
    })
  }
  let made = await ui()
  await Promise.all(
    [...made, ...plan(reading(to, made)).files].map(async ([at, bytes]) => {
      await io.mkdir(dirname(join(to, at)), { recursive: true })
      await io.writeFile(join(to, at), bytes)
    }),
  )
}
