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
  Workspaces,
  Purger,
  PublicDirectory,
  Outlast,
  Lexicon,
  Files,
  Site,
  Uses,
  Ads,
  Outbound,
  SandboxOutbound,
  ModelHost,
} = yak.classes
