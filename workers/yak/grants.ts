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
// a row in the same KV the OAuth grants live in, verifying requires that row,
// and revoking deletes it. The row expires with the token, so nothing has to
// sweep it. KV is eventually consistent, so a revocation lands everywhere
// within about a minute rather than instantly — which is why the life is short
// and the ceiling is a day.
import { opened, seal } from './lib/token.ts'
import type { Directory, Role } from './directory.ts'
import { refuse } from './tool.ts'

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

// A shelf of those over the KV, keyed `<what>:<person>:<id>`. Both revocable
// credentials here are one — a CLI grant, and the standing sign-in link beside
// it (link.ts) — because a sealed value nobody can forge is still one nobody
// could end: verifying asks whether the row is there, and revoking deletes it.
// The row expires with what it names, so nothing has to sweep it, and a token
// naming somebody else's id finds no row at all, since the person is in the
// key.
//
// Null when there is no KV (a probe with none wired): minting refuses rather
// than handing out something nothing could ever take back. `kv` and `ttl` are
// answered too, for the rows a shelf's owner keeps beside its own (`wearing`).
export let shelf = <T extends Row>(kv: unknown, what: string) => {
  let store = kv as Kv | undefined
  if (!store?.get) return null
  let key = (person: string, id: string) => `${what}:${person}:${id}`
  // A minute past the row's own death — KV's own floor is a minute — so a
  // clock that disagrees slightly reads a live one as live.
  let ttl = (r: Row, now = Date.now()) =>
    Math.max(60, r.exp - Math.floor(now / 1000) + 60)
  return {
    key,
    kv: store,
    ttl,
    keep: async (r: T, now = Date.now()) => {
      await store.put(key(r.person, r.id), JSON.stringify(r), {
        expirationTtl: ttl(r, now),
      })
    },
    held: async (person: string, id: string): Promise<T | null> =>
      JSON.parse(await store.get(key(person, id)) ?? 'null'),
    // Every one of this person's still on the books, by id.
    ids: async (person: string) =>
      (await store.list({ prefix: key(person, '') })).keys
        .map((k) => k.name.slice(key(person, '').length)),
    drop: async (person: string, id: string) => {
      await store.delete(key(person, id))
    },
  }
}

// Where a grant is written down: the shelf above, plus the one row a grant has
// that a sign-in link does not.
export let ledger = (kv: unknown) => {
  let book = shelf<Grant>(kv, CLI_GRANT)
  if (!book) return null
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
      await book.kv.put(worn(holder), `${g.person}:${g.id}`, {
        expirationTtl: book.ttl(g, now),
      })
    },
    wearing: async (holder: string) => {
      let said = await book.kv.get(worn(holder))
      let cut = said?.indexOf(':') ?? -1
      return cut < 0
        ? null
        : { person: said!.slice(0, cut), id: said!.slice(cut + 1) }
    },
    bare: async (holder: string) => {
      await book.kv.delete(worn(holder))
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
  want: { person: string; space?: string | null; hours?: number },
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
    space: want.space ?? null,
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
  if (!token.startsWith(GRANT) || !book) return null
  let g = await opened<Grant>('grant', token.slice(GRANT.length), secret)
  if (
    !g || typeof g.person != 'string' || typeof g.id != 'string' ||
    typeof g.exp != 'number' || g.exp * 1000 <= now
  ) return null
  return await book.held(g.person, g.id) ? g : null
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
// `own` answers the narrowed space too: a tool that was given no space asks
// for the caller's own, and under a grant for one space that is the space it
// means. Whether they may write there is still their membership, read below.
export let narrowed = (
  dir: Directory,
  slug: string,
  eid?: string,
): Directory => {
  let matches = (space: Parameters<Directory['role']>[0]) =>
    eid ? space.eid == eid : space.slug == slug
  return {
    ...dir,
    space: async (want: string) => {
      if (!eid && want != slug) return null
      let space = await dir.space(want)
      return space && matches(space) ? space : null
    },
    page: async (want, app, person) => {
      let got = await dir.page(want, app, person)
      return {
        ...got,
        ...person
          ? {
            role: got.space && matches(got.space) ? got.role : null,
            administrative: false,
          }
          : {},
      }
    },
    spaces: async (person: string, role?: Role) =>
      (await dir.spaces(person, role)).filter(matches),
    seats: async (person: string, role?: Role) =>
      (await dir.seats(person, role)).filter((s) => matches(s.space)),
    reachable: async (person: string) =>
      (await dir.reachable(person)).filter((r) => matches(r.space)),
    seated: async (person: string, role?: Role) =>
      (await dir.seated(person, role)).filter((s) => matches(s.space)),
    role: async (space: Parameters<Directory['role']>[0], person: string) =>
      matches(space) ? await dir.role(space, person) : null,
    target: async (space: string, person: string, app?: string | null) => {
      let got = await dir.target(space, person, app)
      return got.space && matches(got.space) ? got : { ...got, role: null }
    },
    own: async () => {
      let space = eid ? await dir.at(eid) : await dir.space(slug)
      if (!space) throw refuse('missing', `no space ${slug}`)
      return space
    },
  }
}
