// The `@yaks/model2vec/graph` facet: the embedder this plugin lends its host,
// named `model2vec`, which @yaks/embedding selects with
// `embedder: {"provider": "model2vec", "model": …, "dim": …}`:
//
// ```json
// [ "@yaks/model2vec",
//   { "use": "@yaks/embedding",
//     "with": { "embedder": { "provider": "model2vec",
//                             "model": "minishlab/potion-retrieval-32M@6fc8051",
//                             "dim": 256 } } } ]
// ```
import { type Embedder, type Model2Vec, model2vec } from './mod.ts'

/** The `model2vec` embedder, made from the model and width a config names. */
export let embedders = (): Record<string, (said: Model2Vec) => Embedder> => ({
  model2vec,
})
