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
    { avg: 100e6, cpu: 2e6, n: 4, cpuSamples: [2e6] },
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
      { avg: 20e6, cpu: 3e6, n: 2, cpuSamples: [3e6] },
    )
  }
})

test('calibration and cold compilation are excluded from retained CPU batches', async () => {
  let time = clock(), calls = 0
  let measured = await invocation(
    {
      name: 'cold',
      warmup: 5,
      fn: () => time.work(++calls <= 6 ? 100 : 2),
    },
    time.timer,
    1,
  )
  equal(measured.cpu, 2e6)
  equal(measured.cpuSamples, [2e6])
})

test('a declared invocation count does not multiply expensive fixture setup', async () => {
  let time = clock(), calls = 0
  let measured = await invocation({
    name: 'expensive fixture',
    n: 2,
    warmup: 1,
    fn: (b) => {
      calls++
      time.work(100)
      b.start()
      time.work(.001)
      b.end()
      time.work(100)
    },
  }, time.timer)
  equal(calls, 3)
  equal(measured.n, 2)
})

test('adaptive calibration counts fixture CPU when bounding the batch size', async () => {
  let time = clock(), calls = 0
  let measured = await invocation({
    name: 'expensive adaptive fixture',
    warmup: 0,
    fn: (b) => {
      calls++
      time.work(100)
      b.start()
      time.work(.001)
      b.end()
    },
  }, time.timer)
  equal(measured.n, 1)
  equal(calls, 2)
})
