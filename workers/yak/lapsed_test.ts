// An assistant that lost its sign-in (lapsed.ts): the refresh it comes back
// with is refused, and its person is written to once with how to connect it
// again, never while it is connected, and never for one they disconnected
// themselves. The directory is a map of rows that keeps a lapse once per
// person and assistant (its identity, facets/lapsed-vocab.ts), the sign-ins a
// set, and the letters a list; the door that feeds `lapse` is `unheld`,
// doctested there.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { effects as lapsedEffects } from './facets/lapsed-effects.ts'
import { closed, lapse, reconnected } from './lapsed.ts'
import type { Clients } from './connected.ts'
import type { Letter } from './mail.ts'
import type { Stored } from './graph.ts'

let ME = '3b4c249e-5dba-4e24-85f6-318194d57d7d'
let YOU = '8f1d2c3a-0b4e-4a5f-9c6d-7e8f9a0b1c2d'
let CLAUDE = 'claude-client'

let redirect = (id: string) =>
  id == CLAUDE ? 'https://claude.ai/api/mcp/auth_callback' : 'https://x.test/'

type Lapsed = { person: string; agent: string; known?: string }
type Write = { entity: { eid: string }; lapsed?: Lapsed; $delete?: true }

let fixture = () => {
  let sent: Letter[] = []
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
  let { tell_lapsed } = lapsedEffects({}, {
    store: {
      meta: true,
      env: {},
      graph: { apply: (b: Write[]) => void write(b) },
    } as unknown as Stored,
    mail: (l) => Promise.resolve(void sent.push(l)),
  })
  let tx = {
    get: (eids: string[]) =>
      Promise.resolve(
        eids.map((eid) =>
          people.has(eid)
            ? { entity: { eid }, email: { address: people.get(eid) } }
            : row(eid)
        ),
      ),
  } as never
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
    // The effect runs for each lapse written new (`tell_lapsed` `created`).
    apply: async (b: Bundle[]) => {
      let before = new Set(rows.keys())
      write(b as Write[])
      for (let eid of rows.keys()) {
        if (!before.has(eid)) await tell_lapsed(row(eid) as never, tx)
      }
    },
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
    held,
    store,
    rows: () => [...rows.values()],
    refused: (person: string, client = CLAUDE) =>
      lapse(oauth, store, person, client),
    connected: (person: string, client = CLAUDE) => {
      held.add(client)
      return reconnected(oauth, store, person, client)
    },
  }
}

test('an assistant that lost its sign-in has its person told once', async () => {
  let f = fixture()
  await f.refused(ME)
  equal(f.sent.length, 1)
  ok(f.sent[0].body.includes('claude.ai'))
  await f.refused(ME)
  equal(f.sent.length, 1)
  equal(f.rows().length, 1)
})

test('a refusal owes nothing while the assistant is connected, and a lapse ends when it connects again', async () => {
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

test('an assistant its person disconnected, or that nobody knows, owes no second letter', async () => {
  let f = fixture()
  await closed(f.store, ME, 'claude')
  await f.refused(ME)
  equal(f.sent, [])
  // A lapse the platform's admin recorded for an unknown assistant.
  await f.store.apply([{
    entity: { eid: '$lapse' },
    lapsed: { person: YOU, agent: 'any' },
  }] as Bundle[])
  equal(f.sent.length, 1)
  ok(
    f.sent[0].body.includes('claude.ai') &&
      f.sent[0].body.includes('chatgpt.com'),
  )
  await f.refused(YOU)
  equal(f.sent.length, 1)
})

test('a refresh naming somebody the directory does not know writes nobody', async () => {
  let f = fixture()
  await f.refused('11111111-2222-3333-4444-555555555555')
  equal(f.sent, [])
  equal(f.rows(), [])
})
