// The `task new` stray-flag guard: agents pattern-match to --flags, but the
// CLI grammar is dot-params. The guard must catch both the glued `--project=P`
// and the space-separated `--project P` forms — the latter is what agents
// actually type, and the bug that let it through polluted the owner board.
import { assertEquals, assertMatch, assertThrows } from '@std/assert'
import {
  bodyIn,
  bodyOf,
  claimedDigest,
  claudeHookSettings,
  claudeLaunch,
  codexArgs,
  codexHookArgs,
  codexLaunch,
  finalText,
  hookDialect,
  hookOperator,
  hookProvider,
  hookTurn,
  jsonText,
  kindArg,
  leadPrio,
  lifecycleHooks,
  listing,
  operatorHook,
  parts,
  place,
  printer,
  roleEid,
  strayFile,
  strayFlag,
  subagentDigest,
  subject,
  subjectUsage,
} from './cli.ts'
import { rows } from './client.ts'
import { parseQuery } from './query.ts'
import { fakeGraph } from './graph_fake.ts'
import type { Snapshot } from './types.ts'

let transcript = (...events: unknown[]) => {
  let path = Deno.makeTempFileSync()
  try {
    Deno.writeTextFileSync(
      path,
      events.map((e) => JSON.stringify(e)).join('\n'),
    )
    return finalText(path)
  } finally {
    Deno.removeSync(path)
  }
}

let cli = (...args: string[]) =>
  new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', new URL('./cli.ts', import.meta.url).pathname, ...args],
    env: { TASKS_HOST: '127.0.0.1:1' },
  }).output()

let bareCli = (env: Record<string, string>) =>
  new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', new URL('./cli.ts', import.meta.url).pathname],
    clearEnv: true,
    env,
  }).output()

let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

let unsafe = (text: string) =>
  [...text].filter((c) => {
    let n = c.charCodeAt(0)
    return (n < 0x20 && ![1, 2, 10].includes(n)) ||
      (n >= 0x7f && n <= 0x9f)
  })

Deno.test('printer: content cannot speak to the terminal', () => {
  let cases: [string, string, string][] = [
    ['ESC and BEL go', 'a\x1b]52;c;QQ==\x07b', 'a]52;c;QQ==b'],
    ['C1 goes', 'a\x9b2Jb', 'a2Jb'],
    ['DEL goes', 'a\x7fb', 'ab'],
    ['C0 goes', 'a\x00\x05\r\x1fb', 'ab'],
    ['FTS marks stay', 'a \x01hit\x02 b', 'a \x01hit\x02 b'],
    ['newlines stay', 'a\nb', 'a\nb'],
    ['tabs become spaces', 'a\tb', 'a  b'],
  ]
  for (let [what, content, want] of cases) {
    let got = ''
    printer((line) => got = line)(content)
    assertEquals(got, want, what)
  }
})

Deno.test('printer: CLI styling wraps sanitized content', () => {
  let got = ''
  printer((line) => got = line)('safe\x1b[2Jtext', true)
  assertEquals(got, '\x1b[1msafe[2Jtext\x1b[0m')
})

Deno.test('jsonText: terminal bytes go while parsed values stay whole', () => {
  let value = { body: 'a\x00\x7f\x9fb' }
  let got = jsonText(value)
  assertEquals(unsafe(got), [])
  assertEquals(JSON.parse(got), value)
})

Deno.test('subject: sentences route through the existing CLI verbs', () => {
  let route = (line: string) => {
    let [id, ...args] = line.split(' ')
    return subject(id, args)
  }
  assertEquals(route('T-3'), { cmd: 'show', args: ['T-3'] })
  assertEquals(route('T-3 show --json'), {
    cmd: 'show',
    args: ['T-3', '--json'],
  })
  assertEquals(route('T-3 as markdown'), { cmd: 'show', args: ['T-3'] })
  assertEquals(route('T-3 as json'), {
    cmd: 'show',
    args: ['T-3', '--json'],
  })
  assertEquals(route('T-3 is wip'), {
    cmd: 'set',
    args: ['T-3', '.status=wip'],
  })
  for (let edge of ['requires', 'contains', 'reads', 'about']) {
    assertEquals(route(`T-3 ${edge} T-9 --gone`), {
      cmd: 'dep',
      args: ['T-3', edge, 'T-9', '--gone'],
    })
  }
})

Deno.test('kindArg: every spelling of a kind names it, a filter is not one', () => {
  for (
    let spelling of [
      'project',
      'projects',
      '.kind=project',
      'kind=project',
      '.kind=projects',
    ]
  ) assertEquals(kindArg(spelling), 'project')
  assertEquals(kindArg('memories'), 'memory')
  assertEquals(kindArg('canvases'), 'canvas')
  assertEquals(kindArg('aliases'), 'alias')
  // English's one irregular, and the naive plural still lands
  assertEquals(kindArg('people'), 'person')
  assertEquals(kindArg('persons'), 'person')
  // A filter, a bare word that names nothing: not a kind, so it falls
  // through to the filter parser rather than being guessed at.
  assertEquals(kindArg('.status=open'), undefined)
  assertEquals(kindArg('projekts'), undefined)
  // Spelled as a kind and wrong: the door names the vocabulary.
  assertThrows(() => kindArg('.kind=projekt'), Error, 'no such kind: projekt')
  assertThrows(() => kindArg('kind=task,project'), Error, 'no such kind')
})

// `task decided` scopes itself to where you stand, so `.project=P-30` has to
// mean STAND THERE — the task column alone would answer with that project's
// tasks and hide its memories. Only the plain `=` form names a place; a list
// or a `!=` is a predicate, and screens whatever the scope already chose.
Deno.test('place: one project is somewhere to stand, a predicate is not', () => {
  let named = (q: string) => place(parseQuery(q))?.value
  assertEquals(named('.project=P-30'), 'P-30')
  assertEquals(named('.project=P-30 .status=done'), 'P-30')
  assertEquals(named('.project_eid=P-30'), 'P-30')
  assertEquals(named('.status=done'), undefined)
  assertEquals(named('.project!=P-30'), undefined)
  assertEquals(named('.project=P-30,P-19'), undefined)
  // `.project=` is "no project at all" — an absence, not an address.
  assertEquals(named('.project='), undefined)
})

