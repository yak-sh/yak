// Friends on yaks.app (D-472) at the Worker's doors: the Operator's
// friend_list, friend_add and friend_remove, and the requests and suggestions
// waiting on a person in their Updates. What a friendship is, and who may
// write which side of it, is @yaks/platform/friends.
import {
  type Request as FriendRequest,
  sidesOf,
  type Stand,
  type Standing,
  standings,
  type Verdict,
} from '@yaks/platform/friends'
import { sendable } from '@yaks/mail'
import { presence } from '@yaks/notify/whereabouts'
import { line } from '@yaks/query'
import { talkPath } from '@yaks/platform/routes'
import { canon } from './signin.ts'
import { nameOf } from './names.ts'
import { type Directory, directory, fetch, type Space } from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'
import { asCaller, type Ctx, EID, flag, refuse, str, text } from './tool.ts'
import type { Update } from './operator-updates.ts'
import type { Row as ToolRow } from './tool-words.ts'

let open = (env: Env) => directory(bound(env.DIRECTORY, fetch, env))

// Every friend side `person` is at either end of, and the people at their
// ends, in one read.
let sidesRead = (dir: Directory, person: string) => dir.read(sidesOf(person))

// Where everyone stands with `person`, unnamed.
let standingsOf = async (dir: Directory, person: string) =>
  standings(person, await sidesRead(dir, person))

/** Another person, where they stand with the reader, and since when. */
export type Friend = Stand & { person: string; name: string }

/** Everyone who stands somewhere with `person`, named, friends first and
 * then by name. */
export let friendsOf = async (
  dir: Directory,
  person: string,
): Promise<Friend[]> => {
  let order: Standing[] = ['friend', 'asked', 'suggested', 'asking']
  let rows = await sidesRead(dir, person)
  let named = new Map(rows.map((r) => [
    r.entity.eid,
    nameOf(
      (r.doc as { title?: string } | undefined)?.title,
      (r.email as { address?: string } | undefined)?.address ?? '',
    ),
  ]))
  return [...standings(person, rows)].map(([other, stand]) => ({
    person: other,
    name: named.get(other) || 'Someone on yaks.app',
    ...stand,
  })).sort((a, b) =>
    order.indexOf(a.standing) - order.indexOf(b.standing) ||
    a.name.localeCompare(b.name)
  )
}

/** Where a friend is on yaks.app now, as one reader may see it: building
 * or online, and the spaces and apps they have open that the reader can
 * already open themselves. */
export type Seen = {
  state: 'building' | 'online'
  spaces: { slug: string; title: string }[]
  apps: { slug: string; title: string; space: string }[]
}

/** What `reader` may see of `friend`'s presence (@yaks/notify/whereabouts
 * `presence`), none when no page of theirs is open or they hide it
 * (`presence{hidden}`). Call it for a confirmed friend alone. */
export let presenceOf = async (
  dir: Directory,
  reader: string,
  friend: string,
  now: number = Date.now(),
): Promise<Seen | undefined> => {
  let [rows, hidden] = await Promise.all([
    dir.read(line`.whereabouts.person=${friend}&*`),
    dir.presenceHidden(friend),
  ])
  let said = hidden ? undefined : presence(rows, now)
  if (!said) return
  let [spaces, apps] = await Promise.all([
    Promise.all(said.spaces.map(async (eid) => {
      let space = await dir.at(eid)
      return space && await dir.role(space, reader) ? [space] : []
    })),
    Promise.all(said.apps.map(async (eid) => {
      let held = await dir.appAt(eid)
      if (!held || held.app.trashed) return []
      let { app, space } = held
      let opens = app.access != 'private' ||
        !!await dir.role(space, reader) || !!await dir.grant(app, reader)
      return opens ? [{ app, space }] : []
    })),
  ])
  return {
    state: said.state,
    spaces: spaces.flat().map((s) => ({ slug: s.slug, title: s.title })),
    apps: apps.flat().map(({ app, space }) => ({
      slug: app.slug,
      title: app.title || app.slug,
      space: space.slug,
    })),
  }
}

// One friend's presence in words: "Fay is building in gift-shop".
let presenceLine = (name: string, s: Seen) =>
  s.state == 'building'
    ? `${name} is building${
      s.spaces.length ? ` in ${s.spaces.map((x) => x.title).join(', ')}` : ''
    }`
    : s.apps.length
    ? `${name} has ${s.apps.map((a) => a.title).join(', ')} open`
    : `${name} is online`

