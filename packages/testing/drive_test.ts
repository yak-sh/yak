import { afterAll, equal, kept, ok, test } from './mod.ts'
import { drive } from './drive.ts'
import { release } from './run.ts'
import { from, type Test } from './suite.ts'

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
  equal(Object.keys(result.took), ['first.ts', 'second.ts'])
  equal(result.loading, Object.values(result.loads).reduce((a, b) => a + b, 0))
})

test('a full runtime loads no more files and leaves them for another', async () => {
  let loaded: string[] = []
  let result = await drive(['a.ts', 'b.ts', 'c.ts'], (path) => {
    loaded.push(path)
    return Promise.resolve([])
  }, { full: () => loaded.length == 2 })
  equal([loaded, result.rest], [['a.ts', 'b.ts'], ['c.ts']])
})

test('a file ends once its tests have run, before the next loads, and a failed end is its own', async () => {
  let events: string[] = []
  let result = await drive(['a.ts', 'b.ts'], (path) => {
    from(path)
    events.push(`load ${path}`)
    afterAll(() => events.push(`${path} opened first`))
    return Promise.resolve([{
      file: path,
      name: `${path} test`,
      tags: [],
      skip: false,
      body: () => {
        events.push(`${path} test`)
        afterAll(() => {
          events.push(`${path} opened last`)
          if (path == 'b.ts') throw new Error('would not close')
        })
      },
    }])
  })
  equal(events, [
    'load a.ts',
    'a.ts test',
    'a.ts opened last',
    'a.ts opened first',
    'load b.ts',
    'b.ts test',
    'b.ts opened last',
    'b.ts opened first',
  ])
  equal(
    result.outcomes.map((o) => [o.test.name, o.ok]),
    [['a.ts test', true], ['b.ts test', true], ['b.ts ends', false]],
  )
})

test("what a file kept outlives it until the runtime releases it, and a failed release is that file's", async () => {
  let events: string[] = []
  await drive(['a.ts', 'b.ts'], (path) => {
    from(path)
    events.push(`load ${path}`)
    kept(() => {
      events.push(`${path} released`)
      if (path == 'b.ts') throw new Error('would not close')
    })
    return Promise.resolve([])
  })
  events.push('ran')
  let released = await release(1_000)
  equal(events, [
    'load a.ts',
    'load b.ts',
    'ran',
    'b.ts released',
    'a.ts released',
  ])
  equal(released.map((o) => [o.test.name, o.ok]), [['b.ts releases', false]])
  equal(await release(1_000), [])
})