Deno.test('listing: a plural kind is the list verb, the singular is a subject', () => {
  assertEquals(listing('projects', []), { cmd: 'list', args: ['projects'] })
  assertEquals(listing('memories', ['--json']), {
    cmd: 'list',
    args: ['memories', '--json'],
  })
  assertEquals(listing('people', []), { cmd: 'list', args: ['people'] })
  assertEquals(listing('persons', []), { cmd: 'list', args: ['persons'] })
  assertEquals(listing('project', []), undefined)
  assertEquals(listing('T-3', []), undefined)
  assertEquals(listing(undefined, []), undefined)
})

Deno.test('subject: old commands and explicit focused commands keep their door', () => {
  assertEquals(subject('show', ['T-3']), undefined)
  assertEquals(subject('dep', ['T-3', 'requires', 'T-9']), undefined)
  assertEquals(subject('fix', ['T-3']), undefined)
  assertEquals(subject('T-3', [':done']), undefined)
})

Deno.test('subject: malformed sentences teach the contextual grammar', () => {
  assertThrows(() => subject('T-3', ['requires']), Error, '<id> [--gone]')
  assertThrows(
    () => subject('T-3', ['show', 'T-9']),
    Error,
    '[show] [--json]',
  )
  assertThrows(() => subject('T-3', ['is', 'blocked']), Error, 'status is one')
  assertThrows(() => subject('T-3', ['as', 'yaml']), Error, 'format is one')
  assertThrows(
    () => subject('T-3', ['frobnicate']),
    Error,
    'task T-3 --help',
  )
})

Deno.test('task subject help is contextual and needs no server', async () => {
  let out = await cli('T-3', '--help')
  assertEquals(out.code, 0)
  let stdout = text(out.stdout)
  assertMatch(stdout, /task T-3 — subject-first verbs/)
  assertMatch(stdout, /requires\|contains\|reads\|about <id> \[--gone\]/)
  assertMatch(stdout, /task T-3 is open\|wip\|done\|cancelled/)
  assertEquals(subjectUsage('T-3').trim(), stdout.trim())
})

Deno.test('bodyOf: only explicit stdin spellings read the pipe', () => {
  let cases: [string[], string[], string, number][] = [
    [['--body=-'], [], 'piped', 1],
    [['--body=@-'], [], 'piped', 1],
    [['--body=literal'], [], 'literal', 0],
    [[], ['word', 'body'], 'word body', 0],
  ]
  for (let [flags, words, want, reads] of cases) {
    let read = 0
    let got = bodyOf(flags, words, {
      terminal: () => false,
      read: () => (read++, ' piped\n'),
    })
    assertEquals({ flags, got, read }, { flags, got: want, read: reads })
  }
})

// @ is the door's convention, not the flag's — a lone trailing @file is
// read exactly as --body=@file is, so a letter can never go out carrying
// the path of the file it should have quoted (T-10461).
Deno.test('bodyOf: a lone trailing @file is read, prose is not', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole letter\n')
  let tty = { terminal: () => true, read: () => '' }
  assertEquals(bodyOf([], [`@${f}`], tty), 'the whole letter\n')
  // @@ escapes to a literal @, the same as every other door
  assertEquals(bodyOf([], ['@@handle'], tty), '@handle')
  // more than one word is prose: an opening @handle is never a filename
  assertEquals(bodyOf([], ['@handle', 'thanks!'], tty), '@handle thanks!')
  assertEquals(bodyOf([], ['plain', 'words'], tty), 'plain words')
  // a QUOTED sentence is still one argv token — prose, not a reference
  assertEquals(bodyOf([], ['@handle thanks!'], tty), '@handle thanks!')
  // a missing file is loud — the caller's own token names the door
  assertThrows(
    () => bodyOf([], ['@/no/such/file'], tty),
    Error,
    '@/no/such/file: no such file',
  )
  Deno.removeSync(f)
})

Deno.test('bodyOf: a lone trailing @- is the pipe, and refuses a TTY', () => {
  // said positionally, both spellings, exactly as the flag says them
  for (let t of ['@-', '-']) {
    let read = 0
    assertEquals(
      bodyOf([], [t], {
        terminal: () => false,
        read: () => (read++, ' hi\n'),
      }),
      'hi',
    )
    assertEquals(read, 1)
    assertThrows(
      () => bodyOf([], [t], { terminal: () => true, read: () => 'x' }),
      Error,
      `${t}: stdin is a TTY`,
    )
  }
})

Deno.test('bodyOf: both stdin spellings refuse a TTY', () => {
  for (let b of ['-', '@-']) {
    let read = 0
    assertThrows(
      () =>
        bodyOf([`--body=${b}`], [], {
          terminal: () => true,
          read: () => (read++, 'piped'),
        }),
      Error,
      // the error names the spelling the caller typed, not a synonym
      `--body=${b}: stdin is a TTY`,
    )
    assertEquals(read, 0)
  }
})

