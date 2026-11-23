// A person's own space minted inside the write that mints it (T-148852): the
// request `$own{person, want?}` becomes the batch directory.ts `owning`
// decides over this transaction's own reads, so it reads the person's seats,
// their row and which addresses are free as the write finds them. Two asks at
// once (a sign-in settling behind its answer, and the first page it sent the
// person to) are two transactions one after the other, and the second finds
// the first's seat and writes nothing. Before, the gateway read, decided and
// wrote in five trips, and an ask landing between another's reads minted a
// second space at the next free address.
//
// The platform's alone: what it writes is the kernel's (a person's `started`,
// a space's `starter`), so a request that is not trusted is refused.
//
// A seat written in a space, or taken away, tells the space's Operator
// (`seatsHeard`), as an app's commit does (graph.ts `#herald`): its
// subscriptions over the space look again a beat later (build.ts `HEARD`),
// and one watching member_list sees the role change within seconds.
import {
  about,
  type Bundle,
  type Graph,
  type Plugin,
  type Tx,
} from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { dead, TOMBSTONE } from '@yaks/graph/bundle'
import { after, each, together } from '@yaks/fp'
import { line } from '@yaks/query'
import { sharing } from '@yaks/connections/mcp'
import { spaceHost } from '@yaks/platform/host'
import { mcpUnshared } from '@yaks/platform/letters'
import { idOf, inside, type Row } from '../directory.ts'
import { reclaimFiles } from '../file-retirement-graph.ts'
import { caught } from '../defects.ts'
import type { Env } from '../env.ts'
import { type Letter, letterRows } from '../mail.ts'
import { KERNEL, meta as directoryStore } from '../meta.ts'
import { legacySeat, ownerSeats } from '../number-voice.ts'
import type { Options } from './store.ts'

type Own = { person: string; want?: string }

// The space a seat among `rows` is in.
let spacesOf = (rows: Row[]) =>
  rows.flatMap((r) => r.member?.space ? [idOf(r.member.space)] : [])

// The entities a batch deletes.
let killing = (bundles: Bundle[]) => [
  ...new Set(bundles.filter(dead).map((b) => b.entity.eid)),
]

type Sharing = { space: string; person: string; names: string[] }
type Connector = Sharing & { title: string; slug: string; email: string }
type OwnerSeat = { eid: string; space: string; person: string }

let ownersOf = (rows: Row[]): OwnerSeat[] =>
  rows.flatMap(({ entity, member }) =>
    member?.role == 'owner' && member.space && member.person
      ? [{
        eid: entity.eid,
        space: idOf(member.space),
        person: idOf(member.person),
      }]
      : []
  )

// Bind the original account before the earliest owner's seat can disappear.
let departures = (bundles: Bundle[], owners: OwnerSeat[], killed: string[]) => {
  let patches = new Map(bundles.map((b) => [b.entity.eid, b]))
  return owners.filter(({ eid, space, person }) => {
    let patch = patches.get(eid)
    let member = patch?.member as Row['member']
    return killed.includes(eid) || killed.includes(space) ||
      killed.includes(person) ||
      patch?.member === null ||
      member?.role != null && member.role != 'owner' ||
      !!member?.space && idOf(member.space) != space ||
      !!member?.person && idOf(member.person) != person
  })
}

let boundLines = (tx: Tx, owners: OwnerSeat[]) =>
  each(
    [...new Set(owners.map((s) => s.space))],
    [] as Bundle[],
    (out, space) =>
      after(
        together([
          tx.read(ownerSeats(space)),
          tx.read(line`.phone_line.space=${space}`),
          tx.read(
            line`.phone_login.seat=${
              owners.filter((s) => s.space == space).map((s) => s.eid)
            }`,
          ),
        ]),
        ([seats, numbers, logins]) => [
          ...out,
          ...numbers.flatMap((row) => {
            let from = (row.phone_line as Row['phone_line'])?.legacy_seat
            let legacy = from ?? legacySeat(seats)
            let to = owners.some((s) => s.eid == legacy) ? '' : legacy
            return from == to
              ? []
              : [{ entity: row.entity, phone_line: { legacy_seat: to } }]
          }),
          ...logins.map(({ entity }) => ({ entity, tombstone: {} })),
        ],
      ),
  )

let sharingSeats = (tx: Tx, seats: Row[]) =>
  each(seats, [] as Sharing[], (out, { member: m }) => {
    if (m?.role != 'owner' || !m.space || !m.person) return out
    let space = idOf(m.space), person = idOf(m.person)
    return after(sharing(tx.read, person, space), (names) => {
      if (names.length) out.push({ space, person, names })
      return out
    })
  })

let addressing = (tx: Tx, servers: Sharing[]) => {
  if (!servers.length) return []
  let ids = [...new Set(servers.flatMap((s) => [s.space, s.person]))]
  return after(tx.get(ids, ['space', 'doc', 'email']), (rows: Row[]) => {
    let by = new Map(rows.map((r) => [r.entity.eid, r]))
    return servers.flatMap((s) => {
      let at = by.get(s.space), email = by.get(s.person)?.email?.address
      let slug = at?.space?.slug
      return slug && email
        ? [{ ...s, slug, email, title: at?.doc?.title || slug }]
        : []
    })
  })
}

