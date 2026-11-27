/**
 * A person's conversation with a space's Operator, as the chat page hears it
 * in the tab's page graph (D-475 step 4): the line `operatorTalk(space,
 * task)`, which the space's Operator store answers live (yaks.app's
 * operator-host.ts `operatorFrames`) with one row, `operatorTalk{…}`, for
 * the conversation `task` shows (none for a new chat). The page graph's door
 * routes the line to that store (yaks.app's reach-door.ts), and carries the
 * tab's whereabouts on it: a tab watching an Operator's conversation is a tab
 * on that Operator.
 *
 * The row is answered whole each time the watch opens, again after a
 * reconnect: `opened` is that answer's, and `standing` says where the
 * conversation shown stands, so the page reads it again only when it moved.
 * Each step after it is the row again with the step's frame (`step`, the
 * Operator's lines, what it is doing, and what it changed) and `n` one more;
 * a page that sees `n` skip reads the conversation again. A step says where
 * its session stands after it (`step.at`), so a page reading when it lands
 * reads again only when the read did not hold it. A reply as it is
 * written is a transient on `typing` (@yaks/graph `transient`), for the
 * conversation `writing` names, ended as the step that wrote it lands.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'
import operatorTalkJson from './vocab/operator-talk.vocab.json' with {
  type: 'json',
}

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

export let operatorTalkWords: VocabDoc = operatorTalkJson as VocabDoc

/** What a conversation's row says beside what its line asks. */
export type Told = {
  opened: string
  n: number
  standing?: string
  step?: Record<string, unknown>
  writing?: string
}

/** The eid of `person`'s row for the line `talk`. */
export let talkEid = (person: string, talk: Talk): string =>
  derivedEid(`operatorTalk|${talk.space}|${person}|${talk.task ?? ''}`)

/** The row `person`'s line `talk` is answered with, saying `told`. */
export let talkRow = (person: string, talk: Talk, told: Told): Bundle => ({
  entity: { eid: talkEid(person, talk) },
  operatorTalk: { ...talk, typing: '', ...told },
})

/** Where `session` stands: at its newest line, `seq`. A conversation's
 * `standing` is one for each session it draws (and a mark of its archived
 * lines, after a `/`), and a step's `at` is its own session's. */
export let stand = (session: string, seq: number): string => `${session}:${seq}`

/**
 * Whether a read of a conversation standing at `standing` holds every line
 * of a step that stands `at`: a page that hears the step while it reads need
 * not read again.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * let standing = `${stand('a', 12)},${stand('b', 3)}/archived`
 * equal(covers(standing, stand('a', 12)), true)
 * equal(covers(standing, stand('b', 2)), true)
 * equal(covers(standing, stand('a', 13)), false)
 * equal(covers(standing, stand('c', 1)), false)
 * equal(covers(standing, undefined), false)
 * equal(covers(undefined, stand('a', 1)), false)
 * ```
 */
export let covers = (standing?: string, at?: string): boolean => {
  if (!standing || !at) return false
  let seq = (said: string) => Number(said.slice(said.lastIndexOf(':') + 1))
  let session = at.slice(0, at.lastIndexOf(':'))
  return standing.split('/')[0].split(',').some((s) =>
    s.startsWith(`${session}:`) && seq(s) >= seq(at)
  )
}
