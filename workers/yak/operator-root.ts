// Where a person's talk with a space's Operator is: what a chat page reads
// first, apart from the channels that take in what they send
// (operator-channels.ts).
import { derivedEid } from '@yaks/graph/identity'
import type { OperatorStore } from './operator-store.ts'

type Store = OperatorStore

/** The one conversation a person has with a space's Operator: every message
 * they send it, by chat, email or text, is the next input of this session,
 * which forks for the work (D-137704). */
export let rootOf = (space: string, person: string) =>
  derivedEid(`operator-root|${space}|${person}`)

/** The line a request's words become in the conversation that takes them
 * in (operator.ts `ask`): one id, so the request and its line are one. */
export let inputOf = (request: string) =>
  derivedEid('operator-input|' + request)

/** The line saying what became of a request no session has taken yet: its
 * answer, that it waits, or that it failed. */
export let outcomeOf = (request: string) =>
  derivedEid('operator-outcome|' + request)

/** The person's one conversation in `store`: the one said to be theirs
 * (`operator_session.conversation`), as a conversation handed to them is
 * (operator-channels.ts `handOver`), else the one `rootOf` begins for them. */
export let rootAt = async (store: Store, space: string, person: string) => {
  let mine = rootOf(space, person)
  let held = person
    ? await store.g.read(
      `.operator_session.person=${person}&.operator_session.conversation=true&!spawned&.fields=entity.eid`,
    )
    : []
  return held.length && !held.some((b) => b.entity.eid == mine)
    ? held[0].entity.eid
    : mine
}

/** What the helper `session` was asked, in a line: the first sentence it
 * was started with, from its first lines (`briefly`). */
export let askedAt = async (store: Store, session: string) => {
  let opening = await store.g.read(
    `.entry.session=${session}&.order=entry.seq&.limit=3&*`,
  )
  let first = opening.find((b) => !b.prompt && b.content)?.content as
    | { body?: unknown }
    | undefined
  return briefly(String(first?.body ?? '')) || 'A piece of work'
}

/** What a helper is called: the title it was started with (`doc{title}`),
 * else what it was asked (`askedAt`). */
export let titleAt = async (
  store: Store,
  row: { entity: { eid: string }; doc?: unknown },
) =>
  String((row.doc as { title?: unknown } | undefined)?.title ?? '') ||
  await askedAt(store, row.entity.eid)

/**
 * The first sentence of `text`, cut at a word once it runs past `most`.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { briefly } from './operator-root.ts'
 * equal(briefly('Check the calendar. Then tell me.'), 'Check the calendar.')
 * equal(
 *   briefly("Check for recent app errors across Jeffrey's apps in space jeff, using app_list with each."),
 *   "Check for recent app errors across Jeffrey's apps in space…",
 * )
 * equal(briefly('  \n'), '')
 * ```
 */
export let briefly = (text: string, most = 60) => {
  let line = text.trim().split(/\n|(?<=[.!?])\s/)[0] ?? ''
  if (line.length <= most) return line
  let cut = line.slice(0, most + 1)
  let at = cut.lastIndexOf(' ')
  return (at > most / 2 ? cut.slice(0, at) : line.slice(0, most))
    .replace(/[\s,;:.\u2013\u2014-]+$/, '') + '…'
}
