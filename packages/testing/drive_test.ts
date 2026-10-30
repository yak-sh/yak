import { equal, ok, test } from './mod.ts'
import { drive } from './drive.ts'
import type { Test } from './suite.ts'

test('files load and execute in order, retaining reports without fixture bodies', async () => {
  let events: string[] = []
  let declared = (file: string, name: string, fail = false): Test => ({
    file,
    name,
    tags: [],
    skip: false,
    body: () => {
      events.push(name)
      if (fail) throw Error(name)
    },
  })
  let result = await drive(['first.ts', 'second.ts'], (path) => {
    events.push(`load ${path}`)
    return Promise.resolve(
      path == 'first.ts'
        ? [declared(path, 'passed'), declared(path, 'failed', true)]
        : [declared(path, 'continued')],
    )
  })
  equal(events, [
    'load first.ts',
    'passed',
    'failed',
    'load second.ts',
    'continued',
  ])
  equal(result.outcomes.map((o) => o.ok), [true, false, true])
  equal(result.outcomes.map((o) => o.test.file), [
    'first.ts',
    'first.ts',
    'second.ts',
  ])
  ok(result.outcomes.every((o) => !Object.hasOwn(o.test, 'body')))
  equal(Object.keys(result.loads), ['first.ts', 'second.ts'])
  equal(result.loading, Object.values(result.loads).reduce((a, b) => a + b, 0))
})
