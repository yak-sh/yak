// Provider receipts preserve both Operator letter and answer threading.
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
    operator_answer: { text: 'Done.' },
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
  let [index, name, kind] of [[0, 'mail', 'mail'], [
    1,
    'operator_answer',
    'answer',
  ]] as const
) {
  test(`an Operator ${kind} receipt threads the same stored words once`, async () => {
    let row = letters[index]
    let before = writes
    let request = { letter: row.entity.eid, id: 'thread@example.com', kind }
    equal((await operatorReceipt(operator, request)).status, 200)
    equal((await operatorReceipt(operator, request)).status, 200)
    equal((row[name] as Comp).message_id, 'thread@example.com')
    equal(writes - before, 1)
  })
}
