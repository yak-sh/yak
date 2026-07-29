// The shell manual is executable data: root usage, focused help and argument
// validation all read this table. The palette keeps its own command table;
// this module renders it directly, so neither vocabulary can drift.

import { commands } from './commands.ts'
import { FILTERS, GRAMMAR } from './grammar.ts'
import { edges, statuses } from './types.ts'

type Opt = {
  name: string
  value?: RegExp
  separate?: boolean
  want?: string
}

export type Manual = {
  usage: string
  about: string
  deprecated?: string
  examples?: string[]
  detail?: string
  root?: boolean
  alias?: boolean
  options?: Opt[]
  words?: [min: number, max?: number]
  passthrough?: boolean
  check?: (args: string[], words: string[]) => string | undefined
}

let flag = (name: string): Opt => ({ name })
let value = (
  name: string,
  want = 'a value',
  separate = false,
  accept = /.+/,
): Opt => ({ name, value: accept, separate, want })

let json = flag('--json')
let body = value('--body', 'text, @file, - or @-')
let count = value('-n', 'a positive number', true, /^[1-9]\d*$/)

export let manuals: Record<string, Manual> = {
  tui: {
    usage: 'tui',
    about: 'open the terminal UI',
    root: true,
    words: [0, 0],
  },
  claude: {
    usage: 'claude [--operator] [claude args...]',
    about:
      'interactive claude: graph participant; --operator adds project broadcasts',
    examples: ['task claude', 'task claude --operator --continue'],
    root: true,
    passthrough: true,
  },
  codex: {
    usage: 'codex [--operator] [codex args...]',
    about:
      'interactive codex: graph participant; --operator adds project broadcasts',
    examples: ['task codex', 'task codex --operator resume --last'],
    root: true,
    passthrough: true,
  },
  list: {
    usage: 'list [filters...] [--json]',
    about: 'list tasks (filter grammar)',
    examples: [
      'task list .status=open .priority<=1',
      'task list .project=harness .updated.at>="1 week ago"',
      'task list .assignee=jeff --json',
    ],
    root: true,
    options: [json],
  },
  new: {
    usage: 'new .title="..." [...]',
    about: 'create a task (bare words become the title)',
    examples: [
      'task new P1 .project=holdco Fix the flux capacitor',
      'task new .title="Write the digest" .body="Details..." .domain=Eng',
    ],
    root: true,
    // create() owns the more useful --flag → .param correction.
    passthrough: true,
  },
  set: {
    usage: 'set <id> .prop=value ... [--comment=words]',
    about: 'patch any entity; --comment says why, in the same batch',
    examples: [
      'task set T-3 .status=done --comment="verified end-to-end"',
      'task set T-3 .assignee=jeff .priority=1',
      'task set S-12 ".body=@brief.md"',
    ],
    root: true,
    options: [value('--comment', 'comment text')],
  },
  show: {
    usage: 'show <id> [--json]',
    about: 'one entity as a document (--json for scripts)',
    examples: ['task show T-3', 'task show T-3 --json'],
    root: true,
    options: [json],
    words: [1, 1],
  },
  history: {
    usage: 'history <id> [-n N] [--json]',
    about: "the entity's write history (journal)",
    examples: ['task history T-3 -n 10'],
    root: true,
    options: [count, json],
    words: [1, 1],
  },
  search: {
    usage: 'search <words...> [--json]',
    about: 'full-text search (trailing * = prefix)',
    examples: [
      'task search flux capac*',
      'task search .project=holdco deploy',
    ],
    root: true,
    options: [json],
    words: [1],
  },
  mail: {
    usage: 'mail [filters...] [--json|--all|--sent]',
    about: 'the mail-only slice of your items',
    deprecated: 'superseded by task inbox, where mail is one kind of item',
    examples: [
      'task inbox',
      'task mail send jeff Subject words --body=@draft.md',
    ],
    detail:
      '<to> is an address or graph reference (alias, P-9, eid); the address ' +
      'book resolves it at delivery. Filters speak `task help grammar`.',
    options: [json, flag('--all'), flag('--sent')],
  },
  'mail show': {
    usage: 'mail show <id> [--json]',
    about: 'show the mail and thread; mark it opened',
    options: [json],
    words: [1, 1],
  },
  'mail send': {
    // Root because `mail` itself is deprecated: sending a letter is not
    // superseded by the inbox, so it keeps its own door in the usage.
    usage: 'mail send <to> <subject...> --body=@file|-|@-',
    about: 'send a letter; - and @- read the body from stdin',
    root: true,
    // No --from: a letter is signed by whoever wrote it, derived from the
    // session's actor server-side (T-9511). Naming one is now an error,
    // which is the point — it used to be honoured.
    options: [body],
    words: [2],
    check: (args) =>
      args.some((a) => a.startsWith('--body='))
        ? undefined
        : 'needs --body=@file, --body=-, or --body=@-',
  },
  'mail reply': {
    usage: 'mail reply <id> [text... | --body=@file|-|@-]',
    about: 'reply in the existing mail thread',
    options: [body],
    words: [1],
    check: (args, words) =>
      words.length > 1 || args.some((a) => a.startsWith('--body='))
        ? undefined
        : 'needs reply words or --body=@file|-|@-',
  },
  'mail search': {
    usage: 'mail search <words...>',
    about: 'full-text search, limited to mail',
    words: [1],
  },
  'mail files': {
    usage: 'mail files <id> [--out DIR]',
    about: 'download attachments',
    options: [value('--out', 'a directory', true)],
    words: [1, 1],
  },
  'mail doctor': {
    usage: 'mail doctor',
    about: 'compare every book address with the Cloudflare routing rules',
    words: [0, 0],
  },
  inbox: {
    usage: 'inbox [--json|--all]',
    about: 'everything addressed to you, unread first',
    examples: [
      'task inbox',
      'task inbox --all',
      'task inbox show E-9',
      'task inbox archive E-9',
    ],
    detail:
      'Archived items are hidden; --all shows them too, marked `\u00d7`. ' +
      'Closing a task archives the correspondence about it, so --all is ' +
      'where that correspondence went.',
    root: true,
    options: [json, flag('--all')],
    words: [0, 0],
  },
  'inbox show': {
    usage: 'inbox show <id> [--json]',
    about: 'show the item and mark it opened',
    options: [json],
    words: [1, 1],
  },
  'inbox archive': {
    usage: 'inbox archive <id>',
    about: 'hide the item from your inbox',
    words: [1, 1],
  },
  claim: {
    usage: 'claim <id> [session]',
    about: 'lease a task (default: your own session id)',
    examples: ['task claim T-3 my-session-id'],
    root: true,
    words: [1, 2],
  },
  release: {
    usage: 'release <id>',
    about: 'drop the lease',
    examples: ['task release T-3'],
    root: true,
    words: [1, 1],
  },
  subject: {
    usage: '<id> [show|is|as|edge] …',
    about: 'show or act on a subject',
    examples: [
      'task T-3',
      'task T-3 requires T-9',
      'task T-3 is done',
      'task T-3 as json',
    ],
    root: true,
  },
  spawn: {
    usage: 'spawn <id> [--provider=X] [--model=Y] [--effort=Z] [--persona=P-9]',
    about: "dispatch a managed agent (defaults: your session's provider)",
    examples: [
      'task spawn T-3',
      'task spawn T-3 --provider=codex --model=gpt-5.4',
    ],
    root: true,
    options: [
      value('--provider'),
      value('--model'),
      value('--effort'),
      value('--persona'),
    ],
    words: [1, 1],
  },
  comment: {
    usage:
      'comment <id> [text...] [--verdict=approved|rejected|changes_requested] ' +
      '[--event]',
    about: 'comment on any entity; a verdict makes it a review',
    examples: [
      'task comment T-3 "blocked on the schema call"',
      'task comment S-31 "status?"',
      'task comment T-3 --verdict=approved',
      'task comment T-3 "sweep: missing domain" --event',
    ],
    detail:
      '--event marks a comment EMITTED by machinery — a sweep finding, a ' +
      'status nudge. An event never rides the mail relay and renders as a ' +
      'chip, not a bubble; the bus and the inbox still deliver it. Prose ' +
      'you wrote is a letter and stays one. The mark must ride the mint: ' +
      'the relay fires there, so flagging afterwards is too late.',
    root: true,
    options: [
      value(
        '--verdict',
        'approved, rejected, or changes_requested',
        false,
        /^(approved|rejected|changes_requested)$/,
      ),
      flag('--event'),
    ],
    words: [1],
    check: (args, words) =>
      words.length > 1 || args.some((a) => a.startsWith('--verdict='))
        ? undefined
        : 'needs comment text or --verdict=...',
  },
  dep: {
    usage: 'dep <id> <type> <child> [--gone]',
    about: 'link or unlink an edge',
    deprecated: 'superseded by task <id> <type> <child> [--gone]',
    examples: ['task T-3 requires T-9', 'task T-3 requires T-9 --gone'],
    root: true,
    options: [flag('--gone')],
    words: [3, 3],
  },
  backup: {
    usage: 'backup',
    about: 'snapshot the db + commit/push the data dir',
    root: true,
    words: [0, 0],
  },
  sync: {
    usage: 'sync [--no-commit]',
    about: "materialize personas into each project repo's .tasks/",
    examples: ['task sync', 'task sync --no-commit'],
    root: true,
    options: [flag('--no-commit')],
    words: [0, 0],
  },
  remember: {
    usage: 'remember <title...> [--body=…] ' +
      '[--type=user|feedback|project|reference] [--scope=P-9]',
    about: 'save a memory: the title is the index line, the body the lesson',
    examples: [
      'task remember "pipe a gate, lose its exit code" --type=feedback',
    ],
    root: true,
    options: [
      body,
      value(
        '--type',
        'user, feedback, project, or reference',
        false,
        /^(user|feedback|project|reference)$/,
      ),
      value('--scope', 'a project reference'),
    ],
    words: [1],
  },
  session: {
    usage: 'session <context|wrap|brief|turn> …',
    about: 'the session lifecycle: boot digest, wrap, self-authored brief',
    examples: [
      'task session context',
      'task session context my-session-id',
      'task session brief --body=@-',
      'task session turn idle',
      'task session wrap',
    ],
    root: true,
  },
  'session context': {
    usage: 'session context [sid] [--hook] [--subagent]',
    about: 'reify and print the session digest',
    options: [flag('--hook'), flag('--subagent')],
    words: [0, 1],
  },
  'session wrap': {
    usage: 'session wrap [sid] [--hook]',
    about: 'release claims and preserve the session brief',
    options: [flag('--hook')],
    words: [0, 1],
  },
  'session brief': {
    usage: 'session brief [text... | --body=@file|-|@-]',
    about: 'write your own session brief',
    options: [body],
    words: [0],
    check: (args, words) =>
      words.length || args.some((a) => a.startsWith('--body='))
        ? undefined
        : 'needs brief text or --body=@file|-|@-',
  },
  'session turn': {
    usage: 'session turn <idle|busy> [sid] [--hook]',
    about: 'announce a native provider turn boundary',
    options: [flag('--hook')],
    words: [0, 2],
  },
  role: {
    usage: 'role [--json] | role <stop|start> <id>… | --all',
    about: 'persistent roles: what should be running, and the off switch',
    examples: [
      'task role',
      'task role stop R-12',
      'task role stop --all',
      'task role start R-12',
    ],
    detail:
      'A role is DESIRED capacity — the reconciler drives real processes ' +
      'toward it every couple of seconds. Killing a pane or tmux session is ' +
      'therefore not a stop; the next sweep relaunches it. `role stop` patches ' +
      'the desire itself, so it holds across daemon and machine restarts. ' +
      '`role stop --all` is the fleet-wide off switch.',
    root: true,
    options: [json],
  },
  'role stop': {
    usage: 'role stop <id>… | --all',
    about: 'set roles to stopped — the durable off switch',
    examples: ['task role stop R-12', 'task role stop --all'],
    options: [flag('--all')],
    words: [0],
    check: (args, words) =>
      words.length || args.includes('--all')
        ? undefined
        : 'name at least one role, or --all',
  },
  'role start': {
    usage: 'role start <id>… | --all',
    about: 'set roles to running — the reconciler launches them',
    examples: ['task role start R-12', 'task role start --all'],
    options: [flag('--all')],
    words: [0],
    check: (args, words) =>
      words.length || args.includes('--all')
        ? undefined
        : 'name at least one role, or --all',
  },
  telemetry: {
    usage: 'telemetry [--errors] [--since=ISO] [-n N]',
    about: 'tool calls + crashes',
    examples: ['task telemetry --errors -n 20'],
    root: true,
    options: [flag('--errors'), value('--since', 'an ISO timestamp'), count],
    words: [0, 0],
  },
  wake: {
    usage: 'wake <who> <when...> [target]',
    about: 'a knock on a timer',
    examples: [
      'task wake S-31 in 60m',
      'task wake homelab "9am tomorrow" T-42',
    ],
    root: true,
    words: [2],
  },
  ':': {
    usage: ':<command> … | <id> :<command> …',
    about: "the web bar's `:` vocabulary (task help : lists every command)",
    examples: [
      'task :fix T-42',
      'task :new P1 ship the fix',
      'task T-42 :done',
    ],
    root: true,
  },
  help: {
    usage: 'help [verb|nested verb|grammar|:]',
    about: 'this manual; grammar = filters + dot-params',
    examples: [
      'task help list',
      'task help mail send',
      'task help grammar',
      'task help :fix',
    ],
    root: true,
    words: [0, 2],
  },
  ls: {
    usage: 'ls [filters...] [--json]',
    about: 'list tasks (filter grammar)',
    deprecated: 'superseded by task list',
    examples: ['task list .status=open'],
    alias: true,
    options: [json],
  },
  context: {
    usage: 'context [sid] [--hook] [--subagent]',
    about: 'reify and print the session digest',
    deprecated: 'superseded by task session context',
    examples: ['task session context'],
    alias: true,
    options: [flag('--hook'), flag('--subagent')],
    words: [0, 1],
  },
  wrap: {
    usage: 'wrap [sid] [--hook]',
    about: 'release claims and preserve the session brief',
    deprecated: 'superseded by task session wrap',
    examples: ['task session wrap'],
    alias: true,
    options: [flag('--hook')],
    words: [0, 1],
  },
}

