import { Pending } from '@yaks/api/log'
import type { Bundle } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import { held, through } from './grant-rows.ts'

let KEY = 'grant:person:g1'
let GRANT = JSON.stringify({ id: 'g1', clientId: 'c', createdAt: 1 })

// A KV over a Map, through a directory whose row write fails with `no`.
let kvWith = (no?: Error) => {
  let held = new Map<string, string>()
  let written: Bundle[][] = []
  let kv = through({
    get: (key: string) => Promise.resolve(held.get(key) ?? null),
    put: (key: string, value: string) =>
      Promise.resolve(void held.set(key, value)),
    delete: (key: string) => Promise.resolve(void held.delete(key)),
  }, {
    write: (bundles: Bundle[]) => {
      written.push(bundles)
      return no ? Promise.reject(no) : Promise.resolve()
    },
  })
  return { kv, held, written }
}

let outcome = (run: () => Promise<unknown>) =>
  run().then(() => 'ok', (e: Error) => e.name)

test('a grant whose row the directory keeps is written to KV', async () => {
  let { kv, held, written } = kvWith(new Pending('kept'))
  equal(await outcome(() => kv.put(KEY, GRANT)), 'ok')
  equal([held.get(KEY), written.length], [GRANT, 1])
  equal(await outcome(() => kv.delete(KEY)), 'ok')
  equal([held.has(KEY), written.length], [false, 2])
})

test('a grant whose row fails is not written to KV', async () => {
  let { kv, held } = kvWith(new TypeError('down'))
  equal(await outcome(() => kv.put(KEY, GRANT)), 'TypeError')
  equal(held.has(KEY), false)
})

test('a deleted grant leaves its row cancelled', async () => {
  let { kv, written } = kvWith()
  await kv.put(KEY, GRANT)
  await kv.delete(KEY)
  equal(written[1][0].cancelled, {})
})

// Whether a token's grant stands, by what the directory holds of the grant and
// of its person, and the agent its row names.
let standing = (person: boolean, row: Bundle | null) =>
  held(
    {
      credential: () =>
        Promise.resolve({ owner: null, present: person, row } as never),
    },
    'g1',
    'person',
  )

let grant = (g: Record<string, unknown>) =>
  ({ entity: { eid: 'g' }, oauth_grant: { id: 'g1', ...g } }) as Bundle

test("a token's grant stands until its row is cancelled or its person goes", async () => {
  let row = grant({})
  equal(
    await Promise.all([
      standing(true, row),
      standing(true, null),
      standing(true, { ...row, cancelled: {} }),
      standing(false, row),
    ]),
    [{}, {}, null, null],
  )
})

test("a token's grant names its agent as the person's connections do", async () => {
  equal(
    await Promise.all([
      standing(
        true,
        grant({ redirect: 'https://claude.ai/api/mcp/auth_callback' }),
      ),
      standing(true, grant({ redirect: 'https://chatgpt.com/cb', name: null })),
      standing(
        true,
        grant({ redirect: 'http://localhost:3000/cb', name: 'claude-code' }),
      ),
      standing(
        true,
        grant({ redirect: 'https://example.com/cb', name: 'Zed' }),
      ),
    ]),
    [
      { agent: 'Claude' },
      { agent: 'ChatGPT' },
      { agent: 'Claude Code' },
      { agent: 'Zed' },
    ],
  )
})
