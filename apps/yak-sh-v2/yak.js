// The yak command, running in this page. A graph (@yaks/graph) over memory
// (@yaks/ram) with the kernel, doc, edge, task, project, id, session and tool
// vocabularies; the tools the command line lists (the generic graph tier and
// @yaks/task's); the runner that records every call (@yaks/tools); and
// @yaks/cli's own `cli()` reading each line through each tool's input schema.
// Every package is the one published on JSR, loaded through esm.sh; nothing
// is bundled or copied.
//
// A line runs the way `yak --config yak.json …` runs on a machine (@yaks/cli
// local.ts): a `call` entity is written, the runner executes it, and the
// answer is printed through the packages' own views as the lines `yak … | cat`
// prints. Every example on every disk runs through `run`, so they all write to
// this one graph.
import { loadVocab } from '@yaks/vocab'
import { graph, offered } from '@yaks/graph'
import { loadTools, tier } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { matcher, rows } from '@yaks/match'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { views as docViews } from '@yaks/doc/views'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { compute, taskDoc, tasks } from '@yaks/task'
import { runs } from '@yaks/task/tools'
import { views as taskViews } from '@yaks/task/views'
import { projectDoc } from '@yaks/project'
import { human, idKeywords } from '@yaks/id'
import { idDoc } from '@yaks/id/vocab'
import { ids } from '@yaks/id/rules'
import { modelDoc } from '@yaks/model'
import { sessionDoc, sessions } from '@yaks/session'
import { views as sessionViews } from '@yaks/session/views'
import {
  answerOf,
  faulted,
  runner,
  structured,
  toolEid,
  toolsDoc,
} from '@yaks/tools'
import { views as toolViews } from '@yaks/tools/views'
import { cli, helpTool, registry, show } from '@yaks/cli'

export let vocab = loadVocab(
  [
    kernelDoc,
    docDoc,
    edgeDoc,
    taskDoc,
    projectDoc,
    idDoc,
    toolsDoc,
    modelDoc,
    sessionDoc,
  ],
  [kernelKeywords, edgeKeywords, idKeywords],
)

// TODO: @yaks/ram takes `computed` itself on main (56fe1250), which is how it
// answers `.task.status=open`; replace this with `ram(vocab, { number,
// computed: compute() })` once the release after 0.2.1 is on JSR. 0.2.1's ram
// refuses a query on a computed property, and `task list` asks for one.
let computing = (store) => {
  let opts = (o = {}) => ({ now: o.now, computed: compute() })
  let over = (all) => ({
    read: (q, o) => matcher(q, vocab, opts(o))(all()),
    rows: (q, o) => rows(q, vocab, opts(o))(all()),
  })
  return {
    ...store,
    ...over(() => store.read('*')),
    tx: (body) =>
      store.tx((tx) => body({ ...tx, read: over(() => tx.read('*')).read })),
  }
}

// Whoever wants to see each commit, and each refusal, as the graph's own
// `effect` and `audit` phases see them.
let watchers = new Set()
let tell = (said) => watchers.forEach((w) => w(said))

/** Be told of every commit (`{ applied }`) and refusal (`{ refused }`); the
 * answer stops the telling. */
export let watch = (fn) => (watchers.add(fn), () => watchers.delete(fn))

let seen = {
  name: 'yak.sh',
  hooks: {
    effect: (applied) => (tell({ applied }), applied),
    audit: (bundles, _tx, err) => (err && tell({ refused: err }), bundles),
  },
}

// Numbered the way a config's `"numbers": { "except": [...] }` numbers them:
// the tool rows, and the call and result each line writes, keep their eids, so
// the first task here is T-1.
export let storage = computing(
  ram(vocab, {
    number: { except: ['tool', 'call', 'result', 'error', 'exception'] },
  }),
)
export let g = graph({
  storage,
  vocab,
  plugins: [edges(vocab), tasks(), ids(vocab), sessions(), seen],
})
await g.install()

let tools = [...tier(), ...loadTools(taskDoc, runs())].filter(offered('cli'))
let calls = runner(g, { tools })
await calls.ensure()

let mine = {
  '@yaks/task': taskViews,
  '@yaks/doc': docViews,
  '@yaks/session': sessionViews,
  '@yaks/tools': toolViews,
}
let views = await registry(
  Object.keys(mine),
  (p) => Promise.resolve(mine[p] ? { views: mine[p] } : null),
)

let from = {
  lookup: (eids) => storage.tx((tx) => tx.get(eids)),
  query: (q) => g.read(q),
}

// One tool as a subcommand, the way @yaks/cli's local.ts makes one: the call
// is written, run, and its answer printed through the views, or as data under
// `--json`. A refusal is an answer too, and exit code 1. The answer is printed
// rather than painted: @yaks/tui's painter swaps `globalThis.document` for a
// document of its own (tui/dom.ts), and a browser window will not give its
// up.
let command = (declared) => ({
  ...declared,
  run: async (args, c) => {
    let landed = await calls.call([{
      entity: { eid: '$call' },
      call: { to: toolEid(declared.name), args: args ?? {} },
    }])
    let answer = answerOf(landed)
    if (c.json) c.out(JSON.stringify(structured(declared, answer), null, 2))
    else {
      await show(
        c,
        views,
        vocab,
        answer,
        {},
        from,
        !declared.readOnly,
      )
    }
    return faulted(landed) ? 1 : 0
  },
})

let about = 'yak, running in this page: a graph in memory with the task ' +
  'vocabulary, every package loaded from JSR.'

// The environment `cli` reads. It keeps a token and a tool list under
// YAKS_HOME, and this page keeps neither, so the directory is named rather
// than looked up on a disk there is none of.
let env = (name) => name == 'YAKS_HOME' ? '/nowhere' : undefined
let offline = () =>
  Promise.reject(new Error('this page runs its own graph; it calls no server'))
let reads = {
  file: (path) => {
    throw new Error(`there are no files here to read: ${path}`)
  },
  stdin: () => '',
}

let commands = [...tools.map(command), helpTool({ name: 'yak', about })]

/** Run one command line's words after `yak`. `out` gets what stdout would,
 * `note` what stderr would; the answer is the exit code. */
export let run = (argv, { out, note }) =>
  cli(
    commands,
    {
      argv,
      name: 'yak',
      about,
      host: 'yak.sh',
      env,
      ask: offline,
      reads,
      out,
      note,
    },
  )

/** Every live entity. */
export let everything = () => storage.read('*')

/** The id a person types for an entity: `T-7`, or its short eid. */
export let id = human(vocab)

/** The kind an entity prints as: the component that names what it is. */
export let kind = (b) => vocab.kindOf(b) ?? 'entity'

/** Where a task stands, by @yaks/task's own rule: open, done or cancelled. */
export let status = compute()['task.status']

/** The words the command line knows, for completion: every tool's two. */
export let spoken = tools.map((t) => [t.noun, t.verb].filter(Boolean).join(' '))
