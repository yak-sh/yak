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
let mismatch = (wanted: Lock, held: Lock) => {
  if (held.lockfileVersion !== wanted.lockfileVersion) {
    return 'lockfile mismatch: lockfileVersion'
  }
  for (let [path, pkg] of Object.entries(wanted.packages)) {
    if (path && !pkg.optional && !held.packages[path]) {
      return `lockfile mismatch: ${JSON.stringify(path)} package missing`
    }
  }
  for (let [path, pkg] of Object.entries(held.packages)) {
    if (!wanted.packages[path]) {
      return `lockfile mismatch: ${JSON.stringify(path)} package unexpected`
    }
    for (let field of identity) {
      if (pkg[field] !== wanted.packages[path][field]) {
        return `lockfile mismatch: ${JSON.stringify(path)} ${field}`
      }
    }
  }
}

export let matching = (wanted: Lock, held: Lock) => !mismatch(wanted, held)

let incomplete = (root: string) => {
  let read = (path: string): Lock =>
    JSON.parse(Deno.readTextFileSync(`${root}/${path}`))
  let path = 'package-lock.json'
  try {
    let wanted = read(path)
    path = 'node_modules/.package-lock.json'
    let held = read(path), reason = mismatch(wanted, held)
    if (reason) return reason
    for (let path of Object.keys(held.packages)) {
      try {
        if (Deno.statSync(`${root}/${path}`).isDirectory) continue
      } catch { /* A missing or inaccessible package cannot be reused. */ }
      return `tree incomplete: ${JSON.stringify(`${root}/${path}`)}`
    }
  } catch (error) {
    return `lockfile ${
      error instanceof Deno.errors.NotFound ? 'missing' : 'unreadable'
    }: ${JSON.stringify(`${root}/${path}`)}`
  }
}

let complete = (root: string) => !incomplete(root)

let changed = (root: string) => {
  try {
    let held: string
    try {
      held = Deno.readTextFileSync(receipt(root))
    } catch (error) {
      return `receipt ${
        error instanceof Deno.errors.NotFound ? 'missing' : 'unreadable'
      }: ${JSON.stringify(receipt(root))}`
    }
    let wanted = key(files(root))
    if (held !== wanted) {
      return `receipt different key: ${JSON.stringify(held)} != ${wanted}`
    }
    return incomplete(root)
  } catch (error) {
    return `install inputs unreadable: ${JSON.stringify(String(error))}`
  }
}

/** Whether the successful install inputs or its package tree changed. */
export let stale = (root = dir) => !!changed(root)

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
      let seedReason = () => {
        if (!seed) return 'seed missing'
        if (key(files(root)) !== key(files(seed))) {
          return `seed different key: ${JSON.stringify(seed)}`
        }
        let reason = changed(seed)
        if (reason) return `seed stale: ${JSON.stringify(seed)} (${reason})`
      }
      let seedIssue = seedReason()
      if (!seedIssue) {
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
      let reason = changed(root)
      let cacheReason = cacheKey
        ? inputs !== cacheKey
          ? `cache different key: ${cacheKey} != ${inputs}`
          : incomplete(root)
        : undefined
      console.error(
        `npm ci in ${JSON.stringify(root)}: ${
          [reason, cacheReason, seedIssue].filter(Boolean).join('; ')
        }`,
      )
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
