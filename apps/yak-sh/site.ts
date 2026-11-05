// The site as entities: the page is a layout whose panes show its sections,
// each section is a doc, and each file the app serves is a file read in the
// site. The page draws itself from these, so changing one redraws it.
import type { Bundle } from '@yaks/graph'
import { fileOf } from '@yaks/file'

/** The site: its title, and the layout its page is. */
export let SITE = '2caade2e-aa23-4fc5-bba3-af9eff4f64a1'
let ROOT = '90e19de2-e19c-4490-81cf-561edd349718'

/** Every file the app serves, as `file{path, root}` read in the site. */
export let FILES = [
  'index.html',
  'style.css',
  'main.ts',
  'page.ts',
  'views.ts',
  'figure.ts',
  'yak.ts',
  'site.ts',
  'package.json',
  'icon.png',
  'yak.webp',
  'yak-880.webp',
  'og.jpg',
  'paper.webp',
  'term.ts',
  'parts.ts',
  'bands.ts',
  'told.ts',
  'editor.ts',
  'doors.ts',
  'windows.ts',
  'turns.ts',
  'prose.ts',
  'shop.ts',
  'outbox.ts',
]

/** A section: the view that draws it and what it says. A step's `sh` block
 * is what it types into the prompt, its `mcp` block what an agent calls, and
 * a `web` block what a page in the browser calls. */
type Section = {
  eid: string
  pane: string
  view: string
  title: string
  body: string
}

let sh = (...lines: string[]) => '```sh\n' + lines.join('\n') + '\n```'
let mcp = (...lines: string[]) => '```mcp\n' + lines.join('\n') + '\n```'
let web = (...lines: string[]) => '```web\n' + lines.join('\n') + '\n```'
/** The rules and effects a beat shows, by name. */
let declared = (...names: string[]) =>
  '```declared\n' + names.join('\n') + '\n```'
/** A beat that writes nothing: its window is the outbox, showing what was
 * tried with the letter of this subject. */
let outbox = (subject: string) => '```outbox\n' + subject + '\n```'
/** A beat that starts a session wearing a persona, by its short id: its
 * window is what the session is given. */
let session = (persona: string) => '```session\n' + persona + '\n```'

export let INSTALL = 'deno run -A jsr:@yaks/cli/install'

/** A part's body: what its heading says beside it, a rule, then what it
 * holds. A `###` heading in what it holds starts a numbered item. */
let part = (head: string, ...held: string[]) =>
  [head, '---', ...held].join('\n\n')
/** A file's code, with its name. */
let code = (name: string, ...lines: string[]) =>
  '```ts ' + name + '\n' + lines.join('\n') + '\n```'
/** A group of packages as a table: each name linked to its source. */
let packages = (group: string, rows: [string, string][]) =>
  [
    `| ${group} | |`,
    '| --- | --- |',
    ...rows.map(([name, what]) =>
      `| [${name}](https://github.com/yak-sh/yak/tree/main/packages/${name}) | ${what} |`
    ),
  ].join('\n')

export let HERO = '6f166202-b881-400d-84c7-dd8620dc7826'
export let SELF = '525ab3f6-bdc3-48a6-b2f3-e88fa2d06a1b'
let YAKS_APP = 'a3c9e1f4-7b2d-4e68-9f05-1d8b6c4a2e93'

