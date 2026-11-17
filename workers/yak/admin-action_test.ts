import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { audit } from './admin-action.ts'
import { within } from './defects.ts'
import type { Env } from './env.ts'

let reports: Bundle[][] = []
let env = {
  STORE: {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.reject(Error('audit storage unavailable')),
    }),
  },
  ERRORS: {
    send: (rows: Bundle[]) => Promise.resolve(void reports.push(rows)),
  },
} as unknown as Env

test('an audit outage reports its cause and lets the action continue', async () => {
  let continued = false
  await within(env, { request: 'admin audit proof' }, async () => {
    await audit(env, { person: crypto.randomUUID(), role: 'owner' }, {
      operation: 'move',
      store: 'checks/notes',
    })
    continued = true
  })
  equal(continued, true)
  equal(reports.length, 1)
  equal(
    (reports[0][0].exception as { value: string }).value.includes(
      'audit storage unavailable',
    ),
    true,
  )
})
