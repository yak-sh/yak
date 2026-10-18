import { equal, test } from '@yaks/testing'
import { reportUnit, unitFailure } from './unit_failure.ts'

for (
  let result of [
    'timeout',
    'signal',
    'exit-code',
    'core-dump',
    'watchdog',
    'resources',
  ]
) {
  test(`a systemd ${result} reaches the reporter with exit metadata`, async () => {
    let exit = {
      unit: 'yak-web@probe.service',
      result,
      code: 'killed',
      status: 'KILL',
      invocation: 'invocation',
    }
    let reports: {
      name: string
      message: string
      tags: Record<string, string>
    }[] = []
    await reportUnit(exit, (error, tags) => {
      reports.push({ name: error.name, message: error.message, tags })
      return Promise.resolve()
    })
    equal(reports.length, 1)
    equal(reports[0].name, 'SystemdUnitFailure')
    equal(reports[0].tags, exit)
  })
}

test('successful and non-systemd exits do not report', async () => {
  equal(unitFailure({ unit: 'yak-web@probe.service' }), undefined)
  equal(
    unitFailure({
      unit: 'yak-web@probe.service',
      result: 'success',
      status: '143',
    }),
    undefined,
  )
  let calls = 0
  await reportUnit({ unit: 'yak-web@probe.service', result: 'success' }, () => {
    calls++
    return Promise.resolve()
  })
  equal(calls, 0)
})
