// The kernel's npm install, shared by Workers Builds, Wrangler and probes.
// npm's hidden lockfile records the installed tree; compare its contents,
// since a restored cache and a fresh checkout have unrelated mtimes.
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'

let dir = fileURLToPath(new URL('./', import.meta.url))
export type Lock = {
  lockfileVersion: number
  packages: Record<string, { optional?: boolean }>
}

/** npm may omit optional packages, including binaries for other platforms. */
export let matching = (wanted: Lock, held: Lock) =>
  held.lockfileVersion === wanted.lockfileVersion &&
  Object.entries(wanted.packages).every(([path, pkg]) =>
    !path || pkg.optional || held.packages[path]
  ) &&
  Object.entries(held.packages).every(([path, pkg]) =>
    isDeepStrictEqual(pkg, wanted.packages[path])
  )

/** Whether npm's installed tree differs from the requested lockfile. */
export let stale = (root = dir) => {
  let read = (path: string): Lock =>
    JSON.parse(Deno.readTextFileSync(`${root}/${path}`))
  let wanted = read('package-lock.json')
  try {
    let held = read('node_modules/.package-lock.json')
    return !matching(wanted, held) ||
      Object.keys(held.packages).some((path) =>
        !Deno.statSync(`${root}/${path}`).isDirectory
      )
  } catch {
    return true
  }
}

/** Install only a stale tree. An atomic directory keeps simultaneous callers
 * from deleting each other's node_modules while npm ci replaces it. */
export let installed = async (root = dir, timeout = 600_000) => {
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
      let { code } = await new Deno.Command('npm', {
        args: ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
        cwd: root,
        stdin: 'null',
      }).spawn().status
      if (code) throw new Error(`npm ci in ${root} exited ${code}`)
      return true
    } finally {
      Deno.removeSync(lock)
    }
  }
  return false
}

if (import.meta.main) await installed()