export let SECTIONS: Section[] = [
  {
    eid: HERO,
    pane: '68496d50-1f05-4653-a937-2bd2f96455c9',
    view: 'Hero',
    title: 'A shared graph for your data, tools, and agents.',
    body:
      '`yak` is a command line, and `@yaks` a set of open-source TypeScript packages, for one graph that you and your agents both read and write.',
  },
  {
    eid: '35cd004b-ca47-4090-9d3c-285a1f8de275',
    pane: 'eea2335c-b3d2-40ae-8ab4-a166ec45f33b',
    view: 'Step',
    title: 'A task is an entity',
    body: [
      "Say you're starting a business, and agents build the product. An entity is an id and the components it carries. `task new` writes one with `doc{title}` and `task{}`, and the graph gives it a number.",
      sh(
        '# A task for an agent: the sign-up page',
        "yak task new 'Add the sign-up page'",
      ),
    ].join('\n\n'),
  },
  {
    eid: '599e735a-c838-49d8-9299-bbc8d005d047',
    pane: '329d0f98-94c8-455e-bb62-08fe643e1e27',
    view: 'Step',
    title: 'A link is an entity too',
    body: [
      'Some work only a person can do, such as signing up with a payment processor, so that task is assigned to you. An edge ties one entity to another: this one says the checkout requires it.',
      sh(
        '# A task only you can do, assigned to you',
        "yak task new 'Sign up for payments' --assignee U-1",
        '# The checkout, for an agent to build',
        "yak task new 'Build the checkout'",
        '# An edge: the checkout requires the payments sign-up',
        `yak graph apply --bundles '[{"edge": {"from": "T-4", "to": "T-3"}, "requires": {}}]'`,
      ),
    ].join('\n\n'),
  },
  {
    eid: 'b0bc4ecf-d1a1-4beb-87a4-b13205a7a679',
    pane: 'd82ec80a-577a-401c-8787-934b8edf4196',
    view: 'Step',
    title: 'Your agent calls the same tools',
    body: [
      'Every `yak` command is also an MCP tool, served at `/mcp` by `yak serve`. An agent finishes the sign-up page and says so, and its writes carry its own id.',
      mcp(
        '# The agent says what it did, on the task',
        'comment_new {"target": "T-2", "body": "The sign-up page is up at /signup, with tests."}',
        '# Then marks the task done',
        'task_update {"task": "T-2", "status": "done"}',
      ),
    ].join('\n\n'),
  },
  {
    eid: '52fba5d7-8abb-41cd-a743-ca88cca351ee',
    pane: '7001b339-96f5-4ad8-9e73-928e3163ab06',
    view: 'Step',
    title: 'One query finds them',
    body: [
      "What's left is the payments sign-up only you can do, and the checkout that waits on it. The same query grammar reads the graph in the terminal, over MCP and in the browser.",
      sh(
        '# Every open task, with its doc',
        "yak graph query '.task.status=open ?doc'",
      ),
    ].join('\n\n'),
  },
  {
    eid: SELF,
    pane: 'f8eb267e-b1df-4754-b6b8-7d7f25ddcd25',
    view: 'Step',
    title: 'This page is a graph',
    body: [
      'Its sections, its files and each command you type are entities in the graph running in this tab, and the page draws itself from them. Change this section and it redraws. Reloading starts over.',
      sh(
        "# The page's own files, which are entities too",
        "yak graph query '.file ?file'",
        '# Retitle this section, and the page redraws it',
        `yak graph apply ${SELF} '.doc.title="This page is a graph you can change"'`,
      ),
    ].join('\n\n'),
  },
  {
    eid: '69f51fa0-442e-4bcc-b440-9665c93fec06',
    pane: 'd57ac900-730b-417c-8798-5cafc5c891d5',
    view: 'Stack',
    title: 'A write is a list of bundles, applied in one transaction',
    body: [
      "A bundle is one entity's components, and a write is a list of them. Here your agent writes you a letter: one bundle, its `doc` the words, `mail` the task it is about and `deliver` who it goes to.",
      '`apply()` takes the list through the phases below, and the rules and checks of every package the graph loads run inside them. As you scroll past each, it does its work on the letter: the short ids become eids, the alias is given one, a rule fills in the sender, and after the commit an effect hands the letter to a mail service. The phases in the box are one transaction: the batch is stored whole at commit, or not at all.',
      mcp(
        '# One bundle: a letter to you about T-3',
        'graph_apply {"bundles": [{"entity": {"eid": "$letter"}, "doc": {"title": "Can you sign up for payments?", "body": "The checkout can\'t be built until T-3 is done."}, "mail": {"target": "T-3"}, "deliver": {"to": "U-1"}}]}',
      ),
    ].join('\n\n'),
  },
  {
    eid: 'daf368d7-bfd4-4fe4-ae77-3545d58f4cd7',
    pane: 'e3705147-f576-424a-8ef2-6e0718ee0875',
    view: 'Doors',
    title: 'Every interface reaches the same graph',
    body: [
      'The terminal, your agents over MCP and a page in the browser call the same tools on one graph. Scroll, and each makes its own change to the graph drawn above. `--host` points the same commands at another machine, or at yaks.app once you run `yak auth yaks.app`.',
      '### In the browser',
      'You opened the payment account today, and tick it off on the web canvas `yak serve` draws at `/`.',
      web('task_update {"task": "T-3", "status": "done"}'),
      '### Over MCP',
      'The checkout no longer waits on anything, so your agent finishes it.',
      mcp('task_update {"task": "T-4", "status": "done"}'),
      '### In a terminal',
      'The tests fail on main, so you file the fix and give it to your agent.',
      sh("yak task new 'Fix the failing build' --assignee N-5"),
    ].join('\n\n'),
  },
  {
    eid: '196d0ca4-ea4c-4126-861c-d7a93d646aed',
    pane: '30236dd0-a5d0-4615-9fbf-c0e24b224a5f',
    view: 'Rules',
    title: 'Rules change a write as it is made, and effects do what it leaves',
    body: [
      "You don't write code that watches the graph. A **rule** is a query a vocabulary declares, and the graph runs it inside every write, whichever door the write came through: what it matches, it changes before the write is stored, so nothing ever reads the graph without it. An **effect** is work a write leaves behind. The commit records it in the same transaction, so it can't be lost, and after the commit it runs on its own, tried again until it succeeds.",
      '### A rule turns a question into a letter',
      "Fixing the build, your agent needs an answer only you can give, and asks. The shop's rule matches a question for someone with an address, and writes them a letter in the same write; `letter_from` then gives the letter its sender.",
      declared('question_mail', 'letter_from'),
      mcp(
        'decision_new {"question": "Which payments key should the build use?", "choices": [{"label": "The test key", "description": "The build never charges a card."}, {"label": "The live key", "description": "The build checks the live account."}], "recommended": "The test key", "assignee": "U-1"}',
      ),
      '### An effect sends it',
      '`@yaks/mail` declares an effect for every letter written: hand it to the mail service, and record what happened. The commit owed it, and it runs after. The outbox turns the letter away once, so the effect waits and tries again.',
      declared('mail_post'),
      outbox('Which payments key should the build use?'),
      '### A rule closes the question',
      "You pick an answer in the browser. `@yaks/task`'s rule finishes a question once it is answered, in the same write.",
      declared('decision_answered'),
      web('decision_answer {"decision": "T-8", "choice": "The test key"}'),
    ].join('\n\n'),
  },
  {
    eid: '6b8ad916-987c-4ae0-933b-f9b32ba39a9d',
    pane: 'ce5827a4-c426-45f3-a720-d81c61ace6d0',
    view: 'Memory',
    title: 'What one agent learns, every agent after it knows',
    body: [
      "An agent's context is gone when its session ends, so what it learns is kept in the graph. A **memory** marks words a person said, verbatim, where they said them. A **persona** is the instructions an agent wears: it contains documents and memories by edges, and every session that wears it starts with all of them, after the personas it is built on. A **topic** holds what is known about one subject the same way, and an agent opened on a topic, the oracle, answers from it.",
      '### You say it once',
      'Answering the question, you say why.',
      web(
        'comment_new {"target": "T-8", "body": "Never put the live key in CI: it charges real cards."}',
      ),
      '### Your agent keeps your words',
      'It marks your comment as a memory, with a line of context. The words stay yours, where you wrote them, and `memory_recall` finds them again.',
      mcp(
        'memory_save {"on": "C-9", "context": "Which payments key the build uses"}',
      ),
      '### Its persona carries them',
      'It files the memory in the persona it wears.',
      mcp(
        'graph_apply {"bundles": [{"edge": {"from": "N-5", "to": "C-9"}, "contains": {}}]}',
      ),
      '### The next agent starts with them',
      'A new session wearing the persona is given its text and everything it contains, so the next agent knows to keep the live key out of CI without being told.',
      session('N-5'),
    ].join('\n\n'),
  },
  {
    eid: '8d0c64a5-4f1e-4b8e-9a51-0c3e2f6a7b19',
    pane: 'c2f4e0a1-3b6d-4f7e-8a90-5d1c2b3e4f60',
    view: 'Part',
    title: 'yak is a command line for the tools your graph declares',
    body: part(
      'A config names a SQLite file and a list of plugins. Each plugin is an `@yaks` package, and every tool it declares is a `yak` command and an MCP tool.',
      [
        "- **Every tool is a command.** Its arguments and help come from the tool's input schema, so a new tool needs no new release of yak.",
        '- **No server needed.** A command opens the graph in its own process, runs one tool and exits.',
        '- **Every call is recorded.** A call from you and a call from an agent go through the same checks, rules and effects, and each is kept in the graph.',
        '- **`yak serve` answers HTTP.** A web canvas at `/`, the tools for agents at `/mcp`, and `/query` and `/apply` for programs, on this machine only.',
        '- **Your agents join it.** `yak hooks install` makes each Claude Code session an entity in the graph, told its claims when it starts. Any MCP client can call the tools at `/mcp`.',
        '- **Other graphs too.** `--config` opens the graph another config names, and `--host` calls the graph on another machine.',
      ].join('\n'),
    ),
  },
  {
    eid: YAKS_APP,
    pane: '0b6f3e2a-8d41-4c57-9a1e-6c2d7f9b3a84',
    view: 'Part',
    title: 'yaks.app hosts web apps on the same packages',
    body: part(
      'yaks.app builds, hosts and shares web apps. You ask Claude or ChatGPT for an app, and yaks.app keeps it online at its own address, with its data in a graph made of these packages.',
      [
        "- **One toolkit in two places.** On your machine, `yak` keeps a graph in a SQLite file. On yaks.app, the same `@yaks/graph` keeps each app's data in a Cloudflare Durable Object.",
        '- **Your assistant builds the app.** Add yaks.app to Claude or ChatGPT and ask for what you need. It writes the app, and yaks.app serves it at an address like `yourname.yaks.app/recipes`.',
        '- **The same `yak` reaches it.** `yak auth yaks.app` signs you in. Then `yak app_list` lists your apps and `yak app_errors --app recipes` shows what broke in one, from the command line that runs your own graph.',
        "- **An app's commands run in your terminal.** A yaks app can declare commands of its own, and `yak <app> <command>` runs them as you.",
        "- **Your graph passes on what it doesn't have.** A command your own graph doesn't declare goes to yaks.app, so `yak app_list` works on a machine that keeps a graph of its own.",
      ].join('\n'),
    ),
  },
  {
    eid: 'd15f7ff7-ada4-4202-9874-f523e797d35a',
    pane: '156e61d0-9281-41ac-a1b3-19aa77f1c2be',
    view: 'Part',
    title: 'Install yak, then start your graph',
    body: part(
      'The installer runs on [Deno](https://deno.com) and puts `yak` on your PATH, at one release with every package it loads.',
      '### Install yak',
      sh(INSTALL),
      '### Start your graph',
      sh('yak init'),
      "It writes `~/.yak/yak.json`, with the graph's SQLite file beside it, and never replaces a config that is already there.",
      '### Add a task, and list them',
      sh("yak task new 'Add the sign-up page'", 'yak task list'),
      '### Open it in a browser',
      sh('yak serve'),
      'Serves the web canvas, `/mcp` for agents and `/query` for programs at `http://127.0.0.1:8787`, on this machine only.',
      '### Bring your agents',
      sh('yak hooks install'),
      "Each Claude Code session becomes a session entity in the graph. Any MCP client can call the graph's tools at `http://127.0.0.1:8787/mcp`.",
      '### Reach yaks.app',
      sh('yak auth yaks.app'),
      'Signs you in, so the same `yak` calls your yaks.app account.',
    ),
  },
  {
    eid: '3e7b9c21-6a4d-4c85-b0f2-9d18e5a4c3b7',
    pane: '7a2d5e8f-1c4b-4e93-a6d0-2f8b9c7e1d45',
    view: 'Part',
    title: 'Use the packages on their own',
    body: part(
      'yak is built from TypeScript packages on [JSR](https://jsr.io/@yaks). Many build on others, and each README says what it exports, how to set it up and where it stops.',
      packages('The graph', [
        [
          'graph',
          'Entities, components and `apply()`, which checks a batch and commits it through a storage adapter.',
        ],
        [
          'vocab',
          'Components and their properties, declared as JSON Schema and read at runtime.',
        ],
        [
          'query',
          'Query strings such as `.task.status=open`, parsed into a syntax tree.',
        ],
        ['id', 'Entity ids, and the short numbers people type, such as T-2.'],
        [
          'edge',
          'Links between entities, stored as entities, and walks across them.',
        ],
        [
          'doc',
          '`doc{title, body}`, the text a task, a letter and a recipe share.',
        ],
      ]),
      packages('Storage', [
        [
          'sqlite',
          'Storage in SQLite, with the database driver supplied by the caller.',
        ],
        [
          'ram',
          'Storage in memory, for browsers and tests. The graph in this tab uses it.',
        ],
        ['d1', 'Storage in Cloudflare D1, each transaction sent as one batch.'],
        ['durable-object', "Storage in a Cloudflare Durable Object's SQLite."],
        [
          'journal',
          'Every committed transaction, for history, undo and a change feed.',
        ],
        ['fts', 'Full-text search with SQLite FTS5.'],
      ]),
      packages('Ways in', [
        ['cli', "The `yak` command, whose subcommands are a graph's tools."],
        [
          'api',
          'HTTP: `/apply`, `/query`, and `/ws` subscriptions that push changed results.',
        ],
        ['mcp', "The graph's tools for agents, at `/mcp` or over stdio."],
        [
          'client',
          'A graph in the browser, connected to its server, with queries that update.',
        ],
        [
          'sync',
          'Send local changes to a server, and reconcile or revert optimistic writes.',
        ],
        ['workerd', 'The same HTTP handler as a Cloudflare Worker.'],
      ]),
      packages('Agents and work', [
        ['task', 'Tasks, with a status computed from their marks.'],
        [
          'session',
          'Agent transcripts as entities, and claims on what a session works on.',
        ],
        [
          'tools',
          'One registry of tools; each call and its result are stored in the graph.',
        ],
        ['effects', 'Code that runs after a commit, with retries and backoff.'],
        [
          'harness',
          'A local agent: model calls, shell and graph tools, and a terminal interface.',
        ],
      ]),
      '### The same graph in your own code',
      'This example keeps a document in memory and reads it back with a query. `@yaks/sqlite` keeps the same data in a file.',
      sh(
        'deno add jsr:@yaks/doc jsr:@yaks/graph jsr:@yaks/ram jsr:@yaks/vocab',
      ),
      code(
        'main.ts',
        "import { docDoc } from '@yaks/doc'",
        "import { graph } from '@yaks/graph'",
        "import { ram } from '@yaks/ram'",
        "import { loadVocab } from '@yaks/vocab'",
        '',
        'let vocab = loadVocab([docDoc])',
        'let g = graph({ storage: ram(vocab), vocab })',
        'await g.apply([{',
        '  entity: { eid: crypto.randomUUID() },',
        "  doc: { title: 'Getting started', body: 'A document stored as components.' },",
        '}])',
        `console.log(await g.read('.doc.title="Getting started"'))`,
      ),
      'Run it with `deno run main.ts`. In a Node project, add the packages with `npx jsr add`.',
    ),
  },
  {
    eid: 'f4a8c2d6-9b3e-4d71-8c05-6e2a1b9f7d38',
    pane: 'b9e1d3c7-5a2f-4b86-9e04-8c6d2a1f3e57',
    view: 'Block',
    title: 'yak.sh',
    body: [
      'The yak command line and the @yaks packages.',
      '- runs on: [Deno](https://deno.com)',
      '- stored in: `~/.yak/yak.db`',
      '- license: Apache-2.0',
      '- source: [github.com/yak-sh/yak](https://github.com/yak-sh/yak)',
      '- packages: [jsr.io/@yaks](https://jsr.io/@yaks)',
    ].join('\n'),
  },
]

