import { equal, test } from '@yaks/testing'
import { friendsAt } from './friends-at.ts'

let API = 'https://game.example/play/api'

// An app door answering the two friend rows, keeping what was posted.
let door = (status: object, friends: object[] = []) => {
  let posted: unknown[] = []
  let get = async (request: Request) => {
    let url = new URL(request.url)
    if (request.method == 'POST') {
      equal(url.href, `${API}/apply`)
      posted.push(await request.json())
      return Response.json({ ok: true })
    }
    equal(url.pathname, '/play/api/query')
    let line = url.searchParams.get('q')
    return Response.json(
      line == '.app_friends'
        ? [{ entity: { eid: crypto.randomUUID() }, app_friends: status }]
        : friends,
    )
  }
  return { friends: friendsAt(API, get), posted }
}

let friend = (person: string, name: string, presence: string) => ({
  entity: { eid: person },
  app_friend: { name, avatar: `data:${name}`, presence },
})

test('a signed-out player has no friends to show', async () => {
  equal(await door({ signed_in: false, allowed: false }).friends.list(), {
    kind: 'signed-out',
  })
})

test('a player who has not allowed the app is sent to ask', async () => {
  equal(await door({ signed_in: true, allowed: false }).friends.list(), {
    kind: 'ask',
    allow: `${API}/allow?at=friends`,
  })
})

test('friends list whoever is around first, then by name', async () => {
  let { friends } = door({ signed_in: true, allowed: true }, [
    friend('p1', 'Wren', 'unknown'),
    friend('p2', 'Bea', 'away'),
    friend('p3', 'Tam', 'online'),
    friend('p4', 'Ada', 'online'),
  ])
  let shown = await friends.list()
  equal(
    shown.kind == 'friends' && shown.friends.map((f) => [f.person, f.name]),
    [['p4', 'Ada'], ['p3', 'Tam'], ['p2', 'Bea'], ['p1', 'Wren']],
  )
  equal(shown.kind == 'friends' && shown.friends[0].avatar, 'data:Ada')
})

test('an invitation is one friend_invite bundle', async () => {
  let { friends, posted } = door({ signed_in: true, allowed: true })
  await friends.invite('p3', '?party=h1', 'e1')
  await friends.invite('p4', undefined, 'e2')
  equal(posted, [
    [{ entity: { eid: 'e1' }, friend_invite: { to: 'p3', path: '?party=h1' } }],
    [{ entity: { eid: 'e2' }, friend_invite: { to: 'p4' } }],
  ])
})
