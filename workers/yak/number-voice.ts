// The directory's owner seats are the authority for softphone sign-ins.
// The carrier keeps the passwords. Only the signed-in reveal page reads them.
import { type Bundle, token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import type { Login, Voice, Ways } from '@yaks/phone'
import { type Built, line as q } from '@yaks/query'
import { left } from '@yaks/platform/meter'
import { caught } from './defects.ts'
import {
  idOf,
  type PhoneLine,
  type Row,
  type Space,
  stamp,
} from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { spaceNow } from './model-spend.ts'
import { phoneNamed } from './phones.ts'

export let ownerSeats = (space: string) =>
  q`.member.space=${space}&.member.role=owner&?created&.order=created.at`

export let legacySeat = (rows: Bundle[]) => rows[0]?.entity.eid ?? ''

export let voiceOf = (trashed: boolean, space: Space, now: Date): Ways => {
  let open = !trashed && !space.trashed
  return { in: open, out: open && left(space, now) > 0 }
}

let read = (env: Env, query: Built) => meta(env).query(query, { live: true })

type Line = Pick<PhoneLine, 'eid' | 'number' | 'space' | 'via'>

// The carrier may accept createSubAccount after timing out and accepts
// duplicate usernames. Let its prior submission become visible first.
let SIP_WAIT = 120_000

let loginRows = (env: Env, eid: string) =>
  read(env, q`.phone_login.line=${eid}`)

export let claimVoice = (env: Env, line: string) => async (seat: string) => {
  let eid = derivedEid(`phone-login|${line}|${seat}`)
  let [[row], [member], [held]] = await Promise.all([
    read(env, q`.entity.eid=${eid}&?phone_login`),
    read(env, q`.entity.eid=${seat}&.member.role=owner`),
    read(env, q`.entity.eid=${line}&.phone_line&!phone_line.returned&!trashed`),
  ])
  let space = (held?.phone_line as Row['phone_line'])?.space
  let inSpace = (member?.member as Row['member'])?.space
  if (!space || !inSpace || idOf(space) != idOf(inSpace)) return false
  let attempted = (row?.phone_login as { attempted?: string } | undefined)
    ?.attempted
  let now = env.CLOCK?.now() ?? Date.now()
  if (attempted && now - Date.parse(attempted) < SIP_WAIT) return false
  try {
    await stamp(env, {
      entities: [{
        entity: { eid },
        $was: { phone_login: { attempted: token(attempted ?? null) } },
        phone_login: { line, seat, attempted: new Date(now).toISOString() },
      }],
    })
    return true
  } catch (error) {
    if (error instanceof Stale) return false
    throw error
  }
}

let policy = async (env: Env, line: Line, ways: Ways): Promise<Voice> => {
  let [owners, [held], requested] = await Promise.all([
    read(env, ownerSeats(line.space)),
    read(env, q`.entity.eid=${line.eid}&?phone_line&?trashed`),
    loginRows(env, line.eid),
  ])
  let row = held?.phone_line as Row['phone_line']
  if (!row || row.ordering || row.returned || held.trashed) {
    ways = { in: false, out: false }
  }
  return {
    ...ways,
    seats: owners.map((r) => r.entity.eid),
    requested: requested.map((r) =>
      idOf((r.phone_login as { seat: string }).seat)
    ),
    legacy: row?.legacy_seat ?? legacySeat(owners),
  }
}

export let syncVoice = async (
  env: Env,
  line: Line,
  ways: Ways,
  revoked?: string[],
) => {
  let allow = (await phoneNamed(env, line.via))?.numbers?.().allow
  if (!allow) return
  await allow(
    line.number,
    { ...await policy(env, line, ways), revoked },
    claimVoice(env, line.eid),
  )
}

let seatOf = async (env: Env, space: string, person: string) => {
  let [row] = await read(
    env,
    q`.member.space=${space}&.member.person=${person}&.member.role=owner`,
  )
  return row?.entity.eid
}

let sameVoice = (a: Voice, b: Voice) =>
  a.in == b.in && a.out == b.out && a.legacy == b.legacy &&
  a.seats.toSorted().join() == b.seats.toSorted().join() &&
  a.requested?.toSorted().join() == b.requested?.toSorted().join()

export let revealVoice = async (
  env: Env,
  line: PhoneLine,
  person: string,
): Promise<Login | null> => {
  let login = (await phoneNamed(env, line.via))?.numbers?.().login
  if (!line.voice || !login) return null
  let ways = async () =>
    voiceOf(false, await spaceNow(env, line.space), new Date())
  let voice = await policy(env, line, await ways())
  let seat = await seatOf(env, line.space, person)
  if (!seat || !voice.in || !voice.seats.includes(seat)) return null
  await boundLegacy(env, line, voice)
  let eid = derivedEid(`phone-login|${line.eid}|${seat}`)
  await stamp(env, {
    entities: [{
      entity: { eid },
      phone_login: { line: line.eid, seat },
    }],
  })
  let current = async () => await policy(env, line, await ways())
  let canReveal = (v: Voice) =>
    v.in && v.seats.includes(seat) && v.requested?.includes(seat)
  voice = await current()
  if (!canReveal(voice)) return null
  let latest = voice
  let signed: Login
  try {
    signed = await login(line.number, seat, voice, claimVoice(env, line.eid))
  } finally {
    // A seat or line can be taken away while the carrier is answering.
    latest = await current()
    if (!sameVoice(voice, latest)) await syncVoice(env, line, latest)
  }
  return canReveal(latest) ? signed : null
}

let boundLegacy = async (env: Env, line: PhoneLine, voice: Voice) => {
  if (line.legacySeat != null || !voice.legacy) return
  try {
    await stamp(env, {
      entities: [{
        entity: { eid: line.eid },
        phone_line: { legacy_seat: voice.legacy },
        $was: { phone_line: { legacy_seat: null } },
      }],
    })
  } catch (error) {
    let [held] = await read(env, q`.entity.eid=${line.eid}&?phone_line`)
    if ((held?.phone_line as Row['phone_line'])?.legacy_seat != voice.legacy) {
      throw error
    }
  }
}

/** Apply an owner departure to every line in that space. The hourly meter
 * also converges any provider call that could not finish here. */
export let ownersLeft = async (env: Env, space: string, seats: string[]) => {
  let rows = await read(
    env,
    q`.phone_line.space=${space}&!phone_line.returned&?trashed`,
  )
  if (!rows.length) return
  let home = await spaceNow(env, space)
  for (let row of rows) {
    let l = row.phone_line as Row['phone_line']
    if (!l) continue
    await syncVoice(
      env,
      { ...l, eid: row.entity.eid, space: idOf(l.space) },
      voiceOf(!!row.trashed, home, new Date()),
      seats,
    ).catch((e) => caught(e, { request: 'revoke softphone sign-in', space }))
  }
}
