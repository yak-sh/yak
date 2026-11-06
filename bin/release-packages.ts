// The versions a release moves: each member's package.json and the lockfiles
// that record them. A member's JSR metadata is its package.json, which publish
// writes into its deno.json for the run (bin/publish.ts).
import { members } from '@yaks/cli/dependencies'

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

/** Write each member at the version `next` gives it, every other member and
 * every internal dependency at the version it names. */
export let versions = async (root: string, next: Map<string, string>) => {
  let workspaces = members(root)
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
  return [...npm, lockPath, denoPath]
}
