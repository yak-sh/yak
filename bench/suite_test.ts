import { equal, test } from '@yaks/testing'
import { paths, record, type Sample, suiteOf } from './suite.ts'

let sample = (seconds = 10, cpuSeconds = 1, code = 0): Sample => ({
  seconds,
  cpuSeconds,
  code,
  at: '',
})
let fixture = () => {
  let stored = new Map<string, string>()
  return {
    stored,
    host: () => ({
      config: {},
      configURL: null,
      commit: null,
      runtime: 'test',
      cpu: 'test',
      load: [],
    }),
    files: {
      read: (path: string) =>
        stored.has(path)
          ? Promise.resolve(stored.get(path)!)
          : Promise.reject(new Deno.errors.NotFound(path)),
      write: (path: string, value: unknown) => {
        stored.set(path, JSON.stringify(value))
        return Promise.resolve()
      },
    },
  }
}
for (let name of ['check', 'test']) {
  test(`CPU ${name} ignores wall delay and refuses regression without accepting new numbers`, async () => {
    let options = { ...paths(name), ...fixture() }
    await record(name, sample(), options, true)
    let before = options.stored.get(options.baseline)
    equal((await record(name, sample(20), options)).verdict, 'passed')
    equal((await record(name, sample(26, 1.3), options)).verdict, 'regressed')
    equal((await record(name, sample(1, 1, 7), options)).verdict, 'measured')
    equal(options.stored.get(options.baseline), before)
    equal(
      suiteOf('test', 'deno', ['task', 'test', '--tag=deno', 'workers']),
      'test --tag=deno workers',
    )
  })
}

test('long narrowed command names retain distinct durable measurements', async () => {
  let storage = fixture()
  let names = [1, 2].map((n) => 'test ' + 'packages/example/'.repeat(30) + n)
  let outputs: string[] = []
  for (let name of names) {
    let options = { ...paths(name), ...storage }
    outputs.push(options.output)
    await record(name, sample(), options)
    equal(
      JSON.parse(storage.stored.get(options.output)!).suite,
      'suite/' + name,
    )
  }
  equal(new Set(outputs).size, 2)
})
