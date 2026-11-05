// The graph this page runs in the visitor's tab: the packages `yak init` lists
// that a page has a use for, composed from their facets over memory, and the
// `yak` command line typed into it.
import { type Bundle, graph, mint, type Plugin } from '@yaks/graph'
import { loadTools, tier } from '@yaks/graph/tools'
import { type Phase, PHASES } from '@yaks/graph/plugin'
import { ram } from '@yaks/ram'
import { loadVocab, type Vocab } from '@yaks/vocab'
import { answerOf, faulted, runner, toolEid } from '@yaks/tools'
import {
  argsFor,
  commandFor,
  tokensIn,
  toolHelp,
  toolLines,
  Usage,
} from '@yaks/cli/grammar'
import { registry, show } from '@yaks/cli/answer'
import { nameKeywords } from '@yaks/names'
import * as kernelVocab from '@yaks/kernel/vocab'
import * as kernelGraph from '@yaks/kernel/graph'
import * as kernelTools from '@yaks/kernel/tools'
import * as kernelViews from '@yaks/kernel/views'
import * as idVocab from '@yaks/id/vocab'
import * as idGraph from '@yaks/id/graph'
import * as edgeVocab from '@yaks/edge/vocab'
import * as edgeGraph from '@yaks/edge/graph'
import * as docVocab from '@yaks/doc/vocab'
import * as docGraph from '@yaks/doc/graph'
import * as docViews from '@yaks/doc/views'
import * as toolsVocab from '@yaks/tools/vocab'
import * as toolsViews from '@yaks/tools/views'
import * as taskVocab from '@yaks/task/vocab'
import * as taskGraph from '@yaks/task/graph'
import * as taskTools from '@yaks/task/tools'
import * as taskViews from '@yaks/task/views'
import * as personaVocab from '@yaks/persona/vocab'
import * as provenanceVocab from '@yaks/provenance/vocab'
import * as canvasVocab from '@yaks/canvas/vocab'
import * as canvasGraph from '@yaks/canvas/graph'
import * as fileVocab from '@yaks/file/vocab'

type Facets = {
  name: string
  vocab: { docs?: unknown[]; keywords?: unknown[] }
  graph?: { plugins?: (host: { vocab: Vocab }) => Plugin[] }
  tools?: { runs?: () => Record<string, unknown> }
  views?: unknown
}

/** Each package the page's graph is made of, with the facets it uses. */
export let PACKAGES: Facets[] = [
  {
    name: '@yaks/kernel',
    vocab: kernelVocab,
    graph: kernelGraph,
    tools: kernelTools,
    views: kernelViews,
  },
  { name: '@yaks/id', vocab: idVocab, graph: idGraph },
  { name: '@yaks/edge', vocab: edgeVocab, graph: edgeGraph },
  { name: '@yaks/doc', vocab: docVocab, graph: docGraph, views: docViews },
  { name: '@yaks/tools', vocab: toolsVocab, views: toolsViews },
  {
    name: '@yaks/task',
    vocab: taskVocab,
    graph: taskGraph,
    tools: taskTools,
    views: taskViews,
  },
  { name: '@yaks/persona', vocab: personaVocab },
  { name: '@yaks/provenance', vocab: provenanceVocab },
  { name: '@yaks/canvas', vocab: canvasVocab, graph: canvasGraph },
  { name: '@yaks/file', vocab: fileVocab },
] as Facets[]

// What `yak init` leaves unnumbered (@yaks/cli init.ts), so a page's first
// task is T-1.
let UNNUMBERED = ['call', 'edge', 'effect', 'execution', 'lease', 'output']
  .concat(['process', 'result', 'tool', 'file', 'pane', 'layout'])

/** The commands a tab can answer: no files to write, no process to watch. */
export let OFFERED = new Set([
  'graph_apply',
  'graph_query',
  'graph_show',
  'graph_schema',
  'comment_new',
  'task_new',
  'task_list',
  'task_update',
])

/** One line typed, and what it printed. */
export type Said = { code: number; out: string[] }

/** A change the graph committed: the bundles it wrote and the phases it ran. */
export type Change = { bundles: Bundle[]; phases: Phase[] }

export type Yak = Awaited<ReturnType<typeof yak>>

/** A graph in memory with the page's packages, a person typing into it, and
 * an agent beside them. */
