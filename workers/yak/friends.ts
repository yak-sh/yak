// Friends on yaks.app (D-472) at the Worker's doors: the Operator's
// friend_list, friend_add and friend_remove, and the requests and suggestions
// waiting on a person in their Updates. What a friendship is, and who may
// write which side of it, is @yaks/platform/friends.
import type { Befriended, Seen, Shared } from '@yaks/platform/account-rows'
import { possessive } from '@yaks/text'
import {
  type Request as FriendRequest,
  side,
  sidesOf,
  type Stand,
  type Standing,
  standings,
  type Verdict,
} from '@yaks/platform/friends'
import { sendable } from '@yaks/mail'
import { lastSeen, presence, type Row } from '@yaks/notify/whereabouts'
import { line } from '@yaks/query'
import { ordered } from '@yaks/platform/presence'
import { friendsLine } from '@yaks/platform/updates-day'
import { canon } from './signin.ts'
import { nameOf } from './names.ts'
import { type Directory, directory, fetch, type Space } from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'
import { asCaller, type Ctx, EID, flag, refuse, str, text } from './tool.ts'
import type { Update } from './operator-updates.ts'
import type { Row as ToolRow } from './tool-words.ts'

export type { Befriended, Seen, Shared }

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

/** What `reader` may see of each of `friends`' presence
 * (@yaks/notify/whereabouts `presence` and `lastSeen`), by person. Showing
 * is mutual: someone who hides their own (`presence{hidden}`) is shown to no
 * friend and sees none of theirs. A friend never seen on yaks.app has none.
 * Call it for confirmed friends alone. */
export let presencesOf = async (
  dir: Directory,
  reader: string,
  friends: string[],
  now: number = Date.now(),
): Promise<Map<string, Seen>> => {
  if (!friends.length || await dir.presenceHidden(reader)) return new Map()
  let hidden = await Promise.all(friends.map((f) => dir.presenceHidden(f)))
  let visible = friends.filter((_, i) => !hidden[i])
  let rows = await dir.whereabouts(visible)
  let seen = await Promise.all(
    visible.map((f) =>
      presenceOf(
        dir,
        reader,
        rows.filter((r) => r.whereabouts?.person == f),
        now,
      )
    ),
  )
  return new Map(visible.flatMap((f, i) => seen[i] ? [[f, seen[i]]] : []))
}

let presenceOf = async (
  dir: Directory,
  reader: string,
  rows: Row[],
  now: number,
): Promise<Seen | undefined> => {
  let said = presence(rows, now), last = lastSeen(rows)
  if (!said) {
    return last ? { state: 'away', last, spaces: [], apps: [] } : undefined
  }
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
    last,
    spaces: spaces.flat().map((s) => ({ slug: s.slug, title: s.title })),
    apps: apps.flat().map(({ app, space }) => ({
      slug: app.slug,
      title: app.title || app.slug,
      space: space.slug,
    })),
  }
}

/** `person`'s confirmed friends for their Friends page, online first, then
 * the most recently active (@yaks/platform/presence `ordered`), each with
 * the apps of `shared` (everything others let them into) that live in a
 * space the friend owns. */
export let friendList = async (
  dir: Directory,
  person: string,
  shared: Shared[],
): Promise<Befriended[]> => {
  let mine = (await friendsOf(dir, person)).filter((f) =>
    f.standing == 'friend'
  )
  let [seen, owned] = await Promise.all([
    presencesOf(dir, person, mine.map((f) => f.person)),
    shared.length
      ? Promise.all(mine.map((f) => dir.seats(f.person, 'owner')))
      : mine.map(() => []),
  ])
  let listed = mine.map((f, i) => {
    let theirs = new Set(owned[i].map((s) => s.space.slug))
    return {
      person: f.person,
      name: f.name,
      seen: seen.get(f.person),
      shared: shared.filter((a) => theirs.has(a.space)),
    }
  })
  return ordered(listed, (f) => f.seen)
}

