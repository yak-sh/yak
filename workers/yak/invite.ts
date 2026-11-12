// An invitation (T-37880): a seat in a space, or a grant on one app, offered
// by letter and taken with one click. Until it is taken it is an `invite` row
// and nothing else (vocab.ts), so the space is not in the invited person's
// reach: no listing, no bare app slug, no instructions carry a word of it. An
// invitation used to be the seat itself, which let anybody put their space
// into a stranger's agent by naming the stranger's address.
//
// The letter carries a link sealed under the session secret (lib/token.ts)
// naming the invitation. The seal keeps the link out of the inviter's hands,
// since only the letter ever holds it, so a page of theirs cannot accept on
// the invitee's behalf. And only the invited address receives the letter, so
// following its link proves that address the way a sign-in letter's link does
// (link.ts, T-162634): for `DAYS` after it went, the link signs its holder in
// as the person it names, creating their account if they are new, and accepts.
// A browser already signed in as them accepts on opening it; anybody else is
// shown one button, and the press does both (identity.ts `POST /invite`), so
// a mail scanner fetching every link accepts nothing. A browser signed in as
// somebody else is asked which account, never switched on opening. Past its
// days, or from a letter sealed before they existed, the link only accepts,
// and someone not signed in as the invited address is asked to sign in with
// it by code, which brings them back here.
//
// Owner, 2026-09-22: "oh yes, one-click to accept invite is good".
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { mode, reads } from '@yaks/member'
import { opened, seal } from './lib/token.ts'
import {
  type App,
  type Directory,
  type Role,
  type Space,
  stamp,
  url,
} from './directory.ts'
import { reachChanged } from './declared.ts'
import { caught } from './defects.ts'
import type { Env } from './env.ts'
import { type Host, spaceHost, url as hostUrl } from './host.ts'
import { type Mail, mail } from './mail.ts'
import { closed, lost, sentence } from './pages.ts'
import { invited } from './signin-pages.ts'
import { INVITE } from '@yaks/platform/names'
import { refuse } from './tool.ts'
import { CallError } from '@yaks/tools/errors'
import { tell } from './operator-updates.ts'

/** Invitations one person may send in an hour. Enough to bring a whole team
 * or a class in at once, few enough that a loop aimed at strangers stops
 * within the hour. It is the only bound: an invitation never spends the
 * space's monthly emails, because the people an app is for are never metered
 * (D-131886, T-131892). */
export let CAP = 50

/** The subject every invitation goes out under: fixed words, since a subject
 * is what a stranger reads before deciding anything, and a name or a title in
 * it would be the inviter's words in the platform's voice. */
export let SUBJECT = 'You have an invitation on yaks.app'

/** Days a letter's link signs its person in for. A sign-in letter's lasts ten
 * minutes because it was asked for that minute; an invitation arrives
 * unasked and is read when its person gets to it. Past them, the link still
 * accepts for a browser signed in as them, and another letter starts the days
 * again. */
export let DAYS = 7

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

/**
 * What stops one more invitation going out from this person: their hour. It
 * is read and nothing is written: the answer is the inviter's hour with this
 * invitation counted on it, for the caller to write beside the invitation, so
 * a refused invitation writes and mails nothing at all (T-32963).
 */
export let room = async (dir: Directory, person: string): Promise<Bundle> => ({
  entity: { eid: person },
  inviting: paced(await dir.inviting(person)),
})

/** {@link room}, and the invitation counted on the inviter's hour. */
export let allowed = async (env: Env, dir: Directory, person: string) => {
  await stamp(env, { entities: [await room(dir, person)] })
}

/** The article a role takes: an editor, an owner, a viewer. */
export let an = (role: Role) => role == 'viewer' ? 'a' : 'an'

/**
 * What member_add tells the inviter once the invitation stands. Asked again
 * for somebody who never accepted, that is the news when they say they cannot
 * get in, so the answer says so first.
 */
