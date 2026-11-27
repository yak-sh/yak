/**
 * A kit-built app's view, loaded from the app itself, and its store over
 * HTTP: what any host that draws the view outside a browser needs of the app.
 * The iOS shell and `yak open` in a terminal are two such hosts; each hands
 * in its own `fetch` (the phone's signed-in cookie, the CLI's token) and the
 * packages it carries.
 *
 * An app names its view in its front page,
 * `<link rel="yaks-native" href="view.ts">`. `viewAt` fetches that module and
 * what it imports by relative path, compiles each from TypeScript, and runs
 * it with the host's own copies of the app's `"platform"` packages standing
 * in for them, as the platform's compile supplies them to its page; the
 * host's copies are the ones its painter's DOM is rendered by. The module's
 * default export is a component that takes the app's `store`.
 *
 * @module
 */

import { transform } from 'sucrase'
import type { ComponentType } from 'react'

/** The packages a host carries for a remote view, by the names it imports
 * them by: `{ preact, 'preact/hooks': hooks, '@yaks/ui': ui }`. */
export type Carried = Record<string, unknown>

/** A view module's component: it draws the app over its store. */
export type NativeView = ComponentType<{ store: Store }>

/** An app's store, as a page's `./api/client.js` offers it. */
export type Store = {
  query: <T = unknown>(filter: string) => Promise<T[]>
  apply: (bundles: object[]) => Promise<unknown>
}

/** The app's view could not be loaded; its web page still opens. */
export class Unloadable extends Error {}

/** A path against the URL it is named from, as a browser resolves an href:
 * absolute, from the origin, or beside the file.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let page = 'https://a.yaks.app/packing/'
 * assertEquals(against(page, 'view.ts'), 'https://a.yaks.app/packing/view.ts')
 * assertEquals(against(page + 'lib/a.ts', '../b.ts'), page + 'b.ts')
 * assertEquals(against(page, '/x/'), 'https://a.yaks.app/x/')
 * ```
 */
export let against = (from: string, path: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path
  let origin = from.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i)?.[0] ?? ''
  if (path.startsWith('/')) return origin + path
  let parts = from.split('/').slice(0, -1)
  for (let p of path.split('/')) {
    if (p == '..') parts.length > 3 && parts.pop()
    else if (p != '.') parts.push(p)
  }
  return parts.join('/')
}

let tag = (html: string, name: string, rel?: string) =>
  [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0])
    .find((t) => !rel || new RegExp(`\\brel=["']?${rel}["'\\s>]`, 'i').test(t))

let href = (t: string | undefined) =>
  t && /\bhref=["']?([^"'\s>]+)/i.exec(t)?.[1]

/** The URL of the view a page names, against its `<base>` when it has one,
 * or null when it names none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let html = '<base href="/packing/"><link rel="yaks-native" href="view.ts">'
 * assertEquals(
 *   viewOf(html, 'https://a.yaks.app/packing'),
 *   'https://a.yaks.app/packing/view.ts',
 * )
 * assertEquals(viewOf('<link rel="icon" href="i.png">', 'https://a/'), null)
 * ```
 */
export let viewOf = (html: string, page: string): string | null => {
  let view = href(tag(html, 'link', 'yaks-native'))
  if (!view) return null
  let base = href(tag(html, 'base'))
  return against(base ? against(page, base) : page, view)
}

/** The URL of the view an app's page names, or null when it names none. */
export let nativeOf = async (
  page: string,
  go: typeof fetch = fetch,
): Promise<string | null> => {
  let r = await go(page)
  if (!r.ok) {
    await r.body?.cancel()
    return null
  }
  return viewOf(await r.text(), r.url || page)
}

type Module = { exports: Record<string, unknown> }

type Source = { code: string; names: string[] }

let gather = async (
  url: string,
  go: typeof fetch,
  sources: Map<string, Source | undefined>,
): Promise<void> => {
  if (sources.has(url)) return
  sources.set(url, undefined)
  let r = await go(url)
  if (!r.ok) {
    await r.body?.cancel()
    throw new Unloadable(`${url} answered ${r.status}`)
  }
  let { code } = transform(await r.text(), {
    transforms: ['typescript', 'imports'],
    filePath: url,
  })
  let names = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) =>
    m[1]
  )
  sources.set(url, { code, names })
  for (let name of names) {
    if (name.startsWith('.')) await gather(against(url, name), go, sources)
  }
}

let execute = (
  url: string,
  carried: Carried,
  sources: Map<string, Source | undefined>,
  modules: Map<string, Module>,
): Module => {
  let had = modules.get(url)
  if (had) return had
  let module: Module = { exports: {} }
  modules.set(url, module)
  let need = (name: string) =>
    name.startsWith('.')
      ? execute(against(url, name), carried, sources, modules).exports
      : carried[name]
  new Function('require', 'module', 'exports', sources.get(url)!.code)(
    need,
    module,
    module.exports,
  )
  return module
}

/** Fetch a view's module graph so its host can select the renderer before it runs. */
export let prepareView = async (
  url: string,
  go: typeof fetch = fetch,
): Promise<{ imports: string[]; open: (carried: Carried) => NativeView }> => {
  let sources = new Map<string, Source | undefined>()
  await gather(url, go, sources)
  let names = [
    ...new Set(
      [...sources.values()].flatMap((s) =>
        s!.names.filter((name) => !name.startsWith('.'))
      ),
    ),
  ]
  return {
    imports: names,
    open(carried: Carried): NativeView {
      for (let name of names) {
        if (!(name in carried)) {
          throw new Unloadable(
            `it imports ${name}, which this host does not carry`,
          )
        }
      }
      let view = execute(url, carried, sources, new Map()).exports.default
      if (typeof view != 'function') {
        throw new Unloadable(`${url} exports no default view`)
      }
      return view as NativeView
    },
  }
}

/** Load a view module and what it imports, its platform packages the host's. */
export let viewAt = async (
  url: string,
  carried: Carried,
  go: typeof fetch = fetch,
): Promise<NativeView> => (await prepareView(url, go)).open(carried)

// What a refusal says: the store's own words, else its status.
let said = async (r: Response, doing: string) => {
  let body = await r.text()
  let message: string | undefined
  try {
    let json = JSON.parse(body)
    message = json.message ?? json.error?.message ?? json.error
  } catch { /* not JSON */ }
  return new Error(
    typeof message == 'string' ? message : `${doing} (HTTP ${r.status})`,
  )
}

/** An app's store over HTTP, at its `api` (`https://a.yaks.app/packing/api`),
 * as its page's `./api/client.js` offers it. */
export let store = (api: string, go: typeof fetch = fetch): Store => ({
  query: async <T>(filter: string) => {
    let r = await go(`${api}/query?${filter}`)
    if (!r.ok) throw await said(r, 'Could not read this app')
    return await r.json() as T[]
  },
  apply: async (bundles) => {
    let r = await go(`${api}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entities: bundles }),
    })
    if (!r.ok) throw await said(r, 'Could not save in this app')
    return await r.json()
  },
})
