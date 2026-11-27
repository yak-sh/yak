// Where a person's talk with a space's Operator is: what a chat page reads
// first, apart from the channels that take in what they send
// (operator-channels.ts).
import { line } from '@yaks/query'
import { derivedEid } from '@yaks/graph/identity'
import type { ToolContext } from '@yaks/session'
import type { OperatorStore } from './operator-store.ts'

type Store = OperatorStore

/** The one conversation a person has with a space's Operator: every message
 * they send it, by chat, email or text, is the next input of this session,
 * which forks for the work (D-137704). */
export let rootOf = (space: string, person: string) =>
  derivedEid(`operator-root|${space}|${person}`)

/** The line saying what became of a request no session has taken yet: its
 * answer, that it waits, or that it failed. */
export let outcomeOf = (request: string) =>
  derivedEid('operator-outcome|' + request)

/** Whose a tool call is: the person the session it was made in works
 * for. */
export let whoseOf = async (
  store: Pick<Store, 'g'>,
  context?: ToolContext,
) => {
  let [row] = context ? await store.g.get([context.session]) : []
  let o = row?.operator_session as
    | { person: string; administrative?: boolean }
    | undefined
  if (!o) throw new Error('Operator session names no person')
  return o
}

/** Where the file keeps the space it is the Operator's store for, as the
 * object's requests name it (build.ts `#answer`). */
export let SPACED = 'operator:space'

/** Keep the space `store` is for, as a request to its object names it: a
 * store that owes texts before anyone has talked with its Operator (a
 * memory kept, an update told) pays for their vectors from it
 * (operator-vectors.ts). */
export let spacedAt = (store: Pick<Store, 'marks'>, space: string) => {
  if (store.marks && store.marks.get(SPACED) != space) {
    store.marks.set(SPACED, space)
  }
}

// The space each store's sessions name, once read: a value, never the read's
// promise (@yaks/fp `Scope`).
let spaces = new WeakMap<object, string>()
/** The space an Operator store is: the one its file keeps (`spacedAt`), else
 * the one its sessions name. */
export let spaceOf = (
  store: Pick<Store, 'g'> & {
    marks?: Pick<NonNullable<Store['marks']>, 'get'>
  },
): string | Promise<string | undefined> => {
  let kept = store.marks?.get(SPACED)
  if (kept) return kept
  // One read is answered as a promise, as a read is: an embedder lent from it
  // is announced (operator-vectors.ts `ready`).
  let read = spaces.get(store.g)
  if (read) return Promise.resolve(read)
  return Promise.resolve(store.g.read('.operator_session.space&.limit=1'))
    .then(([row]) => {
      let space = (row?.operator_session as { space?: string } | undefined)
        ?.space
      if (space) spaces.set(store.g, space)
      return space
    })
}

/** The person's one conversation in `store`: the one said to be theirs
 * (`operator_session.conversation`), as a conversation handed to them is
 * (operator-channels.ts `handOver`), else the one `rootOf` begins for them. */
export let rootAt = async (store: Store, space: string, person: string) => {
  let mine = rootOf(space, person)
  let held = person
    ? await store.g.read(
      line`.operator_session.person=${person}&.operator_session.conversation=true&!spawned&.fields=entity.eid`,
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
    line`.entry.session=${session}&.order=entry.seq&.limit=3&*`,
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
