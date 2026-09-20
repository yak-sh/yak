// The serving words, and only the words: the `vocab` facet a host takes
// (`@yaks/model/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.
//
// A model's `tool` and the artifacts a reply carries are said by the packages
// that own them (@yaks/tools, @yaks/blob) and folded in here, because a graph
// that keeps `provider` and `model` always keeps those beside them.

import type { VocabDoc } from '@yaks/vocab'
import { toolDoc } from '@yaks/tools/vocab'
import { artifactDoc } from '@yaks/blob/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The `provider`, `model` and `tool` components, to load beside your own. */
export let modelDoc: VocabDoc = {
  ...doc,
  $defs: { ...doc.$defs, ...artifactDoc.$defs, ...toolDoc.$defs },
}

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [modelDoc]
