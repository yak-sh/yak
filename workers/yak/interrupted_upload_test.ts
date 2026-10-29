// An unread request body never reaches graph writes or the defect tracker.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { within } from './defects.ts'
import { Store } from './graph.ts'
import { state } from './testing.ts'
import { doorOf } from './door.ts'
import { KERNEL, metaOf } from './meta.ts'

let store = new Store(state('ada/notes'))
let door = doorOf((r) => store.fetch(r), 'ada/notes')
await door('/vocab', { method: 'POST', body: '{}' }, KERNEL)

test('an interrupted request keeps no graph rows, write receipts or reports', async () => {
  let rows: Bundle[] = []
  await within(
    {
      ERRORS: {
        send: (batch) => {
          rows.push(...batch)
          return Promise.resolve()
        },
      },
    },
    {},
    async () => {
      let eid = crypto.randomUUID()
      for (let path of ['/apply', '/apply?check=1', '/vocab']) {
        let sent = false
        let body = new ReadableStream<Uint8Array>({
          pull: (c) => {
            if (!sent) {
              sent = true
              c.enqueue(new TextEncoder().encode(JSON.stringify([{
                entity: { eid },
                doc: { title: 'Interrupted upload' },
              }])))
            } else {
              c.error(
                new TypeError(
                  "Can't read from request stream because client disconnected.",
                ),
              )
            }
          },
        })
        let response = await door(path, { method: 'POST', body }, KERNEL)
        equal(response.status, 400)
        await response.body?.cancel()
      }
      equal(await metaOf(door).query(`.entity.eid=${eid}`), [])
      equal(await (await door('/writes', {}, KERNEL)).json(), [])
    },
  )
  equal(rows, [])
})