/** Where each part of the page is linked from: `#install` and the rest. */
/** The painted yak's files, for an img's srcset: small for a phone's nav, large
 * for the home page's nav and the footer's 30vw on a 2x screen. */
export let LOGO = 'yak.webp 320w, yak-880.webp 880w'

export let ANCHORS: Record<string, string> = {
  '8d0c64a5-4f1e-4b8e-9a51-0c3e2f6a7b19': 'yak',
  [YAKS_APP]: 'yaks-app',
  'd15f7ff7-ada4-4202-9874-f523e797d35a': 'install',
  '3e7b9c21-6a4d-4c85-b0f2-9d18e5a4c3b7': 'packages',
}

/** The page's own rows: the site, its layout, a pane per section in order,
 * and the sections. None takes a number, so the visitor's first task is T-1. */
export let seed = (): Bundle[] =>
  rows().map((b) => ({ ...b, entity: { ...b.entity, num: null } }))

let rows = (): Bundle[] => [
  {
    entity: { eid: SITE },
    doc: { title: 'yak.sh', body: SECTIONS[0].title },
    layout: { root: ROOT },
  },
  { entity: { eid: ROOT }, pane: { layout: SITE, dir: 'v' } },
  ...SECTIONS.flatMap((s, order) => [
    { entity: { eid: s.eid }, doc: { title: s.title, body: s.body } },
    {
      entity: { eid: s.pane },
      pane: { layout: SITE, parent: ROOT, order, content: s.eid, view: s.view },
    },
  ]),
]

