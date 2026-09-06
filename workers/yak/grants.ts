// The CLI's bearer (T-34385): a short-lived token the connector mints for
// whoever is asking, which the `/mcp` door then takes as that same caller and
// nothing more. It is what signs `yaks` in on a machine that has no browser
// and no connector — the person says "give me a token", pastes one line into a
// terminal, and the CLI speaks to the same door with the same tools.
//
// It is a SEALED value (src/token.ts `seal`), like the platform session cookie
// and the custom-domain handoff beside it, and deliberately NOT an OAuth
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
// And it is REVOCABLE, which a sealed value is not on its own: minting writes
// a row in the same KV the OAuth grants live in, verifying REQUIRES that row,
// and revoking deletes it. The row expires with the token, so nothing has to
// sweep it. KV is eventually consistent, so a revocation lands everywhere
// within about a minute rather than instantly — which is why the life is short
// and the ceiling is a day.
import { opened, seal } from '../../src/token.ts'
import type { Directory } from './directory.ts'

// What a grant token opens with, so identity.ts knows to open it here.
export let GRANT = 'yaks_'

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
type Kv = {
  get(k: string): Promise<string | null>
  put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>
  delete(k: string): Promise<void>
  list(o: { prefix: string }): Promise<{ keys: { name: string }[] }>
}

export type Ledger = NonNullable<ReturnType<typeof ledger>>

// Where a grant is written down. Null when there is no KV at all (a probe with
// none wired): minting refuses rather than handing out a token nothing could
// ever take back.
export let ledger = (kv: unknown) => {
  let store = kv as Kv | undefined
  if (!store?.get) return null
  let key = (person: string, id: string) => `grant:${person}:${id}`
  return {
    keep: async (g: Grant, now = Date.now()) => {
      await store.put(key(g.person, g.id), JSON.stringify(g), {
        // A minute past the token's own death — KV's own floor is a minute —
        // so a clock that disagrees slightly reads a live token as live.
        expirationTtl: Math.max(60, g.exp - Math.floor(now / 1000) + 60),
      })
    },
    held: async (person: string, id: string): Promise<Grant | null> =>
      JSON.parse(await store.get(key(person, id)) ?? 'null'),
    // Every grant of this person's still on the books, by id.
    ids: async (person: string) =>
      (await store.list({ prefix: key(person, '') })).keys
        .map((k) => k.name.slice(key(person, '').length)),
    drop: async (person: string, id: string) => {
      await store.delete(key(person, id))
    },
  }
}

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
    throw new Error(`hours: more than 0 and at most ${HOURS}`)
  }
  let grant: Grant = {
    id: crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    person: want.person,
    space: want.space ?? null,
    exp: Math.floor(now / 1000) + Math.round(hours * 3600),
  }
  await book.keep(grant, now)
  return { grant, token: GRANT + await seal(grant, secret) }
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
  let g = await opened<Grant>(token.slice(GRANT.length), secret)
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

// A grant narrowed to one space, said over the DIRECTORY the tools read
// membership out of (tools.ts `inSpace`, `inReach`, declared.ts): every space
// but this one is a space the caller does not belong to, which is the answer
// this platform already gives for a space that is not theirs. One wrapper, so
// the narrowing holds for every tool at once rather than tool by tool.
//
// `own` answers the narrowed space too: a tool that was given no space asks
// for the caller's own, and under a grant for one space that IS the space it
// means. Whether they may write there is still their membership, read below.
export let narrowed = (dir: Directory, slug: string): Directory => ({
  ...dir,
  space: async (want: string) => (want == slug ? await dir.space(want) : null),
  spaces: async (person: string, role?: Parameters<Directory['spaces']>[1]) =>
    (await dir.spaces(person, role)).filter((s) => s.slug == slug),
  role: async (space: Parameters<Directory['role']>[0], person: string) =>
    space.slug == slug ? await dir.role(space, person) : null,
  own: async (person: string, want?: string) =>
    (await dir.space(slug)) ?? await dir.own(person, want),
})
