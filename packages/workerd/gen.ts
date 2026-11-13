/**
 * `@yaks/workerd/gen` — the modules a Worker imports its plugins from: the
 * entry's config and its plugins' `./worker` facets ({@link written}), and
 * the facets its stores load ({@link loader}). A Worker resolves no module at run
 * time: its bundler needs each import written out, so a build step writes
 * them from the config, and the config itself as data, so the entry loads
 * nothing the config was built from. The entry hands both to `compose`
 * (@yaks/workerd).
 *
 * ```ts
 * import { written } from '@yaks/workerd/gen'
 * import { assert } from '@std/assert'
 *
 * let text = written(
 *   { plugins: ['@yaks/workerd', 'shop'] },
 *   { shop: './shop-worker.ts' },
 * )
 * assert(text.includes(`import * as worker1 from "./shop-worker.ts"`))
 * ```
 *
 * @module
 */
import type { FacetName } from '@yaks/host'
import { type Config, facetsOf, used } from '@yaks/host/config'

/** The module of `config`, exported as `config`, and its `./worker` facets,
 * exported as `facets` by plugin. A plugin `local` names is imported from
 * that path, relative to the module; any other from its package's `./worker`
 * subpath. */
export let written = (
  config: Config,
  local: Record<string, string> = {},
): string => {
  let plugins = [...new Set((config.plugins ?? []).map(used))]
  return [
    '// Generated from the Worker config. Do not edit.',
    "import type { Config } from '@yaks/host/config'",
    "import type { WorkerFacet } from '@yaks/workerd'",
    ...plugins.map((p, i) =>
      `import * as worker${i} from ${JSON.stringify(local[p] ?? `${p}/worker`)}`
    ),
    "/** The Worker's config. */",
    `export let config: Config = ${JSON.stringify(config)}`,
    "/** Each plugin's `./worker` facet, by plugin. */",
    'export let facets: Record<string, WorkerFacet> = {',
    ...plugins.map((p, i) => `${JSON.stringify(p)}: worker${i},`),
    '}',
    '',
  ].join('\n')
}

/** A package's `package.json`, as far as its exports. */
export type Manifest = {
  name?: string
  exports?: string | Record<string, string>
}

/** The facets a store imports: a graph and its effects. HTTP and long-running
 * services belong to their concrete hosts, so they never enter its table. */
export let STORE: FacetName[] = ['vocab', 'graph', 'effects', 'tools']

// Whether a package's exports name this facet.
let exporting = (exported: Manifest['exports'], facet: string) =>
  typeof exported == 'object' && Object.hasOwn(exported, `./${facet}`)

/** Each `<plugin>/<facet>` the `configs` take of `facets`, once: a facet its
 * package exports, and its plugin entry selects (`facets`, every one when
 * unsaid). A plugin with no manifest is refused. */
export let imports = (
  configs: Config[],
  manifests: Manifest[],
  facets: FacetName[] = STORE,
): string[] => {
  let packages = new Map(manifests.map((m) => [m.name, m.exports]))
  let entries = configs.flatMap((c) => c.plugins ?? [])
  return [...new Set(entries.map(used))].sort().flatMap((plugin) => {
    if (!packages.has(plugin)) throw new Error(`no manifest for ${plugin}`)
    return facets.filter((facet) =>
      entries.some((entry) =>
        used(entry) == plugin &&
        (facetsOf(entry) === undefined || facetsOf(entry)!.includes(facet))
      ) && exporting(packages.get(plugin), facet)
    ).map((facet) => `${plugin}/${facet}`)
  })
}

/** The `facet` of each plugin `config` names, as `<plugin>/<facet>`; a plugin
 * exporting none is refused. */
export let named = (
  config: Config,
  manifests: Manifest[],
  facet: string,
): string[] =>
  [...new Set((config.plugins ?? []).map(used))].sort().map((plugin) => {
    if (!exporting(manifests.find((m) => m.name == plugin)?.exports, facet)) {
      throw new Error(`${plugin} exports no ./${facet}`)
    }
    return `${plugin}/${facet}`
  })

/** A table of facets imported with the Worker rather than on first use,
 * exported as `name` by plugin. */
export type Eager = {
  name: string
  /** each facet's type, and the type it names with the module it is from */
  type: string
  using: [name: string, from: string]
  /** each facet, as `<plugin>/<facet>` */
  specifiers: string[]
  /** what the table holds, said above it */
  says: string
}

// `<plugin>/<facet>`'s plugin.
let pluginOf = (specifier: string) =>
  specifier.slice(0, specifier.lastIndexOf('/'))

/**
 * The module a store's facets load from (`Load`, @yaks/host): each
 * `./vocab` imported with the Worker, as `vocabFacets`, since a store reads
 * its words as it opens; each `eager` table the same way; every other facet
 * imported on its first use. A specifier `local` names is imported from that
 * path, relative to the module.
 *
 * ```ts
 * import { loader } from '@yaks/workerd/gen'
 * import { assert } from '@std/assert'
 *
 * let text = loader(['shop/vocab', 'shop/effects'])
 * assert(text.includes(`import * as eager0_0 from "shop/vocab"`))
 * assert(text.includes(`"shop/effects": () => import("shop/effects")`))
 * ```
 */
export let loader = (
  specifiers: string[],
  local: Record<string, string> = {},
  eager: Eager[] = [],
): string => {
  let from = (s: string) => JSON.stringify(local[s] ?? s)
  let vocabs = specifiers.filter((s) => s.endsWith('/vocab')).sort()
  let tables: Eager[] = [{
    name: 'vocabFacets',
    type: 'VocabFacet',
    using: ['VocabFacet', '@yaks/host'],
    specifiers: vocabs,
    says: "Each plugin's words, by plugin.",
  }, ...eager]
  let other = specifiers.filter((s) => !s.endsWith('/vocab'))
  let types = new Map<string, Set<string>>([[
    '@yaks/host',
    new Set(['Facets', 'Load']),
  ]])
  for (let { using: [name, module] } of tables) {
    types.set(module, (types.get(module) ?? new Set()).add(name))
  }
  return [
    "// Generated from the configs and their packages' exports. Do not edit.",
    ...[...types].map(([m, names]) =>
      `import type { ${[...names].sort().join(', ')} } from ${
        JSON.stringify(m)
      }`
    ),
    ...tables.flatMap((t, n) =>
      t.specifiers.map((s, i) => `import * as eager${n}_${i} from ${from(s)}`)
    ),
    ...tables.flatMap((t, n) => [
      `/** ${t.says} */`,
      `export let ${t.name}: Record<string, ${t.type}> = {`,
      ...t.specifiers.map((s, i) =>
        `${JSON.stringify(pluginOf(s))}: eager${n}_${i},`
      ),
      '}',
    ]),
    'let facets: Record<string, () => Promise<unknown>> = {',
    ...other.map((s) => `${JSON.stringify(s)}: () => import(${from(s)}),`),
    '}',
    "/** A plugin's facet, its words at once and anything else when first asked. */",
    'export let load: Load = async (plugin, facet) => {',
    "if (facet == 'vocab') return vocabFacets[plugin] ?? null",
    'let take = facets[`${plugin}/${facet}`]',
    'return take ? await take() as Facets[typeof facet] : null',
    '}',
    '',
  ].join('\n')
}
