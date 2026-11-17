// A provider's receipt threads each Operator letter once: one it wrote, and
// one carrying an answer.
import { equal, test } from '@yaks/testing'
import type { ApplyOpts, Bundle, Comp } from '@yaks/graph'
import { operatorReceipt } from './operator-host.ts'

let letters: Bundle[] = [
  {
    entity: { eid: '73ba70db-fb80-486f-a195-aee2e518ec9a' },
    mail: { from: 'operator@yaks.app' },
  },
  {
    entity: { eid: '3e8382d2-6b7e-4a5a-aa5a-2c201bf8d96a' },
    mail: { from: 'operator@yaks.app', target: 'the answer it carries' },
    deliver: { to: 'ana@example.com' },
  },
  {
    entity: { eid: '0d7c1f2e-5b8a-4c3d-9e6f-1a2b3c4d5e6f' },
    mail: { from: 'operator@yaks.app', reply_to: 'a letter it answers' },
    deliver: { to: 'clerk@example.com' },
  },
]
let writes = 0
let operator = {
  store: {
    g: {
      get: (ids: string[]) =>
        Promise.resolve(letters.filter((row) => ids.includes(row.entity.eid))),
      apply: (batch: Bundle[], options?: ApplyOpts) => {
        equal(options?.trusted, true)
        for (let patch of batch) {
          let row = letters.find((row) => row.entity.eid == patch.entity.eid)!
          for (let [key, value] of Object.entries(patch)) {
            if (key != 'entity') {
              row[key] = {
                ...row[key] as Comp,
                ...value as Comp,
              }
            }
          }
        }
        writes++
        return Promise.resolve(batch)
      },
    },
  },
}
for (
  let [index, kind] of [
    [0, 'letter'],
    [1, 'answer'],
    [2, 'emailed reply'],
  ] as const
) {
  test(`an Operator ${kind} receipt threads the same stored words once`, async () => {
    let row = letters[index]
    let before = writes
    let request = { letter: row.entity.eid, id: 'thread@example.com' }
    equal((await operatorReceipt(operator, request)).status, 200)
    equal((await operatorReceipt(operator, request)).status, 200)
    equal((row.mail as Comp).message_id, 'thread@example.com')
    equal(writes - before, 1)
  })
}
