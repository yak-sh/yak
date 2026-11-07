import { cleanup, equal, test } from './mod.ts'
import { apart, one, timed } from './run.ts'

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
})

// What a test heard on the global error events, and what failed it, when its
// body `listens` then reports an error; `cancel` handles what it hears.
let reported = async (
  listens: (hear: (e: Event) => void) => void,
  cancel = true,
  report = () => reportError(new Error('lost')),
) => {
  apart()
  let heard: string[] = []
  let o = await one(
    {
      name: 'reports',
      file: 'a_test.ts',
      tags: [],
      skip: false,
      body: async () => {
        listens((e) => {
          if (cancel) e.preventDefault()
          heard.push(e.type)
        })
        report()
        await new Promise((go) => setTimeout(go, 0))
      },
    },
    1000,
    () => 0,
  )
  apart()
  return { heard, errors: o.errors.map(String) }
}

test("a file's global error listener hears an error, and one it cancels fails no test", async () => {
  let lost = ['Error: lost']
  let on = (type: string) => (hear: (e: Event) => void) =>
    globalThis.addEventListener(type, hear)
  equal(await reported(() => {}), { heard: [], errors: lost })
  equal(await reported(on('error')), { heard: ['error'], errors: [] })
  equal(await reported(on('error'), false), { heard: ['error'], errors: lost })
  equal(
    await reported((hear) => globalThis.onerror = (e) => hear(e as Event)),
    {
      heard: ['error'],
      errors: [],
    },
  )
  equal(
    await reported(on('unhandledrejection'), true, () => {
      Promise.reject(new Error('lost'))
    }),
    { heard: ['unhandledrejection'], errors: [] },
  )
  equal(
    await reported((hear) => {
      on('error')(hear)
      apart()
    }),
    { heard: [], errors: lost },
  )
})