/** Which of a person's friends are on yaks.app now, in a line for their
 * Updates in their own space; none when nobody is. */
export let friendsHere = async (
  env: Env,
  space: Space,
  who: Who,
): Promise<string | undefined> => {
  if (!who.person || who.role != 'owner') return
  let dir = open(env)
  let [seats, friends] = await Promise.all([
    dir.seats(who.person, 'owner'),
    friendsOf(dir, who.person),
  ])
  if (ownOf(seats)?.space.eid != space.eid) return
  let here = (await Promise.all(
    friends.filter((f) => f.standing == 'friend').map(async (f) => {
      let seen = await presenceOf(dir, who.person!, f.person)
      return seen ? [presenceLine(f.name, seen)] : []
    }),
  )).flat()
  return here.length
    ? `Friends on yaks.app now: ${here.join('. ')}.`
    : undefined
}

// A person's own space among their owner seats, as `dir.own` chooses it
// (the one marked theirs, else the first they own), read without the
// marking or minting it does.
let ownOf = (seats: { own: boolean; space: Space }[]) =>
  seats.find((s) => s.own) ?? seats[0]

/** The sign-in email of one of `person`'s confirmed friends, for the tools
 * that take a friend (`FRIEND`) where they would take an address. */
export let friendEmail = async (
  dir: Directory,
  person: string,
  friend: unknown,
): Promise<string> => {
  let other = text(friend, 'friend')
  let standing = EID.test(other)
    ? (await standingsOf(dir, person)).get(other)?.standing
    : undefined
  if (standing != 'friend') {
    throw refuse('arguments', 'Choose someone from your friend list.')
  }
  let email = await dir.emailAt(other)
  if (!email) {
    throw refuse(
      'missing',
      `${
        await dir.nameAt(other) ?? 'Your friend'
      } has no sign-in email on yaks.app yet. Ask them for one.`,
    )
  }
  return email
}

/** The input a tool takes a friend by, in place of an email. */
export let FRIEND = str(
  'a confirmed friend, by the person id friend_list gives them, in place of an email',
)

/** The address a call names: its `friend`'s, else its `email`. */
export let recipientOf = (
  dir: Directory,
  person: string,
  args: Record<string, unknown>,
) =>
  args.friend != null
    ? friendEmail(dir, person, args.friend)
    : args.email != null
    ? text(args.email, 'email')
    : Promise.reject(refuse('arguments', 'Choose a friend or give an email.'))

let answer = (dir: Directory, who: Who, asked: FriendRequest) =>
  dir.stamp(
    { entities: [{ entity: { eid: '$friend' }, $friend: asked }] },
    vouched(who),
  )

// The other person a call names: by `person`, an eid from friend_list, or by
// their sign-in `email`.
let otherOf = async (dir: Directory, args: Record<string, unknown>) => {
  if (args.person != null) {
    let person = text(args.person, 'person')
    if (!EID.test(person)) {
      throw refuse('arguments', 'Name a person from friend_list.')
    }
    return person
  }
  let email = canon(text(args.email, 'email'))
  if (!sendable(email)) {
    throw refuse('arguments', 'Give their yaks.app sign-in email.')
  }
  let person = await dir.personAt(email)
  if (!person) {
    throw refuse('missing', 'No yaks.app account has that sign-in email.')
  }
  return person
}

let said = async (
  ctx: Ctx,
  args: Record<string, unknown>,
  verdict: Verdict,
) => {
  let dir = open(ctx.env)
  let other = await otherOf(dir, args)
  if (other == ctx.person) {
    throw refuse('arguments', 'Choose someone other than yourself.')
  }
  await answer(dir, asCaller(ctx, null), {
    person: ctx.person,
    other,
    verdict,
  })
  let name = await dir.nameAt(other) ?? 'They'
  let now = (await friendsOf(dir, ctx.person)).find((f) => f.person == other)
  return { other, name, standing: now?.standing ?? null }
}

let PERSON = str('the person, as friend_list names them')
let EMAIL = str('their yaks.app sign-in email')

