import { equal, ok, test } from '@yaks/testing'
import { cpuConsumers, cpuWatch } from './cpu_starvation.ts'

test('CPU attribution ranks the units that used CPU during the sample', () => {
  equal(
    cpuConsumers(
      ['/a/yak-work@old.service', '/a/yak-web@new.service', '/b/exited.scope'],
      [8e6, 2e6, 1e6],
      [8.5e6, 3e6, NaN],
      1000,
    ),
    'Top local cgroups over the next 1.0 s: yak-web@new.service (1.00 CPU s), yak-work@old.service (0.50 CPU s)',
  )
})

test('waiting readers share one CPU incident report with the top consumer', async () => {
  let now = 0, last = -Infinity
  let options = {
    now: () => now,
    reserve: (at: number) => {
      let quiet = at - last >= 30_000
      last = at
      return Promise.resolve(quiet)
    },
    sample: () => Promise.resolve('yak-work@replacement.service (1.00 CPU s)'),
  }
  let first = cpuWatch(options), second = cpuWatch(options)
  let reports: Error[] = []
  let report = (error: Error) => void reports.push(error)
  await Promise.all([
    first('worker one waited 6.2 s', report),
    first('worker two waited 4.1 s', report),
    second('worker three waited 3.0 s', report),
  ])
  equal(reports.length, 1)
  equal(reports[0].name, 'CPUStarvation')
  ok((reports[0].cause as Error).message.includes('yak-work@replacement'))
  now += 20_000
  await second('worker three still waiting', report)
  now += 11_000
  await first('worker one still waiting', report)
  equal(reports.length, 1)
  now += 31_000
  await second('worker three waited another 3.0 s', report)
  equal(reports.length, 2)
})
