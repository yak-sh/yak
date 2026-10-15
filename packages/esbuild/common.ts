// Which npm packages a page shares rather than bundles: those more than one
// consumer would carry a copy of. A consumer is what the compiler emits apart:
// the page scripts (one consumer together), each toolkit package, and each
// package shared here. Toolkit packages, Preact and Signals are shared
// already, so a consumer's walk stops at them.
//
// A package two consumers carry becomes a consumer of its own, whose entries
// are every specifier of it that anything imports. Each round takes only the
// topmost of those packages: once one is shared, what it carries is carried
// once, by it, and need not be shared too. A package stays bundled where an
// ES module URL cannot stand in for it: something requires it, or an import
// of it names a file esbuild reads as CommonJS, or one that is not a script.
import type { Input } from './bundle.ts'
import { packageOf, script } from './graph.ts'

/** What a page shares beyond its toolkit packages, Preact and Signals. */
export type Common = {
  /** Each shared npm package: every specifier of it imported from outside
   * it, by the file it names. */
  entries: Record<string, Record<string, string>>
  /** The shared packages each consumer's build imports, by consumer. */
  uses: Record<string, string[]>
}

let OWNER = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//
let owner = (path: string) => OWNER.exec(path)?.[1] ?? ''

type Crossing = Input['imports'][number]

/** The npm packages more than one consumer carries, from the module graph a
 * build of every consumer's entries read: `consumers` maps each consumer to its
 * entry files (`''` the page scripts, a toolkit package by its name), and
 * `stops` names the packages already shared.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (path: string, original: string) =>
 *   ({ path, original, kind: 'import-statement' as const })
 * let three = 'node_modules/three/build/three.module.js'
 * let graph = {
 *   'main.ts': { format: 'esm' as const, imports: [at(three, 'three')] },
 *   'node_modules/@yaks/stage/mod.ts': {
 *     format: 'esm' as const,
 *     imports: [at(three, 'three')],
 *   },
 *   [three]: { format: 'esm' as const, imports: [] },
 * }
 * let consumers = {
 *   '': ['main.ts'],
 *   '@yaks/stage': ['node_modules/@yaks/stage/mod.ts'],
 * }
 * assertEquals(common(graph, consumers, new Set(['@yaks/stage'])), {
 *   entries: { three: { three } },
 *   uses: { '': ['three'], '@yaks/stage': ['three'], three: [] },
 * })
 * ```
 */
export let common = (
  graph: Record<string, Input>,
  consumers: Record<string, string[]>,
  stops: Set<string>,
): Common => {
  let crossings: Crossing[] = Object.entries(graph).flatMap(([from, input]) =>
    input.imports.filter((i) =>
      !i.external && owner(i.path) && owner(i.path) != owner(from)
    )
  )
  let into = (name: string) => crossings.filter((c) => owner(c.path) == name)
  let starts = (name: string) => [...new Set(into(name).map((c) => c.path))]
  let esm = (c: Crossing) =>
    (c.kind == 'import-statement' || c.kind == 'dynamic-import') &&
    packageOf(c.original ?? '') == owner(c.path) && script(c.path) &&
    graph[c.path]?.format != 'cjs'
  let shared = new Set<string>()
  // The npm packages a consumer's build would bundle, and the shared ones it
  // would import instead.
  let walk = (self: string, files: string[]) => {
    let carried = new Set<string>(), meets = new Set<string>()
    let seen = new Set(files), queue = [...files]
    for (let path of queue) {
      for (let edge of graph[path]?.imports ?? []) {
        if (edge.external) continue
        let name = owner(edge.path)
        let other = name && name != self
        if (other && (stops.has(name) || shared.has(name))) {
          meets.add(name)
          continue
        }
        if (other) carried.add(name)
        if (!seen.has(edge.path)) {
          seen.add(edge.path)
          queue.push(edge.path)
        }
      }
    }
    return { carried, meets }
  }
  let all = () => ({
    ...consumers,
    ...Object.fromEntries([...shared].map((name) => [name, starts(name)])),
  })
  for (;;) {
    let count = new Map<string, number>()
    for (let [self, files] of Object.entries(all())) {
      for (let name of walk(self, files).carried) {
        count.set(name, (count.get(name) ?? 0) + 1)
      }
    }
    let twice = [...count].filter(([name, n]) => n > 1 && into(name).every(esm))
      .map(([name]) => name)
    if (!twice.length) break
    let under = new Set(
      twice.flatMap((name) => [...walk(name, starts(name)).carried]),
    )
    let top = twice.filter((name) => !under.has(name))
    // Packages that carry one another share together.
    for (let name of top.length ? top : twice) shared.add(name)
  }
  return {
    entries: Object.fromEntries(
      [...shared].sort().map((name) => [
        name,
        Object.fromEntries(into(name).map((c) => [c.original!, c.path])),
      ]),
    ),
    uses: Object.fromEntries(
      Object.entries(all()).map((
        [self, files],
      ) => [self, [...walk(self, files).meets].sort()]),
    ),
  }
}