// The doors whose trailing words are a TITLE have no positional body door at
// all, so the param is the only way to say one — and a title built by
// SUBTRACTION swallowed it whole: `task design "…" .body=@plan.md` stored the
// flag in the title, minted an empty body and printed its receipt (T-14187).
// Both spellings, because the dot form is what every other writing door
// speaks and is what the agent who just filed a task types here.
Deno.test('parts: a value never reaches the words, at either spelling', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole design\n')
  let tty = { terminal: () => true, read: () => '' }
  for (let said of [`--body=@${f}`, `.body=@${f}`]) {
    let { vals, words } = parts(['Some', 'title', said, '--json'])
    assertEquals({ said, words }, { said, words: ['Some', 'title'] })
    assertEquals(bodyIn(vals, tty), 'the whole design\n')
  }
  // Prose keeps every word: only a param spelling is taken out of the text.
  assertEquals(parts(['a', '.gitignore', 'rule']).words, [
    'a',
    '.gitignore',
    'rule',
  ])
  assertEquals(bodyIn(parts(['no', 'body']).vals, tty), undefined)
  // The token as TYPED names the door in an error, whichever spelling it was.
  for (let said of ['--body=@/no/such/file', '.body=@/no/such/file']) {
    assertThrows(() => bodyIn(parts([said]).vals, tty), Error, said)
  }
  Deno.removeSync(f)
})

Deno.test('codexArgs: full access and lifecycle lead, caller args keep order', () => {
  let hooks = codexHookArgs()
  assertEquals(codexArgs(['resume', '--last']), [
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    ...hooks,
    'resume',
    '--last',
  ])
  assertEquals(hooks.filter((arg) => arg == '-c').length, 5)
})

Deno.test('finalText: Claude and Codex transcripts yield the closing answer', () => {
  assertEquals(
    transcript({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Claude closes' }] },
    }),
    'Claude closes',
  )
  assertEquals(
    transcript(
      {
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'Codex commentary',
          phase: 'commentary',
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'Codex closes',
          phase: 'final_answer',
        },
      },
    ),
    'Codex closes',
  )
})

Deno.test('hookDialect: Codex payload and Claude transcript name the provider', () => {
  let path = Deno.makeTempFileSync()
  try {
    Deno.writeTextFileSync(
      path,
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-opus-5' },
      }),
    )
    assertEquals(
      hookDialect({
        model: 'claude-opus-5',
        transcript_path: path,
      }, 'claude'),
      {
        provider: 'claude',
        model: 'claude-opus-5',
        transcript: path,
      },
    )
    assertEquals(
      hookDialect({
        model: 'gpt-5.6-sol',
        transcript_path: '/unstable/codex.jsonl',
      }, 'codex'),
      {
        provider: 'codex',
        model: 'gpt-5.6-sol',
        transcript: '/unstable/codex.jsonl',
      },
    )
    assertEquals(hookDialect({}).provider, 'claude')
  } finally {
    Deno.removeSync(path)
  }
})

Deno.test('hookProvider: invocation name wins; ancestry recovers old hooks', () => {
  let find = (provider: string) =>
    provider == 'claude' ? 10 : provider == 'codex' ? 20 : undefined
  assertEquals(hookProvider('claude', find), 'claude')
  assertEquals(hookProvider('codex', find), 'codex')
  assertEquals(
    hookProvider('', find, (pid, root) => pid == 20 && root == 10),
    'codex',
  )
  assertEquals(hookProvider('', find, () => false), 'claude')
  assertEquals(hookProvider('', () => undefined), undefined)
})

Deno.test('task codex is discoverable with its own help', async () => {
  let out = await cli('codex', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /task codex \[--operator\] \[codex args\.\.\.\][\s\S]*graph participant[\s\S]*task codex --operator resume --last/,
  )
})

Deno.test('task comment help teaches verdict-bearing comments', async () => {
  let out = await cli('comment', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /--verdict=approved\|rejected\|changes_requested/,
  )
})

Deno.test('task claude scopes operator capability and strips its local flag', () => {
  let launch = claudeLaunch(
    ['--model', 'opus', '--operator', '--continue'],
    true,
    42,
  )
  assertEquals(launch, {
    args: [
      '--dangerously-skip-permissions',
      '--settings',
      claudeHookSettings(),
      '--channels',
      'plugin:tasks@tasks-fleet',
      '--model',
      'opus',
      '--continue',
    ],
    env: {
      TASKS_OPERATOR: '42',
      TASKS_TASK: '',
      CLAUDE_CODE_CHILD_SESSION: '',
    },
  })

  let ordinary = claudeLaunch(['--continue'], true, 42)
  assertEquals(ordinary.env, {
    TASKS_OPERATOR: '',
    TASKS_TASK: '',
    CLAUDE_CODE_CHILD_SESSION: '',
  })
  assertEquals(
    claudeLaunch(['--', '--operator'], true, 42).args.slice(-2),
    ['--', '--operator'],
  )
})

Deno.test('task codex scopes operator capability and strips its local flag', () => {
  assertEquals(
    codexLaunch(['--operator', 'resume', '--last'], 42),
    {
      args: [
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-hook-trust',
        ...codexHookArgs(),
        'resume',
        '--last',
      ],
      env: {
        TASKS_OPERATOR: '42',
        TASKS_TASK: '',
        CLAUDE_CODE_CHILD_SESSION: '',
      },
    },
  )
  assertEquals(codexLaunch(['resume', '--last'], 42).env.TASKS_OPERATOR, '')
  assertEquals(
    codexLaunch(['--', '--operator'], 42).args.slice(-2),
    ['--', '--operator'],
  )
})

Deno.test('operator capability follows the explicit launcher marker', () => {
  let env = (vars: Record<string, string>) => (name: string) => vars[name]
  let under = (pid: number, root: number) => pid == 7 && root == 42
  assertEquals(
    operatorHook(7, env({ TASKS_OPERATOR: '42' }), under),
    true,
  )
  assertEquals(operatorHook(7, env({ TASKS_OPERATOR: '99' }), under), false)
  assertEquals(operatorHook(7, env({}), under), false)
})

Deno.test('role binding accepts only a live role entity', () => {
  let role = {
    eid: 'role-eid',
    num: 7,
    kind: 'role',
    comps: { role: { state: 'running' } },
  }
  let task = {
    eid: 'task-eid',
    num: 8,
    kind: 'task',
    comps: { task: { status: 'open' } },
  }
  assertEquals(roleEid([role, task], 'R-7'), role.eid)
  assertEquals(roleEid([role, task], task.eid), undefined)
  assertEquals(roleEid([role, task], 'missing'), undefined)
})

