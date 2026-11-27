/** The signed-in player's yaks.app friends, read from the app's query door
 * (`.app_friends`, `.app_friend`), and the one write that invites a friend to
 * play. yaks.app owns the list and the consent; a game keeps no copy. */

/** How a friend is doing on yaks.app; hidden presence is `unknown`. */
export type Presence = 'online' | 'building' | 'away' | 'unknown'

/** One confirmed friend: `person` is who an invitation goes to. */
export type Friend = {
  person: string
  name: string
  avatar: string
  presence: Presence
}

/** Where the player stands: signed out, not yet allowing this app to see their
 * friends (`allow` is the page that asks them), or their friends. */
export type Friends =
  | { kind: 'signed-out' }
  | { kind: 'ask'; allow: string }
  | { kind: 'friends'; friends: Friend[] }

/** How the app's API is asked (default: the global `fetch`). */
export type Get = (request: Request) => Promise<Response>

/** A player's friends at one app: who they are, and inviting one to play. */
export type FriendsAt = {
  /** Read when the picker opens; the list is the player's, not the game's. */
  list: () => Promise<Friends>
  /** Invite a friend to `path`, relative to the app's root. It reaches them
   * in their Friends conversation and Updates. A retry keeps its `eid`. */
  invite: (to: string, path?: string, eid?: string) => Promise<void>
}

type Row = { entity: { eid: string } } & Record<string, unknown>

let ORDER: Presence[] = ['online', 'building', 'away', 'unknown']

/** Friends with whoever is around first, then by name. */
export let ranked = (friends: Friend[]): Friend[] =>
  friends.toSorted((a, b) =>
    ORDER.indexOf(a.presence) - ORDER.indexOf(b.presence) ||
    a.name.localeCompare(b.name)
  )

/** The friends of whoever is signed in to the app at `api`, and inviting
 * them to a path inside it. */
export let friendsAt = (
  api: string | URL = new URL('./api/', document.baseURI),
  get: Get = fetch,
): FriendsAt => {
  let base = new URL(api)
  base.pathname = base.pathname.replace(/\/?$/, '/')
  let rows = async (line: string): Promise<Row[]> => {
    let url = new URL('query', base)
    url.searchParams.set('q', line)
    let answer = await get(new Request(url))
    if (!answer.ok) throw new Error(`Friends: HTTP ${answer.status}`)
    return await answer.json()
  }
  return {
    list: async (): Promise<Friends> => {
      let status = (await rows('.app_friends'))[0]?.app_friends as
        | { signed_in?: boolean; allowed?: boolean }
        | undefined
      if (!status?.signed_in) return { kind: 'signed-out' }
      if (!status.allowed) {
        return { kind: 'ask', allow: new URL('allow?at=friends', base).href }
      }
      return {
        kind: 'friends',
        friends: ranked((await rows('.app_friend')).map((r) => {
          let f = r.app_friend as Omit<Friend, 'person'>
          return { person: r.entity.eid, ...f }
        })),
      }
    },
    invite: async (
      to: string,
      path?: string,
      eid: string = crypto.randomUUID(),
    ): Promise<void> => {
      let answer = await get(
        new Request(new URL('apply', base), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify([{
            entity: { eid },
            friend_invite: path == null ? { to } : { to, path },
          }]),
        }),
      )
      if (!answer.ok) throw new Error(`Invite: HTTP ${answer.status}`)
    },
  }
}