export let cliVerbs = new Set(
  Object.entries(manuals)
    .filter(([name, m]) =>
      !['subject', ':'].includes(name) &&
      !name.includes(' ') && (m.root || m.alias)
    )
    .map(([name]) => name),
)

export let subjectUsage = (id = '<id>') =>
  `task ${id} — subject-first verbs

  task ${id} [show] [--json]        show the entity
  task ${id} as markdown|json       choose the show format
  task ${id} is ${statuses.join('|')}  set task status
  task ${id} ${edges.join('|')} <id> [--gone]
                                      link or unlink an edge
  task ${id} :<command> …            run a focused ':' command`

let roots = () => Object.values(manuals).filter((m) => m.root && !m.deprecated)

export let usage = () =>
  `task — the entity graph, from a shell

${
    roots().map((m) =>
      m.usage.length > 29
        ? `  task ${m.usage}\n${' '.repeat(38)}${m.about}`
        : `  task ${m.usage.padEnd(29)}  ${m.about}`
    ).join('\n')
  }

dot-params route by prop (.title= → doc.title); collisions use the
explicit .comp.prop spelling. 'task help grammar' spells the whole
filter grammar; 'task help <verb>' shows examples.`

let children = (name: string) =>
  Object.entries(manuals)
    .filter(([key, manual]) =>
      !manual.deprecated &&
      key.startsWith(`${name} `) && !key.slice(name.length + 1)
        .includes(' ')
    )
    .map(([, m]) => m)