Deno.test('a bound role carries operator capability without a launcher marker', () => {
  assertEquals(hookOperator('role-eid'), true)
  // Unbound falls through to the launcher marker, which is read from the
  // ambient environment — so clear it, or this asserts nothing when the suite
  // itself is run from inside an operator session.
  let marker = Deno.env.get('TASKS_OPERATOR')
  Deno.env.delete('TASKS_OPERATOR')
  try {
    assertEquals(hookOperator(undefined, undefined), false)
  } finally {
    if (marker != undefined) Deno.env.set('TASKS_OPERATOR', marker)
  }
})

Deno.test('Codex turn hooks announce only busy and idle boundaries', () => {
  assertEquals(hookTurn({ hook_event_name: 'UserPromptSubmit' }), 'busy')
  assertEquals(hookTurn({ hook_event_name: 'Stop' }), 'idle')
  assertEquals(hookTurn({ hook_event_name: 'SessionStart' }), undefined)
})

// The launcher is the global `operate` CLI; its dry run prints the exact argv it
// would exec, so the --operator opt-in is checked against the real thing.
Deno.test('the canonical operator launcher opts into work injection', async () => {
  let repo = new URL('..', import.meta.url).pathname
  let out = await new Deno.Command('operate', {
    args: ['run'],
    cwd: repo,
    env: { DRY_RUN: '1' },
  }).output()
  assertEquals(out.code, 0)
  assertMatch(text(out.stdout), /^task claude --operator /)
})

Deno.test('task wrap help documents the legacy alias', async () => {
  let out = await cli('wrap', '--help')
  assertEquals(out.code, 0)
  assertMatch(
    text(out.stdout),
    /task wrap \[sid\] \[--hook\][\s\S]*task session wrap/,
  )
})

Deno.test('deprecated routes leave root help but teach at their door', async () => {
  let root = await cli('--help')
  assertEquals(root.code, 0)
  assertEquals(/^\s+task dep\b/m.test(text(root.stdout)), false)

  let direct = await cli('dep', '--help')
  assertEquals(direct.code, 0)
  assertMatch(
    text(direct.stdout),
    /task dep <id> <type> <child> \[--gone\][\s\S]*Deprecated: superseded/,
  )

  let bare = await cli('dep')
  assertEquals(bare.code, 1)
  assertMatch(
    text(bare.stderr),
    /usage: task dep <id> <type> <child> \[--gone\][\s\S]*deprecated:/,
  )
})

// The signpost belongs to the spelling typed, not the handler reached —
// the subject-first sentence IS the successor `dep` points at. Both forms
// need a server to answer (a dead host costs 6s of backoff), so they run
// against an empty graph and die on `no entity` instead.
Deno.test('the deprecation notice follows the spelling, not the handler', async () => {
  let empty = Deno.serve(
    { port: 0, onListen: () => {} },
    () => Response.json({ changes: [], deps: [] }),
  )
  let run = (...args: string[]) =>
    new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        ...args,
      ],
      env: { TASKS_HOST: `127.0.0.1:${empty.addr.port}` },
    }).output()
  try {
    let typed = await run('dep', 'T-3', 'requires', 'T-9')
    assertMatch(text(typed.stderr), /task dep: deprecated — superseded by/)

    let sentence = await run('T-3', 'requires', 'T-9')
    assertMatch(text(sentence.stderr), /no entity: T-3/)
    assertEquals(/deprecated/.test(text(sentence.stderr)), false)
  } finally {
    await empty.shutdown()
  }
})

Deno.test('the --blocked-by refusal names the current edge door', async () => {
  let out = await cli('new', 'Title', '--blocked-by=T-1')
  assertEquals(out.code, 1)
  assertMatch(text(out.stderr), /an EDGE, not a prop/)
  assertMatch(text(out.stderr), /task <parent> requires <child>/)
  assertEquals(/task dep\b/.test(text(out.stderr)), false)
})

// Both grammars carry one mistake — the dot-param spelling used to earn
// the filter sketch, correct and silent about the edge it was reaching for.
Deno.test('.blocked-by names the same edge door as --blocked-by', async () => {
  let out = await cli('new', 'Title', '.blocked-by=T-1')
  assertEquals(out.code, 1)
  assertMatch(text(out.stderr), /an EDGE, not a prop/)
  assertMatch(text(out.stderr), /task <parent> requires <child>/)
  assertEquals(/filters are dot-params/.test(text(out.stderr)), false)
})

Deno.test('task session wrap help never runs the hook verb', async () => {
  let out = await cli('session', 'wrap', '--help')
  assertEquals(out.code, 0)
  assertMatch(text(out.stdout), /task session wrap \[sid\] \[--hook\]/)
})

Deno.test('nested and palette help always resolves before effects', async () => {
  let cases: [string[], RegExp][] = [
    [['mail', 'show', '--help'], /^task mail show/],
    [['inbox', 'archive', '--help'], /^task inbox archive/],
    [[':fix', '--help'], /^task :fix/],
    [['fix', '--help'], /^task :fix/],
    [['T-1', ':done', '--help'], /^task :done/],
  ]
  for (let [args, expected] of cases) {
    let out = await cli(...args)
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), expected)
    assertEquals(text(out.stderr), '')
  }
})

Deno.test('task wrap rejects body before touching the session', async () => {
  let out = await cli('wrap', 'test-session', '--body=@brief.md')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /wrap takes no --body.+task session brief --body=…/,
  )
})

Deno.test('task verbs reject unknown flags before their effects', async () => {
  let out = await cli('release', 'T-1', '--wat')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /release does not take --wat/,
  )
})

