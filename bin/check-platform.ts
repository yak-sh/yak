// One TypeScript program per platform, not one per package. Keep each package's
// standalone config as the source of truth; resolve its relative import map
// before merging. `deno task check:browser` checks the browser program here;
// the Workers program is check-types.ts's, beside Deno's. The browser program may use any declared web-platform lib,
// but never gains Deno, Node or Workers globals from the root configuration.
//
// What the browser program checks is a package's browser-facing exports, not
// its directory. `entries` in a browser.json names them (default: `.`), and a
// package's `./vocab` and `./views` subpaths are always added when it has
// them: the web door imports those two of every package, so "this package fits
// the facet split" and "these two subpaths type-check with only the web
// platform in scope" are the same statement. A package whose front door starts
// child processes says `"entries": ["./vocab"]` and is still held to it.
export type Config = {
  compilerOptions: { lib: string[]; [key: string]: unknown }
  imports?: Record<string, string>
  /** which of the package's exports this program checks (default `["."]`);
   * `./vocab` and `./views` are added whenever the package exports them */
  entries?: string[]
  /** package-relative resource globs consumed by the browser compiler catalog;
   * they do not introduce TypeScript entrypoints or compiler options */
  resources?: string[]
  [key: string]: unknown
}

export function mergeConfigs(configs: { url: URL; config: Config }[]): Config {
  let imports: Record<string, string> = {}
  let libs = new Set<string>()
  let options: Record<string, unknown> | undefined
  for (let { url, config } of configs) {
    for (let key of Object.keys(config)) {
      if (
        !['_', 'compilerOptions', 'imports', 'entries', 'resources'].includes(
          key,
        )
      ) {
        throw new Error(`${url}: unsupported platform config field ${key}`)
      }
    }
    let { lib, ...rest } = config.compilerOptions
    let sorted = Object.fromEntries(Object.entries(rest).sort())
    if (options && JSON.stringify(options) !== JSON.stringify(sorted)) {
      throw new Error(`${url}: incompatible platform compiler options`)
    }
    options = sorted
    for (let name of lib) {
      if (
        !['dom', 'dom.asynciterable', 'dom.iterable', 'esnext'].includes(name)
      ) {
        throw new Error(`${url}: non-web platform lib ${name}`)
      }
      libs.add(name)
    }
    for (let [name, target] of Object.entries(config.imports ?? {})) {
      let resolved = new URL(target, url).href
      if (imports[name] && imports[name] !== resolved) {
        throw new Error(`${url}: conflicting platform import ${name}`)
      }
      imports[name] = resolved
    }
  }
  if (!options) throw new Error('No platform configs found')
  return {
    compilerOptions: { ...options, lib: [...libs].sort() },
    imports: Object.fromEntries(Object.entries(imports).sort()),
  }
}

/** The two subpaths the web door imports of every package that has them. */
let WEB = ['./vocab', './views', './ui']

// Which files of one package the browser program checks: what its browser.json
// names (default its front door), plus `./vocab`, `./views` and `./ui` whenever the
// package exports them — the web door's half of the facet split.
function browserEntries(config: Config, deno: URL): string[] {
  let exports = JSON.parse(Deno.readTextFileSync(deno)).exports as
    | string
    | Record<string, string>
  let map = typeof exports === 'string' ? { '.': exports } : exports
  let want = new Set([...(config.entries ?? ['.']), ...WEB])
  let files = [...want].filter((k) => k in map).map((k) => map[k])
  if (!files.length) {
    throw new Error(`${deno}: no browser entry among ${[...want].join(' ')}`)
  }
  return files
}

// A standalone compiler keeps its own globals while taking resolution from
// package manifests, just as the workspace's runtime and bundler do.
let packageImports = (root: URL, platform: string): Record<string, string> => {
  let read = (at: URL) => JSON.parse(Deno.readTextFileSync(at))
  let manifest
  try {
    manifest = read(new URL('package.json', root))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {}
    throw error
  }
  let imports: Record<string, string> = {}
  for (let at of ['', ...manifest.workspaces ?? []]) {
    let url = new URL(`${at ? at + '/' : ''}package.json`, root)
    let pkg = at ? read(url) : manifest
    for (
      let [name, version] of Object.entries({
        ...pkg.devDependencies,
        ...pkg.dependencies,
      })
    ) {
      if (
        name.startsWith('@yaks/') ||
        platform == 'browser' && name == '@cloudflare/workers-types'
      ) continue
      imports[name] = String(version).startsWith('npm:')
        ? String(version)
        : `npm:${name}@${version}`
    }
    let map = typeof pkg.exports == 'string'
      ? { '.': pkg.exports }
      : pkg.exports ?? {}
    for (let [key, target] of Object.entries(map)) {
      if (typeof target == 'string') {
        imports[pkg.name + key.slice(1)] = new URL(target, url).href
      }
    }
  }
  return imports
}

export async function platformConfig(root: URL, platform: string) {
  if (!['browser', 'workers'].includes(platform)) {
    throw new Error('Expected browser or workers')
  }
  let configs: { url: URL; config: Config }[] = []
  let entries: string[] = []
  for (let parent of ['packages', 'workers']) {
    for await (let dir of Deno.readDir(new URL(`${parent}/`, root))) {
      if (!dir.isDirectory) continue
      let url = new URL(`${parent}/${dir.name}/${platform}.json`, root)
      let text: string
      try {
        text = await Deno.readTextFile(url)
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) continue
        throw error
      }
      let config = JSON.parse(text) as Config
      configs.push({ url, config })
      if (platform !== 'browser') {
        entries.push(new URL('conform.ts', url).href)
        continue
      }
      for (let file of browserEntries(config, new URL('deno.json', url))) {
        entries.push(new URL(file, url).href)
      }
    }
  }
  configs.sort((a, b) => a.url.href.localeCompare(b.url.href))
  let config = mergeConfigs(configs)
  config.imports = { ...packageImports(root, platform), ...config.imports }
  return { config, entries: entries.sort() }
}

if (import.meta.main) {
  let { config, entries } = await platformConfig(
    new URL('../', import.meta.url),
    Deno.args[0],
  )
  // A separate config keeps platform globals independent, beside package.json
  // so its workspace and npm dependencies still resolve normally.
  let scratch = await Deno.makeTempFile({
    dir: new URL('../', import.meta.url).pathname,
    prefix: '.platform-',
    suffix: '.json',
  })
  try {
    let path = scratch
    await Deno.writeTextFile(path, JSON.stringify(config))
    let status = await new Deno.Command('deno', {
      args: ['check', '--no-lock', '--config', path, ...entries],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status
    if (!status.success) Deno.exitCode = status.code || 1
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}