// An image is not text, so it has no contents to keep, and reading it would
// only fetch its bytes on every visit.
let image = (path: string) => /\.(png|jpg|webp)$/.test(path)

/** The files, read with `fetch` from where the page is served: text keeps
 * its contents as `content{body}`, and an image is listed unread. */
export let files = async (
  fetch: (path: string) => Promise<Response>,
): Promise<Bundle[]> =>
  await Promise.all(FILES.map(async (path) => {
    let file = {
      entity: { eid: fileOf(SITE, path) },
      file: { path, root: SITE },
    }
    if (image(path)) return file
    let res = await fetch(path).catch(() => null)
    if (!res?.ok) return file
    return { ...file, content: { body: await res.text() } }
  }))

/** A call as a block writes it: the tool's name, then its arguments as JSON. */
export let called = (line: string) => {
  let at = line.indexOf(' ')
  return { tool: line.slice(0, at), args: JSON.parse(line.slice(at + 1)) }
}

/** One command a section runs: typed at the prompt (`sh`) or called by the
 * agent (`mcp`), and the `# ` comment above it saying what it does. */
export type Command = { kind: 'sh' | 'mcp'; line: string; note?: string }

/** A command as the page prints it: the line typed, or the tool the agent
 * calls and its arguments. */
export let shown = (c: Command) => {
  if (c.kind == 'sh') return c.line
  let { tool, args } = called(c.line)
  return `${tool} ${JSON.stringify(args)}`
}