Deno.test('task verbs reject surplus words and missing values before effects', async () => {
  let cases: [string[], RegExp][] = [
    [['claim', 'T-1', 'sess', 'extra'], /claim expected 1–2 arguments/],
    [['inbox', 'archive', 'E-1', 'extra'], /expected 1 argument, got 2/],
    // The inbox takes filters now, so a bare word is no longer surplus —
    // it is a bad FILTER, and it teaches the verb instead of guessing
    // (T-10767). Refused before the snapshot, like every arity check.
    [['inbox', 'notafilter'], /not an inbox filter/],
    [['backup', 'extra'], /backup expected 0 arguments/],
    [['history', 'T-1', '-n'], /-n needs a positive number/],
  ]
  for (let [args, expected] of cases) {
    let out = await cli(...args)
    assertEquals(out.code, 1)
    assertEquals(text(out.stdout), '')
    assertMatch(text(out.stderr), expected)
  }
})

Deno.test('task set rejects surplus positional arguments', async () => {
  let out = await cli('set', 'T-1', '.status=open', 'surplus')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(text(out.stderr), /task set <id> \.prop=value \.\.\./)
})

Deno.test('task dep rejects surplus positional arguments', async () => {
  let out = await cli('dep', 'T-1', 'requires', 'T-2', 'surplus')
  assertEquals(out.code, 1)
  assertEquals(text(out.stdout), '')
  assertMatch(
    text(out.stderr),
    /task dep <id> <type> <child> \[--gone\]/,
  )
})

Deno.test('launchers scope lifecycle hooks to their provider invocation', () => {
  let codex = lifecycleHooks('codex')
  assertEquals(Object.keys(codex), [
    'SessionStart',
    'SubagentStart',
    'UserPromptSubmit',
    'Stop',
    'SessionEnd',
  ])
  assertMatch(
    codex.SessionStart[0].hooks[0].command,
    /TASKS_PROVIDER=codex task session context --hook/,
  )
  assertMatch(
    codex.SubagentStart[0].hooks[0].command,
    /task session context --hook/,
  )
  assertMatch(
    codex.UserPromptSubmit[0].hooks[0].command,
    /task session turn --hook/,
  )
  assertMatch(
    codex.Stop[0].hooks[0].command,
    /task session turn --hook/,
  )
  assertEquals(codex.UserPromptSubmit[0].hooks[0].timeout, 3)
  assertEquals(codex.Stop[0].hooks[0].timeout, 3)
  assertMatch(
    codex.SessionEnd[0].hooks[0].command,
    /task session wrap --hook/,
  )
  assertEquals(codex.SessionEnd[0].hooks[0].timeout, 3)

  let claude = lifecycleHooks('claude')
  assertEquals(Object.keys(claude), [
    'SessionStart',
    'SubagentStart',
    'UserPromptSubmit',
    'Stop',
    'SessionEnd',
  ])
  // Claude reports turn boundaries like every other adapter, and carries the
  // project's self-clear gate as a SECOND Stop hook — ordered after the turn
  // stamp so the cheap fact never queues behind the expensive check.
  assertMatch(
    claude.UserPromptSubmit[0].hooks[0].command,
    /TASKS_PROVIDER=claude task session turn --hook/,
  )
  assertMatch(claude.Stop[0].hooks[0].command, /task session turn --hook/)
  assertEquals(claude.Stop[0].hooks[0].timeout, 3)
  assertMatch(claude.Stop[1].hooks[0].command, /self-clear-stop\.sh/)
  assertEquals(claude.Stop[1].hooks[0].timeout, 20)
  // Codex has no self-clear gate, so its Stop carries the turn stamp alone.
  assertEquals(codex.Stop.length, 1)
  assertMatch(
    claude.SessionStart[0].hooks[0].command,
    /TASKS_PROVIDER=claude task session context --hook/,
  )
  assertEquals(
    JSON.parse(claudeHookSettings()).hooks,
    claude,
  )
  let project = JSON.parse(
    Deno.readTextFileSync(
      new URL('../.claude/settings.json', import.meta.url),
    ),
  )
  assertEquals(project.hooks, undefined)
})

