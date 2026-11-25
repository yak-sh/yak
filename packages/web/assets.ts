// An asset build, exported as `@yaks/web/assets`: the files a browser loads
// from a host, said as data, to serve (`served`) or to write into a static
// host's directory (`write`). Each asset is answered at its `name`, and is
// one of:
//
// - a browser module and everything it imports, as one (`bundle`, made by
//   @yaks/cli/page `bundle`)
// - a body made in this process (`body`): a page drawn, a sheet composed
// - a file a package ships beside its modules (`file`, @yaks/api/asset)
// - none of these: a source already kept in the directory it is written to
//
// One that is `named` is written again under a name of its bytes, in `_yak/`
// (`plan`), which never changes under it, so a browser keeps it for good. A
// named stylesheet is written with its `@import`s in place, so a page waits
// on one fetch instead of a chain, and what it points at is named by its
// bytes too.
//
// The bundles `split` into one group are made in one build (@yaks/cli/page
// `split`): what two of them import is written once, in a chunk under
// `_yak/` named by its bytes, which each imports from the site's root. A page
// that loads several runs each shared module once. A group is the bundles
// that load together: chunks are made for each set of bundles sharing a
// module, so bundles that never meet on a page cut what they share into
// pieces no page needs apart.

import * as io from '@yaks/file/io'
import { bytes } from '@yaks/api/asset'
import type { Route } from '@yaks/api/routed'
import {
  type Body,
  bundle,
  imports,
  kept,
  split,
  type Written,
} from '@yaks/cli/page'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

/** One file of an asset build: where it is answered, how it is made (at most
 * one of `bundle`, `body` and `file`; none for a source kept where it is
 * written), and whether it is written again under a name of its bytes. */
export type Asset = {
  name: string
  bundle?: URL | Written
  /** the bare specifiers a bundle leaves to its page's import map */
  external?: string[]
  body?: (signal?: AbortSignal) => Body | Promise<Body>
  file?: URL
  named?: boolean
  /** the group it is made with, sharing the chunks of the bundles in it;
   * on its own (`make`, `served`) it is made whole */
  split?: string
}

/** Where a named asset is written, below the directory the rest are. */
export let NAMED = '_yak'

/** Whether an asset is made, not kept as a source. */
export let made = (asset: Asset): boolean =>
  !!(asset.bundle || asset.body || asset.file)

/** What a made asset is. */
export let make = async (
  asset: Asset,
  signal?: AbortSignal,
): Promise<Body> => {
  if (asset.bundle) {
    return await bundle(asset.bundle, signal, { external: asset.external })
  }
  if (asset.body) return await asset.body(signal)
  if (asset.file) return await bytes(asset.file)
  throw new Error(`${asset.name} is a source, not made`)
}

let TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
}

/** The content type an asset is answered with, by its name.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(type('app.js'), 'text/javascript; charset=utf-8')
 * assertEquals(type('icon-192.png'), 'image/png')
 * assertEquals(type('notes'), 'application/octet-stream')
 * ```
 */
export let type = (name: string): string =>
  TYPES[/\.(\w+)$/.exec(name)?.[1] ?? ''] ?? 'application/octet-stream'

/** A route for each asset, at `at` and its name, made once and kept for the
 * life of the process (@yaks/cli/page `kept`). */
export let served = (
  assets: Asset[],
  at: string,
  keeping?: Parameters<typeof kept>[3],
): Route[] =>
  assets.map((asset) => ({
    method: 'GET',
    path: at + asset.name,
    handle: kept(
      at + asset.name,
      type(asset.name),
      (signal) => make(asset, signal),
      keeping,
    ),
  }))

/** An asset's bytes, by its name. */
export type Read = (name: string) => Uint8Array

/** Reading from `dir`, or from `made` where an asset was just made. */
export let reading = (
  dir: string,
  made: Map<string, Uint8Array> = new Map(),
): Read =>
(name) => made.get(name) ?? io.readFileSync(join(dir, name))

let stamped = (name: string, bytes: Uint8Array) => {
  let hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
  return `${NAMED}/${name.replace(/(\.\w+)$/, `.${hash}$1`)}`
}