// One friend's presence in words: "Fay is building in gift-shop".
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
  let mine = friends.filter((f) => f.standing == 'friend')
  let seen = await presencesOf(dir, who.person, mine.map((f) => f.person))
  return friendsLine(mine.map((f) => ({ ...f, seen: seen.get(f.person) }))) ||
    undefined
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
      let all = await friendsOf(dir, ctx.person)
      let seen = await presencesOf(
        dir,
        ctx.person,
        all.filter((f) => f.standing == 'friend').map((f) => f.person),
      )
      let friends = all.map((f) =>
        seen.has(f.person) ? { ...f, presence: seen.get(f.person) } : f
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

/** A person's messages with their confirmed friends, the newest `limit`,
 * newest first: each sent to them or by them, as `knock{target, from}` +
 * `doc{body}` rows. */
export let messagesOf = async (
  dir: Directory,
  person: string,
  limit = LIMIT,
): Promise<Message[]> => {
  let [rows, friends] = await Promise.all([
    dir.read(
      line`(.knock.target=${person}|.knock.from=${person})&.knock.from&.doc&?opened&?created&.order=-created.at&.limit=${limit}`,
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

// Sends `words` from one friend to another, as the message `eid` where the
// page chose it: refused unless they are confirmed friends, kept to the
// length of a message, and sent once however often it is asked.
let sent = async (
  dir: Directory,
  who: Who,
  { from, to, words, eid = crypto.randomUUID() }: {
    from: string
    to: string
    words: string
    eid?: string
  },
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
  if (!EID.test(eid)) throw refuse('arguments', 'Name the message by a UUID.')
  let [was] = await dir.read(line`.entity.eid=${eid}&?knock&?doc`)
  if (was) {
    let knock = was.knock as { target?: unknown; from?: unknown } | undefined
    if (idOf(knock?.from) == from && idOf(knock?.target) == to) return friend
    throw refuse('arguments', 'Name the message by a UUID of its own.')
  }
  await dir.stamp({
    entities: [{ entity: { eid }, knock: { target: to, from }, doc: { body } }],
  }, vouched(who))
  return friend
}

/** A message from the person's page: `words` to the friend `to`, as the
 * message `eid` the page shows it as. */
export let sendFriend = (
  dir: Directory,
  who: Who & { person: string },
  message: { eid: string; to: string; words: string },
) => sent(dir, who, { from: who.person, ...message })

/** The person's messages from `friend` read: each marked `opened`, for
 * every interface that shows them. One that is not to them is left. */
export let readFriend = async (
  dir: Directory,
  who: Who & { person: string },
  eids: string[],
) => {
  let mine = (await Promise.all(
    eids.filter((e) => EID.test(e)).map((eid) =>
      dir.read(line`.entity.eid=${eid}&.knock.target=${who.person}&?opened`)
    ),
  )).flat().filter((r) => !r.opened)
  if (!mine.length) return
  await dir.stamp({
    entities: mine.map((r) => ({ entity: { eid: r.entity.eid }, opened: {} })),
  }, vouched(who))
}

/** A person's messages from friends, as Updates in their own space, with a
 * reply box each; reading them (`seen`) marks them read. */
export let messageUpdates = async (
  dir: Directory,
  space: Space,
  who: Who,
  seen = false,
): Promise<Update[]> => {
  if (!who.person || who.role != 'owner') return []
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
    subject: m.operator
      ? `${possessive(m.name)} Operator`
      : `Message from ${m.name}`,
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
  dir: Directory,
  space: Space,
  who: Who,
): Promise<Update[]> => {
  if (!who.person || who.role != 'owner') return []
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
          : `${name} is on yaks.app too.`,
        needs: true,
        unread: false,
        dismissed: false,
        friend: { person, suggested: standing == 'suggested' },
      }]
      : []
  )
}

/** A person's answer to a friend request or suggestion in Updates. */
export let answerFriend = async (
  env: Env,
  who: Who,
  other: string,
  verdict: string,
  receipt: boolean,
) => {
  if (!who.person) throw refuse('access', 'Sign in to answer this.')
  if (!EID.test(other) || !['approved', 'declined'].includes(verdict)) {
    throw refuse('arguments', 'Choose an answer from the request.')
  }
  let dir = open(env)
  await answer(dir, who, {
    person: who.person,
    other,
    verdict: verdict as Verdict,
  })
  if (!receipt || verdict != 'approved') return
  let [theirs] = await dir.read(
    line`.entity.eid=${
      side(other, who.person)
    }&.relationship.role=friend&.decided.verdict=approved`,
  )
  return theirs ? 'friend' : 'asking'
}
