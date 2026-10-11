// What a config's plugins declare, read without opening anything: each one's
// `./vocab`, the vocabulary those documents load into, and the tools they
// declare. A command line lists its subcommands from these words
// (./subcommands.ts), and a graph is built over them (./host.ts `compose`).
// This module imports none of what opens a graph — no database, rule or
// effect — so a usage page, a help page or a mistyped word costs a command
// the plugins' declarations and nothing more.

import { type Config, given, subpath, subpaths, used } from './config.ts'
import { chosen, type Configured } from '@yaks/host/config'
import type { Facets, Load } from '@yaks/host'
import { taking, type Words, wordsOf } from '@yaks/host/words'
import type { CliFacet } from './host.ts'
export { type Declared, type Words, wordsOf } from '@yaks/host/words'

/** The box's loader, including its terminal commands. */
export let facet: Load<{ cli: CliFacet }> = Object.assign(
  <F extends keyof (Facets & { cli: CliFacet })>(plugin: string, name: F) =>
    subpath<(Facets & { cli: CliFacet })[F]>(plugin, name),
  { together: subpaths },
)

/** The words a config's plugins declare: each one's `./vocab`, and nothing
 * else — no database opened, no rule or tool imported. */
export let words = async (
  config: Config,
  load: Load = facet,
): Promise<Words> => {
  let plugins = (config.plugins ?? []).map((plug): Configured => [
    used(plug),
    given(plug),
    chosen(plug),
  ])
  await load.together?.(plugins.map(([p]) => [p, 'vocab'] as const))
  return wordsOf(await taking(plugins, 'vocab', load))
}