Deno.test('task claude appends project settings only for its invocation', () => {
  let dir = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(`${dir}/.tasks`)
    Deno.writeTextFileSync(
      `${dir}/.tasks/claude-settings.json`,
      JSON.stringify({
        env: { DESK: 'trading' },
        hooks: {
          SessionStart: [{
            hooks: [{ type: 'command', command: 'echo rearm' }],
          }],
        },
      }),
    )
    let settings = JSON.parse(claudeHookSettings(dir))
    assertEquals(settings.env, { DESK: 'trading' })
    assertEquals(settings.hooks.SessionStart.length, 2)
    assertMatch(
      settings.hooks.SessionStart[0].hooks[0].command,
      /task session context --hook/,
    )
    assertEquals(
      settings.hooks.SessionStart[1].hooks[0].command,
      'echo rearm',
    )
    assertEquals(
      JSON.parse(claudeLaunch([], true, 42, dir).args[2]),
      settings,
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// `task new P1 …` honors the documented shorthand (T-6741): a LEADING
// P<n> becomes priority, a bare word stays title, and a mid-title P keeps
// its words.
Deno.test('leadPrio: a leading P<n> is priority, else it is a title word', () => {
  assertEquals(leadPrio(['P1', 'Fix', 'it']), {
    words: ['Fix', 'it'],
    priority: 1,
  })
  assertEquals(leadPrio(['p2', 'Ship']), { words: ['Ship'], priority: 2 })
  // no leading P: every word is title, no priority
  assertEquals(leadPrio(['Fix', 'the', 'P2', 'bug']), {
    words: ['Fix', 'the', 'P2', 'bug'],
  })
  // a bare leading digit is a title word, never priority
  assertEquals(leadPrio(['3', 'reasons']), { words: ['3', 'reasons'] })
})

Deno.test('strayFlag: clean title has no stray flag', () => {
  assertEquals(strayFlag(['Fix', 'the', 'login', 'bug']), null)
})

Deno.test('strayFlag: space-separated --flag (the real corruption)', () => {
  // `task new "Title --project P-30 --body ..."` → these words.
  assertEquals(
    strayFlag(['Title', '--project', 'P-30', '--body', 'stuff']),
    { got: '--project', suggest: '.project=P-30' },
  )
})

Deno.test('strayFlag: glued --flag=value', () => {
  assertEquals(
    strayFlag(['Title', '--project=P-30']),
    { got: '--project=P-30', suggest: '.project=P-30' },
  )
})

Deno.test('strayFlag: trailing --flag with no value', () => {
  assertEquals(
    strayFlag(['Title', '--body']),
    { got: '--body', suggest: '.body=…' },
  )
})

// The suggestion is checked before it is offered. `.blocked-by` routes
// nowhere, so there is nothing to recommend — and recommending it sent
// agents to a spelling that landed in the task's TITLE.
Deno.test('strayFlag: a flag with no matching prop suggests nothing', () => {
  assertEquals(
    strayFlag(['Title', '--blocked-by', 'T-9']),
    { got: '--blocked-by' },
  )
})

Deno.test('strayFlag: bare -- is not a flag', () => {
  assertEquals(strayFlag(['Title', '--', 'more']), null)
})

// The @-token sibling. `task new "title" @body.md` is the corruption:
// the words ARE the title, so the path lands in it and the body mints
// empty. Every case is a whole argv WORD, the way a shell hands them over.
Deno.test('strayFile: an @file among the title words', () => {
  // README.md exists relative to the repo root the suite runs from — the
  // positive control, without which every case below passes vacuously.
  assertEquals(Deno.statSync('README.md').isFile, true)

  let cases: [string[], string | undefined][] = [
    [['a', 'title', '@README.md'], '@README.md'],
    [['@README.md'], '@README.md'],
    // nothing to read: prose, an escape, and a path that isn't there
    [['a', 'clean', 'title'], undefined],
    [['a', 'title', '@@README.md'], undefined],
    [['a', 'title', '@nope/not/here.md'], undefined],
    // one token holding whitespace is prose someone quoted, not a door
    [['@README.md and more'], undefined],
    // a bare word that happens to name a file is still just a word
    [['README.md'], undefined],
    [['@'], undefined],
  ]
  for (let [words, want] of cases) {
    assertEquals(strayFile(words), want, words.join(' '))
  }
})

// A subagent (a Task-tool child) sees ONLY its task — never the operator's
// mail/lately/fleet/previously. subagentDigest is that lone output: the
// claimed task's block, the TASKS_TASK block, or a bare identity line.
let S = 'bbbbbbbb-0000-4000-8000-000000000001'
let T = 'bbbbbbbb-0000-4000-8000-000000000002'
let sub: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sub-1', agent_type: 'general' } },
    { eid: T, name: 'entity', comp: { eid: T, num: 2, created_at: '' } },
    { eid: T, name: 'doc', comp: { title: 'Child work', body: '' } },
    { eid: T, name: 'task', comp: { status: 'wip', priority: 0 } },
    { eid: T, name: 'claim', comp: { session_eid: S } },
  ],
  deps: [],
}

let N = 'bbbbbbbb-0000-4000-8000-000000000003'
let O = 'bbbbbbbb-0000-4000-8000-000000000004'
let graph: Snapshot = {
  changes: [
    ...sub.changes,
    { eid: N, name: 'entity', comp: { eid: N, num: 3, created_at: '' } },
    { eid: N, name: 'session', comp: { id: 'idle-1' } },
    { eid: O, name: 'entity', comp: { eid: O, num: 4, created_at: '' } },
    { eid: O, name: 'doc', comp: { title: 'Open board task', body: '' } },
    { eid: O, name: 'task', comp: { status: 'open', priority: 1 } },
  ],
  deps: [],
}

// A comment on sub-1's claimed task, from another session, never notified —
// the thing the bus is supposed to hand over.
let C = 'bbbbbbbb-0000-4000-8000-000000000005'
let W = 'bbbbbbbb-0000-4000-8000-000000000006'
let busGraph: Snapshot = {
  changes: [
    ...graph.changes,
    { eid: W, name: 'entity', comp: { eid: W, num: 5, created_at: '' } },
    { eid: W, name: 'session', comp: { id: 'writer-1' } },
    { eid: C, name: 'entity', comp: { eid: C, num: 6, created_at: '' } },
    {
      eid: C,
      name: 'doc',
      comp: {
        title: '',
        body: 'the ask you missed\x1b]52;c;QQ==\x07\x9b2J\x7f',
      },
    },
    { eid: C, name: 'comment', comp: { target_eid: T } },
    {
      eid: C,
      name: 'created',
      comp: { eid: C, at: '2026-07-28T00:00:00.000Z', via: W },
    },
  ],
  deps: [],
}

// Serves busGraph and records the acks it is asked to write.
let busServer = () => fakeGraph(busGraph)

let graphServer = (snap = graph) => fakeGraph(snap)

Deno.test('list strips terminal controls from graph text', async () => {
  let poisoned: Snapshot = {
    ...graph,
    changes: graph.changes.map((change) =>
      change.eid == O && change.name == 'doc'
        ? {
          ...change,
          comp: {
            title: 'Open\x1b]52;c;QQ==\x07 board\x9b2J\x7f\x00 task',
            body: '',
          },
        }
        : change
    ),
  }
  let { server, host } = graphServer(poisoned)
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'list',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host },
    }).output()
    let stdout = text(out.stdout)
    assertEquals(out.code, 0)
    assertMatch(stdout, /Open]52;c;QQ== board2J task/)
    assertEquals(unsafe(stdout), [])
  } finally {
    await server.shutdown()
  }
})

