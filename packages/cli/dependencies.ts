// The workspace's members and install, shared by the CLI, its hooks, runtime
// copies, builds and probes. pnpm keeps one content-addressed store on the
// machine and hard-links each checkout's node_modules from it
// (pnpm-workspace.yaml), so an install writes directories and links, not
// packages.
import * as io from '@yaks/file/io'
import * as platform from '@yaks/process/system'
import { command as spawnCommand } from '@yaks/process/command'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

let dir = (): string => fileURLToPath(new URL('../../', import.meta.url))
let wanted = (root: string) => `${root}/pnpm-lock.yaml`
// pnpm's copy of the lockfile it last installed, without the document that
// pins pnpm itself.
let current = (root: string) => `${root}/node_modules/.pnpm/lock.yaml`
let packages = (lock?: string) => lock?.split(/^---\n/m).at(-1)

let read = (path: string) => {
  try {
    return io.readTextFileSync(path)
  } catch (error) {
    if (error instanceof io.errors.NotFound) return undefined
    throw error
  }
}

/** The workspace's member directories under root: package.json's
 * `workspaces`, each a directory or `dir/*` for every package beneath it. */
export let members = (root: string = dir()): string[] => {
  let { workspaces = [] } = JSON.parse(
    io.readTextFileSync(`${root}/package.json`),
  ) as { workspaces?: string[] }
  return workspaces.flatMap((pattern) => {
    let path = pattern.replace(/^\.\//, '')
    if (!path.endsWith('/*')) return [path]
    let parent = path.slice(0, -2)
    return [...io.readDirSync(`${root}/${parent}`)]
      .filter((e) =>
        e.isDirectory && existsSync(`${root}/${parent}/${e.name}/package.json`)
      )
      .map((e) => `${parent}/${e.name}`)
      .sort()
  })
}

/** Whether root's node_modules was installed from another lockfile. */
export let stale = (root: string = dir()): boolean =>
  packages(read(wanted(root))) !== read(current(root))

/** Install a stale checkout. Installers take turns by locking the lockfile,
 * which a frozen install only reads. */
export let installed = async (root: string = dir()): Promise<boolean> => {
  if (!stale(root)) return false
  using lock = await io.open(wanted(root))
  await lock.lock(true)
  if (!stale(root)) return false
  // pnpm installs around a tree another installer made, leaving its packages
  // resolvable: start that one over.
  if (!existsSync(`${root}/node_modules/.modules.yaml`)) {
    for (let path of ['.', ...members(root)]) {
      let tree = `${root}/${path}/node_modules`
      if (existsSync(tree)) io.removeSync(tree, { recursive: true })
    }
  }
  let { code } = await spawnCommand('pnpm', {
    args: ['install', '--frozen-lockfile', '--prefer-offline'],
    cwd: root,
    stdin: 'null',
  }).spawn().status
  if (code) throw new Error(`pnpm install in ${root} exited ${code}`)
  return true
}

if (platform.main(import.meta.url)) await installed(platform.args[0])
