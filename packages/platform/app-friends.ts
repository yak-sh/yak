import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line, sub } from '@yaks/query'
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import { monogram } from './monogram.ts'
import { bool, owned, ref, text } from './schema.ts'

export let FRIENDS_ACCESS = 'friends'
export let APP_FRIENDS = '.app_friends'
export let APP_FRIEND = '.app_friend'

export type Presence = 'online' | 'building' | 'away' | 'unknown'
export type FriendInvite = { to: string; path?: string }

let component = (
  description: string,
  properties: Record<string, PropSchema>,
) => ({
  component: true,
  type: 'object',
  description,
  properties,
})

export let appFriendsWords: VocabDoc = {
  title: 'app-friends',
  $defs: {
    app_friends: component('The current player’s permission for this app.', {
      signed_in: owned(bool),
      allowed: owned(bool),
    }),
    app_friend: component('A confirmed friend of the current player.', {
      name: owned(text),
      avatar: owned(text),
      presence: owned({
        ...text,
        enum: ['online', 'building', 'away', 'unknown'],
      }),
    }),
    friend_invite: component('Invite a friend to an app-relative play link.', {
      to: owned(text),
      path: owned(text),
    }),
  },
}

export let appPermissionsWords: VocabDoc = {
  title: 'app-permissions',
  $defs: {
    app_permission: component('A person’s permission for one app and scope.', {
      app: owned(ref('cascade')),
      person: owned(ref('cascade')),
      scope: owned(text),
    }),
    play_invite: component('The link a friend can follow to play.', {
      url: owned(text),
    }),
  },
}

export let friendsAccessEid = (app: string, person: string) =>
  derivedEid(`app permission ${FRIENDS_ACCESS} ${app} ${person}`)

export let friendPermissions = (person: string) =>
  line`.app_permission.person=${person}&.app_permission.scope=${FRIENDS_ACCESS}`

export let friendPermission = (app: string, person: string) =>
  line`${sub(friendPermissions(person))}&.app_permission.app=${app}`

export let friendPermissionPatch = (
  app: string,
  person: string,
  allowed: boolean,
): Bundle => ({
  entity: { eid: friendsAccessEid(app, person) },
  app_permission: allowed ? { app, person, scope: FRIENDS_ACCESS } : null,
})

export let friendsStatus = (
  app: string,
  person: string | null,
  allowed: boolean,
): Bundle => ({
  entity: { eid: friendsAccessEid(app, person ?? '') },
  app_friends: { signed_in: !!person, allowed },
})

export let appFriendRow = (
  { person, name }: { person: string; name: string },
  presence: Presence,
): Bundle => ({
  entity: { eid: person },
  app_friend: {
    name,
    avatar: `data:image/svg+xml,${encodeURIComponent(monogram(name, person))}`,
    presence,
  },
})

/** Resolve a play link under the app's canonical mount. */
export let playLink = (root: string, path: string): string | undefined => {
  if (path.length > 2_048 || /^[\s/\\]|^[\w+.-]+:/.test(path)) return
  let base = new URL(root)
  let link = new URL(path, base)
  if (link.origin != base.origin || !link.pathname.startsWith(base.pathname)) {
    return
  }
  let route = link.pathname.slice(base.pathname.length).split('/')[0]
  if (
    route == 'api' || route.startsWith('~') || /%2f|%5c/i.test(link.pathname)
  ) {
    return
  }
  return link.href
}
