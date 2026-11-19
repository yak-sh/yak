// The CLI's bearer (T-34385): a short-lived token the connector mints for
// whoever is asking, which the `/mcp` door then takes as that same caller and
// nothing more. It is what signs `yaks` in on a machine that has no browser
// and no connector — the person says "give me a token", pastes one line into a
// terminal, and the CLI speaks to the same door with the same tools.
//
// It is a sealed value (lib/token.ts `seal`), like the platform session cookie
// and the custom-domain handoff beside it, and deliberately not an OAuth
// access token: the provider mints those only at the end of a browser redirect
// flow it owns, and their life is one number for the whole provider
// (`accessTokenTTL`), where a grant's is the caller's to pick up to a day. So
// identity.ts opens this one itself, told apart by the `yaks_` a grant opens
// with — no provider token can wear it, since those are
// `<person>:<grant>:<secret>`.
//
// What is sealed is only what a bearer must say: which grant it is, whose it
// is, the one space it is confined to (or none), and the second it dies at. It
// carries no permission — membership is read from the directory at request
// time, exactly as a cookie's is (identity.ts `Props`) — so a grant can never
// be more than the person who asked for it, and a space narrowed to is always
// a narrowing (`narrowed` below).
//
// And it is revocable, which a sealed value is not on its own: minting writes
// a row in the directory, verifying requires that row, and revoking marks it
// `cancelled`. The directory is one strongly consistent store, so a grant
// revoked is refused at once everywhere; KV, eventually consistent, kept a
// revoked grant answering for a minute wherever it had been read (T-1353).
import { opened, seal } from './lib/token.ts'
import type { Bundle } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { type Line, line } from '@yaks/query'
import {
  type Directory,
  listingOf,
  type Reach,
  type Role,
  type Seat,
  type Space,
} from './directory.ts'
import { admin, refuse } from './tool.ts'

// What a grant token opens with, so identity.ts knows to open it here.
export let GRANT = 'yaks_'
export let CLI_GRANT = 'cli-grant'

// The longest life anybody may ask for, and the one they get by asking for
// nothing.
export let HOURS = 24
export let DEFAULT = 1

export type Grant = {
  // Short, and said in the answer that mints it: it is what `revoke` names.
  id: string
  person: string
  // The one space this grant reaches, or null for the caller's whole reach.
  space: string | null
  /** The space's stable identity; absent on grants minted before this field. */
  spaceEid?: string
  // The unix second it dies at.
  exp: number
}

// The KV as this file asks for it — the same shape handoff.ts's ledger takes,
// so no Cloudflare type name enters the kernel (env.ts OAUTH_KV is `unknown`).
export type Kv = {
  get(k: string): Promise<string | null>
  put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>
  delete(k: string): Promise<void>
  list(o: { prefix: string }): Promise<{ keys: { name: string }[] }>
}

export type Ledger = NonNullable<ReturnType<typeof ledger>>

// What every revocable thing this kernel mints says about itself: whose it is,
// which one it is, and the second it dies at.
export type Row = { id: string; person: string; exp: number }

// What a shelf asks of the directory: one credential's row with its person's,
// a read of a person's rows, and a write.
export type Rows = Pick<Directory, 'credential' | 'read' | 'stamp'>

// One kind of row a shelf keeps: its component, the KV prefix it was kept
// under before the directory (`what`), the read of a person's rows still
// standing, and how one of its credentials is said as a row and read back.
export type Kind<T extends Row> = {
  what: string
  component: 'cli_grant' | 'standing_link'
  mine: (person: string) => Line
  said: (r: T) => Record<string, unknown>
  of: (said: Record<string, unknown>, r: Row) => T
}

let iso = (exp: number) => new Date(exp * 1000).toISOString()

