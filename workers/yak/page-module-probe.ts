// A page's module graph in its own window, loaded through the same addresses
// as the page. Only the browser's interfaces come from the fixture.
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

type Exports = Record<string, unknown>
type Page = {
  at: string
  globals?: Record<string, unknown>
  read: (url: string) => Promise<string | Exports>
  resolve?: (specifier: string, from: string) => string
}

let address = (specifier: string, from: string) => {
  if (/^(?:\.{0,2}\/|[a-z][a-z\d+.-]*:)/i.test(specifier)) {
    return new URL(specifier, from).href
  }
  throw new TypeError(`Unmapped module specifier: ${specifier}`)
}

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
    reportError: (error: unknown) => globalThis.reportError(error),
    ...page.globals,
  })
  context.window = context.self = context
  let resolve = page.resolve ?? address
  let modules = new Map<string, Promise<SourceTextModule | SyntheticModule>>()
  let running = new Map<string, Promise<SourceTextModule | SyntheticModule>>()
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
  let module = (code: string, url: string): SourceTextModule =>
    new SourceTextModule(code, {
      context,
      identifier: url,
      initializeImportMeta: (meta) => {
        meta.url = url
      },
      importModuleDynamically: (specifier, from) => {
        let url = resolve(specifier, from.identifier)
        if (!running.has(url)) {
          running.set(
            url,
            (async () => {
              let dependency = await load(url)
              if (dependency.status == 'unlinked') await dependency.link(link)
              await dependency.evaluate()
              return dependency
            })(),
          )
        }
        return running.get(url)!
      },
    })
  let root = module(source, page.at)
  modules.set(page.at, Promise.resolve(root))
  await root.link(link)
  await root.evaluate()
  return root.namespace as Exports
}
