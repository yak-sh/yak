import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { line, sub } from '@yaks/query'
import type { VocabDoc } from '@yaks/vocab'
import {
  APP_FRIEND,
  APP_FRIENDS,
  type FriendInvite,
  type Presence,
} from './friends-at.ts'
import { monogram } from './monogram.ts'
import appFriendsJson from './vocab/app-friends.vocab.json' with {
  type: 'json',
}
import appPermissionsJson from './vocab/app-permissions.vocab.json' with {
  type: 'json',
}

export let FRIENDS_ACCESS = 'friends'
export { APP_FRIEND, APP_FRIENDS }
export type { FriendInvite, Presence }

export let appFriendsWords: VocabDoc = appFriendsJson as VocabDoc

export let appPermissionsWords: VocabDoc = appPermissionsJson as VocabDoc

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
