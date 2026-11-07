// What a space's Operator reaches beyond the space it lives in (T-136179).
// Each space has its own Operator: its conversations, its budget and its
// actor are that space's. A space's owner may let another space's Operator in
// (`operator_reach`, on the People page), with a role there, and it works there with
// that role for whoever may ask it at home. The Operator on a person's own
// space (`member.own`) is their PA (T-136141): every space they sit in lets it
// in, with their role there. Either way the Operator's directory is narrowed
// to its space and these (grants.ts `narrowed`).
import type { Directory, Reach, Role, Space, Walk } from './directory.ts'
import { refuse } from './tool.ts'

let RANK: Role[] = ['viewer', 'editor', 'owner']

/** The spaces this space's Operator reaches for this person, its own left
 * out, and whether it is their PA. Where a seat and an `operator_reach` row
 * both let it into one space, the greater role stands. The space is named by
 * its eid, or by a walk to it (directory.ts `Walk`). */
export let reachOf = async (
  dir: Directory,
  space: Pick<Space, 'eid'> | Walk,
  person: string,
): Promise<{ pa: boolean; beyond: Reach[] }> => {
  let [seats, granted, eid] = await Promise.all([
    person ? dir.seats(person) : [],
    dir.reaches('path' in space ? space : space.eid),
    space.eid,
  ])
  let pa = seats.some((s) => s.own && s.role == 'owner' && s.space.eid == eid)
  let all = new Map<string, Reach>()
  let add = (r: Reach) => {
    let had = all.get(r.space.eid)
    if (!had || RANK.indexOf(r.role) > RANK.indexOf(had.role)) {
      all.set(r.space.eid, r)
    }
  }
  granted.forEach(add)
  if (pa) {
    for (let s of seats) add({ eid: s.seat, space: s.space, role: s.role })
  }
  all.delete(eid)
  return {
    pa,
    beyond: [...all.values()].filter((r) => !r.space.trashed),
  }
}

/** Lets `operator`'s Operator into `space` with `role`, or changes the role
 * of one already in. */
export let letIn = async (
  dir: Directory,
  space: Space,
  operator: Space,
  role: Role,
  by: string,
  headers: Record<string, string>,
) => {
  if (operator.eid == space.eid) {
    throw refuse('arguments', `${space.slug}'s Operator already works here`)
  }
  if (role != 'editor' && role != 'viewer') {
    throw refuse('arguments', 'role: editor or viewer')
  }
  let had = (await dir.admits(space.eid))
    .find((r) => r.space.eid == operator.eid)
  await dir.stamp({
    entities: [
      had ? { entity: { eid: had.eid }, operator_reach: { role, by } } : {
        entity: { eid: crypto.randomUUID() },
        operator_reach: { space: space.eid, operator: operator.eid, role, by },
      },
    ],
  }, headers)
}

/** Takes `operator`'s Operator back out of `space`. */
export let letOut = async (
  dir: Directory,
  space: Space,
  operator: string,
  headers: Record<string, string>,
) => {
  let had = (await dir.admits(space.eid))
    .find((r) => r.space.eid == operator)
  if (!had) {
    throw refuse('missing', `that Operator does not work in ${space.slug}`)
  }
  await dir.apply({
    entities: [{ entity: { eid: had.eid }, tombstone: {} }],
  }, headers)
}
