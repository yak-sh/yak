/**
 * `@yaks/workerd/gen` — the module a Worker's entry imports its config and
 * its plugins' `./worker` facets from. A Worker resolves no module at run
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
import { type Config, used } from '@yaks/host/config'

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
