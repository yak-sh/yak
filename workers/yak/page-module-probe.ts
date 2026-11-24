// A page's module graph in its own window, loaded through the same addresses
// as the page. Only the browser's interfaces come from the fixture.
import {
  type Context,
  createContext,
  SourceTextModule,
  SyntheticModule,
} from 'node:vm'
import { parse } from 'es-module-lexer/js'

type Exports = Record<string, unknown>
type Load = (specifier: string, from: string) => Promise<Exports>
type Page = {
  at: string
  globals?: Record<string, unknown>
  read: (url: string) => Promise<string | Exports>
  resolve?: (specifier: string, from: string) => string
}

// Where a specifier is, as a browser resolves it: by its address, or a bare
// one through the page's import map (`imports`, read off its document).
let address =
  (imports: Record<string, string>) => (specifier: string, from: string) => {
    if (/^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(specifier)) {
      return new URL(specifier, from).href
    }
    let mapped = imports[specifier]
    if (mapped) return new URL(mapped, from).href
    throw new TypeError(`Unmapped module specifier: ${specifier}`)
  }

// The import map a page's document holds, if any.
let mapOf = (doc: unknown): Record<string, string> => {
  let map = (doc as Document | undefined)?.querySelector?.(
    'script[type="importmap"]',
  )?.textContent
  return map ? JSON.parse(map).imports ?? {} : {}
}

// Deno's node:vm holds a module's callbacks outside the garbage collector's
// reach: every `importModuleDynamically` for the runtime's life
// (op_vm_dynamic_import_callback_register is never undone), and each
// `initializeImportMeta` as a root. A callback that reaches its window's
// modules keeps the window, its document and every page script forever. So no
// module is given an `importModuleDynamically`: a page's `import(…)` is read
// as `import.meta.import(…)`. And `import.meta` is set by a callback made out
// here, whose scope holds only the module's address and, weakly, its window.
let loaders = new WeakMap<Context, Load>()
let importMeta =
  (window: WeakRef<Context>, url: string) => (meta: ImportMeta) => {
    let load = loaders.get(window.deref()!)!
    meta.url = url
    Object.assign(meta, { import: (specifier: string) => load(specifier, url) })
  }
let dynamic = (code: string) =>
  parse(code)[0].reduceRight(
    (code, { d, ss }) =>
      d < 0 ? code : code.slice(0, ss) + 'import.meta.import' + code.slice(d),
    code,
  )

/** Run a page module and its imports without a browser, server or shared globals. */
export let pageModule = async (source: string, page: Page) => {
  let context = createContext({
    console,
    crypto,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    DOMException,
    Request,
    Response,
    Headers,
    FormData,
    Blob,
    File,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    performance,
    reportError: (error: unknown) => globalThis.reportError(error),
    ...page.globals,
  })
  context.window = context.self = context
  let window = new WeakRef(context)
  let resolve = page.resolve ?? address(mapOf(page.globals?.document))
  let modules = new Map<string, Promise<SourceTextModule | SyntheticModule>>()
  let running = new Map<string, Promise<Exports>>()
  let load = (url: string) => {
    if (!modules.has(url)) {
      modules.set(
        url,
        page.read(url).then((value) =>
          typeof value == 'string'
            ? module(value, url)
            : new SyntheticModule(Object.keys(value), function () {
              for (let [name, exported] of Object.entries(value)) {
                this.setExport(name, exported)
              }
            }, { context, identifier: url })
        ),
      )
    }
    return modules.get(url)!
  }
  let link = (specifier: string, from: { identifier: string }) =>
    load(resolve(specifier, from.identifier))
  let run = (url: string) => {
    if (!running.has(url)) {
      running.set(
        url,
        (async () => {
          let dependency = await load(url)
          if (dependency.status == 'unlinked') await dependency.link(link)
          await dependency.evaluate()
          return dependency.namespace as Exports
        })(),
      )
    }
    return running.get(url)!
  }
  loaders.set(context, (specifier, from) => run(resolve(specifier, from)))
  let module = (code: string, url: string): SourceTextModule =>
    new SourceTextModule(dynamic(code), {
      context,
      identifier: url,
      initializeImportMeta: importMeta(window, url),
    })
  let root = module(source, page.at)
  modules.set(page.at, Promise.resolve(root))
  await root.link(link)
  await root.evaluate()
  return root.namespace as Exports
}
