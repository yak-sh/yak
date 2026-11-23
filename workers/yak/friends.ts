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
import { managePath } from '@yaks/platform/routes'
import { canon } from './signin.ts'
import { type Directory, directory, fetch, type Space } from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Who } from './session.ts'
import { vouched } from './session.ts'
import { asCaller, type Ctx, EID, refuse, str, text } from './tool.ts'
import type { Update } from './operator-updates.ts'
import type { Row as ToolRow } from './tool-words.ts'

let open = (env: Env) => directory(bound(env.DIRECTORY, fetch, env))

// Where everyone stands with `person`, unnamed.
let standingsOf = async (dir: Directory, person: string) =>
  standings(
    person,
    (await Promise.all(sidesOf(person).map((q) => dir.read(q)))).flat(),
  )

/** Another person, where they stand with the reader, and since when. */
export type Friend = Stand & { person: string; name: string }

/** Everyone who stands somewhere with `person`, named, friends first and
 * then by name. */
export let friendsOf = async (
  dir: Directory,
  person: string,
): Promise<Friend[]> => {
  let order: Standing[] = ['friend', 'asked', 'suggested', 'asking']
  return (await Promise.all(
    [...await standingsOf(dir, person)].map(async ([other, stand]) => ({
      person: other,
      name: await dir.nameAt(other) ?? 'Someone on yaks.app',
      ...stand,
    })),
  )).sort((a, b) =>
    order.indexOf(a.standing) - order.indexOf(b.standing) ||
    a.name.localeCompare(b.name)
  )
}

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
      let friends = await friendsOf(open(ctx.env), ctx.person)
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
]

/** The friend requests and suggestions waiting on a person, as Updates that
 * need them, in their own space alone so each shows once. */
export let friendUpdates = async (
  env: Env,
  space: Space,
  who: Who,
): Promise<Update[]> => {
  if (!who.person || who.role != 'owner') return []
  let dir = open(env)
  // Their own space as `dir.own` chooses it (the one marked theirs, else
  // the first they own), read without the marking or minting it does.
  let [seats, friends] = await Promise.all([
    dir.seats(who.person, 'owner'),
    friendsOf(dir, who.person),
  ])
  let own = seats.find((s) => s.own) ?? seats[0]
  if (own?.space.eid != space.eid) return []
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
  return managePath('updates', space.slug)
}
