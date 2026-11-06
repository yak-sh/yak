// The site's stylesheets as the browser fetches them: each root with its
// `@import`s written in place, so a page waits on one fetch instead of a chain,
// under a name made of its bytes, so a later page never asks again. What a sheet
// points at (the pencil, the paper, the fonts) gets a name of its bytes too,
// beside it. public/ keeps the sources, and those keep answering at their own
// addresses.
//
// One source is made, not kept: `_ui.css`, the kit's share of the look
// (@yaks/ui's linen theme), composed here and written beside the rest by
// `written`, gitignored as `_client.js` is. The plan composes it in memory, so
// a plan never waits on a build having run.
import * as io from '@yaks/file/io'
import { type Composition, linen, stylesheet } from '@yaks/ui'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

let ROOTS = ['style.css', 'pages.css']
let DIR = '_yak'

/** The kit's sheet among the sources. */
export let UI = '_ui.css'

/** What yaks.app wears of the kit. */
let WORN: Composition = { kits: {}, theme: linen }

/** The kit's sheet in yaks.app's cascade layers, the theme its tokens, so
 * nothing of the kit's outranks a rule of the site's. */
export let ui = async () => {
  let css = await stylesheet(WORN)
  return `@layer tokens, base, components, sections;\n@layer tokens {\n${css}\n}\n`
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
    let css = inlined(root).replace(
      POINTED,
      (_, file, fragment = '') => `url(${place(file, read(file))}${fragment})`,
    )
    place(root, new TextEncoder().encode(css))
  }
  return { files, names }
}

/** Reading the sources from a directory, the kit's sheet composed. */
export let from = async (dir: string): Promise<Read> => {
  let kit = new TextEncoder().encode(await ui())
  return (name) => name == UI ? kit : io.readFileSync(join(dir, name))
}

/** Write the plan into public/, leaving no earlier deploy's names behind. */
export let written = async (
  to = new URL('./public/', import.meta.url).pathname,
) => {
  await io.remove(join(to, DIR), { recursive: true }).catch((error) => {
    if (!(error instanceof io.errors.NotFound)) throw error
  })
  await io.mkdir(join(to, DIR), { recursive: true })
  let read = await from(to)
  await io.writeFile(join(to, UI), read(UI))
  await Promise.all(
    [...plan(read).files].map(([at, bytes]) =>
      io.writeFile(join(to, at), bytes)
    ),
  )
}
