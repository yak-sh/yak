import manifest from '../packages/preact/package.json' with { type: 'json' }

let renderer = manifest.yaksRenderer
let checkout = new URL('../', import.meta.url)
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
export let usesPreact = (path: string): boolean => needsPreact(path, new Set())

let needsPreact = (path: string, visited: Set<string>): boolean => {
  let app = /^apps\/[^/]+/.exec(path)?.[0]
  if (app && preactApp(app)) return true
  let group = /^(apps|bench|bin|workers)\/.*\.[cm]?[jt]sx?$/.exec(path)?.[1]
  if (!group || visited.has(path)) return false
  let prior = sources.get(path)
  if (prior != undefined) return prior
  visited.add(path)
  let choice = false
  try {
    let url = new URL(path, checkout)
    let source = Deno.readTextFileSync(url)
    let imports = source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+\.[cm]?[jt]sx?)['"]/g,
    )
    for (let [, imported] of imports) {
      let dependency = new URL(imported, url).href
      if (!dependency.startsWith(checkout.href)) continue
      let local = dependency.slice(checkout.href.length)
      if (group == 'workers' && !local.startsWith('apps/')) continue
      if (needsPreact(local, visited)) {
        choice = true
        break
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  visited.delete(path)
  sources.set(path, choice)
  return choice
}

/** The Preact module bindings for the test and type-check processes. */
export let preactImports: string =
  new URL('../deno.preact.json', import.meta.url)
    .pathname
