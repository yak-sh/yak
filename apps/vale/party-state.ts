// Party rows interpreted by their authors, not by claimed hero ids. A signed-in
// writer can write an app row naming anyone, so created.by must match the hero
// owner before an invitation, reply, or membership can count.
import { comp, num, str } from './bundle.ts'
import { writer } from './chat.ts'
import { seenOf } from './seen.ts'
import type { Bundle } from './net.ts'
import type { Body } from './sim.ts'

export type Invite = { eid: string; from: string; to: string; group: string }
export type Member = {
  eid: string
  name: string
  level: string
  x: number
  z: number
  online: boolean
  body: Body | null
}

/** The newest choice that the hero's owner made, or no party. */
export let groupOf = (rows: Bundle[], hero: string, owner: string) => {
  let newest = rows.filter((b) =>
    !!hero && !!owner && str(comp(b, 'party_step').player) == hero &&
    writer(b) == owner && Number.isFinite(num(comp(b, 'party_step').at, NaN))
  ).sort((a, b) =>
    num(comp(a, 'party_step').at) - num(comp(b, 'party_step').at) ||
    (Date.parse(str(comp(a, 'created').at)) || 0) -
      (Date.parse(str(comp(b, 'created').at)) || 0) ||
    a.entity.eid.localeCompare(b.entity.eid)
  ).at(-1)
  return str(comp(newest, 'party_step').group)
}

/** An invitation is open for one day and stays closed after its recipient
 * answers it. Claims made by another writer count for neither hero. */
export let invitations = (
  rows: Bundle[],
  replies: Bundle[],
  hero: string,
  now: number,
  owners: ReadonlyMap<string, string>,
): Invite[] => {
  let owner = owners.get(hero)
  if (!owner) return []
  let answered = new Set(
    replies.filter((b) =>
      str(comp(b, 'party_reply').to) == hero && writer(b) == owner
    ).map((b) => str(comp(b, 'party_reply').invite)),
  )
  return rows.flatMap((b) => {
    let v = comp(b, 'party_invite')
    let from = str(v.from), at = Date.parse(str(v.at))
    return str(v.to) == hero && from != hero &&
        !!owners.get(from) && writer(b) == owners.get(from) &&
        str(v.group) && at && now - at < 24 * 60 * 60_000 &&
        !answered.has(b.entity.eid)
      ? [{ eid: b.entity.eid, from, to: hero, group: str(v.group) }]
      : []
  })
}

export let memberOf = (b: Bundle, name: string, now: number): Member => {
  let p = comp(b, 'position'), m = comp(b, 'motion')
  let online = Number.isFinite(num(p.x, NaN)) &&
    Number.isFinite(num(p.z, NaN)) && now - num(p.at) < 15_000
  let seen = seenOf(b)
  let x = online ? num(p.x) : seen?.x ?? NaN
  let z = online ? num(p.z) : seen?.z ?? NaN
  let level = online ? str(p.level) : seen?.level ?? ''
  return {
    eid: b.entity.eid,
    name,
    level,
    x,
    z,
    online,
    body: online
      ? {
        x,
        y: num(p.y),
        z,
        yaw: num(m.yaw),
        vy: 0,
        speed: 0,
        gait: str(m.gait) || 'idle',
      }
      : null,
  }
}