// A url() naming a file of ours: not a data: or another site's, fragment apart.
let POINTED =
  /url\((?!["']?(?:data:|[a-z]+:\/\/))["']?([^"')#]+)(#[^"')]*)?["']?\)/g

/** Each named asset's address of its bytes, and the bytes to write there:
 * a sheet with its imports in place, each passed through `sheet`, and what
 * it points at named too. */
export let plan = (
  assets: Asset[],
  read: Read,
  sheet: (css: string) => string = (css) => css,
): { files: Map<string, Uint8Array>; names: Record<string, string> } => {
  let files = new Map<string, Uint8Array>()
  let names: Record<string, string> = {}
  let place = (name: string, bytes: Uint8Array) => {
    let at = stamped(name, bytes)
    files.set(at, bytes)
    names[name] = at
    return at.slice(NAMED.length + 1)
  }
  let inlined = (name: string): string =>
    new TextDecoder().decode(read(name)).replace(
      /@import url\('([^']+)'\);/g,
      (_, imported) => inlined(imported),
    )
  for (let { name } of assets.filter((asset) => asset.named)) {
    if (!name.endsWith('.css')) {
      place(name, read(name))
      continue
    }
    let css = sheet(inlined(name)).replace(
      POINTED,
      (_, file, fragment = '') => `url(${place(file, read(file))}${fragment})`,
    )
    place(name, new TextEncoder().encode(css))
  }
  return { files, names }
}

/** The chunks the split bundles among `assets` import, and those chunks
 * import, by path, read through `read`: what the build wrote beside them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let files: Record<string, string> = {
 *   '_a.js': 'import{a}from"/_yak/chunk.A1.js";a()',
 *   '_yak/chunk.A1.js': 'import"/_yak/chunk.B2.js";export let a=()=>{}',
 *   '_yak/chunk.B2.js': '',
 * }
 * let read = (name: string) => new TextEncoder().encode(files[name])
 * assertEquals(
 *   chunksOf([{ name: '_a.js', split: 'pages', bundle: new URL('file:///a.ts') }], read),
 *   ['_yak/chunk.A1.js', '_yak/chunk.B2.js'],
 * )
 * ```
 */
export let chunksOf = (
  assets: Asset[],
  read: Read,
  imported = imports,
): string[] => {
  let found = new Set<string>()
  let walk = (name: string) => {
    for (let chunk of imported(new TextDecoder().decode(read(name)))) {
      if (found.has(chunk)) continue
      found.add(chunk)
      walk(chunk)
    }
  }
  for (let asset of assets) if (asset.split && asset.bundle) walk(asset.name)
  return [...found]
}

let gone = (error: unknown) => {
  if (!(error instanceof io.errors.NotFound)) throw error
}

/** Write `assets` into `to`: each made one at its name, and each named one
 * again at its bytes' name, leaving no earlier build's names behind, nor
 * anything of an earlier build in the directories `fresh` names. */
export let write = async (
  to: string,
  assets: Asset[],
  { fresh = [], sheet }: {
    fresh?: string[]
    sheet?: (css: string) => string
  } = {},
): Promise<void> => {
  for (let dir of [NAMED, ...fresh]) {
    await io.remove(join(to, dir), { recursive: true }).catch(gone)
  }
  let encoded = (body: Body) =>
    typeof body == 'string' ? new TextEncoder().encode(body) : body
  let splits = assets.filter((asset) => asset.split && asset.bundle)
  let groups = Map.groupBy(splits, (asset) => asset.split!)
  let together = await Promise.all(
    [...groups.values()].map((group) =>
      split(
        Object.fromEntries(
          group.map((asset) => [asset.name, asset.bundle as URL]),
        ),
        undefined,
        { external: [...new Set(group.flatMap((a) => a.external ?? []))] },
      )
    ),
  )
  let bodies = new Map(
    await Promise.all(
      assets.filter((asset) => made(asset) && !splits.includes(asset)).map(
        async (asset) => [asset.name, encoded(await make(asset))] as const,
      ),
    ),
  )
  for (let made of together) {
    for (let [name, code] of Object.entries(made.entries)) {
      bodies.set(name, encoded(code))
    }
  }
  let chunks = together.flatMap((made) =>
    Object.entries(made.chunks).map(([at, code]) =>
      [at, encoded(code)] as const
    )
  )
  let files = [
    ...bodies,
    ...chunks,
    ...plan(assets, reading(to, bodies), sheet).files,
  ]
  await Promise.all(files.map(async ([at, bytes]) => {
    await io.mkdir(dirname(join(to, at)), { recursive: true })
    await io.writeFile(join(to, at), bytes)
  }))
}