/** The Operator's friend tools, each the person's own act. */
export let friendTools: ToolRow[] = [
  {
    name: 'friend_list',
    role: 'self',
    destructive: false,
    idempotent: true,
    input: { type: 'object', properties: {} },
    run: async (ctx) => {
      let dir = open(ctx.env)
      let friends = await Promise.all(
        (await friendsOf(dir, ctx.person)).map(async (f) =>
          f.standing == 'friend'
            ? { ...f, presence: await presenceOf(dir, ctx.person, f.person) }
            : f
        ),
      )
      return { text: '', value: { friends } }
    },
  },
  {
    name: 'friend_add',
    role: 'self',
    destructive: false,
    idempotent: true,
    input: { type: 'object', properties: { person: PERSON, email: EMAIL } },
    run: async (ctx, args) => {
      let { other, name, standing } = await said(ctx, args, 'approved')
      return {
        text: standing == 'friend'
          ? `You and ${name} are friends.`
          : `${name} will see your friend request in their Updates.`,
        value: { person: other, standing },
      }
    },
  },
  {
    name: 'friend_remove',
    role: 'self',
    destructive: false,
    idempotent: true,
    input: { type: 'object', properties: { person: PERSON, email: EMAIL } },
    run: async (ctx, args) => {
      let { other, name } = await said(ctx, args, 'declined')
      return {
        text: `${name} is off your friend list. They are not told.`,
        value: { person: other, standing: null },
      }
    },
  },
  {
    name: 'friend_presence',
    role: 'self',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        hidden: {
          type: 'boolean',
          description:
            'true hides from friends when they are on yaks.app and what they have open; false shows it again',
        },
      },
      required: ['hidden'],
    },
    run: async (ctx, args) => {
      let hidden = flag(args.hidden, 'hidden')
      await hidePresence(open(ctx.env), asCaller(ctx, null), ctx.person, hidden)
      return {
        text: hidden
          ? 'Your friends no longer see when you are on yaks.app.'
          : 'Your friends see when you are on yaks.app again.',
        value: { hidden },
      }
    },
  },
  {
    name: 'friend_message',
    role: 'self',
    destructive: false,
    input: {
      type: 'object',
      properties: {
        friend: FRIEND,
        words: str('the message, as it should read'),
      },
      required: ['friend', 'words'],
    },
    run: async (ctx, args) => {
      let dir = open(ctx.env)
      let { name } = await sent(dir, asCaller(ctx, null), {
        from: ctx.person,
        to: text(args.friend, 'friend'),
        words: text(args.words, 'words'),
      })
      return { text: `Sent to ${name}. It is in their Updates.`, value: {} }
    },
  },
  {
    name: 'friend_messages',
    role: 'self',
    destructive: false,
    idempotent: true,
    input: { type: 'object', properties: {} },
    run: async (ctx) => ({
      text: '',
      value: { messages: await messagesOf(open(ctx.env), ctx.person) },
    }),
  },
]

/** Keeps a person's presence from their friends (`hidden`), or shows it. */
export let hidePresence = (
  dir: Directory,
  who: Who,
  person: string,
  hidden: boolean,
) =>
  dir.apply({
    entities: [{ entity: { eid: person }, presence: { hidden } }],
  }, vouched(who))

/** One message between friends, as its reader sees it. */
export type Message = {
  eid: string
  /** the friend it is from or to, and whether it is to them */
  friend: string
  name: string
  outgoing: boolean
  /** written by the sender's Operator rather than by them at a page */
  operator: boolean
  words: string
  at: string
  read: boolean
}

// What a message is: a knock aimed at the person it is for, from the person
// who sent it, with its words.
let LIMIT = 40

/** A person's messages with their confirmed friends, newest first: each sent
 * to them or by them, as `knock{target, from}` + `doc{body}` rows. */
export let messagesOf = async (
  dir: Directory,
  person: string,
): Promise<Message[]> => {
  let [rows, friends] = await Promise.all([
    dir.read(
      line`(.knock.target=${person}|.knock.from=${person})&.knock.from&.doc&?opened&?created&.order=-created.at&.limit=${LIMIT}`,
    ),
    friendsOf(dir, person),
  ])
  let named = new Map(
    friends.filter((f) => f.standing == 'friend').map((f) => [f.person, f]),
  )
  return rows.flatMap((r): Message[] => {
    let knock = r.knock as { target?: unknown; from?: unknown }
    let from = idOf(knock.from), to = idOf(knock.target)
    let outgoing = from == person
    let friend = named.get(outgoing ? to : from)
    if (!friend) return []
    let created = r.created as { at?: string; by?: unknown } | undefined
    return [{
      eid: r.entity.eid,
      friend: friend.person,
      name: friend.name,
      outgoing,
      operator: !!created?.by && idOf(created.by) != from,
      words: String((r.doc as { body?: string }).body ?? ''),
      at: String(created?.at ?? ''),
      read: outgoing || !!r.opened,
    }]
  })
}