let render = (name: string, m: Manual) => {
  let out = `task ${m.usage}\n  ${m.about}`
  if (m.deprecated) out += `\n\nDeprecated: ${m.deprecated}`
  let subs = children(name)
  if (subs.length) {
    out += '\n\n' +
      subs.map((s) => `  task ${s.usage.padEnd(58)} ${s.about}`).join('\n')
  }
  if (m.detail) out += `\n\n${m.detail}`
  if (m.examples?.length) {
    out += `\n\n${m.examples.map((e) => `  ${e}`).join('\n')}`
  }
  return out
}

let commandHelp = (name = '') => {
  let show = name ? { [name]: commands[name] } : commands
  if (name && !commands[name]) {
    throw new Error(`not a command: ${name} (task help : lists them)`)
  }
  return Object.entries(show)
    .map(([n, c]) => `task :${`${n} ${c.args}`.trim().padEnd(34)} ${c.about}`)
    .join('\n')
}

export let help = (args: string[]) => {
  if (!args.length) return usage()
  if (args[0] == 'subject' && args.length <= 2) return subjectUsage(args[1])
  if (args[0] == 'grammar' && args.length == 1) {
    return `${GRAMMAR}\n\n${FILTERS}`
  }
  if (args[0].startsWith(':') && args.length == 1) {
    return commandHelp(args[0].slice(1))
  }
  let name = args.join(' ')
  let manual = manuals[name]
  if (manual) return render(name, manual)
  if (args.length == 1 && commands[args[0]]) return commandHelp(args[0])
  throw new Error(`no such help topic: ${name} (task help lists them)`)
}

