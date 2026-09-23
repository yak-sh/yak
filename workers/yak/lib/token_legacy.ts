// The tokens sealed before 2c05d0f6, read for their own use and no other: a
// migration, deleted after its last token dies (T-37927).
//
// Until 2c05d0f6 every token was sealed under the raw secret with no use, so
// the mac alone cannot say what an old token is for. Its claims can: every
// kind had its own exact shape, and `oldUse` answers the one use whose shape a
// value matches, or null when it matches none or more than one. token.ts
// `open` accepts an old token only for that use, so a grant or a visitor's
// token never became a session under the new keys either (T-37873).
//
// The code that minted them last served at 2026-09-22T19:43:31Z; CUT is that
// moment rounded up. The longest life any old kind could carry is a 365-day
// standing link, so the last old token dies at 2027-09-22T20:00:00Z. After
// that date this file and its one call in token.ts go (T-37927).
//
// The one pair of kinds with the same key set is a session and an erase
// ticket (`person`, `space`, `exp`, the ticket maybe with `forever`). They
// part on the unit of `exp`: a session's is a unix second, the old ticket's a
// millisecond, and each kind's `exp` is bounded by CUT plus its own life, so
// no number is both.
import type { Use } from './token.ts'

export let CUT = Date.parse('2026-09-22T20:00:00Z') / 1000
let DAY = 86_400

type Obj = Record<string, unknown>

// Exactly these keys: every one of `need`, and nothing but `need` and `may`.
let only = (v: unknown, need: string[], may: string[] = []): v is Obj =>
  !!v && typeof v == 'object' && !Array.isArray(v) &&
  need.every((k) => k in v) &&
  Object.keys(v).every((k) => need.includes(k) || may.includes(k))

let str = (v: unknown) => typeof v == 'string'
let orNull = (v: unknown) => v === null || str(v)
// An expiry in unix seconds, minted before CUT with at most `life` to run.
let sec = (life: number) => (v: unknown) =>
  Number.isInteger(v) && (v as number) <= CUT + life
// The same in milliseconds, which no second-valued expiry reaches.
let ms = (life: number) => (v: unknown) =>
  Number.isInteger(v) && (v as number) > 1e12 &&
  (v as number) <= (CUT + life) * 1000

// Each kind's old claims, read off 2c05d0f6^ at every minting site.
let OLD: Partial<Record<Use, (v: unknown) => boolean>> = {
  // session.ts `minted`: {person, space, exp}, ninety days.
  session: (v) =>
    only(v, ['person', 'space', 'exp']) && str(v.person) &&
    orNull(v.space) && sec(90 * DAY)(v.exp),
  // dispatch.ts `granting`: {store, person, role, exp}, one minute.
  visit: (v) =>
    only(v, ['store', 'person', 'role', 'exp']) && str(v.store) &&
    orNull(v.person) && orNull(v.role) && sec(60)(v.exp),
  // grants.ts `mint`: {id, person, space, exp}, at most a day. The `yaks_`
  // prefix rides outside the seal.
  grant: (v) =>
    only(v, ['id', 'person', 'space', 'exp']) && str(v.id) &&
    str(v.person) && orNull(v.space) && sec(DAY)(v.exp),
  // link.ts: {once: {email, code, q?, back?}}, spent against its code, or
  // {standing: {id, person, exp}}, at most a year and only while its row is
  // on the ledger (link.ts `whose`).
  link: (v) =>
    (only(v, ['once']) && only(v.once, ['email', 'code'], ['q', 'back']) &&
      Object.values(v.once).every(str)) ||
    (only(v, ['standing']) && only(v.standing, ['id', 'person', 'exp']) &&
      str(v.standing.id) && str(v.standing.person) &&
      sec(365 * DAY)(v.standing.exp)),
  // handoff.ts `handoffTo`: {person, host, jti, exp}, one minute.
  handoff: (v) =>
    only(v, ['person', 'host', 'jti', 'exp']) && str(v.person) &&
    str(v.host) && str(v.jti) && sec(60)(v.exp),
  // erase.ts `ticket`: {space, person, exp in ms, forever?: true}, an hour.
  erase: (v) =>
    only(v, ['space', 'person', 'exp'], ['forever']) && str(v.space) &&
    str(v.person) && ms(3600)(v.exp) &&
    (!('forever' in v) || v.forever === true),
  // gallery.ts `ticket`: {app, list, exp in ms}, a week; still in ms today.
  review: (v) =>
    only(v, ['app', 'list', 'exp']) && str(v.app) &&
    typeof v.list == 'boolean' && ms(7 * DAY)(v.exp),
  // consent had no token before 2c05d0f6.
}

/** The one use an old token's claims belong to, or null for none or several. */
export let oldUse = (v: unknown): Use | null => {
  let uses = (Object.keys(OLD) as Use[]).filter((u) => OLD[u]!(v))
  return uses.length == 1 ? uses[0] : null
}

/** An old value in the shape its use reads today: the erase ticket's expiry
 * became a unix second in 2c05d0f6; every other kind reads as it was. */
export let today = (use: Use, v: Obj): Obj =>
  use == 'erase' ? { ...v, exp: Math.floor((v.exp as number) / 1000) } : v