export let invitedWords = (o: {
  email: string
  role: Role
  place: Place
  /** the invitation was already there, and another letter goes */
  standing: boolean
  note?: string
}) => {
  let { space, app } = o.place
  return `${o.email} ${
    o.standing ? 'had not accepted yet, and stays' : 'is'
  } invited as ${an(o.role)} ${o.role} of ` +
    (app
      ? `${space.slug}/${app.slug} and nothing else in ${space.slug}`
      : space.slug) +
    ` — ${o.standing ? 'another letter' : 'the invitation'}${
      o.note ? ' and your note are' : ' is'
    } on its way to them. It is theirs once they accept it from ` +
    `the letter, whose link also signs them in; until then nothing ` +
    `of ${space.slug} is in their reach, and member_remove withdraws it`
}

// Their words, marked as theirs: quoted the way a letter quotes, so a reader
// can tell what the person wrote from what the platform did.
let quoted = (said: string) =>
  said.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')

/**
 * The letter for an invitation standing: the first, or another for somebody
 * who has not accepted yet. It goes from the platform's own sender, the one
 * the sign-in code rides (mail.ts), under fixed words; what the inviter chose
 * (their name, the app's title, their note) is in the body, marked as theirs.
 * It names what it opens with the address it opens at, and who invited them
 * by name, since an address is what a letter is sent to and never what a
 * person is called (T-32654). Once it goes it counts on the space's month and
 * stamps the invitation `sent`, which is what its inviter reads back
 * (people.ts), and `by`, which is who its link says invited them (`door`).
 * True when it went; a failure to send is reported and answered as false, for
 * the caller to say.
 */
export let send = async (
  env: Env,
  dir: Directory,
  o: {
    invite: string
    place: Place
    email: string
    role: Role
    /** who is inviting them, by person */
    by: string
    /** what to call them, where the inviter said */
    name?: string
    note?: string
  },
  post: Mail = mail(env),
): Promise<boolean> => {
  let { space, app } = o.place
  let host = spaceHost(env, space.slug)
  let what = app
    ? `${app.title} (${host}/${app.slug})`
    : `${space.title} (${host})`
  let by = await dir.nameAt(o.by)
  let accept = await acceptLink(env.SESSION_SECRET, {
    invite: o.invite,
    to: app ? app.eid : space.eid,
  }, env)
  let sent = await post({
    to: o.email,
    subject: SUBJECT,
    body: (o.name ? `Hi ${o.name},\n\n` : '') +
      // Their words first, and marked as theirs, so a reader never takes the
      // platform to be saying them (T-32963).
      (o.note ? `${by ?? 'They'} wrote:\n\n${quoted(o.note)}\n\n` : '') +
      `${by ?? 'Someone'} invited you to ` +
      `${o.role == 'viewer' ? 'see' : 'use'} ${what}. ` +
      `Accept with one click:\n\n` +
      `${accept}\n\n` +
      `The link signs you in as ${o.email} for the next ${DAYS} days. ` +
      'There is nothing to install and no account to make first. Until ' +
      'you accept, nothing of theirs is shared with you, and if you did ' +
      'not expect this you can ignore it.',
  }).then(() => true).catch((e) => {
    caught(e, { invite: o.invite, space: space.slug })
    return false
  })
  if (!sent) return false
  // On the invitation still standing: one withdrawn or accepted while its
  // letter went stays gone, rather than coming back as a row that names
  // nobody and nothing (`$was`, @yaks/graph guard.ts).
  await stamp(env, {
    entities: [{
      entity: { eid: o.invite },
      invite: { sent: new Date().toISOString(), by: o.by },
      $was: { invite: { to: token(app ? app.eid : space.eid) } },
    }],
  })
  return true
}

/** What the link seals: the invitation, where it is to, and the unix second
 * it stops signing anyone in. A letter sealed before T-162634 has no `exp`
 * and only accepts. */
type Sealed = { invite: string; to: string; exp?: number }

/** The letter's one click. `to` rides in the seal beside the invitation, so
 * a second click after accepting still knows where to send them. */
