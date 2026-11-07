import { posix } from 'node:path'

/** Test runtime and fixtures travel with the bench; product modules stay at
 * the revision being measured. These paths also identify the driver cache. */
export let SUPPORT = [
  'packages/testing/',
  'packages/d1/testing.ts',
  'packages/durable-object/testing.ts',
  'packages/harness/testing.ts',
  'packages/sqlite/testing.ts',
  'packages/sqlite/fixtures/',
  'packages/tui/testing.ts',
  'workers/yak/endpoints.ts',
  'workers/yak/mcp-probe.ts',
  'workers/yak/probe.ts',
  'workers/yak/testing.ts',
]

export let support = (file: string) =>
  SUPPORT.some((path) =>
    path.endsWith('/') ? file.startsWith(path) : file == path
  )

type Config = {
  imports?: Record<string, string>
  workspace?: string[]
  [key: string]: unknown
}

export let configured = (
  product: Config,
  driver: Config,
  carried: Record<string, string> = {},
): Config => ({
  ...product,
  imports: { ...driver.imports, ...product.imports, ...carried },
  workspace: [...new Set([...product.workspace ?? [], './packages/benchmark'])],
})

/** Where a revision keeps the driver's copies of the modules it lacks. */
export let CARRIED = '.carried'

/** The specifiers a module's source imports or re-exports. */
export let imported = (source: string): string[] =>
  [...source.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])

type Manifest = { name?: string; exports?: string | Record<string, string> }

/** The file each export of the package at `dir` names, by its specifier:
 * `@yaks/file/io` → `packages/file/io.ts`. */
export let exported = (
  dir: string,
  manifest: Manifest,
): Record<string, string> => {
  let { name, exports } = manifest
  if (!name || !exports) return {}
  let entries = typeof exports == 'string' ? { '.': exports } : exports
  return Object.fromEntries(
    Object.entries(entries).map(([path, file]) => [
      name + path.slice(1),
      posix.join(dir, file),
    ]),
  )
}

/** The driver's modules that can travel to an older revision: each @yaks
 * module `sources` import whose files reach no other @yaks package, with
 * those files. Such a module is a boundary over the runtime, not product, so
 * a revision that lacks it runs the driver's copy and measures only its own
 * product. `read` answers undefined for a file the driver lacks. */
export let boundaries = (
  sources: string[],
  exports: Record<string, string>,
  read: (file: string) => string | undefined,
): Record<string, string[]> => {
  let reach = (file: string): string[] | undefined => {
    let files = [file]
    for (let at of files) {
      let source = read(at)
      if (source == undefined) return
      for (let specifier of imported(source)) {
        if (specifier.startsWith('@yaks/')) return
        if (!specifier.startsWith('.')) continue
        let next = posix.join(posix.dirname(at), specifier)
        if (!files.includes(next)) files.push(next)
      }
    }
    return files
  }
  let specifiers = new Set(
    sources.flatMap(imported).filter((specifier) =>
      specifier.startsWith('@yaks/') && exports[specifier]
    ),
  )
  return Object.fromEntries(
    [...specifiers].flatMap((specifier) => {
      let files = reach(exports[specifier])
      return files ? [[specifier, files]] : []
    }).sort(),
  )
}

/** The import map entries pointing each boundary a revision does not export
 * at the driver's copy under CARRIED. */
export let carry = (
  boundaries: Record<string, string[]>,
  exports: Set<string>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(boundaries)
      .filter(([specifier]) => !exports.has(specifier))
      .map(([specifier, [file]]) => [specifier, `./${CARRIED}/${file}`]),
  )
