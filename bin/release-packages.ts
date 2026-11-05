// Family package manifests, JSR metadata and lockfiles move in one release.
import { matchesGlob } from 'node:path'

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

/** Move a family version and its internal dependencies together. */
export let versioned = (
  pkg: Manifest,
  version: string,
  names: Set<string>,
): Manifest => {
  let next = { ...pkg, ...pkg.version ? { version } : {} }
  let groups: ('dependencies' | 'devDependencies' | 'optionalDependencies')[] =
    [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]
  for (let group of groups) {
    if (pkg[group]) {
      next[group] = Object.fromEntries(
        Object.entries(pkg[group]).map(
          ([name, range]) => [name, names.has(name) ? version : range],
        ),
      )
    }
  }
  return next
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

export let versions = async (root: string, version: string) => {
  let { workspaces } = await read(`${root}/package.json`)
  let paths = workspaces.map((dir: string) => `${root}/${dir}/deno.json`)
  let npm = workspaces.map((dir: string) => `${root}/${dir}/package.json`)
  let packages: Manifest[] = await Promise.all(
    npm.map(async (path: string) => JSON.parse(await Deno.readTextFile(path))),
  )
  let names = new Set(packages.flatMap((pkg) => pkg.name ?? []))
  for (let [i, path] of npm.entries()) {
    await Deno.writeTextFile(
      path,
      JSON.stringify(versioned(packages[i], version, names), null, 2) + '\n',
    )
  }
  for (let path of paths) {
    let pkg = await read(path.replace(/deno\.json$/, 'package.json'))
    await write(path, metadata(pkg, await read(path)))
  }
  let lockPath = `${root}/package-lock.json`
  let lock = JSON.parse(await Deno.readTextFile(lockPath))
  let members = new Set(
    workspaces.map((dir: string) => dir.replace(/^\.\//, '')),
  )
  for (let [path, pkg] of Object.entries<Manifest>(lock.packages)) {
    if (!path || members.has(path)) {
      lock.packages[path] = versioned(pkg, version, names)
    }
  }
  await Deno.writeTextFile(lockPath, JSON.stringify(lock, null, 2) + '\n')
  let denoPath = `${root}/deno.lock`
  let deno = JSON.parse(await Deno.readTextFile(denoPath))
  let workspace = JSON.stringify(deno.workspace)
  for (let pkg of packages) {
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