export let acceptLink = async (
  secret: string | undefined,
  sealed: Sealed,
  env: Host,
  now = Date.now(),
) => {
  if (!secret) throw new Error('SESSION_SECRET is not set')
  let exp = sealed.exp ?? Math.floor(now / 1000) + DAYS * 86_400
  return hostUrl(env, INVITE) + '?t=' +
    encodeURIComponent(
      await seal('invite', { sealed: { ...sealed, exp } }, secret),
    )
}

/** What a letter's link says, or null for anything but one sealed under this
 * secret. */
export let unsealed = async (
  t: string,
  secret: string,
): Promise<Sealed | null> => {
  let v = t
    ? await opened<{ sealed?: Partial<Sealed> }>(
      'invite',
      t,
      secret,
    )
    : null
  let s = v?.sealed
  return typeof s?.invite == 'string' && typeof s.to == 'string'
    ? {
      invite: s.invite,
      to: s.to,
      ...typeof s.exp == 'number' ? { exp: s.exp } : {},
    }
    : null
}

// Whether a link still signs its person in at `now`.
let signs = (s: Sealed, now = Date.now()) => !!s.exp && s.exp * 1000 > now

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

// Another letter for an invitation to this space or one of its apps, from the
// owner pressing the button: nothing when it went, else what to say. An
// invitation that is gone (accepted or withdrawn since the page was drawn)
// or is somebody else's space's says so and sends nothing.
export let again = async (
  env: Env,
  dir: Directory,
  space: Space,
  who: { person: string },
  eid: string,
  post?: Mail,
): Promise<{ say: string; no: boolean } | null> => {
  let invite = await dir.invitation(eid)
  let place = invite && await placeOf(dir, invite.to)
  if (!invite || place?.space.eid != space.eid) {
    return { say: 'That invitation is no longer waiting.', no: true }
  }
  let email = await dir.emailAt(invite.person)
  if (!email) return { say: 'That invitation is no longer waiting.', no: true }
  try {
    await allowed(env, dir, who.person)
  } catch (e) {
    if (e instanceof CallError) return { say: sentence(e.message), no: true }
    throw e
  }
  let sent = await send(env, dir, {
    invite: invite.eid,
    place: place!,
    email,
    role: invite.role,
    by: who.person,
  }, post)
  return sent ? null : {
    say: "The letter couldn't be sent just now. Try again in a minute.",
    no: true,
  }
}

/** Where accepting lands them: the app, or the space's own address. */
export let linkOf = (place: Place, env: Host) =>
  place.app
    ? url(place.space, place.app, env)
    : `https://${spaceHost(env, place.space.slug)}/`

/**
 * The seat or grant `person` holds at `role` in `place`, as the bundle that
 * writes it: one already held (taken some other way since) is re-roled rather
 * than doubled. Accepting an invitation writes it, and so does joining an app
 * that lists the person (join.ts).
 */
export let holding = async (
  dir: Directory,
  place: Place,
  person: string,
  role: Role,
): Promise<Bundle> => {
  let held = place.app
    ? await dir.grant(place.app, person)
    : await dir.member(place.space, person)
  return place.app
    ? held ? { entity: { eid: held.eid }, grant: { access: role } } : {
      entity: { eid: crypto.randomUUID() },
      grant: { app: place.app.eid, person, access: role },
    }
    : held
    ? { entity: { eid: held.eid }, member: { role } }
    : {
      entity: { eid: crypto.randomUUID() },
      member: { space: place.space.eid, person, role },
    }
}

/**
 * Taking it: the invitation goes and the seat or grant it offered is written,
 * in one batch.
 */
