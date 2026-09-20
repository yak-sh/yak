// The tools this harness DECLARES in its vocabulary, wearing their runs. The
// words — noun, verb, description, arguments — are vocab.json's, beside the
// components, because they are the same kind of thing: what this graph says
// about itself. The run is code's and lives here, and @yaks/graph's
// `loadTools` is the join, so a declaration nobody implements is a load error
// rather than a word that lists and then fails.

import type { NamedTool } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { runs } from './runs.ts'
import doc from './vocab.json' with { type: 'json' }

export let tools: NamedTool[] = loadTools(doc, runs)
