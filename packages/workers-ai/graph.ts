// The `@yaks/workers-ai/graph` facet: the embedder this plugin lends its host
// (@yaks/host `Host.embedders`), named `workers-ai`, over the `AI` binding its
// options are lent (`ai`). @yaks/embedding selects it with
// `embedder: {"provider": "workers-ai", "model": …, "dim": …}`; a Worker names
// the binding in its config, `{"use": "@yaks/workers-ai", "with": {"ai":
// {"binding": "AI"}}}`. Where no binding is lent, it lends nothing.
import { type Ai, embedder } from './embedder.ts'
import type { Batched } from '@yaks/embedding'

/** The plugin's options in a config. */
export type Options = {
  /** the `AI` binding */
  ai?: Ai
}

/** The `workers-ai` embedder, made from the model and width a config names,
 * over the binding lent. */
export let embedders = (
  _host: unknown,
  options: Options = {},
): Record<string, (said: { model: string; dim?: number }) => Batched> => {
  let ai = options.ai
  return ai ? { 'workers-ai': (said) => embedder({ ...said, ai }) } : {}
}