// A shelf of those in the directory, one row each, its eid derived from whose
// it is and which one. Both revocable credentials here are one — a CLI grant,
// and the standing sign-in link beside it (link.ts) — because a sealed value
// nobody can forge is still one nobody could end: verifying asks whether the
// row stands, and revoking marks it `cancelled`. The row lapses with what it
// names (its `until`, the directory's `expire`), and a token naming somebody
// else's id finds no row at all, since the person is in its eid.
//
// A credential minted before the rows (T-1353) is in KV, under
// `<what>:<person>:<id>`: the first read that finds no row reads it there and
// writes its row, which decides from then on, so nobody holding one is signed
// out (M-37923). Revoking one marks its row the same way. And minting still
// writes KV beside the row, for a Worker on the release before this one.
//
// Null when there is no directory (a probe with none wired): minting refuses
// rather than handing out something nothing could ever take back. `kv` and
// `ttl` are answered too, for the rows a shelf's owner keeps beside its own
// (`wearing`).
export let shelf = <T extends Row>(
  kv: unknown,
  dir: Rows | null | undefined,
  kind: Kind<T>,
) => {
  let store = (kv as Kv | undefined)?.get ? kv as Kv : null
  if (!dir) return null
  let key = (person: string, id: string) => `${kind.what}:${person}:${id}`
  let eid = (person: string, id: string) =>
    identityEid(kind.component, [person, id])
  // A minute past the row's own death — KV's own floor is a minute — so a
  // clock that disagrees slightly reads a live one as live.
  let ttl = (r: Row, now = Date.now()) =>
    Math.max(60, r.exp - Math.floor(now / 1000) + 60)
  let rowOf = (r: T, ended = false): Bundle => ({
    entity: { eid: eid(r.person, r.id) },
    [kind.component]: {
      person: r.person,
      id: r.id,
      until: iso(r.exp),
      ...kind.said(r),
    },
    ...ended ? { cancelled: {} } : {},
  })
  let kept = async (person: string, id: string): Promise<T | null> =>
    store ? JSON.parse(await store.get(key(person, id)) ?? 'null') : null
  // The credential and whether its person stands, as the directory says.
  let look = async (person: string, id: string) => {
    let { present, row } = await dir.credential(eid(person, id), person)
    if (row?.cancelled) return { present, held: null }
    let said = row?.[kind.component] as Record<string, unknown> | undefined
    if (said) {
      let exp = Date.parse(String(said.until)) / 1000
      return { present, held: kind.of(said, { id, person, exp }) }
    }
    let old = await kept(person, id)
    if (old && present) await dir.stamp({ entities: [rowOf(old)] })
    return { present, held: old }
  }
  let held = async (person: string, id: string) => (await look(person, id)).held
  return {
    key,
    kv: store,
    ttl,
    keep: async (r: T, now = Date.now()) => {
      await dir.stamp({ entities: [rowOf(r)] })
      await store?.put(key(r.person, r.id), JSON.stringify(r), {
        expirationTtl: ttl(r, now),
      })
    },
    held,
    // Whether the credential stands and so does its person, in one read.
    stands: async (person: string, id: string) => {
      let { present, held } = await look(person, id)
      return present && !!held
    },
    // Every one of this person's still on the books, by id: their rows, and
    // whatever KV still holds from before the rows.
    ids: async (person: string) => {
      let [rows, old] = await Promise.all([
        dir.read(kind.mine(person)),
        store
          ? store.list({ prefix: key(person, '') }).then((l) =>
            l.keys.map((k) => k.name.slice(key(person, '').length))
          )
          : [],
      ])
      let ids = rows.map((b) =>
        String((b[kind.component] as { id: string }).id)
      )
      return [...new Set([...ids, ...old])]
    },
    drop: async (person: string, id: string) => {
      let r = await held(person, id)
      await dir.stamp({
        entities: [
          r
            ? rowOf(r, true)
            : { entity: { eid: eid(person, id) }, cancelled: {} },
        ],
      })
      await store?.delete(key(person, id))
    },
  }
}

