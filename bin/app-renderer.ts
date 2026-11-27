import manifest from '../packages/preact/package.json' with { type: 'json' }

let renderer = manifest.yaksRenderer
let apps = new Map<string, boolean>()
let sources = new Map<string, boolean>()

let preactApp = (app: string): boolean => {
  let choice = apps.get(app)
  if (choice != undefined) return choice
  try {
    let at = new URL(`../${app}/package.json`, import.meta.url)
    let { dependencies = {} } = JSON.parse(Deno.readTextFileSync(at))
    choice = renderer.dependency in dependencies &&
      !(renderer.unless in dependencies)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
    choice = false
  }
  apps.set(app, choice)
  return choice
}

/** Whether this source runs an app that selects the Preact plugin. */
export let usesPreact = (path: string): boolean => {
  let app = /^apps\/[^/]+/.exec(path)?.[0]
  if (app) return preactApp(app)
  if (!/^(bin|workers)\/.*\.[cm]?[jt]sx?$/.test(path)) return false
  let prior = sources.get(path)
  if (prior != undefined) return prior
  let choice = false
  try {
    let source = Deno.readTextFileSync(new URL(`../${path}`, import.meta.url))
    let imports = source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](?:\.\.\/)+(apps\/[^/]+)\/[^'"]+\.[cm]?[jt]sx?['"]/g,
    )
    choice = [...imports].some(([, app]) => preactApp(app))
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  sources.set(path, choice)
  return choice
}

/** The Preact module bindings for the test and type-check processes. */
export let preactImports: string =
  new URL('../deno.preact.json', import.meta.url)
    .pathname
