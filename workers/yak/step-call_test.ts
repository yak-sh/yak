// A call an app's step writes (@yaks/workflow) runs as the writer of the
// change it matched, inside that write or after it commits, exactly as the
// same call written through the store's door: the app's worker is asked as
// that person, at their role.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { toolEid } from '@yaks/tools'
import { parseTools } from '@yaks/tools/declared'
import type { Dispatch } from './door.ts'
import { appStore, storeName } from './directory.ts'
import { ADA, ADA_OWNS, platform, seeded } from './serving-probe.ts'

let words = {
  $defs: {
    on_order: {
      tool: true,
      description: 'Answer an order',
      worker: '/on-order',
      input: { order: { type: 'string' } },
    },
  },
}
let ask = (order: string) => ({ to: toolEid('on_order'), args: { order } })

let doors: [string, (o: string) => object[][]][] = [
  [
    'the door',
    (o) => [[{ entity: { eid: crypto.randomUUID() }, call: ask(o) }]],
  ],
  ...['write', 'commit'].map((when): [string, (o: string) => object[][]] => [
    `a step ${when == 'write' ? 'inside the write' : 'after commit'}`,
    (o) => [
      [{
        entity: { eid: crypto.randomUUID() },
        step: {
          match: `$o .doc.title=${o}`,
          write: [{ entity: { eid: '$c' }, call: ask('$o') }],
          when,
        },
      }],
      [{ entity: { eid: o }, doc: { title: o } }],
    ],
  ]),
]

for (let [door, writes] of doors) {
  test(`a call written by ${door} asks the app's worker as its writer`, async () => {
    await using p = platform()
    let { env } = p
    let { space, app } = await seeded(env, 'private')
    let asked: { person: string | null; role: string | null }[] = []
    env.DISPATCH = {
      get: () => ({
        fetch: (req: Request) => {
          asked.push({
            person: req.headers.get('x-yak-person'),
            role: req.headers.get('x-yak-role'),
          })
          return Promise.resolve(Response.json({}))
        },
      }),
    } as Dispatch
    let store = appStore(env.STORE, space, app)
    let send = async (path: string, body: unknown) => {
      let res = await store(path, {
        method: 'POST',
        body: JSON.stringify(body),
      }, ADA_OWNS)
      assertEquals(res.status, 200, await res.text())
    }
    await send('/tools', parseTools(words, []))
    for (let batch of writes(crypto.randomUUID())) await send('/apply', batch)
    await until(async () => {
      await p.object(storeName(space, app)).alarm()
      await p.settled()
      return asked.length
    }, { label: 'the worker asked' })
    assertEquals(asked, [{ person: ADA, role: 'owner' }])
  })
}
