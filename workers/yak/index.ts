// The kernel Worker's entry: the Worker @yaks/workerd composes from its config
// (config.ts `worker`, written into worker-facets.ts with its plugins'
// facets), and the classes wrangler.toml binds, spelled once because its
// migrations fix their names.
import { compose } from '@yaks/workerd/compose'
import { config, facets } from './worker-facets.ts'

let yak = compose(config, facets)

export default yak.default
export let {
  Store,
  Wire,
  Builder,
  Purger,
  PublicDirectory,
  Outlast,
  Lexicon,
  Chats,
  Files,
  ReleaseIndex,
  Site,
  Uses,
  Ads,
  Outbound,
  SandboxOutbound,
  Reruns,
  ModelHost,
} = yak.classes
