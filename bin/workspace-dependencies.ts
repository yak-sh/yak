// The installer runs before node_modules exists. Resolve workspace exports from
// their manifests for this one process; pnpm owns resolution after the install.
import { fileURLToPath } from 'node:url'
let root = new URL('../', import.meta.url)
let read = (url: URL) => JSON.parse(Deno.readTextFileSync(url))

export let imports = (root: URL): Record<string, string> => {
  let { workspaces = [] } = read(new URL('package.json', root))
  let members = workspaces.flatMap((pattern: string) => {
    if (!pattern.endsWith('/*')) return [pattern]
    let parent = pattern.slice(0, -2)
    return [...Deno.readDirSync(new URL(`${parent}/`, root))]
      .filter((entry) => entry.isDirectory)
      .map((entry) => `${parent}/${entry.name}`)
  })
  return Object.fromEntries(members.flatMap((member: string) => {
    let url = new URL(`${member}/package.json`, root)
    let pkg
    try {
      pkg = read(url)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return []
      throw error
    }
    let exports = typeof pkg.exports == 'string'
      ? { '.': pkg.exports }
      : pkg.exports ?? {}
    return Object.entries(exports)
      .filter(([, target]) => typeof target == 'string')
      .map(([name, target]) => [
        pkg.name + name.slice(1),
        new URL(target as string, url).href,
      ])
  }))
}

if (import.meta.main) {
  let config = await Deno.makeTempFile({ suffix: '.json' })
  try {
    await Deno.writeTextFile(config, JSON.stringify({ imports: imports(root) }))
    let { code } = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-q',
        '-A',
        '--config',
        fileURLToPath(new URL('deno.json', root)),
        '--import-map',
        config,
        fileURLToPath(new URL('packages/cli/dependencies.ts', root)),
        ...Deno.args,
      ],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status
    Deno.exitCode = code
  } finally {
    await Deno.remove(config)
  }
}