export let accept = async (
  dir: Directory,
  invite: { eid: string; person: string; role: Role },
  place: Place,
) => {
  let { person, role } = invite
  await dir.apply({
    entities: [
      { entity: { eid: invite.eid }, tombstone: {} },
      await holding(dir, place, person, role),
    ],
  }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
}

// Taking it, and what follows: the invitation accepted, its people told who
// joined, and a seat's views put in reach.
let seated = async (
  env: Env,
  dir: Directory,
  invite: { eid: string; person: string; role: Role },
  place: Place,
  notify: typeof tell,
) => {
  let { person } = invite
  await accept(dir, invite, place)
  // Its people hear who joined, in their Updates; the joiner knows.
  let { space, app } = place
  await notify(env, space, {
    to: space.eid,
    words: `${await dir.nameAt(person) ?? 'Someone'} joined ${
      app ? app.title || app.slug : space.title || space.slug
    }.`,
    about: app?.eid ?? space.eid,
    by: person,
    id: invite.eid,
  })
  // A seat is a deploy from where they stand: every view the space's apps
  // declare just came into their reach (declared.ts, T-33004). A grant is a
  // page they open, not a store their agent lists.
  if (!place.app && (await dir.apps(place.space)).length) {
    await reachChanged(env, person)
  }
}

/**
 * The click (`GET /invite?t=`), for whoever is signed in on this browser, or
 * nobody. A browser signed in as the invited person accepts and goes there.
 * Anybody else is shown what the letter said and nothing more, since only
 * the letter carries the link and whoever holds it has read the letter, or a
 * forward of it: who invited them, by name, to see or use which app (or
 * space) at which address, and the address it went to. The note stays in the
 * letter, and nothing inside the app or the space (its own icon when it is
 * private, its other apps, who else is in it) reaches anyone before they are
 * in. With it comes the one button that signs in as that address and
 * accepts (`taken`), or, past the link's days, the way to sign in by code.
 * A mail scanner that fetches every link in a letter has no session, so it
 * is shown that page and accepts nothing.
 */
export let door = async (
  t: string,
  env: Env,
  dir: Directory,
  person: string | null,
  secret: string,
  notify = tell,
): Promise<Response> => {
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
  if (person == invite.person) {
    await seated(env, dir, invite, place, notify)
    return there()
  }
  let [email, by, as] = await Promise.all([
    dir.emailAt(invite.person),
    invite.by ? dir.nameAt(invite.by) : null,
    person ? addressOf(dir, person) : null,
  ])
  if (!email) return closed(env)
  let { space, app } = place
  return invited({
    email,
    t,
    signs: signs(sealed),
    as,
    back: `${hostUrl(env, INVITE)}?t=${encodeURIComponent(t)}`,
    by,
    see: invite.role == 'viewer',
    space: { slug: space.slug, title: space.title },
    app: app && {
      eid: app.eid,
      slug: app.slug,
      title: app.title,
      // Its own picture only where a visitor may already see it: the page
      // is for somebody not yet in.
      open: reads(mode(app.access), null),
    },
  }, env)
}

// The address a signed-in person goes by, to say whom the browser is signed
// in as; nothing for a newcomer, who has none and is nobody else.
let addressOf = async (dir: Directory, person: string) =>
  await dir.emailAt(person) ?? await dir.phoneAt(person)

/**
 * The press (`POST /invite`): the invitation accepted for the person it
 * names, who the letter's link proved, and that person and where to land
 * them, for the sign-in door to sign them in and send them there
 * (identity.ts). Null when the link no longer signs anyone in: past its
 * days, sealed before it could, or for an invitation accepted or withdrawn
 * since, which is what makes it work once.
 */
export let taken = async (
  t: string,
  env: Env,
  dir: Directory,
  secret: string,
  notify = tell,
): Promise<{ person: string; link: string } | null> => {
  let sealed = await unsealed(t, secret)
  if (!sealed || !signs(sealed)) return null
  let [invite, place] = await Promise.all([
    dir.invitation(sealed.invite),
    placeOf(dir, sealed.to),
  ])
  if (!invite || !place || invite.to != sealed.to) return null
  await seated(env, dir, invite, place, notify)
  return { person: invite.person, link: linkOf(place, env) }
}
