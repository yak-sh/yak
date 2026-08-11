// The shell manual is executable data: root usage, focused help and argument
// validation all read this table. The palette keeps its own command table;
// this module renders it directly, so neither vocabulary can drift.

import { commands } from './commands.ts'
import { providers } from './adapters.ts'
import {
  inflate,
  type Param,
  param,
  separated,
  type Stdin,
  stdin,
} from './client.ts'
import { FILTERS, GRAMMAR } from './grammar.ts'
import { comps, edges, kindOrder, plurals, statuses } from './types.ts'
import {
  type Arg,
  body as bodyKind,
  type Decl,
  enumOf,
  type Got,
  id,
  num,
  of,
  type Opt,
  path,
  text,
  usageOf,
  wordsOf,
} from './verb.ts'

export type Manual = Decl

let arg = (
  name: string,
  kind = text,
  rest = false,
  need = true,
): Arg => ({ name, kind, rest, need })

let flag = (name: string): Opt => ({ name })
let value = (name: string, kind = text, separate = false): Opt => ({
  name,
  kind,
  separate,
})

let json = flag('--json')
let quarantined = flag('--quarantined')
let body = value('--body', bodyKind)
let bodyText = { ...bodyKind, name: 'text' }
// Retired flags whose habit outlives them, said once each (Manual.retired).
let BRIEF_BODY = "takes no --body — did you mean 'task session brief --body=…'?"
let REMEMBER_TYPE =
  'takes no --type: the memory.type enum is retired (T-12585) — ' +
  '--scope=P-19 says project, --feedback=jeff says who gave it, and ' +
  'saying nothing IS a reference'
let count = value('-n', num, true)
let empty = { name: 'text', test: /.*/ }
let minutes = { name: 'minutes', test: /^\d+$/ }
let timestamp = { name: 'iso', test: /.+/ }
let verdict = enumOf(comps.review.verdict, 'verdict')
let provider = of('provider', () => providers().map((p) => p.name))
let model = of(
  'model',
  () => [...new Set(providers().flatMap((p) => p.models))],
)
let effort = of(
  'effort',
  () => [...new Set(providers().flatMap((p) => p.efforts))],
)

let declare = (
  all: Record<string, Omit<Manual, 'name' | 'door'>>,
): Record<string, Manual> =>
  Object.fromEntries(
    Object.entries(all).map(([name, verb]) => [
      name,
      { name, door: ['cli'], ...verb },
    ]),
  )

