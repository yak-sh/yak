// The CLI manual's table is the contract: every registered route answers
// help, and the same entries reject malformed arguments before dispatch.

import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import { commands } from './commands.ts'
import {
  help,
  manuals,
  requestedHelp,
  route,
  usage,
  validate,
  validateCommand,
} from './manual.ts'

Deno.test('every CLI route and palette command answers help from its table', () => {
  for (let [name, manual] of Object.entries(manuals)) {
    let args = name == 'subject' ? ['T-3'] : name.split(' ')
    let out = requestedHelp([...args, '--help'])
    assert(out, `${name} has help`)
    assertMatch(out, /^task /)
    for (let option of manual.options ?? []) {
      assert(
        manual.usage.includes(option.name),
        `${name} documents ${option.name}`,
      )
    }
  }
  for (let name of Object.keys(commands)) {
    assertMatch(requestedHelp([`:${name}`, '--help']) ?? '', /^task :/)
  }
})

Deno.test('help topics cover nested and colon vocabularies', () => {
  assertMatch(help(['mail', 'send']), /^task mail send/)
  assertMatch(help(['session', 'brief']), /^task session brief/)
  assertMatch(help(['fix']), /^task :fix/)
  assertMatch(help([':fix']), /^task :fix/)
  assertThrows(
    () => help(['grammar', 'extra']),
    Error,
    'no such help topic',
  )
  assertThrows(() => help([':fix', 'extra']), Error, 'no such help topic')
})

Deno.test('deprecated routes leave the index but keep their manuals', () => {
  let index = usage()
  for (let [name, manual] of Object.entries(manuals)) {
    if (!manual.deprecated) continue
    if (manual.root) {
      assertEquals(index.includes(`task ${manual.usage}`), false, name)
    }
    let direct = help(name.split(' '))
    assertMatch(direct, /^task /)
    assert(direct.includes(`Deprecated: ${manual.deprecated}`), name)
  }
  assertThrows(
    check('dep', []),
    Error,
    'deprecated: superseded by task <id> <type> <child> [--gone]',
  )
})

let check = (name: string, args: string[]) => {
  let selected = route(name.split(' ')[0], [
    ...name.split(' ').slice(1),
    ...args,
  ])!
  return () => validate(selected.name, selected.manual, selected.args)
}

Deno.test('manual validation rejects loss-shaped arguments', () => {
  let cases: [string, string[], string][] = [
    ['show', ['T-1', 'extra'], 'expected 1 argument, got 2'],
    ['claim', ['T-1', 'sess', 'extra'], 'expected 1–2 arguments, got 3'],
    ['spawn', ['T-1', 'extra'], 'expected 1 argument, got 2'],
    ['backup', ['extra'], 'expected 0 arguments, got 1'],
    ['history', ['T-1', '-n'], '-n needs a positive number'],
    ['history', ['T-1', '-n0'], '-n needs a positive number'],
    ['mail files', ['E-1', '--out'], '--out needs a directory'],
    ['mail reply', ['E-1'], 'needs reply words or --body='],
    ['mail send', ['jeff', 'subject'], 'needs --body='],
    ['comment', ['T-1'], 'needs comment text or --verdict='],
    ['session brief', [], 'needs brief text or --body='],
    ['telemetry', ['-n', '--errors'], '-n needs a positive number'],
    ['wrap', ['sid', '--body=@x'], 'task session brief --body=…'],
  ]
  for (let [name, args, message] of cases) {
    assertThrows(check(name, args), Error, message)
  }
})

Deno.test('manual validation accepts each supported option shape', () => {
  check('history', ['T-1', '-n', '2', '--json'])()
  check('history', ['T-1', '-n2'])()
  check('mail files', ['E-1', '--out', 'tmp'])()
  check('mail files', ['E-1', '--out=tmp'])()
  check('comment', ['T-1', '--verdict=approved'])()
})

Deno.test('palette validation rejects CLI flags before command dispatch', () => {
  assertThrows(
    () => validateCommand('fix', ['--project=P-1', 'broken']),
    Error,
    ':fix does not take --project — writes use .prop=value',
  )
  validateCommand('mail', ['jeff', 'subject', '--', 'body'])
  assertThrows(
    () => validateCommand('done', ['extra']),
    Error,
    ':done expected 0–0 arguments',
  )
})