Deno.test('entity JSON has one component-shaped contract across CLI doors', async () => {
  let task = 'bbbbbbbb-0000-4000-8000-000000000041'
  let comment = 'bbbbbbbb-0000-4000-8000-000000000042'
  let snap: Snapshot = {
    changes: [
      { eid: task, name: 'entity', comp: { eid: task, num: 41 } },
      {
        eid: task,
        name: 'doc',
        comp: { eid: task, title: 'Structured', body: 'One shape' },
      },
      {
        eid: task,
        name: 'task',
        comp: { eid: task, status: 'done', priority: 2 },
      },
      {
        eid: task,
        name: 'decided',
        comp: { eid: task, at: '2026-08-03T00:00:00.000Z' },
      },
      { eid: comment, name: 'entity', comp: { eid: comment, num: 42 } },
      {
        eid: comment,
        name: 'doc',
        comp: { eid: comment, title: '', body: 'Looks right' },
      },
      {
        eid: comment,
        name: 'comment',
        comp: { eid: comment, target_eid: task },
      },
    ],
    deps: [],
  }
  let { server, host } = graphServer(snap)
  let run = (...args: string[]) =>
    new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        ...args,
      ],
      env: { TASKS_HOST: host },
    }).output()
  let entity = {
    kind: 'task',
    entity: { eid: task, num: 41 },
    doc: { title: 'Structured', body: 'One shape' },
    task: { status: 'done', priority: 2 },
    decided: { at: '2026-08-03T00:00:00.000Z' },
  }
  try {
    let listed = await run('list', '--json')
    let decided = await run('decided', '--all', '--json')
    let shown = await run('show', 'T-41', '--json')
    assertEquals(listed.code, 0)
    assertEquals(decided.code, 0)
    assertEquals(shown.code, 0)
    assertEquals(JSON.parse(text(listed.stdout)), [entity])
    assertEquals(JSON.parse(text(decided.stdout)), [entity])
    assertEquals(JSON.parse(text(shown.stdout)), {
      ...entity,
      refs: [],
      backrefs: [],
      comments: [{
        kind: 'comment',
        entity: { eid: comment, num: 42 },
        doc: { title: '', body: 'Looks right' },
        comment: { target_eid: task },
      }],
    })
  } finally {
    await server.shutdown()
  }
})

Deno.test('colon open prints the public entity URL', async () => {
  let { server, host } = graphServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        ':open',
        'T-2',
      ],
      env: { TASKS_HOST: host },
    }).output()
    assertEquals(out.code, 0)
    assertEquals(text(out.stdout).trim(), 'https://tasks.yak.sh/T-2')
  } finally {
    await server.shutdown()
  }
})

Deno.test('subagentDigest: a held claim renders that task block, nothing else', () => {
  let out = subagentDigest(sub, 'sub-1', 'general')
  assertEquals(out, '- T-2 wip — Child work')
  // never the operator digest's tiers
  for (
    let mark of ['## mail', '## lately', 'from the fleet', '## previously']
  ) {
    assertEquals(out.includes(mark), false)
  }
})

Deno.test('subagentDigest: TASKS_TASK names the block when set', () => {
  Deno.env.set('TASKS_TASK', 'T-2')
  try {
    // even a session holding no claim shows the managed task
    assertEquals(
      subagentDigest(sub, 'nobody', 'general'),
      '- T-2 wip — Child work',
    )
  } finally {
    Deno.env.delete('TASKS_TASK')
  }
})

Deno.test('subagentDigest: no task = a one-line identity note', () => {
  Deno.env.delete('TASKS_TASK')
  assertEquals(
    subagentDigest(sub, 'nobody', 'general'),
    '# subagent general · nobody',
  )
  assertMatch(subagentDigest(sub, 'nobody'), /^# subagent · nobody$/)
})

Deno.test('claimedDigest: only this session lease, never the open board', () => {
  let mine = rows(sub).filter((r) => r.comps.claim)
  assertEquals(claimedDigest(mine), '- T-2 wip — Child work')
  assertEquals(claimedDigest([]), '')
})

Deno.test('bare task prints usage without a session or server read', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await bareCli({ TASKS_HOST: host })
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), /^task — the entity graph/)
    assertEquals(seen, [])
  } finally {
    await server.shutdown()
  }
})

Deno.test('bare task appends the current claimed task digest', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await bareCli({ TASKS_HOST: host, TASKS_SESSION: 'sub-1' })
    assertEquals(out.code, 0)
    assertMatch(text(out.stdout), /task —[\s\S]*- T-2 wip — Child work/)
    assertEquals(seen, [
      '/query?kind=session&.session.id=sub-1',
      `/query?kind=task&.claim.session_eid=${S}`,
      // then the bus, on its own bounded queries (client.ts bus()) — the
      // reader's rows, then the candidates its selector might pick
      '/query?.session.id=sub-1',
      `/query?.claim.session_eid=${S}`,
      '/query?.repo!',
      `/query?.comment.target_eid=${S},${T}&.notified=`,
      `/query?.knock.to_eid=${S}&.notified=`,
      `/query?.mail.target_eid=${S}&.notified=&.opened=&.archived=`,
    ])
  } finally {
    await server.shutdown()
  }
})

Deno.test('bare task never reads or prints the open board', async () => {
  let { server, seen, host } = graphServer()
  try {
    let out = await bareCli({ TASKS_HOST: host, TASKS_SESSION: 'idle-1' })
    assertEquals(out.code, 0)
    assertEquals(text(out.stdout).includes('Open board task'), false)
    assertEquals(seen.includes('/snapshot'), false)
  } finally {
    await server.shutdown()
  }
})

// Passive delivery: a verb that merely READ the graph serves the bus from
// what it already has — no per-verb wiring, and no second snapshot (one is
// ~16MB on a real graph). It rides stderr so a pipe or --json can never
// swallow a message that was just stamped read.
// A verb that never READ the graph now serves the bus too — that is the whole
// point of asking its own bounded question rather than riding a snapshot.
// `help` touches nothing and still hands over what is waiting.
Deno.test('a verb that reads nothing serves the bus all the same', async () => {
  let { server, acked, seen, host } = busServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'help',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
    }).output()
    assertEquals(out.code, 0)
    assertMatch(text(out.stderr), /the ask you missed/)
    assertEquals(acked.map((c) => `${c.name} ${c.eid}`), [`notified ${C}`])
    // and it cost keyed queries, never the corpus
    assertEquals(seen.filter((line) => line.startsWith('/snapshot')), [])
  } finally {
    await server.shutdown()
  }
})