export let manuals = declare({
  tui: {
    about: 'open the terminal UI',
    root: true,
    args: [],
  },
  claude: {
    about:
      'interactive claude: graph participant; --operator adds project broadcasts',
    examples: ['task claude', 'task claude --operator --continue'],
    root: true,
    args: [arg('claude args', text, true, false)],
    opts: [flag('--operator')],
    passthrough: true,
  },
  codex: {
    about:
      'interactive codex: graph participant; --operator adds project broadcasts',
    examples: ['task codex', 'task codex --operator resume --last'],
    root: true,
    args: [arg('codex args', text, true, false)],
    opts: [flag('--operator')],
    passthrough: true,
  },
  list: {
    dots: 'filters',
    about: 'list tasks — or any kind (filter grammar)',
    examples: [
      'task list .status=open .priority<=1',
      'task list .project=harness .updated.at>="1 week ago"',
      'task projects',
      'task list boards .title~=fleet',
    ],
    detail: 'A leading KIND word says what to list — `projects`, ' +
      '`.kind=project` and `kind=project` all name it, and the plural is a ' +
      'verb of its own (`task projects`). Tasks are the default. The second ' +
      "column is the handle you can type: a task's status, everything " +
      `else's alias. Quarantined rows require an explicit ` +
      `'.quarantined!' filter. Kinds: ${kindOrder.join(', ')}.`,
    root: true,
    args: [arg('kind', text, false, false), arg('filters', text, true, false)],
    opts: [json],
  },
  decided: {
    dots: 'filters',
    about: 'what has been settled here, newest decision first',
    examples: [
      'task decided',
      'task decided .project=P-30',
      'task decided --all',
      'task decided .decided.at>="1 month ago"',
    ],
    detail: 'The `decided` stamp is a facet, not a kind — a task, a memory ' +
      'and a doc can all wear one — so this walks every kind at once. The ' +
      'date leads each line, and it is the DECISION date: record an old one ' +
      'with `task set <id> .decided.at="2026-06-01"`, which is not the same ' +
      'as when the entity was filed. The default scope is the project your ' +
      'cwd puts you in, plus the fleet-wide rulings that bind it — the same ' +
      "scope the digest's `## decided` block uses. `.project=P-30` asks " +
      'about another one; `--all` asks about every project at once.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [flag('--all'), json],
  },
  new: {
    dots: 'params',
    about: 'create a task (bare words become the title)',
    body: 'body',
    examples: [
      'task new P1 .project=holdco Fix the flux capacitor',
      'task new .title="Write the digest" .body="Details..." .domain=Eng',
      'task new .title="Write the digest" .body=@- <<\'EOF\'',
    ],
    detail: 'Any dot-param value may be `@file` (read from that file) or ' +
      '`-`/`@-` (read from piped stdin) — the safe doors for a long body, ' +
      'since shell substitution fails silently and an empty value CLEARS ' +
      'the column. `@@` escapes a value that genuinely starts with an @. ' +
      'stdin is consumable once: a second `@-` in one command is refused.',
    root: true,
    args: [arg('title', text, true, false)],
    // create() owns the more useful --flag → .param correction.
    passthrough: true,
  },
  set: {
    dots: 'params',
    about: 'patch any entity; --comment says why, in the same batch',
    examples: [
      'task set T-3 .status=done --comment="verified end-to-end"',
      'task set T-3 .assignee=jeff .priority=1',
      'task set S-12 ".body=@brief.md"',
      'task set S-12 .body=@- < brief.md',
    ],
    detail: 'A dot-param or --comment that IS `@file` is read from that ' +
      'file, and `-`/`@-` from piped stdin. The patch and the reason for ' +
      'it ride one atomic batch, so neither can land without the other.',
    root: true,
    args: [arg('id', id)],
    opts: [value('--comment', bodyText)],
  },
  show: {
    about: 'one entity as a document (--quarantined explicitly reveals)',
    examples: [
      'task show T-3',
      'task show T-3 --json',
      'task show T-3 --quarantined',
    ],
    root: true,
    args: [arg('id', id)],
    opts: [json, quarantined],
  },
  history: {
    about: "the entity's write history (journal)",
    examples: ['task history T-3 -n 10'],
    root: true,
    args: [arg('id', id)],
    opts: [{ ...count, or: '50' }, json],
  },
  search: {
    dots: 'filters',
    about: 'full-text search (trailing * = prefix)',
    examples: [
      'task search flux capac*',
      'task search .project=holdco deploy',
    ],
    root: true,
    // Filters ride words but not positional slots; seek rejects a query with
    // neither, after both forms have reached it.
    args: [arg('words', text, true, false)],
    opts: [json],
  },
  mail: {
    dots: 'filters',
    about: 'the mail-only slice of your items',
    deprecated: 'superseded by task inbox, where mail is one kind of item',
    examples: [
      'task inbox',
      'task mail send jeff Subject words --body=@draft.md',
    ],
    detail:
      '<to> is an address or graph reference (alias, P-9, eid); the address ' +
      'book resolves it at delivery. Filters speak `task help grammar`.',
    args: [arg('filters', text, true, false)],
    opts: [json, flag('--all'), flag('--sent')],
  },
  'mail show': {
    about: 'show the mail and thread; mark it opened',
    args: [arg('id', id)],
    opts: [json],
  },
  'mail send': {
    // Root because `mail` itself is deprecated: sending a letter is not
    // superseded by the inbox, so it keeps its own door in the usage.
    dots: ['body'],
    body: 'body',
    about: 'send a letter; - and @- read the body from stdin',
    root: true,
    // No --from: a letter is signed by whoever wrote it, derived from the
    // session's actor server-side (T-9511). Naming one is now an error,
    // which is the point — it used to be honoured.
    args: [arg('to', id), arg('subject', text, true)],
    opts: [body],
    some: ['--body'],
  },
  'mail reply': {
    // A lone trailing @file reads the file, exactly as --body=@file does —
    // one @ convention per door, named here so the two spellings can't be
    // read as equal when only one works (T-10461).
    dots: ['body'],
    body: 'text',
    about: 'reply in the existing mail thread; a lone @file is read',
    args: [arg('id', id), arg('text', text, true, false)],
    opts: [body],
    some: ['text', '--body'],
  },
  'mail search': {
    about: 'full-text search, limited to mail',
    args: [arg('words', text, true)],
  },
  'mail files': {
    about: 'download attachments',
    args: [arg('id', id)],
    opts: [value('--out', path, true)],
  },
  'mail doctor': {
    about: 'compare every book address with the Cloudflare routing rules',
    args: [],
  },
  watch: {
    about: 'put an entity in your inbox even when nothing is aimed at you',
    examples: ['task watch T-3', 'task watch T-3 --gone'],
    detail:
      'A standing instruction about ONE entity: its comments, letters and ' +
      'knocks reach your inbox whether or not they were addressed to you. ' +
      '--gone clears it. Per-actor, resolved from your cwd like `task inbox`.',
    root: true,
    args: [arg('id', id)],
    opts: [flag('--gone')],
  },
  mute: {
    about: 'stop an entity reaching your inbox, even direct address',
    examples: ['task mute T-3', 'task mute T-3 --gone'],
    detail:
      'The opposite standing instruction, and it wins over direct address: ' +
      'a thread you have declared finished stays out. Nothing is deleted — ' +
      '`task inbox --all` still shows it. --gone clears it.',
    root: true,
    args: [arg('id', id)],
    opts: [flag('--gone')],
  },
  inbox: {
    dots: 'filters',
    about: 'everything addressed to you, unread first',
    examples: [
      'task inbox',
      'task inbox --all',
      'task inbox .from=jeff@yak.sh',
      'task inbox show E-9',
      'task inbox archive E-9',
    ],
    detail:
      'Archived items are hidden; --all shows them too, marked `\u00d7`, ' +
      'and ignores `task mute`. Closing a task archives the correspondence ' +
      'about it, so --all is where that correspondence went. --sent is the ' +
      'letters you sent. Filters speak `task help grammar` \u2014 the same one ' +
      'parser every list door uses.',
    root: true,
    args: [arg('filters', text, true, false)],
    opts: [json, flag('--all'), flag('--sent')],
  },
  'inbox show': {
    about: 'show the item and mark it opened',
    args: [arg('id', id)],
    opts: [json],
  },
  'inbox archive': {
    about: 'hide the item from your inbox',
    args: [arg('id', id)],
  },
  claim: {
    about: 'lease a task (default: your own session id)',
    examples: ['task claim T-3 my-session-id'],
    root: true,
    args: [arg('id', id), arg('session', text, false, false)],
  },
  release: {
    about: 'drop the lease',
    examples: ['task release T-3'],
    root: true,
    args: [arg('id', id)],
  },
  subject: {
    syntax: '<id> [show|is|as|edge] …',
    about: 'show or act on a subject',
    examples: [
      'task T-3',
      'task T-3 requires T-9',
      'task T-3 is done',
      'task T-3 as json',
    ],
    root: true,
    args: [arg('words', text, true, false)],
  },
  spawn: {
    dots: ['provider', 'model', 'effort', 'persona'],
    about: "dispatch a managed agent (defaults: your session's provider)",
    examples: [
      'task spawn T-3',
      'task spawn T-3 --provider=codex --model=gpt-5.6-sol',
    ],
    root: true,
    args: [arg('id', id)],
    opts: [
      value('--provider', provider),
      value('--model', model),
      { ...value('--effort', effort), or: 'high' },
      value('--persona', id),
    ],
  },
  land: {
    about: "rebase, gate, and land this session's worktree",
    examples: ['task land'],
    detail: "The session's task chooses the repo, base branch, worktree and " +
      'repo.gate command from the graph. A concurrent fast-forward makes the ' +
      'verb rebase and retest, up to five times. Success comments the landed ' +
      'sha on the task and unlocks the worktree — you keep standing in it, so ' +
      'you can still release, comment and clean up. A later landing (or ' +
      '`task probes --reap`) removes it once nobody is inside.',
    root: true,
    args: [],
  },
  comment: {
    about: 'comment on any entity; a verdict makes it a review',
    dots: ['body'],
    body: 'text',
    examples: [
      'task comment T-3 "blocked on the schema call"',
      'task comment T-3 .body=@notes.md',
      'task comment S-31 "status?"',
      'task comment T-3 --verdict=approved',
      'task set C-13 .body="what it should have said"',
    ],
    detail: 'The body is a DOCUMENT like a task body — `.body=@-` reads a ' +
      'heredoc, `.body=@file` reads a file, and a lone trailing @token does ' +
      'the same (`@@` escapes a comment that genuinely starts with an @). ' +
      'Comments render markdown exactly as bodies do, so author a rich one ' +
      'through the body door rather than as a flat inline string. A comment ' +
      'is something you WROTE, and it reaches whoever the entity concerns.\n\n' +
      "Prints the comment's own id. A comment is an ordinary entity, so " +
      'REVISE a wrong one in place — `task set C-13 .body="…"` — rather ' +
      'than posting a correction beneath it. `task history C-13` keeps every ' +
      'earlier version, so nothing is lost by fixing it; a correction ' +
      'comment only leaves the wrong text as the one read first.',
    root: true,
    args: [arg('id', id), arg('text', text, true, false)],
    opts: [
      body,
      value('--verdict', verdict),
    ],
    some: ['text', '--body', '--verdict'],
  },
  dep: {
    about: 'link or unlink an edge',
    deprecated: 'superseded by task <id> <type> <child> [--gone]',
    examples: ['task T-3 requires T-9', 'task T-3 requires T-9 --gone'],
    root: true,
    args: [arg('id', id), arg('type'), arg('child', id)],
    opts: [flag('--gone')],
  },
  backup: {
    about: 'snapshot the db + commit/push the data dir',
    root: true,
    args: [],
  },
  sync: {
    about: "materialize personas into each project repo's .tasks/",
    examples: ['task sync', 'task sync --no-commit', 'task sync --check'],
    detail: 'Commits what it wrote in the repos that track it, and pushes ' +
      'in the ventures that permit it — `task set P-34 .push=1` grants it, ' +
      'and absent is no, so a venture whose main branch deploys simply ' +
      'never gets one. Unpushed, every projection commit is one more the ' +
      'next operator has to rebase past. --check writes nothing: it reports ' +
      'any projection that drifts from its render and exits non-zero, the ' +
      "gate's guard against a hand-edit to a generated file.",
    root: true,
    args: [],
    opts: [flag('--no-commit'), flag('--check')],
  },
  design: {
    dots: ['body'],
    body: 'body',
    about: 'record a design: the thinking that precedes a build, proposed',
    examples: [
      'task design "Mail is local-first for fleet recipients" .body=@plan.md',
      'task design "One graph, many doors" --body=@plan.md',
      'task designs',
      'task designs .decided=',
    ],
    detail: 'A design is a doc wearing the `design` tag and the `proposed` ' +
      'mark — written awaiting acceptance. Accepting one is `task set D-9 ' +
      '.decided.at=now .decided.by=jeff`, the same stamp a task or a memory ' +
      'takes; both marks then stand, proposed on that day and decided on ' +
      'this one. `task designs` lists them, `.decided=` screens the ones ' +
      'still waiting.\n\nThe words are the TITLE, so the writing rides its ' +
      'own door: `.body=@plan.md` or `--body=@plan.md` reads that file, ' +
      '`-`/`@-` reads piped stdin. Any other argument is refused rather ' +
      'than joined to the title.',
    root: true,
    args: [arg('title', text, true)],
    opts: [body],
  },
  remember: {
    dots: ['body', 'scope', 'feedback'],
    body: 'body',
    about: 'save a memory: the title is the index line, the body the lesson',
    examples: [
      'task remember "pipe a gate, lose its exit code" .feedback=jeff',
      'task remember "the sweep runs hourly" .scope=P-19 .body=@lesson.md',
    ],
    detail: 'Every value is said at either spelling — `.scope=P-19` and ' +
      '`--scope=P-19` alike — and the words are the TITLE, so anything ' +
      'else is refused rather than joined to it. `.body=@lesson.md` reads ' +
      'that file, `-`/`@-` piped stdin.\n\nscope names the project it ' +
      'belongs to; omit it for a principle every operator carries. ' +
      'feedback names WHO gave it (an empty value tags it with no ' +
      'source). There is no --type: the enum is retired, and saying ' +
      'nothing IS a reference.',
    root: true,
    args: [arg('title', text, true)],
    opts: [
      body,
      value('--feedback', empty),
      value('--scope', id),
    ],
    retired: { '--type': REMEMBER_TYPE },
  },
  session: {
    about: 'the session lifecycle: boot digest, wrap, self-authored brief',
    examples: [
      'task session context',
      'task session context my-session-id',
      'task session brief --body=@-',
      'task session turn idle',
      'task session wrap',
    ],
    root: true,
    args: [arg('command', text, true, false)],
  },
  'session context': {
    about: 'reify and print the session digest',
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook'), flag('--subagent')],
  },
  'session wrap': {
    about: 'release claims and preserve the session brief',
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook')],
    retired: { '--body': BRIEF_BODY },
  },
  'session brief': {
    dots: ['body'],
    body: 'text',
    about: 'write your own session brief; a lone @file is read',
    args: [arg('text', text, true, false)],
    opts: [body],
    some: ['text', '--body'],
  },
  'session turn': {
    about: 'announce a native provider turn boundary',
    args: [
      arg('idle|busy', of('state', () => ['idle', 'busy']), false, false),
      arg('sid', text, false, false),
    ],
    opts: [flag('--hook')],
  },
  role: {
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
    args: [arg('command', text, true, false)],
    opts: [json],
  },
  'role stop': {
    about: 'set roles to stopped — the durable off switch',
    examples: ['task role stop R-12', 'task role stop --all'],
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  'role start': {
    about: 'set roles to running — the reconciler launches them',
    examples: ['task role start R-12', 'task role start --all'],
    args: [arg('ids', id, true, false)],
    opts: [flag('--all')],
    some: ['ids', '--all'],
  },
  probes: {
    about: 'what dead sessions left running — browsers, servers, worktrees',
    detail:
      'Lists by default; --reap kills the orphans and removes the worktrees.\n' +
      'A process is an orphan only on ephemeral ground (a worktree or a\n' +
      'scratchpad) or as a headless browser holding a debugging port, and\n' +
      'only when no live session owns it. --all shows what was spared and\n' +
      'why. --grace=0 drops the 30-minute head start a young probe gets.\n' +
      'The server sweeps on its own only under TASKS_SWEEP=1; unset, this\n' +
      'verb is the one door and nothing is killed unless you say so.',
    examples: ['task probes', 'task probes --all', 'task probes --reap'],
    root: true,
    args: [],
    opts: [
      flag('--all'),
      flag('--reap'),
      { ...value('--grace', minutes), or: '30' },
    ],
  },
  telemetry: {
    about: 'tool calls + crashes',
    examples: ['task telemetry --errors -n 20'],
    root: true,
    args: [],
    opts: [flag('--errors'), value('--since', timestamp), count],
  },
  wake: {
    about: 'a knock on a timer',
    examples: [
      'task wake S-31 in 60m',
      'task wake homelab "9am tomorrow" T-42',
    ],
    root: true,
    args: [
      arg('who', id),
      arg('when', text, true),
      arg('target', id, false, false),
    ],
  },
  ':': {
    syntax: ':<command> … | <id> :<command> …',
    about: "the web bar's `:` vocabulary (task help : lists every command)",
    examples: [
      'task :fix T-42',
      'task :new P1 ship the fix',
      'task T-42 :done',
    ],
    root: true,
    args: [arg('words', text, true, false)],
  },
  help: {
    about: 'this manual; grammar = filters + dot-params',
    examples: [
      'task help list',
      'task help mail send',
      'task help grammar',
      'task help :fix',
    ],
    root: true,
    args: [
      arg('verb|grammar|:', text, false, false),
      arg('nested verb', text, false, false),
    ],
  },
  ls: {
    dots: 'filters',
    about: 'list tasks (filter grammar)',
    deprecated: 'superseded by task list',
    examples: ['task list .status=open'],
    alias: true,
    args: [arg('filters', text, true, false)],
    opts: [json],
  },
  context: {
    about: 'reify and print the session digest',
    deprecated: 'superseded by task session context',
    examples: ['task session context'],
    alias: true,
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook'), flag('--subagent')],
  },
  wrap: {
    about: 'release claims and preserve the session brief',
    deprecated: 'superseded by task session wrap',
    examples: ['task session wrap'],
    alias: true,
    args: [arg('sid', text, false, false)],
    opts: [flag('--hook')],
    retired: { '--body': BRIEF_BODY },
  },
})

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
      usageOf(m).length > 29
        ? `  task ${usageOf(m)}\n${' '.repeat(38)}${m.about}`
        : `  task ${usageOf(m).padEnd(29)}  ${m.about}`
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

let reference = (m: Manual) => {
  let opts = (m.opts ?? []).filter((opt) => opt.kind?.of || opt.or)
  if (!opts.length) return ''
  let width = Math.max(...opts.map((opt) => opt.name.length))
  return opts.map((opt) => {
    let values = opt.kind?.of?.()
    let accepts = values?.length
      ? `one of ${values.join(', ')}`
      : opt.kind?.name ?? ''
    let fallback = opt.or ? ` — default ${opt.or}` : ''
    return `  ${opt.name.padEnd(width)}  ${accepts}${fallback}`
  }).join('\n')
}

let render = (name: string, m: Manual) => {
  let out = `task ${usageOf(m)}\n  ${m.about}`
  if (m.deprecated) out += `\n\nDeprecated: ${m.deprecated}`
  let subs = children(name)
  if (subs.length) {
    out += '\n\n' +
      subs.map((s) => `  task ${usageOf(s).padEnd(58)} ${s.about}`).join('\n')
  }
  let refs = reference(m)
  if (refs) out += `\n\n${refs}`
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
  // A plural kind IS the list verb (cli.ts `listing`), so its help is
  // list's — otherwise `task projects --help` reads as a subject.
  if (plurals.has(args[0])) return render('list', manuals.list)
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

export let route = <V extends Manual = Manual>(
  cmd: string | undefined,
  args: string[],
  all: Record<string, V> = manuals as Record<string, V>,
) => {
  if (!cmd) return
  let nested = all[`${cmd} ${args[0]}`]
  let familyHelp = args[0] == 'help' &&
    Object.keys(all).some((name) => name.startsWith(`${cmd} `))
  return nested
    ? { name: `${cmd} ${args[0]}`, manual: nested, args: args.slice(1) }
    : familyHelp
    ? { name: 'help', manual: all.help, args: [cmd] }
    : all[cmd]
    ? { name: cmd, manual: all[cmd], args }
    : undefined
}

let option = (arg: string) =>
  arg != '--' && (arg.startsWith('--') || /^-[A-Za-z]/.test(arg))

let match = (opt: Opt, arg: string) => {
  if (!opt.kind) return arg == opt.name
  if (arg == opt.name) return opt.separate
  if (opt.name.startsWith('--')) return arg.startsWith(`${opt.name}=`)
  return arg.startsWith(opt.name)
}

let optionName = (arg: string) =>
  arg.startsWith('--') ? arg.split('=')[0] : arg.slice(0, 2)

// The dot-param SHAPE — client.ts param()'s, narrowed to the leading name.
// An `=` is required, so a title word that merely opens with a dot (a
// `.gitignore`, a leading ellipsis) is prose and stays prose.
let dotted = (arg: string) =>
  /^\.([A-Za-z_][\w-]*)(?:\.[A-Za-z_][\w-]*)?=/
    .exec(arg)?.[1]

// What a verb that takes SOME dot-params should be told it takes.
let takes = (manual: Manual) =>
  Array.isArray(manual.dots) && manual.dots.length
    ? ` — it takes ${manual.dots.map((d) => `.${d}=`).join(' ')}`
    : ''

let usageError = (name: string, manual: Manual, message: string) =>
  new Error(
    `${name} ${message}\nusage: task ${usageOf(manual)}` +
      (manual.deprecated ? `\ndeprecated: ${manual.deprecated}` : ''),
  )

let accepts = (kind: NonNullable<Opt['kind']>, value: string) => {
  let values = kind.of?.()
  if (values) return values.includes(value)
  if (!kind.test) return true
  kind.test.lastIndex = 0
  return kind.test.test(value)
}

let wanted = (kind: NonNullable<Opt['kind']>) =>
  kind == num
    ? 'a positive number'
    : kind == path
    ? 'a directory'
    : kind == bodyKind
    ? 'text, @file, - or @-'
    : kind == timestamp
    ? 'an ISO timestamp'
    : kind.name

let some = (manual: Manual, present: Set<string>) => {
  let missing = manual.some?.filter((name) => !present.has(name))
  if (!missing || missing.length != manual.some?.length) return
  let shape = (name: string) => {
    let positional = manual.args?.find((arg) => arg.name == name)
    if (positional) return `<${name}>`
    let opt = manual.opts?.find((opt) => opt.name == name)
    return `${name}${opt?.kind ? `=<${wanted(opt.kind)}>` : ''}`
  }
  return `needs ${missing.map(shape).join(' or ')}`
}

let parsed = (
  name: string,
  manual: Manual,
  argv: string[],
  io: Stdin,
  read: boolean,
): Got => {
  let words: string[] = []
  let slots: string[] = []
  let opts: Record<string, string> = Object.fromEntries(
    (manual.opts ?? []).flatMap((opt) =>
      opt.or == null ? [] : [[opt.name, opt.or]]
    ),
  )
  let flags = new Set<string>()
  let provided = new Set<string>()
  let params: Param[] = []
  let paramAs: string[] = []
  let reads: Record<string, { raw: string; as: string }> = {}
  let present = new Set<string>()
  let literal = false
  let value = (opt: Opt, raw: string, as: string) => {
    if (!accepts(opt.kind!, raw)) {
      throw usageError(name, manual, `${opt.name} needs ${wanted(opt.kind!)}`)
    }
    if (provided.has(opt.name)) return
    opts[opt.name] = raw
    if (opt.kind!.read) reads[opt.name] = { raw, as }
    provided.add(opt.name)
  }
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]
    if (literal) {
      words.push(arg)
      slots.push(arg)
      continue
    }
    if (arg == '--') {
      literal = true
      if (manual.passthrough) {
        words.push(arg)
        slots.push(arg)
      }
      continue
    }
    if (!option(arg)) {
      let dot = dotted(arg)
      if (manual.dots == 'filters' && arg.startsWith('.')) {
        words.push(arg)
        continue
      }
      if (manual.dots == 'params' && arg.startsWith('.')) {
        let p = param(arg)
        if (p) {
          params.push(p)
          paramAs.push(arg)
          continue
        }
      }
      if (dot) {
        // A param the verb declares is a VALUE, so it never counts as one of
        // the words; anything else is refused by name rather than swallowed.
        if (Array.isArray(manual.dots) && manual.dots.includes(dot)) {
          let raw = arg.slice(arg.indexOf('=') + 1)
          let key = `--${dot}`
          if (!provided.has(key)) {
            opts[key] = raw
            if (dot == 'body') reads[key] = { raw, as: arg }
          }
          provided.add(key)
          present.add(key)
          continue
        }
        // A retired flag is retired at BOTH spellings: the habit that
        // outlives the mechanism reaches for whichever one it learned.
        let gone = manual.retired?.[`--${dot}`]
        if (gone) throw usageError(name, manual, gone)
        throw usageError(
          name,
          manual,
          `does not take .${dot}=: its bare words are TEXT, and an ` +
            `argument it does not know would be swallowed by them` +
            takes(manual),
        )
      }
      words.push(arg)
      slots.push(arg)
      continue
    }
    let opt = manual.opts?.find((o) => match(o, arg))
    if (!opt) {
      if (manual.passthrough) {
        words.push(arg)
        slots.push(arg)
        continue
      }
      let gone = manual.retired?.[optionName(arg)]
      if (gone) throw usageError(name, manual, gone)
      throw usageError(name, manual, `does not take ${optionName(arg)}`)
    }
    present.add(opt.name)
    if (!opt.kind) {
      flags.add(opt.name)
      continue
    }
    let got = opt.name.startsWith('--')
      ? arg.slice(opt.name.length + 1)
      : arg.slice(opt.name.length)
    if (arg == opt.name) {
      let next = argv[i + 1]
      if (!opt.separate || !next || option(next)) {
        throw usageError(name, manual, `${opt.name} needs ${wanted(opt.kind)}`)
      }
      got = next
      i++
    }
    value(opt, got, arg == opt.name ? `${opt.name}=${got}` : arg)
  }
  let named: Record<string, string> = {}
  let many: Record<string, string[]> = {}
  let at = 0
  for (let arg of manual.args ?? []) {
    let values = arg.rest
      ? slots.slice(at)
      : slots[at] == null
      ? []
      : [slots[at]]
    if (values.length) {
      let raw = values.join(' ')
      if (!arg.rest && !accepts(arg.kind, raw)) {
        throw usageError(name, manual, `${arg.name} needs ${wanted(arg.kind)}`)
      }
      present.add(arg.name)
      named[arg.name] = raw
      many[arg.name] = values
    }
    at += arg.rest ? values.length : values.length ? 1 : 0
  }
  let issue = some(manual, present)
  if (issue) throw usageError(name, manual, issue)
  let [min, max] = wordsOf(manual)
  if (
    !manual.passthrough &&
    (slots.length < min || (max != null && slots.length > max))
  ) {
    let want = max == null
      ? `at least ${min}`
      : min == max
      ? `${min}`
      : `${min}–${max}`
    throw usageError(
      name,
      manual,
      `expected ${want} argument${want == '1' ? '' : 's'}, got ${slots.length}`,
    )
  }
  if (read) {
    for (let [key, value] of Object.entries(reads)) {
      opts[key] = String(
        inflate(
          { comp: 'doc', prop: 'body', value: value.raw },
          io,
          value.as,
        ).value,
      )
    }
    params = params.map((p, i) => inflate(p, io, paramAs[i]))
  }
  let body: string | undefined
  if (manual.body == 'body') {
    let value = params.find((p) => p.prop == 'body')?.value
    body = opts['--body'] ?? (value == null ? undefined : String(value))
  } else if (manual.body == 'text') {
    body = opts['--body']
    let text = many.text ?? []
    if (body == null && text.length) {
      if (read) separated(text)
      let raw = text.join(' ')
      body = read && text.length == 1 && /^\S+$/.test(raw)
        ? String(
          inflate({ comp: 'doc', prop: 'body', value: raw }, io, raw).value,
        )
        : raw
    }
  }
  return { args: named, many, opts, flags, params, words, body }
}

export let parse = (
  name: string,
  manual: Manual,
  argv: string[],
  io = stdin,
) => parsed(name, manual, argv, io, true)

export let validate = (
  name: string,
  manual: Manual,
  argv: string[],
) => {
  parsed(name, manual, argv, stdin, false)
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
