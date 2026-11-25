// Run browser modules in the page's VM from source. Each module stays separate,
// and each window gets its own module instances and browser globals.
import { text } from '@yaks/api/asset'
import { transform } from 'sucrase'

type Exports = Record<string, unknown>

export let sourceModules = (
  at: string,
  entries: Record<string, URL | Exports>,
) => {
  let files = new Map<string, Promise<string | Exports>>()
  let page = new URL(at)
  let resolve = (specifier: string, from: string) => {
    if (!/^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(specifier)) {
      return entries[specifier]
        ? `fixture:${specifier}`
        : import.meta.resolve(specifier)
    }
    let url = new URL(specifier, from)
    let entry = url.origin == page.origin && entries[url.pathname]
    return entry instanceof URL ? entry.href : url.href
  }
  let source = async (href: string) => {
    let url = new URL(href)
    if (url.origin == page.origin) {
      let entry = entries[url.pathname]
      if (entry && !(entry instanceof URL)) return entry
    }
    if (url.protocol == 'fixture:') return entries[url.pathname] as Exports
    if (url.protocol == 'node:') return await import(href) as Exports
    if (url.protocol != 'file:') throw new Error(`No source for ${href}`)
    if (url.pathname.endsWith('.json')) {
      return await import(href, { with: { type: 'json' } }) as Exports
    }
    let code = await text(url)
    if (/\.[cm]?tsx?$/.test(url.pathname)) {
      return transform(code, {
        transforms: url.pathname.endsWith('tsx')
          ? ['typescript', 'jsx']
          : ['typescript'],
        jsxRuntime: 'automatic',
        jsxImportSource: 'preact',
        production: true,
        disableESTransforms: true,
      }).code
    }
    return code
  }
  return {
    resolve,
    read: (href: string) => {
      if (!files.has(href)) files.set(href, source(href))
      return files.get(href)!
    },
  }
}
