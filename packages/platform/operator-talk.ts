/**
 * A person's conversation with a space's Operator, as the chat page watches
 * it in the tab's page graph (D-475 step 4): the line `operatorTalk(space,
 * task)`, which the space's Operator store answers live with one row,
 * `operatorTalk{space, task}`, for the conversation `task` shows (none for a
 * new chat). The page graph's door routes the line to that store
 * (yaks.app's reach-door.ts), and carries the tab's whereabouts on it: a tab
 * watching an Operator's conversation is a tab on that Operator.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'

let LINE =
  /^\.operatorTalk\.space=([^&]+)(?:&\.operatorTalk\.task=([^&]+))?&\*$/

/** What an `operatorTalk` line asks: the space, and the conversation shown. */
export type Talk = { space: string; task?: string }

/** The line of `person`'s conversation `task` with the Operator of the space
 * `space`, or of none (a new chat). */
export let operatorTalk = (space: string, task?: string): string =>
  `.operatorTalk.space=${space}${task ? `&.operatorTalk.task=${task}` : ''}&*`

/** What an `operatorTalk` line asks, or undefined for another line. */
export let talkAsked = (line: string): Talk | undefined => {
  let [, space, task] = LINE.exec(line) ?? []
  return space ? { space, ...task ? { task } : {} } : undefined
}

export let operatorTalkWords: VocabDoc = {
  $defs: {
    operatorTalk: {
      component: true,
      type: 'object',
      properties: {
        space: { type: 'string' },
        task: { type: 'string' },
      },
      required: ['space'],
    },
  },
}

/** The row `person`'s line `talk` is answered with. */
export let talkRow = (person: string, talk: Talk): Bundle => ({
  entity: {
    eid: derivedEid(`operatorTalk|${talk.space}|${person}|${talk.task ?? ''}`),
  },
  operatorTalk: { space: talk.space, ...talk.task ? { task: talk.task } : {} },
})
