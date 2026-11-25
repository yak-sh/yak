// The kernel's in-process asset contents. Application and browser behavior
// tests import their modules directly. Requests that only exercise serving
// can supply bytes for an asset through the same reader.
import { once } from '@yaks/fp'
import { ASSETS } from './assets.ts'
import { kit } from './sheet-assets.ts'

export let PUBLIC = new URL('./public/', import.meta.url)
export let CLIENT_SCRIPT = 'export const store = () => ({})\n'

let scripts: Record<string, string> = {
  '/_client.js': CLIENT_SCRIPT,
  '/data.js': 'export const open = () => {}\n',
  '/_install.js': 'void 0\n',
}
let catalog = '{}'
let encoded = (text: string) => new TextEncoder().encode(text)
let site = once(() => import('./site/mod.ts'))
let sheets = once(async () =>
  new Map((await kit()).map((item) => ['/' + item.name, item]))
)
let sources = new Map(ASSETS.map((item) => ['/' + item.name, item]))

let file = (url: URL) =>
  Deno.readFile(url).catch((error) => {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.IsADirectory
    ) return null
    throw error
  })

export let readAsset = async (path: string) => {
  let script = scripts[path]
  if (script != undefined) return encoded(script)
  if (path == '/_compiler/packages.json' || path == '/_compiler/toolkit.json') {
    return encoded(catalog)
  }
  if (/^\/[^/]+\.html$/.test(path)) {
    let { page, PAGES } = await site()
    let name = path.slice(1)
    return Object.hasOwn(PAGES, name) ? encoded(page(name)) : null
  }
  // The kit's sheets, its guide's (named among the sources, made by `kit`),
  // and what they point at.
  let asset = /^\/(_ui\.css$|_ui\/|_guide\.)/.test(path)
    ? (await sheets()).get(path)
    : sources.get(path)
  if (asset?.file) return await file(asset.file)
  if (asset?.body) {
    let body = await asset.body()
    return typeof body == 'string' ? encoded(body) : body
  }
  if (asset?.bundle || (path.startsWith('/_') && path != '/_headers')) {
    return null
  }
  return await file(new URL('.' + path, PUBLIC))
}