export let yak = async () => {
  let docs = PACKAGES.flatMap((p) => p.vocab.docs ?? [])
  let keywords = [
    ...PACKAGES.flatMap((p) => p.vocab.keywords ?? []),
    nameKeywords,
  ]
  let vocab = loadVocab(docs as never, keywords as never)
  let you = mint()
  let agent = mint()
  let host = { vocab }
  // Every phase each write runs, and what it committed, told to whoever
  // listens: the page draws from these.
  let ran: Phase[] = []
  let listeners = new Set<(change: Change) => void>()
  let watch: Plugin = {
    name: 'yak.sh',
    hooks: Object.fromEntries(PHASES.map((phase) => [
      phase,
      (bundles: Bundle[]) => {
        ran.push(phase)
        if (phase == 'effect') {
          let change = { bundles, phases: ran }
          ran = []
          for (let l of listeners) l(change)
        }
        return bundles
      },
    ])),
  } as Plugin
  let storage = ram(vocab, { number: { except: UNNUMBERED } })
  let g = graph({
    storage,
    vocab,
    actor: { by: you },
    plugins: [
      ...PACKAGES.flatMap((p) => p.graph?.plugins?.(host) ?? []),
      watch,
    ],
  })
  await g.install()
  // The person typing is in the graph from the start; the agent joins it,
  // writing its own row, when it first calls a tool.
  await g.apply([{ entity: { eid: you }, person: {}, doc: { title: 'You' } }])
  let met: Promise<unknown> | undefined
  let meet = () =>
    met ??= Promise.resolve(g.apply([{
      entity: { eid: agent },
      persona: {},
      doc: { title: 'Your agent', body: 'Calls the same tools over MCP.' },
      $actor: { by: agent },
    }]))
  let tools = [
    ...tier({ keywords: vocab.keywords }),
    ...PACKAGES.flatMap((p) =>
      p.tools?.runs
        ? loadTools(p.vocab.docs as never, p.tools.runs() as never)
        : []
    ),
  ].filter((t) => OFFERED.has(t.name))
  let calls = runner(g, { tools })
  await calls.ensure()
  let views = await registry(
    PACKAGES.filter((p) => p.views).map((p) => p.name),
    (name) =>
      Promise.resolve(
        (PACKAGES.find((p) => p.name == name)?.views ?? null) as never,
      ),
  )
  let from = {
    lookup: (eids: string[]) => g.get(eids),
    query: (q: string) => g.read(q),
  }

  // What a view reads without waiting: each entity a commit touched, read
  // again once it has committed, and told to whoever watches it.
  let rows = new Map<string, Bundle>()
  let watchers = new Map<string, Set<() => void>>()
  let tell = (eid: string) => {
    for (let w of [...watchers.get(eid) ?? [], ...watchers.get('*') ?? []]) w()
  }
  let reading = Promise.resolve()
  listeners.add(({ bundles }) => {
    let eids = [...new Set(bundles.map((b) => b.entity.eid))]
    reading = reading.then(async () => {
      let read = await g.get(eids)
      let found = new Set(read.map((b) => b.entity.eid))
      for (let b of read) rows.set(b.entity.eid, b)
      for (let eid of eids) if (!found.has(eid)) rows.delete(eid)
      eids.forEach(tell)
    })
  })

  /** Run one tool as `by`, the way @yaks/cli's local.ts runs a command: a
   * call is written and run, or a read is run, and its answer kept. */
  let invoke = async (
    name: string,
    args: Record<string, unknown>,
    by = you,
  ) => {
    let tool = tools.find((t) => t.name == name)!
    let id = mint()
    let call = {
      entity: { eid: id },
      call: { to: toolEid(name), args },
      $actor: { by },
    }
    let landed = await (tool.readOnly ? calls.read(call) : calls.call(call))
    return { tool, id, landed, answer: answerOf(landed, id) }
  }

  /** A call's answer printed the way `yak` prints it. */
  let said = async (
    made: ReturnType<typeof invoke>,
    say: (text: string) => void,
    out: string[],
  ): Promise<Said> => {
    let { tool, landed, id, answer } = await made
    await show({ tui: false, out: say }, views, vocab, answer, {}, from, tool)
    return { code: faulted(landed, id) ? 1 : 0, out }
  }

  /** One line typed at the prompt, printed the way `yak` prints it. */
  let run = async (line: string): Promise<Said> => {
    let out: string[] = []
    let say = (text: string) => out.push(...String(text).split('\n'))
    try {
      let argv = tokensIn(line).map((w) => w.value)
      if (argv[0] == 'yak') argv.shift()
      if (!argv.length || argv[0] == 'help' && argv.length == 1) {
        say(`yak, running in this tab.\n\n${toolLines(tools)}`)
        return { code: 0, out }
      }
      let help = argv[0] == 'help' || argv.includes('--help')
      let words = argv.filter((w) => w != '--help' && w != 'help')
      let found = commandFor(tools, words)
      if (!found) throw new Usage(`yak: no command ${words.join(' ')}`)
      if (help) {
        say(toolHelp(found.verb))
        return { code: 0, out }
      }
      let args = await argsFor(found.verb, found.args)
      return await said(invoke(found.verb.name, args), say, out)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e))
      return { code: e instanceof Usage ? 2 : 1, out }
    }
  }

  return {
    graph: g,
    vocab,
    you,
    agent,
    tools,
    run,
    /** A call the agent makes over MCP: the same tool, its own name. */
    ask: async (name: string, args: Record<string, unknown>): Promise<Said> => {
      await meet()
      let out: string[] = []
      let say = (text: string) => out.push(...String(text).split('\n'))
      return await said(invoke(name, args, agent), say, out)
    },
    /** Hear every change the graph commits. */
    listen: (each: (change: Change) => void) => {
      listeners.add(each)
      return () => listeners.delete(each)
    },
    /** An entity as last committed, read without waiting. */
    row: (eid: string) => rows.get(eid),
    /** Every entity as last committed. */
    rows: () => [...rows.values()],
    /** Be told when an entity changes (`*`: any of them). */
    watch: (eid: string, notify: () => void) => {
      let set = watchers.get(eid) ?? new Set()
      watchers.set(eid, set.add(notify))
      return () => void set.delete(notify)
    },
    /** Settles once every commit so far is in `row`. */
    settled: () => reading,
  }
}
