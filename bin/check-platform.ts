// One TypeScript program per platform, not one per package. Keep each package's
// standalone config as the source of truth; resolve its relative import map
// before merging. The browser program may use any declared web-platform lib,
// but never gains Deno, Node or Workers globals from the root configuration.
export type Config = {
  compilerOptions: { lib: string[]; [key: string]: unknown }
  imports?: Record<string, string>
  [key: string]: unknown
}

export function mergeConfigs(configs: { url: URL; config: Config }[]): Config {
  let imports: Record<string, string> = {}
  let libs = new Set<string>()
  let options: Record<string, unknown> | undefined
  for (let { url, config } of configs) {
    for (let key of Object.keys(config)) {
      if (!['_', 'compilerOptions', 'imports'].includes(key)) {
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
      configs.push({ url, config: JSON.parse(text) })
      entries.push(
        new URL(platform === 'browser' ? 'mod.ts' : 'conform.ts', url).href,
      )
    }
  }
  // The tail Worker shares the Store's runtime config, not the Deno root's.
  if (platform === 'workers') {
    entries.push(new URL('workers/yak-tail/conform.ts', root).href)
  }
  configs.sort((a, b) => a.url.href.localeCompare(b.url.href))
  return { config: mergeConfigs(configs), entries: entries.sort() }
}

if (import.meta.main) {
  let { config, entries } = await platformConfig(
    new URL('../', import.meta.url),
    Deno.args[0],
  )
  // Outside the workspace so its Deno globals/imports cannot leak in. All map
  // targets and entrypoints are absolute; random scratch paths do not change
  // the program's module identities or its shared type cache.
  let scratch = await Deno.makeTempDir({ prefix: 'check-platform-' })
  try {
    let path = `${scratch}/deno.json`
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
