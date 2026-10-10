// The kernel's npm install, shared by Workers Builds, Wrangler and probes.
// Keep successful install inputs beside the tree: npm versions omit different
// metadata from their hidden lockfiles, and restored mtimes tell us nothing.
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync } from 'node:fs'

let dir = fileURLToPath(new URL('./', import.meta.url))
export type Lock = {
  lockfileVersion: number
  packages: Record<string, {
    optional?: boolean
    version?: string
    resolved?: string
    integrity?: string
    link?: boolean
  }>
}

let files = (root: string) =>
  ['package.json', 'package-lock.json'].map((
    file,
  ) => [file, Deno.readTextFileSync(`${root}/${file}`)])
let key = (inputs: string[][]) =>
  createHash('sha256').update(
    JSON.stringify([Deno.build.os, Deno.build.arch, inputs]),
  ).digest('hex')
let receipt = (root: string) => `${root}/node_modules/.yak-install`
let identity = ['version', 'resolved', 'integrity', 'link'] as const
let remove = (path: string) => {
  try {
    Deno.removeSync(path, { recursive: true })
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
}

/** npm may omit optional packages, including binaries for other platforms. */
export let matching = (wanted: Lock, held: Lock) =>
  held.lockfileVersion === wanted.lockfileVersion &&
  Object.entries(wanted.packages).every(([path, pkg]) =>
    !path || pkg.optional || held.packages[path]
  ) &&
  Object.entries(held.packages).every(([path, pkg]) =>
    wanted.packages[path] &&
    identity.every((field) => pkg[field] === wanted.packages[path][field])
  )

let complete = (root: string) => {
  let read = (path: string): Lock =>
    JSON.parse(Deno.readTextFileSync(`${root}/${path}`))
  let wanted = read('package-lock.json')
  let held = read('node_modules/.package-lock.json')
  return matching(wanted, held) &&
    Object.keys(held.packages).every((path) =>
      Deno.statSync(`${root}/${path}`).isDirectory
    )
}

/** Whether the successful install inputs or its package tree changed. */
export let stale = (root = dir) => {
  try {
    return Deno.readTextFileSync(receipt(root)) !== key(files(root)) ||
      !complete(root)
  } catch {
    return true
  }
}

let adopted = (root: string, cacheKey: string) => {
  try {
    if (
      existsSync(receipt(root)) || key(files(root)) !== cacheKey ||
      !complete(root)
    ) return false
    Deno.writeTextFileSync(receipt(root), cacheKey)
    return true
  } catch {
    return false
  }
}

/** Install only a stale tree. An atomic directory keeps simultaneous callers
 * from deleting each other's node_modules while npm ci replaces it. */
export let installed = async (root = dir, {
  timeout = 600_000,
  seed,
  cacheKey,
}: { timeout?: number; seed?: string; cacheKey?: string } = {}) => {
  let lock = `${root}/node_modules.lock`
  let due = Date.now() + timeout
  while (stale(root)) {
    try {
      Deno.mkdirSync(lock)
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error
      if (Date.now() > due) {
        throw new Error(
          `npm ci in ${root} never finished; if nothing is installing, ` +
            `remove ${lock}`,
        )
      }
      await new Promise((ok) => setTimeout(ok, 200))
      continue
    }
    try {
      // Another installer may have finished between the read and the mkdir.
      if (!stale(root)) return false
      // The restored project's content key certifies an older complete tree.
      if (cacheKey && adopted(root, cacheKey)) return false
      if (seed && key(files(root)) === key(files(seed)) && !stale(seed)) {
        let modules = `${root}/node_modules`, copy = `${lock}/node_modules`
        cpSync(Deno.realPathSync(`${seed}/node_modules`), copy, {
          recursive: true,
          verbatimSymlinks: true,
        })
        remove(modules)
        Deno.renameSync(copy, modules)
        return false
      }
      let inputs = key(files(root))
      remove(receipt(root))
      try {
        let { code } = await new Deno.Command('npm', {
          args: ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
          cwd: root,
          stdin: 'null',
        }).spawn().status
        if (code) throw new Error(`npm ci in ${root} exited ${code}`)
        Deno.writeTextFileSync(receipt(root), inputs)
      } catch (error) {
        // npm can write its hidden lock before an install script fails.
        if (existsSync(`${root}/node_modules`)) {
          remove(Deno.realPathSync(`${root}/node_modules`))
        }
        remove(`${root}/node_modules`)
        throw error
      }
      return true
    } finally {
      Deno.removeSync(lock, { recursive: true })
    }
  }
  return false
}

/** Workers Builds restores npm's cache, not the checkout's node_modules.
 * Keep the installed project in that cache and link the checkout to it. */
export let restored = async (cache: string, root = dir) => {
  let inputs = files(root)
  let digest = key(inputs), project = resolve(cache, 'yak-installed', digest)
  Deno.mkdirSync(project, { recursive: true })
  let legacy = false
  try {
    legacy = key(files(project)) === digest
  } catch { /* An incomplete legacy cache installs normally. */ }
  for (let [file, contents] of inputs) {
    let pending = `${project}/${file}.${randomUUID()}`
    Deno.writeTextFileSync(pending, contents)
    Deno.renameSync(pending, `${project}/${file}`)
  }
  let changed = await installed(project, {
    seed: root,
    cacheKey: legacy ? digest : undefined,
  })
  let modules = `${root}/node_modules`
  try {
    if (
      Deno.lstatSync(modules).isSymlink &&
      Deno.readLinkSync(modules) === `${project}/node_modules`
    ) return changed
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  remove(modules)
  Deno.symlinkSync(`${project}/node_modules`, modules, { type: 'dir' })
  return changed
}

if (import.meta.main) {
  if (Deno.args[0]) await restored(Deno.args[0])
  else await installed()
}