let helpAt = (args: string[]) => {
  if (!args.length) return usage()
  if (args[0] == 'help') return help(args.slice(1))
  let colon = args.find((a) => a.startsWith(':'))
  if (colon) return commandHelp(colon.slice(1))
  let root = manuals[args[0]]
  if (root) {
    let nested = manuals[`${args[0]} ${args[1]}`]
    return nested
      ? render(`${args[0]} ${args[1]}`, nested)
      : render(args[0], root)
  }
  if (commands[args[0]]) return commandHelp(args[0])
  if (args[0].startsWith('-')) {
    throw new Error(`no such verb: ${args[0]} (task --help lists them)`)
  }
  return subjectUsage(args[0])
}

export let requestedHelp = (argv: string[]) => {
  let end = argv.indexOf('--')
  let head = end < 0 ? argv : argv.slice(0, end)
  if (!head.some((a) => a == '--help' || a == '-h')) return
  return helpAt(head.filter((a) => a != '--help' && a != '-h'))
}

export let route = (cmd: string | undefined, args: string[]) => {
  if (!cmd) return
  let nested = manuals[`${cmd} ${args[0]}`]
  let familyHelp = args[0] == 'help' &&
    Object.keys(manuals).some((name) => name.startsWith(`${cmd} `))
  return nested
    ? { name: `${cmd} ${args[0]}`, manual: nested, args: args.slice(1) }
    : manuals[cmd]
    ? { name: cmd, manual: manuals[cmd], args: familyHelp ? [] : args }
    : undefined
}

