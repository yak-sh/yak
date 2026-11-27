/** The signed-in person's yaks.app friends, read from an app's query door
 * (`.app_friends`, `.app_friend`, answered by ./app-friends.ts), and the one
 * write that invites a friend into the app. yaks.app owns the list and the
 * consent; an app keeps no copy. Every app's page has it as `friends` from
 * `./api/client.js`, which reads and writes through its own doors
 * (`friendsOver`); `friendsAt` asks an app's API over `fetch`. */

export let APP_FRIENDS = '.app_friends'
export let APP_FRIEND = '.app_friend'

/** How a friend is doing on yaks.app; hidden presence is `unknown`. */
export type Presence = 'online' | 'building' | 'away' | 'unknown'

/** One confirmed friend: `person` is who an invitation goes to. */
export type Friend = {
  person: string
  name: string
  avatar: string
  presence: Presence
}

/** What `friend_invite` asks: a link to `path`, relative to the app's root,
 * sent to the person `to`. */
export type FriendInvite = { to: string; path?: string }

/** Where the person stands: signed out, not yet allowing this app to see their
 * friends (`allow` is the page that asks them), or their friends. */
export type Friends =
  | { kind: 'signed-out' }
  | { kind: 'ask'; allow: string }
  | { kind: 'friends'; friends: Friend[] }

/** How the app's API is asked (default: the global `fetch`). */
export type Get = (request: Request) => Promise<Response>

/** A person's friends at one app: who they are, and inviting one in. */
export type FriendsAt = {
  /** Read when the picker opens; the list is the person's, not the app's. */
  list: () => Promise<Friends>
  /** Invite a friend to `path`, relative to the app's root. It reaches them
   * in their Friends conversation and Updates. A retry keeps its `eid`. */
  invite: (to: string, path?: string, eid?: string) => Promise<void>
}

type Row = { entity: { eid: string } } & Record<string, unknown>

/** An app's query and apply doors, as `./api/client.js` offers them. */
export type Doors = {
  query: (line: string) => Promise<Row[]>
  apply: (bundles: Row[]) => Promise<unknown>
}

let ORDER: Presence[] = ['online', 'building', 'away', 'unknown']

/** Friends with whoever is around first, then by name. */
export let ranked = (friends: Friend[]): Friend[] =>
  friends.toSorted((a, b) =>
    ORDER.indexOf(a.presence) - ORDER.indexOf(b.presence) ||
    a.name.localeCompare(b.name)
  )

/** The friends of whoever is signed in, read and invited through an app's
 * `doors`; `allow` is the page that asks them to let the app see their friends. */
export let friendsOver = (
  { query, apply }: Doors,
  allow: string,
): FriendsAt => ({
  list: async (): Promise<Friends> => {
    let status = (await query(APP_FRIENDS))[0]?.app_friends as
      | { signed_in?: boolean; allowed?: boolean }
      | undefined
    if (!status?.signed_in) return { kind: 'signed-out' }
    if (!status.allowed) return { kind: 'ask', allow }
    return {
      kind: 'friends',
      friends: ranked((await query(APP_FRIEND)).map((r) => {
        let f = r.app_friend as Omit<Friend, 'person'>
        return { person: r.entity.eid, ...f }
      })),
    }
  },
  invite: async (to, path, eid = crypto.randomUUID()): Promise<void> => {
    let friend_invite: FriendInvite = path == null ? { to } : { to, path }
    await apply([{ entity: { eid }, friend_invite }])
  },
})

/** The friends of whoever is signed in to the app at `api`, and inviting
 * them to a path inside it. */
export let friendsAt = (
  api: string | URL = new URL('./api/', document.baseURI),
  get: Get = fetch,
): FriendsAt => {
  let base = new URL(api)
  base.pathname = base.pathname.replace(/\/?$/, '/')
  return friendsOver({
    query: async (line) => {
      let url = new URL('query', base)
      url.searchParams.set('q', line)
      let answer = await get(new Request(url))
      if (!answer.ok) throw new Error(`Friends: HTTP ${answer.status}`)
      return await answer.json()
    },
    apply: async (bundles) => {
      let answer = await get(
        new Request(new URL('apply', base), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bundles),
        }),
      )
      if (!answer.ok) throw new Error(`Invite: HTTP ${answer.status}`)
    },
  }, new URL('allow?at=friends', base).href)
}