// A CLI grant as a row: the space it is narrowed to beside whose it is, read
// back in the order it was sealed, since the seal is said again from it
// (`tokenOf`).
let GRANTS: Kind<Grant> = {
  what: CLI_GRANT,
  component: 'cli_grant',
  mine: (person) => line`.cli_grant.person=${person}&!cancelled`,
  said: (g) => ({ space: g.space, space_eid: g.spaceEid ?? null }),
  of: (said, { id, person, exp }) => ({
    id,
    person,
    space: (said.space as string | null | undefined) ?? null,
    ...said.space_eid ? { spaceEid: String(said.space_eid) } : {},
    exp,
  }),
}

// Where a grant is written down: the shelf above, plus the one row a grant has
// that a sign-in link does not.
export let ledger = (kv: unknown, dir: Rows | null | undefined) => {
  let book = shelf<Grant>(kv, dir, GRANTS)
  let worns = book?.kv
  if (!book || !worns) return null
  // Never write or delete provider-owned grant: rows here.
  // What a long-lived holder is signed in with, by what the holder is known
  // by.
  let worn = (holder: string) => `wearing:${holder}`
  return {
    ...book,
    // Which grant a long-lived holder is wearing — one build container, by
    // its id (sandbox.ts). The token is answered once and kept nowhere, so
    // this row is not the token: it is whose grant and which one, which is
    // enough for the holder's next wake to wear the same grant again, for the
    // swap on its way out to say that grant's token, and for whoever ends the
    // holder to take it back without having minted it. It expires with the
    // grant it names.
    wear: async (holder: string, g: Grant, now = Date.now()) => {
      await worns.put(worn(holder), `${g.person}:${g.id}`, {
        expirationTtl: book.ttl(g, now),
      })
    },
    wearing: async (holder: string) => {
      let said = await worns.get(worn(holder))
      let cut = said?.indexOf(':') ?? -1
      return cut < 0
        ? null
        : { person: said!.slice(0, cut), id: said!.slice(cut + 1) }
    },
    bare: async (holder: string) => {
      await worns.delete(worn(holder))
    },
  }
}

// The token that carries a grant. The seal is deterministic, so a grant still
// on the books can be said again from what the ledger holds — which is what
// lets one build container keep one grant across every command that wakes it
// (sandbox.ts `swapped`) instead of minting one per command. It is not a way to
// recover a token somebody lost: nothing but this kernel can read the ledger.
export let tokenOf = async (g: Grant, secret: string) =>
  GRANT + await seal('grant', g, secret)

// A grant, and the token that carries it. The token is answered once and kept
// nowhere: what the ledger holds is the grant, and the seal is what proves the
// bearer is this one.
export let mint = async (
  secret: string,
  book: Ledger,
  want: {
    person: string
    space?: Pick<Space, 'eid' | 'slug'> | null
    hours?: number
  },
  now = Date.now(),
): Promise<{ grant: Grant; token: string }> => {
  let hours = want.hours ?? DEFAULT
  // Refused, never clamped: a caller told "24" and handed one hour would
  // believe the answer it did not get.
  if (!(hours > 0) || hours > HOURS) {
    throw refuse('arguments', `hours: more than 0 and at most ${HOURS}`)
  }
  let grant: Grant = {
    id: crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    person: want.person,
    space: want.space?.slug ?? null,
    ...want.space ? { spaceEid: want.space.eid } : {},
    exp: Math.floor(now / 1000) + Math.round(hours * 3600),
  }
  await book.keep(grant, now)
  return { grant, token: await tokenOf(grant, secret) }
}

// The grant a bearer names, or null for anything else: a token written under
// another secret, edited, expired, or revoked. The ledger row is what makes
// the last of those possible — a sealed value nobody can forge is still one
// nobody could end, so verifying asks whether the row is still there.
export let held = async (
  token: string,
  secret: string,
  book: Ledger | null,
  now = Date.now(),
): Promise<Grant | null> => {
  if (!book) return null
  let g = await sealed(token, secret, now)
  return g && await book.held(g.person, g.id) ? g : null
}

