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

/** The filesystem and process boundary used by the install policy. */
export type Host = {
  read(path: string): string
  write(path: string, contents: string): void
  mkdir(path: string, recursive?: boolean): void
  remove(path: string): void
  directory(path: string): boolean
  exists(path: string): boolean
  realpath(path: string): string
  copy(from: string, to: string): void
  rename(from: string, to: string): void
  symlink(target: string, path: string): void
  link(path: string): string | undefined
  now(): number
  wait(): Promise<void>
  npm(root: string): Promise<number>
  report(message: string): void
  nonce(): string
}

let system: Host = {
  read: Deno.readTextFileSync,
  write: Deno.writeTextFileSync,
  mkdir: (path, recursive = false) => Deno.mkdirSync(path, { recursive }),
  remove: (path) => {
    try {
      Deno.removeSync(path, { recursive: true })
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
  },
  directory: (path) => Deno.statSync(path).isDirectory,
  exists: existsSync,
  realpath: Deno.realPathSync,
  copy: (from, to) =>
    cpSync(from, to, { recursive: true, verbatimSymlinks: true }),
  rename: Deno.renameSync,
  symlink: (target, path) => Deno.symlinkSync(target, path, { type: 'dir' }),
  link: (path) =>
    Deno.lstatSync(path).isSymlink ? Deno.readLinkSync(path) : undefined,
  now: Date.now,
  wait: () => new Promise((ok) => setTimeout(ok, 200)),
  npm: async (root) => {
    let { code } = await new Deno.Command('npm', {
      args: ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
      cwd: root,
      stdin: 'null',
    }).spawn().status
    return code
  },
  report: (message) => console.error(message),
  nonce: randomUUID,
}

let key = (inputs: string[][]) =>
  createHash('sha256').update(
    JSON.stringify([Deno.build.os, Deno.build.arch, inputs]),
  ).digest('hex')
let receipt = (root: string) => `${root}/node_modules/.yak-install`
let identity = ['version', 'resolved', 'integrity', 'link'] as const

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

/** Install/cache policy with its effects supplied by the host. */
export let dependencies = (host: Host = system) => {
  let files = (root: string) =>
    ['package.json', 'package-lock.json'].map((
      file,
    ) => [file, host.read(`${root}/${file}`)])
  let remove = host.remove

  let incomplete = (root: string) => {
    let read = (path: string): Lock => JSON.parse(host.read(`${root}/${path}`))
    let path = 'package-lock.json'
    try {
      let wanted = read(path)
      path = 'node_modules/.package-lock.json'
      let held = read(path), reason = mismatch(wanted, held)
      if (reason) return reason
      for (let path of Object.keys(held.packages)) {
        try {
          if (host.directory(`${root}/${path}`)) continue
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
        held = host.read(receipt(root))
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
  let stale = (root = dir) => !!changed(root)

  let adopted = (root: string, cacheKey: string) => {
    try {
      if (
        host.exists(receipt(root)) || key(files(root)) !== cacheKey ||
        !complete(root)
      ) return false
      host.write(receipt(root), cacheKey)
      return true
    } catch {
      return false
    }
  }

  let linked = (root: string) => {
    try {
      return host.link(`${root}/node_modules`) !== undefined
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false
      throw error
    }
  }

  /** Install only a stale tree. An atomic directory keeps simultaneous callers
   * from deleting each other's node_modules while npm ci replaces it. */
  let installed = async (root = dir, {
    timeout = 600_000,
    seed,
    cacheKey,
    copy = false,
  }: { timeout?: number; seed?: string; cacheKey?: string; copy?: boolean } =
    {}) => {
    let lock = `${root}/node_modules.lock`
    let due = host.now() + timeout
    let needed = () => stale(root) || (copy && linked(root))
    while (needed()) {
      try {
        host.mkdir(lock)
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error
        if (host.now() > due) {
          throw new Error(
            `npm ci in ${root} never finished; if nothing is installing, ` +
              `remove ${lock}`,
          )
        }
        await host.wait()
        continue
      }
      try {
        // Another installer may have finished between the read and the mkdir.
        if (!needed()) return false
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
          host.copy(host.realpath(`${seed}/node_modules`), copy)
          remove(modules)
          host.rename(copy, modules)
          return false
        }
        let inputs = key(files(root))
        let reason = changed(root)
        let cacheReason = cacheKey
          ? inputs !== cacheKey
            ? `cache different key: ${cacheKey} != ${inputs}`
            : incomplete(root)
          : undefined
        host.report(
          `npm ci in ${JSON.stringify(root)}: ${
            [reason, cacheReason, seedIssue].filter(Boolean).join('; ')
          }`,
        )
        remove(receipt(root))
        try {
          let code = await host.npm(root)
          if (code) throw new Error(`npm ci in ${root} exited ${code}`)
          host.write(receipt(root), inputs)
        } catch (error) {
          // npm can write its hidden lock before an install script fails.
          if (host.exists(`${root}/node_modules`)) {
            remove(host.realpath(`${root}/node_modules`))
          }
          remove(`${root}/node_modules`)
          throw error
        }
        return true
      } finally {
        host.remove(lock)
      }
    }
    return false
  }

  /** Share an installed project through npm's restored cache. Link by default;
   * copy when a resolver needs module URLs to remain under the checkout. */
  let restored = async (
    cache: string,
    root = dir,
    { timeout = 600_000, mode = 'link' }: {
      timeout?: number
      mode?: 'link' | 'copy'
    } = {},
  ) => {
    let inputs = files(root)
    let digest = key(inputs), project = resolve(cache, 'yak-installed', digest)
    host.mkdir(project, true)
    let legacy = false
    try {
      legacy = key(files(project)) === digest
    } catch { /* An incomplete legacy cache installs normally. */ }
    for (let [file, contents] of inputs) {
      let pending = `${project}/${file}.${host.nonce()}`
      host.write(pending, contents)
      host.rename(pending, `${project}/${file}`)
    }
    let changed = await installed(project, {
      timeout,
      seed: root,
      cacheKey: legacy ? digest : undefined,
    })
    if (mode == 'copy') {
      await installed(root, { timeout, seed: project, copy: true })
      return changed
    }
    let modules = `${root}/node_modules`
    try {
      if (
        host.link(modules) === `${project}/node_modules`
      ) return changed
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
    remove(modules)
    host.symlink(`${project}/node_modules`, modules)
    return changed
  }

  return { stale, installed, restored }
}

export let { stale, installed, restored } = dependencies()

if (import.meta.main) {
  if (Deno.args[0]) await restored(Deno.args[0])
  else await installed()
}