let option = (arg: string) =>
  arg != '--' && (arg.startsWith('--') || /^-[A-Za-z]/.test(arg))

let match = (opt: Opt, arg: string) => {
  if (!opt.value) return arg == opt.name
  if (arg == opt.name) return opt.separate
  if (opt.name.startsWith('--')) return arg.startsWith(`${opt.name}=`)
  return arg.startsWith(opt.name)
}

let optionName = (arg: string) =>
  arg.startsWith('--') ? arg.split('=')[0] : arg.slice(0, 2)

let usageError = (name: string, manual: Manual, message: string) =>
  new Error(
    `${name} ${message}\nusage: task ${manual.usage}` +
      (manual.deprecated ? `\ndeprecated: ${manual.deprecated}` : ''),
  )

export let validate = (
  name: string,
  manual: Manual,
  args: string[],
) => {
  if (manual.passthrough) return
  let words: string[] = []
  let literal = false
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]
    if (literal || arg == '--') {
      literal = true
      words.push(arg)
      continue
    }
    if (!option(arg)) {
      words.push(arg)
      continue
    }
    let opt = manual.options?.find((o) => match(o, arg))
    if (!opt) {
      if (
        (name == 'wrap' || name == 'session wrap') &&
        optionName(arg) == '--body'
      ) {
        throw usageError(
          name,
          manual,
          "takes no --body — did you mean 'task session brief --body=…'?",
        )
      }
      throw usageError(name, manual, `does not take ${optionName(arg)}`)
    }
    if (!opt.value) continue
    let got = opt.name.startsWith('--')
      ? arg.slice(opt.name.length + 1)
      : arg.slice(opt.name.length)
    if (arg == opt.name) {
      let next = args[i + 1]
      if (!opt.separate || !next || option(next)) {
        throw usageError(name, manual, `${opt.name} needs ${opt.want}`)
      }
      got = next
      i++
    }
    if (!opt.value.test(got)) {
      throw usageError(name, manual, `${opt.name} needs ${opt.want}`)
    }
  }
  if (!manual.words) return
  let issue = manual.check?.(args, words)
  if (issue) throw usageError(name, manual, issue)
  let [min, max] = manual.words
  if (words.length >= min && (max == null || words.length <= max)) return
  let want = max == null
    ? `at least ${min}`
    : min == max
    ? `${min}`
    : `${min}–${max}`
  throw usageError(
    name,
    manual,
    `expected ${want} argument${want == '1' ? '' : 's'}, got ${words.length}`,
  )
}

export let validateCommand = (name: string, args: string[]) => {
  let command = commands[name]
  if (!command) {
    throw new Error(`not a command: :${name} (task help : lists them)`)
  }
  let end = args.indexOf('--')
  let bad = (end < 0 ? args : args.slice(0, end)).find(option)
  if (bad) {
    let hint = ['new', 'fix', 'set'].includes(name)
      ? ` — writes use .prop=value (task help grammar)`
      : ''
    throw new Error(
      `:${name} does not take ${optionName(bad)}${hint}\n` +
        `usage: task :${`${name} ${command.args}`.trim()}`,
    )
  }
  if (
    command.words &&
    (args.length < command.words[0] || args.length > command.words[1])
  ) {
    throw new Error(
      `:${name} expected ${command.words[0]}–${command.words[1]} arguments, ` +
        `got ${args.length}\nusage: task :${`${name} ${command.args}`.trim()}`,
    )
  }
}