// The grant a token's seal says, before the ledger is asked whether it still
// stands: what a door can start on while the directory answers (asking.ts).
export let sealed = async (
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Grant | null> => {
  if (!token.startsWith(GRANT)) return null
  let g = await opened<Grant>('grant', token.slice(GRANT.length), secret)
  return !g || typeof g.person != 'string' || typeof g.id != 'string' ||
      typeof g.exp != 'number' || g.exp * 1000 <= now
    ? null
    : g
}

// Taking one back, named by its id or by enough of the front of one to find
// it — the person reads the id off the answer that minted the grant, and a
// prefix is what somebody types. Answers the ids that went, so a caller that
// named a prefix matching nothing is told rather than reassured.
export let revoke = async (
  book: Ledger,
  person: string,
  said: string,
): Promise<string[]> => {
  let gone = (await book.ids(person)).filter((id) => id.startsWith(said))
  for (let id of gone) await book.drop(person, id)
  return gone
}

// A grant narrowed to one space, said over the directory the tools read
// membership out of (tools.ts `inSpace`, `inReach`, declared.ts): every space
// but this one is a space the caller does not belong to, which is the answer
// this platform already gives for a space that is not theirs. One wrapper, so
// the narrowing holds for every tool at once rather than tool by tool.
//
// `own` and `narrowedTo` answer the narrowed space: a tool that was given no space
// means the one the grant or the Operator is for (tool.ts `ownSpace`). Whether they may write there is still their membership, read below.
//
// `beyond` is each other space its holder was let into, with the role it was
// given there, which stands in for the caller's membership in it: a space's
// Operator is narrowed to its own space and the spaces that let it in
// (operator-reach.ts). It may still be on its way: what is asked of the
// narrowed space alone is answered without it, so a step's reads that need
// only its person and space are asked beside the reach (operator.ts
// `working`), and only what reaches past the space waits for it. Named by
// its eid, the space needs no slug: one is read with it where asked.
export let narrowed = (
  dir: Directory,
  slug: string | undefined,
  eid?: string,
  over = false,
  beyond: Reach[] | Promise<Reach[]> = [],
): Directory => {
  let matches = (space: Pick<Space, 'eid' | 'slug'>) =>
    eid ? space.eid == eid : space.slug == slug
  let letting = Promise.resolve(beyond).then((all) => ({
    all,
    letIn: new Map(all.map((r) => [r.space.eid, r])),
  }))
  letting.catch(() => {})
  let past = async (space: { eid: string } | null | undefined) =>
    space ? (await letting).letIn.get(space.eid) : undefined
  let also = async (role?: Role) =>
    (await letting).all.filter((r) => !role || r.role == role)
  let seat = (r: Reach): Seat => ({
    space: r.space,
    role: r.role,
    seat: r.eid,
    own: false,
  })
  // The narrowed space's role, for an administrative holder: the platform's
  // admin stands as its owner, which their seats say (tool.ts `admin`).
  let ownRole = async (space: Pick<Space, 'eid'>, person: string) =>
    over && await admin({ dir, person }) ? 'owner' : dir.role(space, person)
  // An administrative holder reaches every app of the space: those of a space
  // they sit in are in their own reach, read with their seats; the rest are
  // asked.
  let reachHere = async (person: string) => {
    if (!over) {
      return (await dir.reachable(person)).filter((r) => matches(r.space))
    }
    let [space, theirs] = await Promise.all([
      eid ? dir.at(eid) : dir.space(slug!),
      dir.reachable(person),
    ])
    if (!space || space.trashed) return []
    let role = await ownRole(space, person)
    if (!role) return []
    let sat = theirs.filter((r) => r.space.eid == space.eid).map((r) => r.app)
    return (sat.length ? sat : await dir.apps([space]))
      .filter((app) => !app.trashed)
      .map((app) => ({ space, app, role }))
  }
  // The apps of each space that let the holder in, with the role it gave. A
  // space the person also sits in is in their own reach, which the request
  // has already read (an Operator's step asks it with the space, operator.ts
  // `working`), an administrative one's too: the role is the one given, and
  // the apps are the space's. The rest are asked together, in one round trip,
  // unless the request already read them (directory.ts `apps`).
  let reachBeyond = async (person: string) => {
    let { all } = await letting
    if (!all.length) return []
    let theirs = await dir.reachable(person)
    let sat = new Set(theirs.map((r) => r.space.eid))
    let asked = all.filter((r) => !sat.has(r.space.eid))
    let apps = asked.length ? await dir.apps(asked.map((r) => r.space)) : []
    return all.flatMap((r) =>
      (sat.has(r.space.eid)
        ? theirs.filter((t) => t.space.eid == r.space.eid).map((t) => t.app)
        : apps.filter((app) => app.space == r.space.eid))
        .filter((app) => !app.trashed)
        .map((app) => ({ space: r.space, app, role: r.role }))
    )
  }
  let narrowedTo = async () => {
    let space = eid ? await dir.at(eid) : await dir.space(slug!)
    if (!space) throw refuse('missing', `no space ${slug ?? eid}`)
    return space
  }
  let self: Directory = {
    ...dir,
    space: async (want: string) => {
      if (!eid && want != slug && !(await letting).letIn.size) return null
      let space = await dir.space(want)
      return space && (matches(space) || await past(space)) ? space : null
    },
    page: async (want, app, person, _over, every) => {
      let got = await dir.page(want, app, person, over, every)
      let here = !!got.space && matches(got.space)
      return {
        ...got,
        ...person
          ? {
            role: here ? got.role : (await past(got.space))?.role ?? null,
            administrative: here && over && got.administrative === true,
          }
          : {},
      }
    },
    // A call naming an app and no space means the narrowed space when no
    // other space let its holder in (tool.ts `ownSpace`), read as its page.
    // Spaces it was let into are asked the long way.
    holding: async (app, person, _over, every) => {
      if ((await letting).all.length) return null
      let at = eid ? (await narrowedTo()).slug : slug!
      let page = await self.page(at, app, person, over, every)
      return page.space && matches(page.space)
        ? { holding: [page.space], page }
        : null
    },
    // A listing is its seats here, which no one read of the whole directory
    // says, so it is asked the long way over them.
    listing: (person: string) => listingOf(self, person),
    spaces: async (person: string, role?: Role) => [
      ...(await dir.spaces(person, role)).filter(matches),
      ...(await also(role)).map((r) => r.space),
    ],
    seats: async (person: string, role?: Role) => [
      ...(await dir.seats(person, role)).filter((s) => matches(s.space)),
      ...(await also(role)).map(seat),
    ],
    reachable: async (person: string) => {
      let [here, there] = await Promise.all([
        reachHere(person),
        reachBeyond(person),
      ])
      return [...here, ...there]
    },
    seated: async (person: string, role?: Role) => [
      ...(await dir.seated(person, role)).filter((s) => matches(s.space)),
      ...(await also(role)).map(seat),
    ],
    // The narrowed space is never one it was let into (operator-reach.ts
    // `reachOf` leaves it out), so its role is read without the rest. Asked
    // by eid, a space narrowed by its slug is read to say whether it is the
    // one.
    role: async (space: Pick<Space, 'eid'>, person: string) => {
      let here = eid
        ? space.eid == eid
        : (await dir.space(slug!))?.eid == space.eid
      if (!here) return (await past(space))?.role ?? null
      return ownRole(space, person)
    },
    target: async (space: string, person: string, app?: string | null) => {
      let got = await dir.target(space, person, app)
      let r = await past(got.space)
      return got.space && matches(got.space)
        ? got
        : { ...got, role: r?.role ?? null }
    },
    own: narrowedTo,
    narrowedTo,
  }
  return self
}
