// The CLI manual's table is the contract: every registered route answers
// help, and the same entries reject malformed arguments before dispatch.

import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import { commands } from './commands.ts'
import {
  help,
  manuals,
  parse,
  requestedHelp,
  route,
  usage,
  validate,
  validateCommand,
} from './manual.ts'
import { edges, plurals } from './types.ts'
import { usageOf } from './verb.ts'

Deno.test('every CLI route and palette command answers help from its table', () => {
  for (let name of Object.keys(manuals)) {
    let args = name == 'subject' ? ['T-3'] : name.split(' ')
    let out = requestedHelp([...args, '--help'])
    assert(out, `${name} has help`)
    assertMatch(out, /^task /)
  }
  for (let name of Object.keys(commands)) {
    assertMatch(requestedHelp([`:${name}`, '--help']) ?? '', /^task :/)
  }
})

Deno.test('every verb usage is rendered from its declaration', () => {
  assertEquals(
    Object.fromEntries(
      Object.entries(manuals).map(([name, manual]) => [
        name,
        usageOf(manual),
      ]),
    ),
    {
      tui: 'tui',
      claude: 'claude [claude args…] [--operator]',
      codex: 'codex [codex args…] [--operator]',
      list: 'list [kind] [filters…] [--json]',
      decided: 'decided [filters…] [--all] [--json]',
      docs: 'docs [filters…] [--json]',
      stale: 'stale [filters…] [--all] [--json]',
      new: 'new [title…]',
      set: 'set <id> [--comment=TEXT]',
      edit: 'edit <id> <old> [new] [--all]',
      show: 'show <id> [--json] [--quarantined]',
      history: 'history <id> [-n=50] [--json]',
      undo: 'undo <id>',
      transcript:
        'transcript <id> [--prose] [--seq=RANGE] [--after=N] [--limit=N] [--since=ISO] [--until=ISO] [--json]',
      search: 'search [words…] [--json]',
      doctor: 'doctor',
      mail: 'mail [filters…] [--json] [--all] [--sent]',
      'mail show': 'mail show <id> [--json]',
      'mail send': 'mail send <to> <subject…> --body=BODY',
      'mail reply': 'mail reply <id> [text…] [--body=BODY]',
      'mail search': 'mail search <words…>',
      'mail files': 'mail files <id> [--out=DIR]',
      'mail doctor': 'mail doctor',
      backfill: 'backfill',
      'backfill worked': 'backfill worked',
      watch: 'watch <id> [--gone]',
      mute: 'mute <id> [--gone]',
      inbox: 'inbox [filters…] [--json] [--all] [--sent]',
      'inbox show': 'inbox show <id> [--json]',
      'inbox archive': 'inbox archive <id>',
      claim: 'claim <id> [session]',
      release: 'release <id>',
      block: 'block <id> [reason…]',
      unblock: 'unblock <id>',
      delete: 'delete <id> [--cascade] [--force]',
      forget: 'forget <id> [--cascade] [--force]',
      subject: '<id> [show|is|as|edge] …',
      spawn: 'spawn <id> [--provider=PROVIDER] [--model=MODEL] ' +
        '[--effort=high] [--persona=ID]',
      land: 'land',
      comment: 'comment <id> [text…] [--body=BODY] [--verdict=VERDICT]',
      meta: 'meta [text…] [--body=BODY]',
      dep: 'dep <id> <type> <child> [--gone]',
      backup: 'backup',
      sync: 'sync [--no-commit] [--check]',
      design: 'design <title…> [--body=BODY]',
      dream: 'dream <project>',
      remember:
        'remember <title…> [--body=BODY] [--feedback=TEXT] [--scope=ID]',
      session: 'session [command…]',
      'session context': 'session context [sid] [--hook] [--subagent]',
      'session wrap': 'session wrap [sid] [--hook]',
      'session brief': 'session brief [text…] [--body=BODY]',
      'session turn': 'session turn [idle|busy] [sid] [--hook]',
      role: 'role [command…] [--json]',
      'role stop': 'role stop [ids…] [--all]',
      'role start': 'role start [ids…] [--all]',
      'role pause': 'role pause [ids…] [--all]',
      'role resume': 'role resume [ids…] [--all]',
      'role disable': 'role disable [ids…] [--all]',
      'role retire': 'role retire [ids…] [--all]',
      probes: 'probes [--all] [--reap] [--grace=30]',
      telemetry: 'telemetry [--errors] [--stats] [--since=ISO] [-n=N]',
      usage: 'usage [filters…] [--by=DIM] [--json]',
      wake: 'wake <who> [when…] [target] [--body=BODY] [--gone]',
      ':': ':<command> … | <id> :<command> …',
      help: 'help [verb|grammar|:] [nested verb]',
      complete: 'complete [words…]',
      ls: 'ls [filters…] [--json]',
      context: 'context [sid] [--hook] [--subagent]',
      wrap: 'wrap [sid] [--hook]',
      create: 'create [title…]',
      rm: 'rm <id> [--cascade] [--force]',
    },
  )
})

