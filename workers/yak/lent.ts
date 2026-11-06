// What the providers config.ts names lend the Worker's own layers: the
// senders post.ts selects from, the notice readers mail-receipts.ts asks, the
// arrival inbox.ts reads a letter with and the phones phones.ts texts and
// calls through. No layer here names a provider;
// each provider is a plugin whose graph facet lends by name (@yaks/host
// lending), its options read from the Worker's env.
import {
  type Config,
  type Configured,
  configured,
  holding,
  type Options,
} from '@yaks/host/config'
import { lending, type Lends } from '@yaks/host/lending'
import { taking } from '@yaks/host/words'
import { posts } from './config.ts'
import { load } from './load.ts'

// Options with `add` beside them, each still read from the env as it is
// accessed.
let beside = (options: Options, add: Options): Options =>
  Object.defineProperties({}, {
    ...Object.getOwnPropertyDescriptors(options),
    ...Object.getOwnPropertyDescriptors(add),
  })

/** What `config`'s providers lend of one kind, by name, their options read
 * from `env` as they are accessed, with `add` beside them: what the Worker
 * lends one call, such as the tags a letter's notices are routed by. */
export let lent = async <K extends keyof Lends>(
  env: object,
  kind: K,
  config: Config = posts.apps,
  add: Options = {},
): Promise<Readonly<Record<string, Lends[K]>>> => {
  let plugins: Configured[] = configured(config, holding(env)).map((
    [plugin, options, words, facets],
  ) => [plugin, beside(options, add), words, facets])
  return lending(await taking(plugins, 'graph', load), {}, kind) ?? {}
}
