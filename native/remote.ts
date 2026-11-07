// A kit-built app's view, loaded from the app itself, so a deploy reaches the
// phone without a new shell. An app names its native view in its front page,
// `<link rel="yaks-native" href="view.ts">`; the shell fetches that module and
// what it imports by relative path, compiles each from TypeScript, and runs it
// with the packages the shell carries standing in for the app's `"platform"`
// ones, as the platform's compile supplies them to its page. The module's
// default export is a component that takes the app's `store`.
import { transform } from 'sucrase'
import * as preact from 'preact'
import * as hooks from 'preact/hooks'
import * as ui from '@yaks/ui'
import type { ComponentType } from 'preact'
import type { App } from './yaks.ts'

/** The packages a remote view may import, by the names it imports them by. */
let carried: Record<string, unknown> = {
  preact,
  'preact/hooks': hooks,
  '@yaks/ui': ui,
}

/** A view module's component: it draws the app over its store. */
export type NativeView = ComponentType<{ store: unknown }>

/** The app's view could not be loaded natively; its web page still opens. */
export class Unloadable extends Error {}

// Where a module's relative import points, against the module's own URL.
let resolve = (from: string, path: string) => {
  let parts = from.split('/').slice(0, -1)
  for (let p of path.split('/')) {
    if (p == '..') parts.pop()
    else if (p != '.') parts.push(p)
  }
  return parts.join('/')
}

let NATIVE = /<link\b[^>]*\brel=["']?yaks-native["']?[^>]*>/i
let HREF = /\bhref=["']?([^"'\s>]+)/i

/** The URL of the app's native view, or null when it names none. */
export let nativeOf = async (app: App): Promise<string | null> => {
  let r = await fetch(app.url)
  if (!r.ok) return null
  let link = NATIVE.exec(await r.text())?.[0]
  let href = link && HREF.exec(link)?.[1]
  return href ? resolve(app.url + 'index.html', href) : null
}

type Module = { exports: Record<string, unknown> }

let load = async (url: string, seen: Map<string, Module>): Promise<Module> => {
  let had = seen.get(url)
  if (had) return had
  let module: Module = { exports: {} }
  seen.set(url, module)
  let r = await fetch(url)
  if (!r.ok) throw new Unloadable(`${url} answered ${r.status}`)
  let { code } = transform(await r.text(), {
    transforms: ['typescript', 'imports'],
    filePath: url,
  })
  let named = [...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) =>
    m[1]
  )
  for (let name of named) {
    if (name.startsWith('.')) await load(resolve(url, name), seen)
    else if (!(name in carried)) {
      throw new Unloadable(`it imports ${name}, which this app does not carry`)
    }
  }
  let need = (name: string) =>
    name.startsWith('.') ? seen.get(resolve(url, name))!.exports : carried[name]
  new Function('require', 'module', 'exports', code)(
    need,
    module,
    module.exports,
  )
  return module
}

/** Load a native view module and what it imports. */
export let viewAt = async (url: string): Promise<NativeView> => {
  let view = (await load(url, new Map())).exports.default
  if (typeof view != 'function') {
    throw new Unloadable(`${url} exports no default view`)
  }
  return view as NativeView
}
