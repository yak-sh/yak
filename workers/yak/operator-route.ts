// Who answers what the Operator cannot do on someone's word alone (T-2351):
// an approval, a decision, an escalation, an odd request's report. One rule
// for all of them, as data: each act needs the least role its tool declares
// (tool.ts `Tool.role`, the one its own admission refuses below), and
// whoever holds it may answer. An act waits for one of two reasons:
//
// - identity: the act is within the person's role, and only that it is
//   theirs needs confirming. They confirm it themselves, on a channel that
//   proves it is them. In a private room (`chat_room{private}`), anyone
//   whose role allows the act may also vouch for them.
// - authority: the person's role does not allow the act (a stranger holds
//   none). Everyone whose role allows it is asked, and any one of them
//   answers it for the rest.
//
// An act only the person may do (`self`: mail as them, their numbers) is
// theirs to confirm, wherever they ask.
import type { Role } from './directory.ts'

/** What an act needs: a least role in the space, or `self`, the person. */
export type Need = Role | 'self'

/** A tool of the Operator's own that declares what a call of it needs, as a
 * platform tool does (tool.ts `Tool.role`). */
export type Routed = { role?: Need }

/** A member of the space and their role. */
export type Member = { person: string; role: Role }

let RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

/** What an act needs that declares nothing (a stranger's question, an odd
 * request, a tool that names no role): an editor's, someone who changes
 * things in the space. */
export let needOf = (need?: Need): Need => need ?? 'editor'

/** Whether `role` allows what `need` asks. */
export let allows = (role: Role | null | undefined, need: Need) =>
  need != 'self' && !!role && RANK[role] >= RANK[need]

/** Everyone whose role allows what `need` asks, the act only the person may
 * do counted as an editor's: who may judge whether it should be done, as of a
 * request that looks odd for who asked it. */
export let holders = (seats: Member[], need?: Need) => {
  let least = needOf(need)
  return seats.filter((s) => allows(s.role, least == 'self' ? 'editor' : least))
    .map((s) => s.person)
}

/** Why an act waits, and everyone who may answer it. */
export type Route = { why: 'identity' | 'authority'; approvers: string[] }

/**
 * Who answers an act needing `need` (its tool's `role`) asked by `person`,
 * given the space's `seats`, and whether it was asked in a private room.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { route } from './operator-route.ts'
 * let seats = [
 *   { person: 'jeff', role: 'owner' as const },
 *   { person: 'matt', role: 'owner' as const },
 *   { person: 'ana', role: 'editor' as const },
 *   { person: 'bo', role: 'viewer' as const },
 * ]
 * equal(route({ need: 'editor', person: 'ana', seats }), {
 *   why: 'identity',
 *   approvers: ['ana'],
 * })
 * equal(route({ need: 'editor', person: 'ana', seats, private: true }), {
 *   why: 'identity',
 *   approvers: ['ana', 'jeff', 'matt'],
 * })
 * equal(route({ need: 'owner', person: 'ana', seats }), {
 *   why: 'authority',
 *   approvers: ['jeff', 'matt'],
 * })
 * equal(route({ need: 'editor', person: 'bo', seats }), {
 *   why: 'authority',
 *   approvers: ['jeff', 'matt', 'ana'],
 * })
 * equal(route({ person: 'stranger', seats }), {
 *   why: 'authority',
 *   approvers: ['jeff', 'matt', 'ana'],
 * })
 * equal(route({ need: 'self', person: 'ana', seats, private: true }), {
 *   why: 'identity',
 *   approvers: ['ana'],
 * })
 * ```
 */
export let route = (
  { need: declared, person, seats, private: closed = false }: {
    need?: Need
    person: string
    seats: Member[]
    private?: boolean
  },
): Route => {
  let need = needOf(declared)
  let allowed = need == 'self' ? [] : holders(seats, need)
  let role = seats.find((s) => s.person == person)?.role
  if (need == 'self' || allows(role, need)) {
    return {
      why: 'identity',
      approvers: closed
        ? [person, ...allowed.filter((p) => p != person)]
        : [person],
    }
  }
  return { why: 'authority', approvers: allowed.filter((p) => p != person) }
}
