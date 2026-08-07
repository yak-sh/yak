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
    ['mail reply', ['E-1'], 'needs reply words, @file, or --body='],
    ['mail send', ['jeff', 'subject'], 'needs --body='],
    ['comment', ['T-1'], 'needs comment text, .body=@-|@file, or --verdict='],
    ['session brief', [], 'needs brief text, @file, or --body='],
    ['telemetry', ['-n', '--errors'], '-n needs a positive number'],
    ['wrap', ['sid', '--body=@x'], 'task session brief --body=…'],
    // A RETIRED flag names its replacement instead of "does not take": the
    // habit outlives the mechanism, so the refusal has to answer the
    // caller's question, not just the grammar's (T-12585).
    ['remember', ['a fact', '--type=feedback'], '--feedback=jeff says who'],
    ['remember', ['a fact', '--nonsense=1'], 'does not take --nonsense'],
    // The dot spelling of the same mistake — the one a title door used to
    // swallow (T-14187). The refusal names the argument AND the params the
    // verb does take, so the correction is on the screen that refuses it.
    ['design', ['A title', '.project=P-19'], 'does not take .project='],
    ['design', ['A title', '.project=P-19'], 'it takes .body='],
    ['remember', ['a fact', '.feddback=jeff'], 'does not take .feddback='],
    ['mail send', ['jeff', 'Subject', '.oops=1'], 'does not take .oops='],
    ['comment', ['T-1', 'text', '.oops=1'], 'does not take .oops='],
    ['claim', ['T-1', '.session=S-3'], 'does not take .session='],
    // An unscoped stop must never be read as "stop everything".
    ['role stop', [], 'name at least one role, or --all'],
    ['role start', [], 'name at least one role, or --all'],
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
  // A comment body rides the same door a task body does, at either spelling —
  // and it is a VALUE, so the id is still the one word the verb needs.
  check('comment', ['T-1', '.body=@notes.md'])()
  check('comment', ['T-1', '--body=@-'])()
  check('role stop', ['R-1'])()
  check('role stop', ['--all'])()
  check('role start', ['R-1', 'R-2'])()
  // The body at the dot spelling, where the verb declares it — and it is a
  // VALUE, so it never counts toward the words the title needs.
  check('design', ['A title', '.body=@plan.md'])()
  check('remember', [
    'a fact',
    '.body=@m.md',
    '.scope=P-19',
    '.feedback=jeff',
  ])()
  check('mail send', ['jeff', 'Subject', '.body=@letter.md'])()
  check('spawn', ['T-1', '.provider=codex'])()
  // A verb whose grammar IS the filter/write params keeps every one of them.
  check('list', ['.status=open', '.priority<=1'])()
  check('set', ['T-1', '.status=done'])()
  check('search', ['.project=P-19', 'deploy'])()
})

// A verb that takes its title as "everything left over" turns any argument it
// does not know into silent corruption, so the DEFAULT is refusal: a verb
// declares the params it reads (`dots`), and everything else is named back to
// the caller. Written as a sweep over the whole table because the point is the
// next verb — one written by subtraction tomorrow inherits the guard instead
// of having to remember it (T-14187).
Deno.test('a verb refuses any dot-param it does not declare, by name', () => {
  for (let [name, manual] of Object.entries(manuals)) {
    if (manual.dots || manual.passthrough) continue
    assertThrows(
      () => validate(name, manual, ['.zzz=1']),
      Error,
      'does not take .zzz=',
    )
    // The usage line rides every refusal, so the working form is right there.
    assertThrows(() => validate(name, manual, ['.zzz=1']), Error, manual.usage)
  }
  // A word that merely opens with a dot is prose, and stays prose.
  validate('design', manuals.design, ['.gitignore', 'handling'])
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
