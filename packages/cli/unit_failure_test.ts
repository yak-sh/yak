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

test('unit output is invocation-scoped, bounded and stripped of terminal escapes', async () => {
  let { unitOutput } = await import('./unit_failure.ts')
  let calls: string[][] = []
  let text = await unitOutput({
    unit: 'probe.service',
    invocation: 'a'.repeat(32),
  }, (command, args) => {
    calls.push([command, ...args])
    return Promise.resolve({
      code: 0,
      stdout: '\x1b[31m' + 'x'.repeat(9000) + '\x1b[0m',
    })
  })
  equal(text, 'x'.repeat(8192))
  equal(calls[0].includes('_SYSTEMD_INVOCATION_ID=' + 'a'.repeat(32)), true)
  equal(calls[0].includes('_SYSTEMD_USER_UNIT=probe.service'), true)
})

test('unit output falls back for an unreadable journal and tolerates missing access', async () => {
  let { unitOutput } = await import('./unit_failure.ts')
  let calls: string[] = []
  let exit = { unit: 'probe.service', invocation: 'a'.repeat(32) }
  equal(
    await unitOutput(exit, (command) => {
      calls.push(command)
      return Promise.resolve({
        code: 0,
        stdout: command == 'sudo' ? 'startup failed\n' : '',
      })
    }),
    'startup failed',
  )
  equal(calls, ['journalctl', 'sudo'])
  equal(
    await unitOutput(exit, () => {
      throw new Error('no journal')
    }),
    '',
  )
  equal(
    await unitOutput({ unit: 'probe.service' }, () => {
      throw new Error('not called')
    }),
    '',
  )
})

test('unit failure report carries output without changing the error identity', async () => {
  let exit = { unit: 'probe.service', result: 'exit-code' }
  let seen = false
  await reportUnit(exit, (error, tags) => {
    equal(error.name, 'SystemdUnitFailure')
    equal(error.message, unitFailure(exit)?.message)
    equal(tags.stderr, 'Failed to start inspector: Address already in use')
    seen = true
    return Promise.resolve()
  }, () => Promise.resolve('Failed to start inspector: Address already in use'))
  equal(seen, true)
})
