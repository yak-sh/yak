// The tools this harness declares in its vocabulary, paired with the functions
// that implement them. The declarations — noun, verb, description, arguments —
// are in vocab.json beside the components, because they are the same kind of
// thing: what this graph declares about itself. The implementation is code and
// lives here, and @yaks/graph's `loadTools` joins the two, so a declaration
// nobody implements is a load error rather than a tool that appears in a
// listing and then fails when called.

import type { NamedTool } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { runs } from './runs.ts'
import { vocab } from './vocab.ts'
import doc from './vocab.json' with { type: 'json' }

// The harness's own document, so its command line lists the harness's own
// tools; the implementations are built against the whole loaded vocabulary,
// which is more than this document declares and harmless here — `loadTools`
// takes only the ones it needs.
export let tools: NamedTool[] = loadTools(doc, runs({ vocab }))