// A HOOK has no reader (T-14196). Serving there prints to a stream nobody
// will read and stamps every line `notified`, which is how an unread message
// disappears without ever being delivered — worst of all at SessionEnd, which
// is what `wrap --hook` is. So a hook serves nothing and stamps nothing.
Deno.test('a hook never serves the bus, because nobody is there to read it', async () => {
  for (
    let args of [['wrap', '--hook'], ['session', 'turn', 'idle', '--hook']]
  ) {
    let { server, acked, host } = busServer()
    try {
      let out = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          new URL('./cli.ts', import.meta.url).pathname,
          ...args,
        ],
        clearEnv: true,
        env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
        stdin: 'null',
      }).output()
      assertEquals(/pending messages/.test(text(out.stderr)), false)
      assertEquals(acked.filter((c) => c.name == 'notified'), [])
    } finally {
      await server.shutdown()
    }
  }
})

// The one hook that DOES serve, and must keep serving: its stdout is the
// digest the session boots into, so the lines are delivered by definition.
Deno.test('the boot digest is the hook that delivers, on stdout', async () => {
  let { server, acked, host } = busServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'context',
        'sub-1',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host },
    }).output()
    assertMatch(text(out.stdout), /pending messages/)
    assertMatch(text(out.stdout), /the ask you missed/)
    assertEquals(acked.map((c) => `${c.name} ${c.eid}`), [`notified ${C}`])
  } finally {
    await server.shutdown()
  }
})

Deno.test('any graph-reading verb serves the bus, on stderr', async () => {
  let { server, acked, host } = busServer()
  try {
    let out = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '-A',
        new URL('./cli.ts', import.meta.url).pathname,
        'show',
        'T-2',
      ],
      clearEnv: true,
      env: { TASKS_HOST: host, TASKS_SESSION: 'sub-1' },
    }).output()
    assertEquals(out.code, 0)
    // the message reached the operator as a served notice...
    assertMatch(text(out.stderr), /pending messages/)
    assertMatch(text(out.stderr), /the ask you missed/)
    assertEquals(unsafe(text(out.stderr)), [])
    // ...and the block never touched what the caller asked for. (`show`
    // renders the comment thread itself on stdout, which is its job — what
    // must not leak there is the BUS, since that is what a pipe would eat.)
    assertEquals(/pending messages/.test(text(out.stdout)), false)
    assertEquals(unsafe(text(out.stdout)), [])
    // ...and was stamped read exactly once
    assertEquals(acked.map((c) => `${c.name} ${c.eid}`), [`notified ${C}`])
  } finally {
    await server.shutdown()
  }
})

// The same guard through the positional and --body= doors, since the
// mistake transfers between verbs (T-10612).
Deno.test('bodyOf: a lone path that forgot its @ is refused at every door', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole letter\n')
  let tty = { terminal: () => true, read: () => '' }
  assertThrows(() => bodyOf([], [f], tty), Error, 'did you mean @')
  assertThrows(() => bodyOf([`--body=${f}`], [], tty), Error, 'did you mean @')
  // Prose keeps its exemption: more than one token is never a reference.
  assertEquals(bodyOf([], ['see', f, 'please'], tty), `see ${f} please`)
  // And one token holding whitespace is still prose, @ or not.
  assertEquals(bodyOf([], [`@handle re ${f}`], tty), `@handle re ${f}`)
  Deno.removeSync(f)
})

// The mistake that actually shipped: the dot-param handed to `task comment`
// as its positional body. It reached the graph as prose and fanned out as
// mail, so the guard has to hold at the door the caller reached for.
Deno.test('bodyOf: a body flag in the value position is refused at every door', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole ruling\n')
  let tty = { terminal: () => true, read: () => '' }
  assertThrows(() => bodyOf([], [`.body=@${f}`], tty), Error, 'Pass just')
  assertThrows(
    () => bodyOf([`--body=.body=@${f}`], [], tty),
    Error,
    'Pass just',
  )
  // The corrected value reads the file through both doors — the control that
  // earns the suggestion its place.
  assertEquals(bodyOf([], [`@${f}`], tty), 'the whole ruling\n')
  assertEquals(bodyOf([`--body=@${f}`], [], tty), 'the whole ruling\n')
  // Prose keeps its exemption here too.
  assertEquals(bodyOf([], ['.body=@x', 'or', 'so'], tty), '.body=@x or so')
  Deno.removeSync(f)
})

// The WHOLE family in one table, because the family is only closed if every
// spelling is asserted — the dropped @ (T-10612), the flag in the value
// position (T-10858), and the dropped separator (T-10873). The last row is the
// positive control: the spelling that works must still work, or this test is
// measuring nothing.
Deno.test('bodyOf: every misplaced-body spelling is refused, and @file still reads', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole ruling\n')
  let tty = { terminal: () => true, read: () => '' }
  for (let said of [`.body=@${f}`, `--body=@${f}`, `body=@${f}`]) {
    assertThrows(() => bodyOf([], [said], tty), Error, 'value position', said)
  }
  for (let flag of ['.body', '--body', 'body']) {
    assertThrows(
      () => bodyOf([], [flag, `@${f}`], tty),
      Error,
      "space instead of '='",
      flag,
    )
  }
  assertThrows(() => bodyOf([], [f], tty), Error, 'names a file that exists')
  assertEquals(bodyOf([], [`@${f}`], tty), 'the whole ruling\n')
  Deno.removeSync(f)
})
