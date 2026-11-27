// Run browser modules in the page's VM from source. Each module stays separate,
// and each window gets its own module instances and browser globals.
import { text } from '@yaks/api/asset'
import { bundle } from '@yaks/cli/page'
import { once } from '@yaks/fp'
import { transform } from 'sucrase'

type Exports = Record<string, unknown>

let rendering = {
  react: () => import('react'),
  'react/jsx-runtime': () => import('react/jsx-runtime'),
  'react-dom': () => import('react-dom'),
  'react-dom/client': () => import('react-dom/client'),
  'react-dom/server': () => import('react-dom/server'),
}

// These npm modules ship CommonJS. Bundle them together for each page's
// module graph so its React DOM sees its window and shares its one React.
let bundled = once(async () => {
  let entries = Object.entries(rendering)
  let parts = entries.map(([name], i) =>
    `export * as runtime${i} from ${JSON.stringify(name)}`
  )
  let at = new URL('./page-renderer.js', import.meta.url)
  let code = await bundle({ at, code: parts.join('\n') })
  let modules = new Map<string, string>([[at.href, code]])
  for (let [i, [name, load]] of entries.entries()) {
    let keys = Object.keys(await load()).filter((key) =>
      key != 'default' && /^[A-Za-z_$][\w$]*$/.test(key)
    )
    modules.set(
      `fixture:${name}`,
      `import { runtime${i} as mod } from ${JSON.stringify(at.href)}\n` +
        `export const { ${keys.join(', ')} } = mod\nexport default mod.default`,
    )
  }
  return modules
})

export let sourceModules = (
  at: string,
  entries: Record<string, URL | Exports>,
) => {
  let files = new Map<string, Promise<string | Exports>>()
  let page = new URL(at)
  let resolve = (specifier: string, from: string) => {
    if (!/^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(specifier)) {
      return entries[specifier] || Object.hasOwn(rendering, specifier)
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
    if (url.protocol == 'fixture:' && entries[url.pathname]) {
      return entries[url.pathname] as Exports
    }
    if (
      url.protocol == 'fixture:' || url.pathname.endsWith('/page-renderer.js')
    ) {
      let code = (await bundled()).get(href)
      if (code) return code
    }
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
        jsxImportSource: 'react',
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
