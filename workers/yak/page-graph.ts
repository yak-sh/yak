// A page's query of its app's store: asked across the homes of the words the
// app borrows, which the store composes itself (graph.ts `#across`), and
// answered by the platform's listing rule, as every door answers a page.
import { whole } from '@yaks/query'
import { listed, type Row } from '@yaks/platform/listing'
import { type Bundle, type Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { presence } from '@yaks/notify/whereabouts'
import {
  APP_FRIEND,
  APP_FRIENDS,
  appFriendRow,
  type FriendInvite,
  friendPermission,
  friendsStatus,
  playLink,
} from '@yaks/platform/app-friends'
import {
  type App,
  appStore,
  type Directory,
  type Space,
  url,
} from './directory.ts'
import { ACROSS } from './door.ts'
import type { Env } from './env.ts'
import { metaOf } from './meta.ts'
import { vouched, type Who } from './session.ts'
import { EID, refuse } from './tool.ts'

/** A page's query of its app's store, as `who` with `headers` beside. The
 * page wrote `line` whole, so it is read as written. */
export let queried = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  line: string,
  live = false,
  headers: Record<string, string> = {},
): Promise<unknown> => {
  let rows = await metaOf(appStore(env.STORE, space, app, env), {
    ...vouched(who),
    ...headers,
    [ACROSS]: '1',
  }).query(whole(line), { live, listing: true, names: true })
  return Array.isArray(rows) ? listed(rows as Row[], line) : rows
}

let friendsAllowed = async (dir: Directory, app: App, person: string | null) =>
  !!person && (await dir.read(friendPermission(app.eid, person))).length > 0

/** Read the current person's friend rows on the ordinary app query door. */
export let queryFriends = async (
  dir: Directory,
  app: App,
  person: string | null,
  line: string,
): Promise<Response | undefined> => {
  if (line != APP_FRIEND && line != APP_FRIENDS) return
  let allowed = await friendsAllowed(dir, app, person)
  let rows: Bundle[] = []
  if (line == APP_FRIENDS) rows = [friendsStatus(app.eid, person, allowed)]
  else if (person && allowed) {
    let { friendsOf, friendWhereabouts } = await import('./friend-reads.ts')
    let friends = (await friendsOf(dir, person)).filter((f) =>
      f.standing == 'friend'
    )
    let visible = await friendWhereabouts(
      dir,
      person,
      friends.map((f) => f.person),
    )
    rows = friends.map((f) => {
      let seen = visible.get(f.person)
      return appFriendRow(f, seen ? presence(seen)?.state ?? 'away' : 'unknown')
    })
  }
  return Response.json(rows, {
    headers: { 'cache-control': 'private, no-store' },
  })
}

/** Send an invitation on behalf of the signed-in person using this app. */
export let inviteFriend = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
  bundles: Bundle[],
  check: boolean,
): Promise<Bundle[] | undefined> => {
  if (!bundles.some((b) => b && typeof b == 'object' && 'friend_invite' in b)) {
    return
  }
  let [b] = bundles
  let sent = b?.friend_invite as Comp | undefined
  if (
    bundles.length != 1 ||
    Object.keys(b).some((k) => k != 'entity' && k != 'friend_invite') ||
    !EID.test(b.entity?.eid) || !sent || typeof sent.to != 'string' ||
    (sent.path !== undefined && typeof sent.path != 'string') ||
    Object.keys(sent).some((k) => k != 'to' && k != 'path')
  ) {
    throw refuse(
      'arguments',
      'Send one friend_invite with a UUID, a friend and an optional path.',
    )
  }
  let { to, path } = sent as FriendInvite
  let person = who.person
  if (!person || !await friendsAllowed(dir, app, person)) {
    throw refuse(
      'access',
      'Allow this app to see your friends before inviting one.',
    )
  }
  let link = playLink(url(space, { ...app, home: false }, env), path ?? '')
  if (!link) throw refuse('arguments', 'Choose a play link inside this app.')
  let { sendFriend } = await import('./friends.ts')
  await sendFriend(dir, { ...who, person }, {
    eid: derivedEid(`play invite ${app.eid} ${person} ${b.entity.eid}`),
    to,
    words: `You’re invited to play ${app.title || app.slug}.`,
    invite: link,
    app: app.eid,
  }, check)
  return [b]
}
