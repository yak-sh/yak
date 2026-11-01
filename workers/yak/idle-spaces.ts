// Test-space eligibility, from directory evidence of use. Lifecycle stamps
// and monthly bills describe platform work too; neither is a use clock.
// Creation gives a new record its grace period, and used survives bookkeeping.
import { isTestAddress } from './lib/bots.ts'

export let PROTECTED = new Set([
  'yak',
  'admin',
  'yourname',
  'claude-review',
  'claude-review-2',
  'grok-review',
  'grok-review-2',
  'chata',
  'chatb',
])
export let IDLE = 7 * 86_400_000

type Ref = string | { eid: string }
export type Row = {
  entity: { eid: string }
  space?: { slug: string }
  app?: { space: Ref }
  member?: { space: Ref; person: Ref; role?: string }
  grant?: { app: Ref; person: Ref }
  invite?: { to: Ref }
  hostname?: { serves: Ref }
  email?: { address: string }
  published?: unknown
  created?: { at?: string; by?: Ref | null; via?: string | null }
  used?: { at?: string }
  written?: { at?: string | null; by?: Ref | null }
  signed_in?: { at?: string }
}
let id = (ref: Ref) => typeof ref == 'string' ? ref : ref.eid
let quiet = (row: Row, cutoff: number) => {
  let at = row.written?.at ?? row.created?.at ?? ''
  if (!(Date.parse(at) <= cutoff)) return false
  return !row.used || Date.parse(row.used.at ?? '') <= cutoff
}

export let inactive = (rows: Row[], now = Date.now()) =>
  rows.every((row) => quiet(row, now - IDLE))

// This selection is shared by the scheduled sweep and its read-only preview.
export let idleSpaces = (rows: Row[], now = Date.now()): string[] => {
  let emails = new Map(
    rows.filter((r) => r.email).map((r) => [
      r.entity.eid,
      r.email!.address,
    ]),
  )
  let test = (person: Ref) => isTestAddress(emails.get(id(person)) ?? '')
  return rows.filter((space) => {
    if (!space.space || PROTECTED.has(space.space.slug)) return false
    let eid = space.entity.eid
    let apps = rows.filter((r) => r.app && id(r.app.space) == eid)
    if (apps.some((r) => r.published != null)) return false
    let appIds = new Set(apps.map((r) => r.entity.eid))
    let members = rows.filter((r) => r.member && id(r.member.space) == eid)
    if (!members.length || !members.every((r) => test(r.member!.person))) {
      return false
    }
    let related = rows.filter((r) =>
      (r.grant && appIds.has(id(r.grant.app))) ||
      (r.invite && (id(r.invite.to) == eid || appIds.has(id(r.invite.to)))) ||
      (r.hostname && appIds.has(id(r.hostname.serves)))
    )
    if (related.some((r) => r.grant && !test(r.grant.person))) return false
    return inactive([space, ...apps, ...members, ...related], now)
  }).map((r) => r.entity.eid)
}

// A test account that may go: the reviewers' fixtures keep theirs, each named
// for the space it holds. A new reviewer account goes in PROTECTED before its
// link is handed over: a directory may not look for months.
export let expendable = (address: string) =>
  isTestAddress(address) && !PROTECTED.has(address.split('@')[0])

// Idle test accounts, once the sweep has had their spaces. A space of only test
// accounts that still stands (in use, published) keeps everyone seated in it;
// a seat in anyone else's space goes with the account.
export let idleAccounts = (rows: Row[], now = Date.now()): string[] => {
  let emails = new Map(
    rows.filter((r) => r.email).map((r) => [r.entity.eid, r.email!.address]),
  )
  let test = (person: Ref) => isTestAddress(emails.get(id(person)) ?? '')
  let seats = rows.filter((r) => r.member)
  let kept = new Set(
    rows.filter((r) => r.space && !PROTECTED.has(r.space.slug)).map((r) =>
      r.entity.eid
    ).filter((eid) => {
      let seated = seats.filter((r) => id(r.member!.space) == eid)
      return seated.every((r) => test(r.member!.person))
    }),
  )
  return rows.filter((r) =>
    r.email && expendable(r.email.address) &&
    quiet(r, now - IDLE) &&
    !(Date.parse(r.signed_in?.at ?? '') > now - IDLE) &&
    !seats.some((s) =>
      id(s.member!.person) == r.entity.eid && kept.has(id(s.member!.space))
    )
  ).map((r) => r.entity.eid)
}

export let CENSUS =
  '(.space | .app | .member | .grant | .invite | .hostname | .email)' +
  ' ?created ?used ?published ?signed_in'
