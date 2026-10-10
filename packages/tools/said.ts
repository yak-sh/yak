// The answer of a tool that has only words to give: one bundle, aimed at the
// call it answers.

import type { Bundle } from '@yaks/graph'

/** What a tool says as its answer: `body`, lines joined by newlines, in a
 * bundle whose `output.source` is the call. */
export let said = (call: Bundle, body: string | string[]): Bundle => ({
  entity: { eid: '$said' },
  content: { body: typeof body == 'string' ? body : body.join('\n') },
  output: { source: call.entity.eid },
})
