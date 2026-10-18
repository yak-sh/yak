// An assistant that lost its sign-in (lapsed.ts): the refresh it comes back
// with is refused, and the lapse is reported to the tracker once, never while
// it is connected, and never for one its person disconnected themselves. The
// directory is a map of rows that keeps a lapse once per person and assistant
// (its identity, facets/lapsed-vocab.ts), the sign-ins a set; the door that
// feeds `lapse` is `unheld`, doctested there.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { closed, lapse, reconnected, refusedRefresh } from './lapsed.ts'
import type { Clients } from './connected.ts'

let ME = '3b4c249e-5dba-4e24-85f6-318194d57d7d'
let YOU = '8f1d2c3a-0b4e-4a5f-9c6d-7e8f9a0b1c2d'
let CLAUDE = 'claude-client'

let redirect = (id: string) =>
  id == CLAUDE ? 'https://claude.ai/api/mcp/auth_callback' : 'https://x.test/'

type Lapsed = { person: string; agent: string; known?: string }
type Write = { entity: { eid: string }; lapsed?: Lapsed; $delete?: true }

let fixture = () => {
  let sent: string[] = []
  let held = new Set<string>()
  let people = new Map([ME, YOU].map((eid) => [eid, `${eid.slice(0, 4)}@x`]))
  let rows = new Map<string, Lapsed>()
  let row = (eid: string) => ({ entity: { eid }, lapsed: rows.get(eid) })
  let write = (b: Write[]) => {
    for (let { entity, lapsed, $delete } of b) {
      let eid = lapsed?.person ? `${lapsed.person}/${lapsed.agent}` : entity.eid
      if ($delete) rows.delete(eid)
      else if (lapsed) rows.set(eid, { ...rows.get(eid), ...lapsed } as Lapsed)
    }
  }
  let store = {
    // `.lapsed.person=<person>`, or `.entity.eid=<person>&.email`
    query: (q: string) => {
      let value = q.split('=')[1].split('&')[0]
      return Promise.resolve(
        q.startsWith('.lapsed')
          ? [...rows].filter(([, r]) => r.person == value).map(([eid]) =>
            row(eid)
          )
          : people.has(value)
          ? [{ entity: { eid: value } }]
          : [],
      )
    },
    apply: (b: Bundle[]) => Promise.resolve(write(b as Write[])),
  } as unknown as Parameters<typeof lapse>[1]
  // The sign-ins a person holds: a grant per client in `held`.
  let oauth = {
    lookupClient: (id: string) =>
      Promise.resolve({ clientId: id, redirectUris: [redirect(id)] }),
    listUserGrants: () =>
      Promise.resolve({
        items: [...held].map((clientId) => ({
          id: clientId,
          clientId,
          redirectUri: redirect(clientId),
          createdAt: 1,
        })),
      }),
  } as unknown as Clients
  return {
    sent,
    oauth,
    held,
    store,
    rows: () => [...rows.values()],
    refused: (person: string, client = CLAUDE) =>
      lapse(oauth, store, person, client, (_, tags) => {
        sent.push(`${tags.person}/${tags.agent}`)
      }),
    connected: (person: string, client = CLAUDE) => {
      held.add(client)
      return reconnected(oauth, store, person, client)
    },
  }
}

test('an assistant that lost its sign-in is reported once', async () => {
  let f = fixture()
  await f.refused(ME)
  equal(f.sent, [`${ME}/claude`])
  await f.refused(ME)
  equal(f.sent.length, 1)
  equal(f.rows().length, 1)
})

test('a refusal reports nothing while the assistant is connected, and a lapse ends when it connects again', async () => {
  let f = fixture()
  await f.refused(ME)
  await f.connected(ME)
  equal(f.rows(), [])
  await f.refused(ME)
  equal(f.sent.length, 1)
  f.held.clear()
  await f.refused(ME)
  equal(f.sent.length, 2)
})

test('an assistant its person disconnected, or that nobody knows, is no bug', async () => {
  let f = fixture()
  await closed(f.store, ME, 'claude')
  await f.refused(ME)
  equal(f.sent, [])
  await f.store.apply([{
    entity: { eid: '$lapse' },
    lapsed: { person: YOU, agent: 'any' },
  }] as Bundle[])
  await f.refused(YOU)
  equal(f.sent, [])
})

test('a refresh naming somebody the directory does not know writes nobody', async () => {
  let f = fixture()
  await f.refused('11111111-2222-3333-4444-555555555555')
  equal(f.sent, [])
  equal(f.rows(), [])
})

test("the token door's refused refresh is a lapse only for a lost sign-in", async () => {
  let f = fixture()
  let form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: `${ME}:gone:secret`,
  })
  let answered = (error: string) =>
    refusedRefresh(
      f.oauth,
      f.store,
      form,
      CLAUDE,
      Response.json({ error }, { status: 400 }),
      (_, tags) => void f.sent.push(`${tags.person}`),
    )
  await answered('invalid_request')
  equal(f.sent, [])
  await answered('invalid_grant')
  equal(f.sent, [ME])
})
