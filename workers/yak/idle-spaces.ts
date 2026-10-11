// Test-space eligibility, from existing directory records. Readings are
// monthly totals, not event times: a positive reading conservatively counts
// as use at its reading time. Missing provenance cannot prove inactivity.
import { isTestAddress } from './lib/bots.ts'
import type { Meter } from './directory.ts'

export let PROTECTED = new Set([
  'yak',
  'admin',
  'yourname',
  'claude-review',
  'claude-review-2',
  'chata',
  'chatb',
])
export let IDLE = 7 * 86_400_000

type Ref = string | { eid: string }
export type Row = {
  entity: { eid: string }
  space?: { slug: string }
  app?: { space: Ref }
  member?: { space: Ref; person: Ref }
  grant?: { app: Ref; person: Ref }
  invite?: { to: Ref }
  hostname?: { serves: Ref }
  email?: { address: string }
  published?: unknown
  created?: { at?: string }
  updated?: { at?: string }
  meter?: Partial<Meter>
}
let id = (ref: Ref) => typeof ref == 'string' ? ref : ref.eid
let counts: (keyof Meter)[] = [
  'requests',
  'ws_messages',
  'ws_hibernated',
  'rows_read',
  'rows_written',
  'emails',
  'builds',
  'models',
  'realtime',
  'seconds',
]
let quiet = (row: Row, cutoff: number) => {
  let at = row.updated?.at ?? row.created?.at ?? ''
  if (!(Date.parse(at) <= cutoff)) return false
  if (row.meter && counts.some((key) => Number(row.meter![key] ?? 0) > 0)) {
    if (!(Date.parse(row.meter.at ?? '') <= cutoff)) return false
  }
  return true
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

export let CENSUS =
  '(.space | .app | .member | .grant | .invite | .hostname | .email)' +
  ' ?created ?updated ?meter ?published'
