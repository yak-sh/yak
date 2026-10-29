import { equal, test } from '@yaks/testing'
import { invocation } from './invocations.ts'

let clock = () => {
  let cpu = 0, value = 0
  return {
    work: (used: number, waited = used) => {
      cpu += used
      value += waited
    },
    timer: () => {
      let start = { cpu, value }
      return () => ({ cpu: cpu - start.cpu, value: value - start.value })
    },
  }
}

test('CPU batches normalize work while keeping wall waits diagnostic', async () => {
  let time = clock()
  equal(
    await invocation(
      {
        name: 'batch',
        n: 4,
        warmup: 0,
        fn: () => time.work(2, 100),
      },
      time.timer,
      1,
    ),
    { avg: 100e6, cpu: 2e6, n: 4, cpuSamples: [2e6, 2e6, 2e6, 2e6, 2e6] },
  )
})

test('explicit CPU boundaries exclude setup and teardown for sync and async work', async () => {
  for (let async of [false, true]) {
    let time = clock()
    let run = (b: Deno.BenchContext) => {
      time.work(100)
      b.start()
      time.work(3, 20)
      b.end()
      time.work(200)
    }
    equal(
      await invocation(
        {
          name: 'bounded',
          n: 2,
          warmup: 0,
          fn: async ? (b) => Promise.resolve(run(b)) : run,
        },
        time.timer,
        1,
      ),
      { avg: 20e6, cpu: 3e6, n: 2, cpuSamples: [3e6, 3e6, 3e6, 3e6, 3e6] },
    )
  }
})