Deno.test('help topics cover nested and colon vocabularies', () => {
  assertMatch(help(['mail', 'send']), /^task mail send/)
  assertMatch(help(['session', 'brief']), /^task session brief/)
  assertMatch(help(['fix']), /^task :fix/)
  assertMatch(help([':fix']), /^task :fix/)
  assertMatch(help(['chat']), /^task :chat/)
  assertMatch(help([':chat']), /^task :chat/)
  assertThrows(
    () => help(['grammar', 'extra']),
    Error,
    'no such help topic',
  )
  assertThrows(() => help([':fix', 'extra']), Error, 'no such help topic')
})

Deno.test('spawn help and parsing share the provider vocabulary', () => {
  let out = help(['spawn'])
  assert(out.includes('--provider=PROVIDER'))
  assert(out.includes('gpt-5.6-sol'))
  assertEquals(out.includes('gpt-5.4'), false)
  check('spawn', ['T-1', '--provider=ollama'])
  assertThrows(
    check('spawn', ['T-1', '--model=gpt-5.4']),
    Error,
    '--model needs model',
  )
})

Deno.test('deprecated routes leave the index but keep their manuals', () => {
  let index = usage()
  for (let [name, manual] of Object.entries(manuals)) {
    if (!manual.deprecated) continue
    if (manual.root) {
      assertEquals(index.includes(`task ${usageOf(manual)}`), false, name)
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
    [
      'mail reply',
      ['E-1'],
      'needs <text> or --body=<text, @file, - or @->',
    ],
    [
      'mail send',
      ['jeff', 'subject'],
      'needs --body=<text, @file, - or @->',
    ],
    [
      'comment',
      ['T-1'],
      'needs <text> or --body=<text, @file, - or @-> or --verdict=<verdict>',
    ],
    [
      'session brief',
      [],
      'needs <text> or --body=<text, @file, - or @->',
    ],
    // The space form is warm only when body is TRAILING (accepts test below).
    // A bare body option FOLLOWED by another option is not trailing, so it can
    // not safely swallow the rest — it names the value and the `=` spelling
    // rather than eating `--verdict` (T-18566/T-18481).
    [
      'comment',
      ['T-1', '--body', 'a note', '--verdict', 'approved'],
      '--body needs text, @file, - or @- — use --body=…',
    ],
    // A NON-body value option given bare keeps the `=` requirement — its value
    // is one token, never trailing, so the space form does not apply to it.
    [
      'comment',
      ['T-1', '--verdict', 'approved'],
      '--verdict needs verdict — use --verdict=…',
    ],
    ['telemetry', ['-n', '--errors'], '-n needs a positive number'],
    ['wrap', ['sid', '--body=@x'], 'task session brief --body=…'],
    // A RETIRED flag names its replacement instead of "does not take": the
    // habit outlives the mechanism, so the refusal has to answer the
    // caller's question, not just the grammar's (T-12585).
    ['remember', ['a fact', '--type=feedback'], '--feedback=jeff says who'],
    ['remember', ['a fact', '--nonsense=1'], 'does not take --nonsense'],
    // A creation verb that takes the standard property grammar still refuses a
    // dot that names no prop (a typo), rather than joining it to the title.
    ['design', ['A title', '.projct=P-19'], 'unknown prop: .projct'],
    ['remember', ['a fact', '.feddback=jeff'], 'does not take .feddback='],
    ['mail send', ['jeff', 'Subject', '.oops=1'], 'does not take .oops='],
    ['comment', ['T-1', 'text', '.oops=1'], 'does not take .oops='],
    ['claim', ['T-1', '.session=S-3'], 'does not take .session='],
    // An unscoped stop must never be read as "stop everything".
    ['role stop', [], 'needs <ids> or --all'],
    ['role start', [], 'needs <ids> or --all'],
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
  check('comment', ['T-1', '--verdict=approve'])()
  // A comment body rides the same door a task body does, at either spelling —
  // and it is a VALUE, so the id is still the one word the verb needs.
  check('comment', ['T-1', '.body=@notes.md'])()
  check('comment', ['T-1', '--body=@-'])()
  // The SPACE form of a trailing body option — `--body words…` — is the warm
  // path agents reach for; it binds the remaining words exactly as `--body=…`
  // would (T-18566/T-18481). Valid wherever body is the last thing on the line.
  check('comment', ['T-1', '--body', 'some', 'prose', 'here'])()
  check('remember', ['a', 'fact', '--body', 'the', 'lesson'])()
  check('set', [
    'T-1',
    '.status=done',
    '--comment',
    'verified',
    'end',
    'to',
    'end',
  ])()
  check('mail send', ['jeff', 'Subject', '--body', 'the', 'letter'])()
  check('role stop', ['R-1'])()
  check('role stop', ['--all'])()
  check('role start', ['R-1', 'R-2'])()
  // The body at the dot spelling, where the verb declares it — and it is a
  // VALUE, so it never counts toward the words the title needs.
  check('design', ['A title', '.body=@plan.md'])()
  // A design takes the standard property grammar beside its body (M-15635).
  check('design', ['A title', '.project=P-19', '.priority=2'])()
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
  check('search', ['.status=open'])()
})

Deno.test('parse names positionals, resolves options, and applies defaults', () => {
  let got = parse('history', manuals.history, ['T-3', '-n', '7', '--json'])
  assertEquals(got.args, { id: 'T-3' })
  assertEquals(got.opts, { '-n': '7' })
  assertEquals([...got.flags], ['--json'])

  assertEquals(parse('history', manuals.history, ['T-3']).opts['-n'], '50')
  assertEquals(parse('probes', manuals.probes, []).opts['--grace'], '30')
  assertEquals(
    parse('spawn', manuals.spawn, ['T-3', '.provider=codex']).opts,
    { '--effort': 'high', '--provider': 'codex' },
  )
})

Deno.test('a trailing body option binds its space form as the body', () => {
  // The habit the exception flood came from — `--body words…` without an `=` —
  // now WORKS, equivalent to `--body="words…"` (T-18566/T-18481).
  let comment = parse('comment', manuals.comment, [
    'T-3',
    '--body',
    'some',
    'text',
    'here',
  ])
  assertEquals(comment.args.id, 'T-3')
  assertEquals(comment.body, 'some text here')
  assertEquals(
    comment.body,
    parse('comment', manuals.comment, ['T-3', '--body=some text here']).body,
  )

  // remember keeps its title; the trailing words after --body are the body.
  let remember = parse('remember', manuals.remember, [
    'a',
    'fact',
    '--body',
    'the',
    'lesson',
  ])
  assertEquals(remember.args.title, 'a fact')
  assertEquals(remember.body, 'the lesson')

  // set's --comment (a body-type option) takes the same space form.
  assertEquals(
    parse('set', manuals.set, [
      'T-3',
      '--comment',
      'verified',
      'end',
      'to',
      'end',
    ]).opts['--comment'],
    'verified end to end',
  )
})

Deno.test('complete answers help and passes its completion line through', () => {
  // T-18630: `complete` is a real verb (alias), so `--help` renders its manual
  // instead of failing arg parse, and the `-- <line>` completion contract the
  // shell wrappers use parses as a passthrough rather than a subject.
  assertMatch(requestedHelp(['complete', '--help']) ?? '', /^task complete/)
  assertMatch(requestedHelp(['complete', '-h']) ?? '', /^task complete/)
  let got = parse('complete', manuals.complete, ['--', 'cl'])
  assertEquals(got.words, ['--', 'cl'])
})

Deno.test('parse preserves filter tokens and routes write params', () => {
  let filters = ['projects', '.title~=fleet', '.updated.at>=1 week ago']
  let listed = parse('list', manuals.list, filters)
  assertEquals(listed.words, filters)
  assertEquals(listed.params, [])

  let made = parse('new', manuals.new, [
    'P1',
    '.project=P-19',
    'ship',
    'it',
  ])
  assertEquals(made.words, ['P1', 'ship', 'it'])
  assertEquals(made.args.title, 'P1 ship it')
  assertEquals(made.params[0], {
    comp: 'task',
    prop: 'project',
    value: 'P-19',
  })
})

let shellWords = (line: string) => {
  let words: string[] = []
  let word = ''
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    let char = line[i]
    if (quote) {
      if (char == quote) quote = ''
      else word += char
      continue
    }
    if (char == '"' || char == "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (word) words.push(word)
      word = ''
      continue
    }
    // Redirection belongs to the shell, not to the verb's argv. A filter's
    // `.priority<=1` keeps its operator because the token already started.
    if (char == '<' && !word) break
    word += char
  }
  if (word) words.push(word)
  return words
}

let validateExample = (line: string) => {
  let [binary, cmd, ...args] = shellWords(line)
  assertEquals(binary, 'task', line)
  let selected = route(cmd, args)
  if (selected) {
    validate(selected.name, selected.manual, selected.args)
    return
  }
  if (cmd && plurals.has(cmd)) {
    validate('list', manuals.list, [cmd, ...args])
    return
  }
  if (cmd?.startsWith(':')) {
    validateCommand(cmd.slice(1), args)
    return
  }
  let [verb, ...rest] = args
  if (verb?.startsWith(':')) {
    validateCommand(verb.slice(1), rest)
    return
  }
  if (!verb) return validate('show', manuals.show, [cmd])
  if ((edges as readonly string[]).includes(verb)) {
    return validate('dep', manuals.dep, [cmd, verb, ...rest])
  }
  if (verb == 'is') {
    return validate('set', manuals.set, [cmd, `.status=${rest[0]}`])
  }
  if (verb == 'as') {
    return validate('show', manuals.show, [
      cmd,
      ...(rest[0] == 'json' ? ['--json'] : []),
    ])
  }
  throw new Error(`example has no route: ${line}`)
}

Deno.test('every manual example is valid through the verb it invokes', () => {
  for (let manual of Object.values(manuals)) {
    for (let example of manual.examples ?? []) validateExample(example)
  }
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
    assertThrows(
      () => validate(name, manual, ['.zzz=1']),
      Error,
      usageOf(manual),
    )
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

// The palette is the SAME vocabulary as the CLI verbs (CLAUDE.md: "one
// vocabulary: palette, TUI, CLI colon, MCP command"), so the dot-param guard
// that holds at the CLI door must hold at this one too — a colon verb that
// reads no dot-params refuses an unknown one by name instead of absorbing it
// into its text. Swept over the whole command table so the next colon verb
// inherits the guard rather than having to remember it (T-14291).
Deno.test('a colon verb refuses any dot-param it does not read, by name', () => {
  for (let [name, command] of Object.entries(commands)) {
    if (command.dots) continue
    assertThrows(
      () => validateCommand(name, ['.zzz=1']),
      Error,
      `:${name} does not take .zzz=`,
    )
  }
  // The write/spec verbs still take their dot-params — the exemption holds.
  validateCommand('set', ['.status=done'])
  validateCommand('new', ['.domain=Eng', 'a title'])
  // A `-- note` fold is prose, so a dot inside it is left alone.
  validateCommand('wake', ['homelab', 'in', '60m', '--', 'left .x=1 mid-edit'])
})

// A colon verb reads its entity from the FOCUS, so an entity-shaped stray
// argument means the caller inverted the spelling (`task done T-42` instead of
// `task T-42 done`). The arity refusal names the form that works rather than a
// bare count (T-10331).
Deno.test('a colon arity error over an entity-shaped arg names the entity-first form', () => {
  assertThrows(
    () => validateCommand('done', ['T-10195']),
    Error,
    "did you mean 'task T-10195 :done'",
  )
  // A non-entity stray keeps the plain count + usage line.
  assertThrows(
    () => validateCommand('done', ['extra']),
    Error,
    'usage: task :done',
  )
})