let unshared = (tx: Tx, env: Env, before: Connector[], killed: Set<string>) =>
  each(
    before,
    [] as Letter[],
    (letters, { space, person, names, title, slug, email }) =>
      after(
        tx.read(line`.member.space=${space}&.member.person=${person}`),
        ([held]: Row[]) => {
          let seat = held?.member?.role ?? null
          if (seat == 'owner') return letters
          let host = spaceHost(env, slug)
          letters.push({
            ...mcpUnshared({ title, host }, names, seat, killed.has(space)),
            to: email,
            about: space,
          })
          return letters
        },
      ),
  )

/** Each space whose seats a commit wrote or took away, told to its Operator
 * (build-door.ts `heard`). An owner who shared MCP servers is told what
 * stopped being shared. Read those names before a delete can cascade. */
export let seatsHeard = (
  { store }: Options,
  tell = async (env: Env, space: string) => {
    let { heard } = await import('../build-door.ts')
    await (await heard(env, space)).body?.cancel()
  },
): Plugin => {
  let keys = ['member', '$delete', TOMBSTONE]
  let before = new WeakMap<
    object,
    {
      spaces: string[]
      connectors: Connector[]
      owners: OwnerSeat[]
      letters?: Letter[]
    }
  >()
  let leaving = hook(keys, (bundles, tx, _err, context) => {
    if (!context?.transaction || !store.meta) return bundles
    let at = context.transaction
    let killed = killing(bundles)
    let touched = bundles.filter((b) => 'member' in b || dead(b))
      .map((b) => b.entity.eid)
    let direct = tx.get(touched, ['member'])
    let cascade = killed.length
      ? about(tx, (context.graph as Graph).vocab, killed, ['member'])
      : []
    return after(together([direct, cascade]), ([direct, cascade]) => {
      let seats = [
        ...new Map([...direct, ...cascade].map((r) => [r.entity.eid, r]))
          .values(),
      ]
      let spaces = spacesOf(direct.filter((r) => killed.includes(r.entity.eid)))
      let owners = departures(bundles, ownersOf(seats), killed)
      return after(
        together([
          after(sharingSeats(tx, seats), (servers) => addressing(tx, servers)),
          boundLines(tx, owners),
        ]),
        ([connectors, lines]) => {
          before.set(at, { spaces, connectors, owners })
          return [...bundles, ...lines]
        },
      )
    })
  })
  let commit = hook(keys, (applied, tx, _err, context) => {
    let at = context?.transaction
    let prior = at && before.get(at)
    if (!prior?.connectors.length) return applied
    return after(
      unshared(
        tx,
        store.env as Env,
        prior.connectors,
        new Set(killing(applied)),
      ),
      (letters) => {
        if (letters.length) prior.letters = letters
        return applied
      },
    )
  })
  let effect = hook(keys, async (applied, tx, _err, context) => {
    let env = store.env as Env
    let at = context?.transaction
    let prior = at && before.get(at)
    let leaving = prior?.owners.length
      ? (async (removed) => {
        let { ownersLeft } = await import('../number-voice.ts')
        await Promise.all(
          [...new Set(removed.map((s) => s.space))].map((space) =>
            ownersLeft(
              env,
              space,
              removed.filter((s) => s.space == space).map((s) => s.eid),
            )
              .catch((e) =>
                caught(e, { request: 'revoke softphone sign-in', space })
              )
          ),
        )
      })(prior.owners)
      : undefined
    let due = prior?.letters
    let notify = due && directoryStore(env)
      .apply(due.flatMap((l) => letterRows(l, env)), KERNEL)
      .catch((e) => caught(e, { request: 'tell former MCP owners' }))
    if (!store.meta || !env.BUILDER) {
      await Promise.all([notify, leaving])
      return applied
    }
    let wrote = applied.filter((b) => b.member && !b.tombstone)
      .map((b) => b.entity.eid)
    // A space born in this very commit has no Operator to tell yet.
    let born = new Set(
      applied.filter((b) => b.space).map((b) => b.entity.eid),
    )
    let gone = new Set(killing(applied))
    let spaces = new Set([
      ...prior?.spaces ?? [],
      ...wrote.length ? spacesOf(await tx.get(wrote)) : [],
    ].filter((s) => !born.has(s) && !gone.has(s)))
    await Promise.all(
      [
        notify,
        leaving,
        ...[...spaces].map((space) =>
          tell(env, space).catch((e) =>
            caught(e, { request: 'tell seats', space })
          )
        ),
      ],
    )
    return applied
  })
  return {
    name: 'yak/seats',
    admission: () => true,
    wants: (bundles) => {
      let killed = killing(bundles)
      return killed.length ? [{ about: killed, comps: ['member'] }] : []
    },
    hooks: { precondition: leaving, commit, effect },
  }
}

export let plugins = (_host: unknown, options: Options): Plugin[] => [
  {
    name: 'yak/directory',
    requests: ['$own'],
    authorize: hook(['$own'], (bundles, tx, _err, context) => {
      if (!bundles.some((b) => b.$own)) return bundles
      if (!context?.trusted) {
        throw new Refused('only the platform mints a person their own space')
      }
      return each(
        bundles,
        [] as Bundle[],
        (out, b) => {
          if (!b.$own) return [...out, b]
          let { person, want } = b.$own as Own
          return after(
            inside(tx).owning(person, want),
            (wrote) => [...out, ...wrote],
          )
        },
      )
    }),
  },
  reclaimFiles(),
  seatsHeard(options),
]
