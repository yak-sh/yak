// Party state at the graph edge: each hero's owner writes new membership steps,
// invitations, and replies. Watches cover only this hero's inbox and the
// current party; pure party-state.ts decides which authored rows count.
import { comp, num, str } from './bundle.ts'
import { writer } from './chat.ts'
import { LEVELS } from './levels.ts'
import type { Bundle, Me, Net } from './net.ts'
import { groupOf, invitations, memberOf } from './party-state.ts'
import type { Invite, Member } from './party-state.ts'
import type { Frame, Vec3 } from './play.ts'
import type { Body } from './sim.ts'

export let parties = (net: Net) => {
  type Watch = ReturnType<Net['client']['watch']>
  let who: Me | null = null
  let hero = ''
  let group = ''
  let own: Watch | null = null
  let inbox: Watch | null = null
  let replies: Watch | null = null
  let joins: Watch | null = null
  let steps = new Map<string, Watch>()
  let players = new Map<string, Watch>()
  let names = new Map<string, string>()
  let owners = new Map<string, string>()
  let seenInvites = new Set<string>()
  let first = true
  let issuedAt = 0
  let meBody: Body | null = null

  let close = () => {
    own?.close()
    inbox?.close()
    replies?.close()
    joins?.close()
    for (let w of steps.values()) w.close()
    for (let w of players.values()) w.close()
    own = null
    inbox = null
    replies = null
    joins = null
    steps.clear()
    players.clear()
  }

  let know = (id: string) => {
    if (!id || names.has(id)) return
    names.set(id, net.who(id)?.name ?? 'A hero')
    void net.about(id).then(({ hero: h, by }) => {
      if (h) names.set(id, h.name)
      if (by) owners.set(id, by)
    }).catch(() => names.delete(id))
  }

  let current = (id: string, rows: Bundle[]) => {
    let owner = owners.get(id)
    return owner ? groupOf(rows, id, owner) : ''
  }

  let watch = (f: Frame) => {
    if (hero != net.hero) {
      close()
      hero = net.hero ?? ''
      group = ''
      names.clear()
      owners.clear()
      seenInvites.clear()
      first = true
      issuedAt = 0
      if (hero) {
        let q = JSON.stringify(hero)
        own = net.client.watch(`.party_step.player=${q}&*`)
        inbox = net.client.watch(`.party_invite.to=${q}&*`)
        replies = net.client.watch(`.party_reply.to=${q}&*`)
      }
    }
    meBody = f.body
    if (hero && who?.person) {
      know(hero)
      names.set(hero, f.sheet.name)
    }
    for (let b of inbox?.value ?? []) {
      know(str(comp(b, 'party_invite').from))
    }
    let next = current(hero, own?.value ?? [])
    if (next != group) {
      joins?.close()
      for (let w of steps.values()) w.close()
      for (let w of players.values()) w.close()
      steps.clear()
      players.clear()
      group = next
      joins = group
        ? net.client.watch(`.party_step.group=${JSON.stringify(group)}&*`)
        : null
    }
    if (!group) return
    let candidates = new Set([hero])
    for (let b of joins?.value ?? []) {
      let id = str(comp(b, 'party_step').player)
      if (id) candidates.add(id)
    }
    for (let id of candidates) {
      if (id != hero && !steps.has(id)) {
        steps.set(
          id,
          net.client.watch(
            `.party_step.player=${JSON.stringify(id)}&*`,
          ),
        )
      }
      if (id != hero) know(id)
      let active = current(
        id,
        id == hero ? own?.value ?? [] : steps.get(id)?.value ?? [],
      ) == group
      if (active && !players.has(id)) {
        players.set(
          id,
          net.client.watch(`.eid=${JSON.stringify(id)}&.player&*`),
        )
      } else if (!active && players.has(id)) {
        players.get(id)?.close()
        players.delete(id)
      }
    }
    for (let id of [...steps.keys()]) {
      if (!candidates.has(id)) {
        steps.get(id)?.close()
        steps.delete(id)
        players.get(id)?.close()
        players.delete(id)
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
    [...players.keys()].flatMap((id) => {
      let row = net.client.ent(id)
      return row?.player
        ? [memberOf(row, names.get(id) ?? 'A hero', net.now())]
        : []
    })
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

  // A page may write two steps before its watch receives the first. Its own
  // timestamp increases within that page; the server stamp settles ties
  // between pages, and the eid settles writes stamped in one millisecond.
  let step = (group: string): Bundle => {
    let last = Math.max(
      0,
      ...(own?.value ?? [])
        .filter((b) => writer(b) == who?.person)
        .map((b) => num(comp(b, 'party_step').at)),
    )
    issuedAt = Math.max(net.now(), issuedAt + 1, last + 1)
    return {
      entity: { eid: crypto.randomUUID() },
      party_step: { player: hero, group, at: issuedAt },
    }
  }

  return {
    me: (m: Me) => who = m,
    get canJoin() {
      return !!who?.person && who.writes && owners.get(hero) == who.person
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
    get members() {
      return listed()
    },
    name: (id: string) => names.get(id) ?? 'A hero',
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
    tick: (f: Frame) => {
      watch(f)
      let found = open()
      let fresh = first ? [] : found.filter((i) => !seenInvites.has(i.eid))
      seenInvites = new Set(found.map((i) => i.eid))
      first = false
      return fresh
    },
    invite: async (to: string) => {
      if (
        !who?.person || !who.writes || owners.get(hero) != who.person ||
        !hero || to == hero
      ) return false
      try {
        if (!(await net.about(to)).by) return false
        let id = group || hero
        let change: Bundle[] = group ? [] : [step(id)]
        change.push({
          entity: { eid: crypto.randomUUID() },
          party_invite: {
            from: hero,
            to,
            group: id,
            at: new Date(net.now()).toISOString(),
          },
        })
        await net.client.mutate(change)
        return true
      } catch {
        return false
      }
    },
    accept: async (i: Invite) => {
      if (
        !who?.person || !who.writes || owners.get(hero) != who.person ||
        i.to != hero ||
        !open().some((v) => v.eid == i.eid)
      ) return false
      try {
        if (await net.partyOf(i.from) != i.group) return false
        await net.client.mutate([step(i.group), {
          entity: { eid: crypto.randomUUID() },
          party_reply: { invite: i.eid, to: hero, accept: true },
        }])
        return true
      } catch {
        return false
      }
    },
    decline: async (i: Invite) => {
      if (
        !who?.person || !who.writes || owners.get(hero) != who.person ||
        i.to != hero ||
        !open().some((v) => v.eid == i.eid)
      ) return false
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
      if (
        !who?.person || !who.writes || owners.get(hero) != who.person ||
        !hero || !group
      ) return false
      try {
        await net.client.mutate([step('')])
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
