// The sign-in LINK (T-34351): one click instead of six digits, and the
// standing link a directory reviewer is handed. The owner, 2026-09-05, asking
// for both at once: "probably add a (multi-use) magic link sign in. and give
// them the link in the application. we could use it also for users to login
// from email too" — OpenAI's app review refuses credentials that need a
// mailbox at all, and a person reading a letter on their phone should not have
// to retype anything.
//
// One mechanism carries both: a value sealed under the session secret
// (src/token.ts) riding on `/login/link?t=`. Nothing here imports a Cloudflare
// name, so the contract holds in plain Deno (link_test.ts); identity.ts is
// where a pass becomes a session, at the same `landed` a spent code reaches.
// The two passes die differently, and that difference is the design:
//
//   ONCE      the link every code letter carries. It seals the ADDRESS and the
//             CODE, so it IS that code said another way — spending the link
//             spends the code (signin.ts `spend`), which makes it single use,
//             ten minutes old and counted against the same ceilings without a
//             ledger of its own. A person is not minted for it either, so
//             asking for a code still writes nothing about the address but the
//             row that already counted it. And a leaked store row still cannot
//             be turned into a link, because that store keeps a mac and never
//             the digits.
//   STANDING  the link that signs ONE person in until an expiry its minter
//             set. It seals the person and a row id, and it is worth a session
//             and nothing more: what the holder may then do is their
//             membership, read at request time exactly as a cookie's is
//             (identity.ts `Props`). The row is what makes it revocable
//             (grants.ts `shelf`) — a sealed value nobody can forge is still
//             one nobody could end.
//
// What the code would have carried rides in the seal rather than beside it on
// the URL: an OAuth authorize request in flight, and the page the person was
// sent here from. Sealed, a leaked link cannot be re-aimed at a stranger's
// page, and identity.ts still judges both the way it judges the code form's.
//
// There is no guessing ceiling of this door's own, deliberately: a forged `t`
// fails the mac before anything is read at all, and a wrong `once` burns a try
// on every code standing for that address, since it goes through the same
// `spend`. A counter per request would cost every honest sign-in a write to
// defend a 256-bit mac.
import { opened, seal } from '../../src/token.ts'
import { type Row, shelf } from './grants.ts'
import { PLATFORM } from './route.ts'

// Where a link is spent. Under `/login/`, so index.ts already routes it to the
// identity part with the rest of the sign-in surface.
export let LINK = '/login/link'

// A standing link's life: what a minter gets by asking for nothing, and the
// most anyone may ask for. Thirty days is a review cycle; a year is the
// ceiling because a credential nobody remembers minting should not outlive the
// reason it existed.
export let DAYS = 30
export let MOST = 365

/** The letter's one click: the address and the code it was mailed beside. */
export type Once = {
  email: string
  code: string
  /** The authorize request in flight, when signing in is granting. */
  q?: string
  /** Where they were headed when they were asked to sign in. */
  back?: string
}

/** A standing link: whose it is, which row it needs, when it dies. */
export type Standing = Row

/** What a link carries. Exactly one half is ever set. */
export type Pass = { once?: Once; standing?: Standing }

/** Where the standing links are written down (grants.ts `shelf`). */
export let links = (kv: unknown) => shelf<Standing>(kv, 'link')

export type Links = NonNullable<ReturnType<typeof links>>

/** The address a pass rides on. `at` is the host, which a probe moves. */
export let linkTo = (t: string, at = PLATFORM) =>
  `https://${at}${LINK}?t=${encodeURIComponent(t)}`

/** The one-click link for a code just minted, for the letter to carry. */
export let onceLink = async (secret: string, once: Once, at = PLATFORM) =>
  linkTo(await seal({ once } satisfies Pass, secret), at)

/**
 * A standing link, and the row that lets it be taken back. `days` is refused
 * rather than clamped (grants.ts `mint` takes the same line): a minter told
 * "90" and handed thirty would believe the answer it did not get.
 */
export let stand = async (
  secret: string,
  book: Links,
  want: { person: string; days?: number },
  now = Date.now(),
): Promise<{ standing: Standing; url: string }> => {
  let days = want.days ?? DAYS
  if (!(days > 0) || days > MOST) {
    throw new Error(`days: more than 0 and at most ${MOST}`)
  }
  let standing: Standing = {
    id: crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    person: want.person,
    exp: Math.floor(now / 1000) + Math.round(days * 86_400),
  }
  await book.keep(standing, now)
  return {
    standing,
    url: linkTo(await seal({ standing } satisfies Pass, secret)),
  }
}

/**
 * What a link says, or null for anything but a well-formed pass under this
 * secret. Nothing is SPENT here: who a pass names is settled by the caller —
 * a `once` against the code it carries (signin.ts `spend`), a `standing`
 * against {@link whose} — so a pass that fails there is refused without this
 * having to know either story.
 */
export let passOf = async (
  t: string,
  secret: string,
): Promise<Pass | null> => {
  let p = t ? await opened<Pass>(t, secret) : null
  if (!p) return null
  let { once, standing } = p
  if (
    once && typeof once.email == 'string' && typeof once.code == 'string'
  ) return { once }
  if (
    standing && typeof standing.person == 'string' &&
    typeof standing.id == 'string' && typeof standing.exp == 'number'
  ) return { standing }
  return null
}

/**
 * The person a standing link still names, or null: expired, revoked, or minted
 * where nothing could ever take it back.
 */
export let whose = async (
  standing: Standing,
  book: Links | null,
  now = Date.now(),
): Promise<string | null> =>
  book && standing.exp * 1000 > now &&
    await book.held(standing.person, standing.id)
    ? standing.person
    : null

/**
 * Taking one back, by its id or by enough of the front of one to find it — the
 * minter reads the id off the answer that minted the link, and a prefix is
 * what somebody types. Answers the ids that went, so a caller that named a
 * prefix matching nothing is told rather than reassured.
 */
export let revoke = async (
  book: Links,
  person: string,
  said: string,
): Promise<string[]> => {
  let gone = (await book.ids(person)).filter((id) => id.startsWith(said))
  for (let id of gone) await book.drop(person, id)
  return gone
}
