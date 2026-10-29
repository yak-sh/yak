import { equal, test } from '@yaks/testing'
import { others, reportUnit, unitFailure } from './unit_failure.ts'

// What `yak-web@a.service` stopping cleanly leaves: user systemd lists the
// `active` units, of which `ready` hold their ready file, while the manager
// says `state`. Answers the report's name, or null for none.
let stop = async (
  unit: string,
  active: string[],
  ready: string[] = [],
  state = 'running',
) => {
  let count = await others(
    unit,
    '/run/user/1000/',
    (_, args) =>
      Promise.resolve({
        code: 0,
        stdout: args.includes('is-system-running')
          ? `${state}\n`
          : active.map((u) => `yak-web@${u}.service loaded active running\n`)
            .join(''),
      }),
    (path) =>
      Promise.resolve(
        ready.some((i) => path == `/run/user/1000/yak-web-${i}.ready`),
      ),
  )
  return unitFailure({ unit, result: 'success', others: count })?.name ?? null
}

for (
  let [name, active, ready, state, expected] of [
    [
      'an in-place restart of the only web',
      [],
      [],
      'running',
      'SystemdUnitAlone',
    ],
    [
      'a stop listed beside its own ready file',
      ['a'],
      ['a'],
      'running',
      'SystemdUnitAlone',
    ],
    [
      'a replacement started but not ready',
      ['b'],
      [],
      'running',
      'SystemdUnitAlone',
    ],
    ['a ready-first handover', ['b'], ['b'], 'running', null],
    ['a manager shutting down', [], [], 'stopping', null],
  ] as const
) {
  test(`a clean stop reports ${expected ?? 'nothing'} for ${name}`, async () => {
    equal(
      await stop('yak-web@a.service', [...active], [...ready], state),
      expected,
    )
  })
}

test('a unit that is no template instance is never asked about others', async () => {
  equal(
    await others('yak-restart.service', '/run', () => {
      throw new Error('not called')
    }),
    undefined,
  )
})

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
