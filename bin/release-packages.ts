// The versions a release moves: each member's package.json, its JSR metadata,
// and the lockfiles that record them.
import { matchesGlob } from 'node:path'
import { members } from '@yaks/cli/dependencies'

let read = async (path: string) => JSON.parse(await Deno.readTextFile(path))
let write = (path: string, value: unknown) =>
  Deno.writeTextFile(path, JSON.stringify(value, null, 2) + '\n')

type Manifest = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  [key: string]: unknown
}

/** A manifest at the versions `next` gives: its own, and the member versions
 * its internal dependencies name. */
export let versioned = (
  pkg: Manifest,
  next: Map<string, string>,
): Manifest => {
  let version = pkg.name && next.get(pkg.name)
  let out = { ...pkg, ...pkg.version && version ? { version } : {} }
  let groups: ('dependencies' | 'devDependencies' | 'optionalDependencies')[] =
    [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]
  for (let group of groups) {
    if (pkg[group]) {
      out[group] = Object.fromEntries(
        Object.entries(pkg[group]).map(
          ([name, range]) => [name, next.get(name) ?? range],
        ),
      )
    }
  }
  return out
}

let metadata = (
  pkg: Record<string, unknown>,
  config: { publish?: false | { exclude?: string[] }; [key: string]: unknown },
) => {
  let next = { ...config }
  for (let key of ['name', 'version', 'license', 'description']) {
    next[key] = pkg[key]
  }
  let exports = pkg.exports
  next.exports = typeof exports == 'string' ? exports : Object.fromEntries(
    Object.entries(exports ?? {}).filter(([, file]) =>
      !((config.publish || {}).exclude ?? []).some((glob: string) =>
        matchesGlob(
          String(file).replace(/^\.\//, ''),
          glob.replace(/^\.\//, ''),
        )
      )
    ),
  )
  return next
}

/** Write each member at the version `next` gives it, every other member and
 * every internal dependency at the version it names. */
export let versions = async (root: string, next: Map<string, string>) => {
  let workspaces = members(root)
  let paths = workspaces.map((dir: string) => `${root}/${dir}/deno.json`)
  let npm = workspaces.map((dir: string) => `${root}/${dir}/package.json`)
  let packages: Manifest[] = await Promise.all(
    npm.map(async (path: string) => JSON.parse(await Deno.readTextFile(path))),
  )
  let all = new Map(
    packages.flatMap((pkg) =>
      pkg.name && pkg.version ? [[pkg.name, pkg.version]] : []
    ),
  )
  for (let [name, version] of next) all.set(name, version)
  for (let [i, path] of npm.entries()) {
    await Deno.writeTextFile(
      path,
      JSON.stringify(versioned(packages[i], all), null, 2) + '\n',
    )
  }
  for (let path of paths) {
    let pkg = await read(path.replace(/deno\.json$/, 'package.json'))
    await write(path, metadata(pkg, await read(path)))
  }
  // pnpm rewrites the members' specifiers its lockfile records.
  let { code } = await new Deno.Command('pnpm', {
    args: ['install', '--lockfile-only', '--prefer-offline'],
    cwd: root,
  }).spawn().status
  if (code) throw new Error(`pnpm install --lockfile-only exited ${code}`)
  let lockPath = `${root}/pnpm-lock.yaml`
  let denoPath = `${root}/deno.lock`
  let deno = JSON.parse(await Deno.readTextFile(denoPath))
  let workspace = JSON.stringify(deno.workspace)
  for (let pkg of packages) {
    let version = pkg.name && next.get(pkg.name)
    if (!version) continue
    workspace = workspace.replaceAll(
      JSON.stringify(`npm:${pkg.name}@${pkg.version}`),
      JSON.stringify(`npm:${pkg.name}@${version}`),
    )
  }
  deno.workspace = JSON.parse(workspace)
  await Deno.writeTextFile(denoPath, JSON.stringify(deno, null, 2) + '\n')
  paths.push(...npm, lockPath, denoPath)
  return paths
}
