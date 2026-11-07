// Where a person's talk with a space's Operator is: what a chat page reads
// first, apart from the channels that take in what they send
// (operator-channels.ts).
import { derivedEid } from '@yaks/graph/identity'
import type { operatorStore } from './operator-store.ts'

type Store = ReturnType<typeof operatorStore>

/** The one conversation a person has with a space's Operator: every message
 * they send it, by chat, email or text, is the next input of this session,
 * which forks for the work (D-137704). */
export let rootOf = (space: string, person: string) =>
  derivedEid(`operator-root|${space}|${person}`)

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
