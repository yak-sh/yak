/** The inbox creation door returns rows; the tool runner writes them as the caller.
 * It performs no I/O and neither starts nor feeds a session.
 */
import { argsOf, type Bundle, Refused } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

/** Implementations of the tools declared in the inbox vocabulary. */
export let runs = (): Runs => ({
  inbox_new: (call): Bundle[] => {
    let text = argsOf(call).text
    if (typeof text != 'string' || !text.trim()) {
      throw new Refused('a conversation needs your words — say text')
    }
    return [{
      entity: { eid: '$conversation' },
      conversation: {},
      doc: { title: text.split(/\r?\n/, 1)[0], body: text },
    }]
  },
})