/** The commands a section's body runs, in order, each with its comment. */
export let scriptOf = (body: string): Command[] =>
  [...body.matchAll(/```(sh|mcp)\n([\s\S]*?)\n```/g)].flatMap((m) => {
    let kind = m[1] as Command['kind']
    let note: string | undefined
    return m[2].split('\n').flatMap((line): Command[] => {
      if (!line.trim()) return []
      if (line.startsWith('# ')) return (note = line.slice(2), [])
      let said = { kind, line, ...note ? { note } : {} }
      note = undefined
      return [said]
    })
  })

/** One turn of a band: its heading, what it says, the rules and effects it
 * shows by name, and the one line it runs: typed in a terminal (`sh`),
 * called by the agent over MCP (`mcp`) or by a page in the browser (`web`).
 * An `outbox` beat runs nothing; its line is the subject of the letter whose
 * tries it shows. A `session` beat starts a session wearing the persona its
 * line names. */
export type Beat = {
  title: string
  prose: string
  kind: string
  line: string
  shows: string[]
}

// The blocks a section's body holds that the page acts on, not prints.
const BLOCK = /```(sh|mcp|web|outbox|session|declared)\n([\s\S]*?)\n```/g

/** A band's body: what it says first, then each `###` beat. */
export let beatsOf = (body: string) => {
  let [head, ...rest] = body.split(/^### /m)
  let beats = rest.map((chunk): Beat => {
    let blocks = [...chunk.matchAll(BLOCK)]
    let run = blocks.find((m) => m[1] != 'declared')
    let [title, ...words] = chunk.replace(BLOCK, '').split('\n')
    return {
      title: title.trim(),
      prose: words.join('\n').trim(),
      kind: run?.[1] ?? 'sh',
      line: run?.[2] ?? '',
      shows: blocks.filter((m) => m[1] == 'declared')
        .flatMap((m) => m[2].split('\n')),
    }
  })
  return { head: head.trim(), beats }
}

/** A section's prose: its body without the blocks the page acts on. */
export let proseOf = (body: string) => body.replace(BLOCK, '').trim()
