import { cleanup, equal, test } from './mod.ts'
import { one, owed, timed } from './run.ts'

test('CPU timing brackets async work and cleanup and reaches the budget report', async () => {
  let cpu = 100
  let outcome = await one(
    {
      name: 'suspended work',
      file: 'a_test.ts',
      tags: [],
      skip: false,
      body: async () => {
        cleanup(() => cpu += 0.25)
        cpu += 0.5
        await Promise.resolve()
        cpu += 0.25
      },
    },
    1000,
    () => cpu,
  )
  equal([outcome.ok, outcome.cpu], [true, 1])
  let report = timed([outcome], {
    wall: 9000,
    planned: 0,
    loading: 0,
    loads: {},
    remembered: {},
    left: 0,
  })
  equal(report.tests[0].cpu, 1)
  let line = { 'a_test.ts': { 'suspended work': 1 } }
  let waited = { ...outcome, ms: 9000 }
  let busy = { ...outcome, cpu: 2, ms: 0.1 }
  equal(owed(line, [waited]), [])
  equal(owed(line, [busy]), ['a_test.ts'])
})
