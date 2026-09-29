// A party is the group named on each member's player row. Invitations are
// separate rows, addressed to one hero; a reply closes one without changing
// anyone else's membership. The page watches only its inbox and current group.
import { comp, num, str } from './bundle.ts'
import type { Bundle, Me, Net } from './net.ts'
import type { Frame, Vec3 } from './play.ts'
import type { Body } from './sim.ts'
import { seenOf } from './seen.ts'
import { LEVELS } from './levels.ts'
import { writer } from './chat.ts'

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

export let groupOf = (b: Bundle | undefined) => str(comp(b, 'party').group)

/** An invitation is open for one day and stays closed after a reply. */
export let invitations = (
  rows: Bundle[],
  replies: Bundle[],
  hero: string,
  now: number,
  owners?: ReadonlyMap<string, string>,
): Invite[] => {
  let answered = new Set(
    replies.filter((b) => str(comp(b, 'party_reply').to) == hero).map((b) =>
      str(comp(b, 'party_reply').invite)
    ),
  )
  return rows.flatMap((b) => {
    let v = comp(b, 'party_invite')
    let at = Date.parse(str(v.at))
    return str(v.to) == hero && str(v.from) != hero &&
        (!owners || !!owners.get(str(v.from)) &&
            writer(b) == owners.get(str(v.from))) &&
        str(v.group) && at && now - at < 24 * 60 * 60_000 &&
        !answered.has(b.entity.eid)
      ? [{
        eid: b.entity.eid,
        from: str(v.from),
        to: hero,
        group: str(v.group),
      }]
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

export let parties = (net: Net) => {
  let who: Me | null = null
  let hero = ''
  let group = ''
  let inbox: ReturnType<Net['client']['watch']> | null = null
  let replies: ReturnType<Net['client']['watch']> | null = null
  let members: ReturnType<Net['client']['watch']> | null = null
  let names = new Map<string, string>()
  let owners = new Map<string, string>()
  let seenInvites = new Set<string>()
  let first = true
  let meBody: Body | null = null

  let watch = (f: Frame) => {
    if (hero != net.hero) {
      inbox?.close()
      replies?.close()
      members?.close()
      inbox = replies = members = null
      hero = net.hero ?? ''
      group = ''
      names.clear()
      owners.clear()
      seenInvites.clear()
      first = true
      meBody = null
      if (hero) {
        let q = JSON.stringify(hero)
        inbox = net.client.watch(`.party_invite.to=${q}&*`)
        replies = net.client.watch(`.party_reply.to=${q}&*`)
      }
    }
    meBody = f.body
    let next = groupOf(net.client.ent(hero))
    if (next != group) {
      members?.close()
      group = next
      members = group
        ? net.client.watch(`.party.group=${JSON.stringify(group)}&.player&*`)
        : null
    }
    for (let b of members?.value ?? []) {
      let id = b.entity.eid
      if (id == hero) names.set(id, f.sheet.name)
      else if (!names.has(id)) {
        names.set(id, net.who(id)?.name ?? 'A hero')
        void net.about(id).then(({ hero: h, by }) => {
          if (h) names.set(id, h.name)
          if (by) owners.set(id, by)
        })
      }
    }
    for (let b of inbox?.value ?? []) {
      let id = str(comp(b, 'party_invite').from)
      if (id && !names.has(id)) {
        names.set(id, net.who(id)?.name ?? 'A hero')
        void net.about(id).then(({ hero: h, by }) => {
          if (h) names.set(id, h.name)
          if (by) owners.set(id, by)
        })
      }
    }
  }

  let open = () =>
    invitations(
      inbox?.value ?? [],
      replies?.value ?? [],
      hero,
      net.now(),
      owners,
    ).filter((i) => i.group != group)
  let listed = () =>
    (members?.value ?? []).filter((b) => groupOf(b) == group).map((b) =>
      memberOf(b, names.get(b.entity.eid) ?? 'A hero', net.now())
    )
  let audible = () =>
    listed().flatMap((m) => {
      if (m.eid == hero) return []
      let body = m.body ?? (meBody
        ? {
          ...meBody,
          x: Number.isFinite(m.x) ? m.x : meBody.x + 1,
          z: Number.isFinite(m.z) ? m.z : meBody.z,
        }
        : null)
      return body ? [{ eid: m.eid, body }] : []
    })

  return {
    me: (m: Me) => who = m,
    get canJoin() {
      return !!who?.person && who.writes
    },
    get signIn() {
      return who?.signIn ?? null
    },
    get group() {
      return group
    },
    get invites() {
      return open()
    },
    get members(): Member[] {
      return listed()
    },
    name: (eid: string) => names.get(eid) ?? 'A hero',
    /** Current positions remain visible across the world while a member is
     * online; their last sighting gives a useful location after they leave. */
    get voices() {
      return audible()
    },
    get spots() {
      return new Map(
        audible().map((m): [string, Vec3] => [
          m.eid,
          [m.body.x, m.body.y + 1.4, m.body.z],
        ]),
      )
    },
    tick: (f: Frame): Invite[] => {
      watch(f)
      let found = open()
      let fresh = first ? [] : found.filter((i) => !seenInvites.has(i.eid))
      seenInvites = new Set(found.map((i) => i.eid))
      first = false
      return fresh
    },
    invite: async (to: string) => {
      if (!who?.person || !who.writes || !hero || to == hero) return false
      let id = group || hero
      let change: Bundle[] = []
      if (!group) {
        change.push({ entity: { eid: hero }, party: { group: id } })
      }
      change.push({
        entity: { eid: crypto.randomUUID() },
        party_invite: {
          from: hero,
          to,
          group: id,
          at: new Date(net.now()).toISOString(),
        },
      })
      try {
        await net.client.mutate(change)
        return true
      } catch {
        return false
      }
    },
    accept: async (i: Invite) => {
      if (!who?.person || !who.writes || i.to != hero) return false
      try {
        if (await net.partyOf(i.from) != i.group) return false
        await net.client.mutate([{
          entity: { eid: hero },
          party: { group: i.group },
        }, {
          entity: { eid: crypto.randomUUID() },
          party_reply: { invite: i.eid, to: hero, accept: true },
        }])
        return true
      } catch {
        return false
      }
    },
    decline: async (i: Invite) => {
      if (!who?.person || !who.writes || i.to != hero) return false
      try {
        await net.client.mutate([{
          entity: { eid: crypto.randomUUID() },
          party_reply: { invite: i.eid, to: hero, accept: false },
        }])
        return true
      } catch {
        return false
      }
    },
    leave: async () => {
      if (!who?.person || !who.writes || !hero || !group) return false
      try {
        await net.client.mutate([{ entity: { eid: hero }, party: null }])
        return true
      } catch {
        return false
      }
    },
    location: (m: Member, at: [number, number]) => {
      if (!m.level || !LEVELS[m.level]) return 'Away'
      if (m.eid == hero) return `${LEVELS[m.level].name} · You`
      let dx = m.x - at[0], dz = m.z - at[1]
      let distance = Math.round(Math.hypot(dx, dz))
      let ways = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
      let turn = (Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2)
      let way = ways[Math.round(turn / (Math.PI / 4)) % 8]
      return `${LEVELS[m.level].name} · ${distance} m ${way}${
        m.online ? '' : ' · last seen'
      }`
    },
  }
}
