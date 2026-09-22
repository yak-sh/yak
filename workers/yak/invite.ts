// An invitation (T-37880): a seat in a space, or a grant on one app, offered
// by letter and taken with one click. Until it is taken it is an `invite` row
// and nothing else (vocab.ts), so the space is not in the invited person's
// reach: no listing, no bare app slug, no instructions carry a word of it. An
// invitation used to be the seat itself, which let anybody put their space
// into a stranger's agent by naming the stranger's address.
//
// The letter carries a link sealed under the session secret (src/token.ts)
// naming the invitation, and the click is accepted only from a browser signed
// in as the person it names. Both halves matter: the seal keeps the link out of
// the inviter's hands, since only the letter ever holds it, so a page of theirs
// cannot accept on the invitee's behalf; the session keeps a forwarded letter
// from seating whoever opened it. Somebody not signed in is asked to sign in
// with the invited address, and the code letter brings them back here.
//
// Owner, 2026-09-22: "oh yes, one-click to accept invite is good".
import { opened, seal } from '../../src/token.ts'
import {
  type App,
  type Directory,
  type Role,
  type Space,
  url,
} from './directory.ts'
import { reachChanged } from './declared.ts'
import type { Env } from './env.ts'
import { type Host, spaceHost, url as hostUrl } from './host.ts'
import { closed, invited, lost } from './pages.ts'
import { refuse } from './tool.ts'

/** Where an invitation is accepted, on the platform's own host. */
export let INVITE = '/invite'

/** Invitations one person may send in an hour. Enough to bring a whole team
 * or a class in at once, few enough that a loop aimed at strangers stops
 * within the hour; the space's monthly letters bound the rest. */
export let CAP = 50

/** The subject every invitation goes out under: fixed words, since a subject
 * is what a stranger reads before deciding anything, and a name or a title in
 * it would be the inviter's words in the platform's voice. */
export let SUBJECT = 'You have an invitation on yaks.app'

/// hourOf(new Date('2026-09-22T15:04:05Z')) -> '2026-09-22T15'
export let hourOf = (at: Date) => at.toISOString().slice(0, 13)

/**
 * The inviter's count with this invitation on it, or the refusal at the cap.
 * A new hour starts from nothing.
 */
export let paced = (
  held: { hour?: string | null; sent?: number | null } | null,
  now = new Date(),
) => {
  let hour = hourOf(now)
  let sent = held?.hour == hour ? held.sent ?? 0 : 0
  if (sent >= CAP) {
    throw refuse(
      'limit',
      `you have sent ${CAP} invitations this hour, which is the most an ` +
        'hour allows; the next can go out at the top of the hour',
    )
  }
  return { hour, sent: sent + 1 }
}

type Sealed = { invite: string; to: string }

/** The letter's one click. `to` rides in the seal beside the invitation, so
 * a second click after accepting still knows where to send them. */
export let acceptLink = async (
  secret: string | undefined,
  sealed: Sealed,
  env: Host,
) => {
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return hostUrl(env, INVITE) + '?t=' +
    encodeURIComponent(await seal('invite', { sealed }, secret))
}

let unsealed = async (t: string, secret: string): Promise<Sealed | null> => {
  let v = t
    ? await opened<{ sealed?: Partial<Sealed> }>(
      'invite',
      t,
      secret,
    )
    : null
  let s = v?.sealed
  return typeof s?.invite == 'string' && typeof s.to == 'string'
    ? { invite: s.invite, to: s.to }
    : null
}

/** What an invitation is to: one app of a space, or the space. */
export type Place = { space: Space; app: App | null }

export let placeOf = async (
  dir: Directory,
  to: string,
): Promise<Place | null> => {
  let at = await dir.appAt(to)
  if (at) return at
  let space = await dir.at(to)
  return space ? { space, app: null } : null
}

/** Where accepting lands them: the app, or the space's own address. */
export let linkOf = (place: Place, env: Host) =>
  place.app
    ? url(place.space, place.app, env)
    : `https://${spaceHost(env, place.space.slug)}/`

/**
 * Taking it: the invitation goes and the seat or grant it offered is written,
 * in one batch. One already held (a seat taken some other way since) is
 * re-roled rather than doubled.
 */
export let accept = async (
  dir: Directory,
  invite: { eid: string; person: string; role: Role },
  place: Place,
) => {
  let { person, role } = invite
  let held = place.app
    ? await dir.grant(place.app, person)
    : await dir.member(place.space, person)
  await dir.apply({
    entities: [
      { entity: { eid: invite.eid }, tombstone: {} },
      place.app
        ? held ? { entity: { eid: held.eid }, grant: { access: role } } : {
          entity: { eid: crypto.randomUUID() },
          grant: { app: place.app.eid, person, access: role },
        }
        : held
        ? { entity: { eid: held.eid }, member: { role } }
        : {
          entity: { eid: crypto.randomUUID() },
          member: { space: place.space.eid, person, role },
        },
    ],
  }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
}

/**
 * The click (`GET /invite?t=`), for whoever is signed in on this browser, or
 * nobody. A mail scanner that fetches every link in a letter has no session,
 * so it is shown the sign-in page and accepts nothing.
 */
export let door = async (
  req: Request,
  env: Env,
  dir: Directory,
  person: string | null,
  secret: string,
): Promise<Response> => {
  let t = new URL(req.url).searchParams.get('t') ?? ''
  let sealed = await unsealed(t, secret)
  if (!sealed) return lost(env)
  let [invite, place] = await Promise.all([
    dir.invitation(sealed.invite),
    placeOf(dir, sealed.to),
  ])
  if (!place || (invite && invite.to != sealed.to)) return closed(env)
  let link = linkOf(place, env)
  let there = () => Response.redirect(link, 303)
  if (!invite) {
    // Accepted already, or withdrawn. Whoever holds it now is sent there, so
    // the letter's link keeps working after its first click.
    let holds = person &&
      (place.app
        ? await dir.grant(place.app, person)
        : await dir.member(place.space, person))
    return holds ? there() : closed(env)
  }
  if (person != invite.person) {
    let email = await dir.emailAt(invite.person)
    if (!email) return closed(env)
    return invited(
      email,
      `${hostUrl(env, INVITE)}?t=${encodeURIComponent(t)}`,
      env,
    )
  }
  await accept(dir, invite, place)
  // A seat is a deploy from where they stand: every view the space's apps
  // declare just came into their reach (declared.ts, T-33004). A grant is a
  // page they open, not a store their agent lists.
  if (!place.app && (await dir.apps(place.space)).length) {
    await reachChanged(env, person)
  }
  return there()
}
