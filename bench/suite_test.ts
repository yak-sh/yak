import { equal, test } from '@yaks/testing'
import { paths, record, type Sample, suiteOf, timed } from './suite.ts'

let sample = (seconds = 10, controlSeconds = .05, code = 0): Sample => ({
  seconds,
  controlSeconds,
  code,
  samples: 10,
  at: '',
})
for (let name of ['check', 'test']) {
  test(`wall-clock ${name} cancels load and refuses regression without accepting new numbers`, async () => {
    let directory = await Deno.makeTempDir()
    let options = {
      baseline: directory + '/baseline.json',
      output: directory + '/results.json',
    }
    try {
      await record(name, sample(), options, true)
      let before = await Deno.readTextFile(options.baseline)
      equal((await record(name, sample(20, .1), options)).verdict, 'passed')
      equal((await record(name, sample(26, .1), options)).verdict, 'regressed')
      equal(
        (await record(name, sample(1, .05, 7), options)).verdict,
        'measured',
      )
      equal(await Deno.readTextFile(options.baseline), before)
      equal(
        suiteOf('test', 'deno', ['task', 'test:run', '--tag=deno', 'workers']),
        'test --tag=deno workers',
      )
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
}
test('wall-clock timer retains a short command exit status', async () => {
  let result = await timed('sh', ['-c', 'exit 7'])
  equal(result.code, 7)
  equal(result.samples > 0, true)
})

test('long narrowed command names retain distinct durable measurements', async () => {
  let directory = await Deno.makeTempDir()
  try {
    let names = [1, 2].map((n) => 'test ' + 'packages/example/'.repeat(30) + n)
    let outputs: string[] = []
    for (let name of names) {
      let location = paths(name)
      let options = {
        baseline: directory + '/' + location.baseline.split('/').at(-1),
        output: directory + '/' + location.output.split('/').at(-1),
      }
      outputs.push(options.output)
      await record(name, sample(), options)
      equal(
        JSON.parse(await Deno.readTextFile(options.output)).suite,
        'suite/' + name,
      )
    }
    equal(new Set(outputs).size, 2)
  } finally {
    await Deno.remove(directory, { recursive: true })
  }
})