let idOf = (v: unknown) =>
  typeof v == 'string' ? v : String((v as { eid?: string })?.eid ?? '')

// Sends `words` from one friend to another: refused unless they are
// confirmed friends, and kept to the length of a message.
let sent = async (
  dir: Directory,
  who: Who,
  { from, to, words }: { from: string; to: string; words: string },
) => {
  let friend = EID.test(to)
    ? (await friendsOf(dir, from)).find((f) => f.person == to)
    : undefined
  if (friend?.standing != 'friend') {
    throw refuse('arguments', 'Choose someone from your friend list.')
  }
  let body = words.trim()
  if (!body || body.length > 4000) {
    throw refuse('arguments', 'Write a message of up to 4,000 characters.')
  }
  await dir.stamp({
    entities: [{
      entity: { eid: crypto.randomUUID() },
      knock: { target: to, from },
      doc: { body },
    }],
  }, vouched(who))
  return friend
}

/** A person's messages from friends, as Updates in their own space, with a
 * reply box each; reading them (`seen`) marks them read. */
export let messageUpdates = async (
  env: Env,
  space: Space,
  who: Who,
  seen = false,
): Promise<Update[]> => {
  if (!who.person || who.role != 'owner') return []
  let dir = open(env)
  let [seats, messages] = await Promise.all([
    dir.seats(who.person, 'owner'),
    messagesOf(dir, who.person),
  ])
  if (ownOf(seats)?.space.eid != space.eid) return []
  let incoming = messages.filter((m) => !m.outgoing)
  let unread = incoming.filter((m) => !m.read)
  if (seen && unread.length) {
    await dir.stamp({
      entities: unread.map((m) => ({ entity: { eid: m.eid }, opened: {} })),
    }, vouched(who))
  }
  return incoming.map((m) => ({
    eid: m.eid,
    at: m.at,
    subject: m.operator ? `${m.name}'s Operator` : `Message from ${m.name}`,
    words: m.words,
    needs: false,
    unread: !m.read,
    dismissed: false,
    message: { friend: m.friend, name: m.name },
  }))
}

/** A reply from a person's Updates to a friend's message. */
export let replyFriend = async (
  env: Env,
  who: Who,
  friend: string,
  words: string,
) => {
  if (!who.person) throw refuse('access', 'Sign in to reply.')
  await sent(open(env), who, { from: who.person, to: friend, words })
}

/** The friend requests and suggestions waiting on a person, as Updates that
 * need them, in their own space alone so each shows once. */
export let friendUpdates = async (
  env: Env,
  space: Space,
  who: Who,
): Promise<Update[]> => {
  if (!who.person || who.role != 'owner') return []
  let dir = open(env)
  let [seats, friends] = await Promise.all([
    dir.seats(who.person, 'owner'),
    friendsOf(dir, who.person),
  ])
  if (ownOf(seats)?.space.eid != space.eid) return []
  return friends.flatMap(({ person, name, standing, at }): Update[] =>
    standing == 'asked' || standing == 'suggested'
      ? [{
        eid: person,
        at,
        subject: standing == 'asked' ? 'Friend request' : 'Someone you know?',
        words: standing == 'asked'
          ? `${name} asked to be your friend on yaks.app.`
          : `${name} is on yaks.app too. Add them as a friend? They see a request only if you do.`,
        needs: true,
        unread: false,
        dismissed: false,
        friend: { person },
      }]
      : []
  )
}

/** A person's answer to a friend request or suggestion in Updates. */
export let answerFriend = async (
  env: Env,
  space: Space,
  who: Who,
  other: string,
  verdict: string,
) => {
  if (!who.person) throw refuse('access', 'Sign in to answer this.')
  if (!EID.test(other) || !['approved', 'declined'].includes(verdict)) {
    throw refuse('arguments', 'Choose an answer from the request.')
  }
  await answer(open(env), who, {
    person: who.person,
    other,
    verdict: verdict as Verdict,
  })
  return talkPath('updates', space.slug)
}
