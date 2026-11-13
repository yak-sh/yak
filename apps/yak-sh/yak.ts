// The graph this page runs in the visitor's tab: the packages `yak init` lists
// that a page has a use for, composed from their facets over memory by
// @yaks/host's assembly as `yak` and yaks.app compose theirs, and the `yak`
// command line typed into it.
import { type Bundle, type Comp, graph, mint, type Plugin } from '@yaks/graph'
import { type Phase, PHASES } from '@yaks/graph/plugin'
import { assembly } from '@yaks/host/assembly'
import type { Config, Load } from '@yaks/host'
import { memoryBlobs } from '@yaks/blob/store'
import { ramVault } from '@yaks/secrets/vault'
import { ram } from '@yaks/ram'
import type { VocabDoc } from '@yaks/vocab'
import { ailing, answerOf, faulted, toolEid } from '@yaks/tools'
import {
  argsFor,
  commandFor,
  tokensIn,
  toolHelp,
  toolLines,
  Usage,
} from '@yaks/cli/grammar'
import { registry } from '@yaks/cli/answer'
import { show } from '@yaks/cli/terminal'
import { human, prefixes } from '@yaks/id'
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
import { voice, wear } from '@yaks/persona'
import * as memoryVocab from '@yaks/memory/vocab'
import * as memoryTools from '@yaks/memory/tools'
import * as provenanceVocab from '@yaks/provenance/vocab'
import * as canvasVocab from '@yaks/canvas/vocab'
import * as canvasGraph from '@yaks/canvas/graph'
import * as fileVocab from '@yaks/file/vocab'
import * as projectVocab from '@yaks/project/vocab'
import * as effectsVocab from '@yaks/effects/vocab'
import * as mailVocab from '@yaks/mail/vocab'
import * as mailGraph from '@yaks/mail/graph'
import * as mailEffects from '@yaks/mail/effects'
import { arrived } from '@yaks/mail'
import * as inboxVocab from '@yaks/inbox/vocab'
import { queueing } from '@yaks/inbox/letters'
import * as inboxMail from '@yaks/inbox/mail'
import { effects, generation } from '@yaks/effects'
import * as draftVocab from '@yaks/draft/vocab'
import * as draftGraph from '@yaks/draft/graph'
import { desk, type Stash } from '@yaks/draft'
import { outbox } from './outbox.ts'
import { SHOP, shopDoc, YOURS } from './shop.ts'
import * as signin from './signin.ts'

/** Each package the page's graph is made of, and the facets it imports: what
 * a config lists and a host's `load` answers, here imported up front so the
 * page is one bundle. */
export let PACKAGES: Record<string, Record<string, unknown>> = {
  '@yaks/kernel': {
    vocab: kernelVocab,
    graph: kernelGraph,
    tools: kernelTools,
    views: kernelViews,
  },
  '@yaks/id': { vocab: idVocab, graph: idGraph },
  '@yaks/edge': { vocab: edgeVocab, graph: edgeGraph },
  '@yaks/doc': { vocab: docVocab, graph: docGraph, views: docViews },
  '@yaks/tools': { vocab: toolsVocab, views: toolsViews },
  '@yaks/task': {
    vocab: taskVocab,
    graph: taskGraph,
    tools: taskTools,
    views: taskViews,
  },
  '@yaks/persona': { vocab: personaVocab },
  '@yaks/memory': { vocab: memoryVocab, tools: memoryTools },
  '@yaks/provenance': { vocab: provenanceVocab },
  '@yaks/canvas': { vocab: canvasVocab, graph: canvasGraph },
  '@yaks/file': { vocab: fileVocab },
  '@yaks/project': { vocab: projectVocab },
  '@yaks/effects': { vocab: effectsVocab },
  '@yaks/mail': { vocab: mailVocab, graph: mailGraph, effects: mailEffects },
  '@yaks/inbox': { vocab: inboxVocab },
  '@yaks/draft': { vocab: draftVocab, graph: draftGraph },
  signin: { vocab: signin.vocab, effects: signin.effects },
}

let load =
  ((plugin: string, facet: string) =>
    Promise.resolve(PACKAGES[plugin]?.[facet] ?? null)) as Load

// The mail effect hands a letter to the page's outbox, never to a mail
// service: the outbox is the sender this host lends.
let CONFIG: Config = {
  plugins: Object.keys(PACKAGES).map((use) =>
    use == '@yaks/mail' ? { use, with: { sender: { via: 'outbox' } } } : use
  ),
}

// What `yak init` leaves unnumbered (@yaks/cli init.ts), so a page's first
// task is T-1.
let UNNUMBERED = ['call', 'edge', 'effect', 'execution', 'lease', 'mail']
  .concat(['output', 'process', 'result', 'tool', 'file', 'pane', 'layout'])
  .concat(['draft', 'signin_request'])

// The graph in a tab starts over on a reload; what the person typed does not
// (M-59093). Their drafts are kept in the stash under the person they typed
// them as, and written back as the graph starts.
const TYPED = 'yak.sh:typed'
type Typed = { you?: string; drafts?: Bundle[] }
let typedIn = (stash?: Stash): Typed => {
  try {
    return JSON.parse(stash?.getItem(TYPED) ?? '{}')
  } catch {
    return {}
  }
}

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
  'decision_new',
  'decision_answer',
  'memory_save',
  'memory_recall',
])

/** One line typed, and what it printed. */
export type Said = { code: number; out: string[] }

/** A change the graph committed: the bundles it wrote, the phases it ran and
 * the batch as each phase left it, and whether an effect wrote it (its
 * generation, 0 for a write anybody asked for). */
export type Change = {
  bundles: Bundle[]
  phases: Phase[]
  steps: [Phase, Bundle[]][]
  generation: number
}

export type Yak = Awaited<ReturnType<typeof yak>>

/** A graph in memory with the page's packages, a person typing into it, and
 * an agent beside them. A failed effect is tried again `retry` ms later;
 * `fetch` is how the one effect that leaves the tab reaches yaks.app
 * (signin.ts), and `stash` keeps what the person types across a reload. */
export let yak = async (
  { retry = 1500, fetch, stash }: {
    retry?: number
    fetch?: typeof globalThis.fetch
    stash?: Stash
  } = {},
) => {
  let typed = typedIn(stash)
  let you = typed.you ?? mint()
  let agent = mint()
  // Every phase each write runs, the batch as it left each one, and what it
  // committed, told to whoever listens: the page draws from these.
  let ran: Phase[] = []
  // The entities committed since the inbox last passed.
  let moved = new Set<string>()
  let steps: [Phase, Bundle[]][] = []
  let listeners = new Set<(change: Change) => void>()
  let watch: Plugin = {
    name: 'yak.sh',
    hooks: Object.fromEntries(PHASES.map((phase) => [
      phase,
      (bundles: Bundle[]) => {
        ran.push(phase)
        steps.push([phase, structuredClone(bundles)])
        if (phase == 'effect') {
          let change = {
            bundles,
            phases: ran,
            steps,
            // The marker an effect's own write carries is gone by the effect
            // phase; the batch as it arrived still has it.
            generation: generation(steps[0]?.[1] ?? bundles),
          }
          ran = []
          steps = []
          for (let l of listeners) l(change)
          for (let b of bundles) moved.add(b.entity.eid)
          void work()
        }
        return bundles
      },
    ])),
  } as Plugin
  let box = outbox(retry)
  let blobs = memoryBlobs()
  let plan = await assembly(CONFIG, ['graph', 'effects'], load, {
    docs: [shopDoc as VocabDoc],
  })
  // The effects the graph's packages declare, run in this tab as a store
  // runs them: each commit records the runs it owes, and the pool works them
  // after it, trying a failed one again once its wait is up.
  let { host } = plan.bind({
    host: {
      me: you,
      vault: ramVault(),
      blobs,
      artifacts: blobs,
      senders: { outbox: box },
      ...fetch ? { fetch } : {},
      stopping: new AbortController().signal,
      duties: () => work(),
      end: () => Promise.resolve(),
      bury: () => Promise.resolve([]),
      gone: () => Promise.resolve(false),
      report: (error) => globalThis.reportError(error),
    },
    actor: { by: you },
    storage: (host) =>
      ram(host.vocab, {
        number: Object.fromEntries(
          Object.entries(prefixes(host.vocab))
            .filter(([c]) => !UNNUMBERED.includes(c)),
        ),
      }),
    effects: (host, disabled) =>
      effects(host.vocab, {
        disabled,
        singleOwner: true,
        write: (b) => host.graph.apply(b, { trusted: true }),
        nudge: () => void work(),
        backoff: () => retry,
        report: (error) => globalThis.reportError(error),
      }),
    // The page hears each phase after every plugin has run its own.
    graph: (options) =>
      graph({ ...options, plugins: [...options.plugins ?? [], watch] }),
  })
  let { vocab, storage, graph: g, fx } = host
  // Your inbox's email door, as @yaks/inbox's service opens it: a letter
  // from the shop for each question that holds up work. The tab passes after
  // every commit instead of every ten seconds, at the cost of what the commits
  // since the last pass touched, and queues no daily digest.
  let inbox = queueing(
    g,
    vocab,
    { person: you, from: SHOP, base: 'http://127.0.0.1:8787' },
    (b) => g.apply(b),
  )
  // Work what is owed after each commit: the inbox's pass, then each effect,
  // again while a run is due, then wake when the next waiting one falls due.
  // A pass not yet started works every commit made before it starts, so the
  // commits a write makes while one waits share it.
  let working = Promise.resolve()
  let waiting: Promise<void> | undefined
  let alarm: ReturnType<typeof setTimeout> | undefined
  let tick = () => new Promise((ok) => setTimeout(ok, 0))
  let work = (): Promise<void> =>
    waiting ??= working = working.then(tick).then(async () => {
      waiting = undefined
      let touched = [...moved]
      moved.clear()
      await inbox(touched)
      for (;;) {
        await fx.work(g)
        let next = Math.min(
          ...(await g.read('.effect.next ?effect'))
            .map((b) => Date.parse(String((b.effect as Comp).next)))
            .filter(Number.isFinite),
        )
        clearTimeout(alarm)
        if (next == Infinity) return
        if (next > Date.now()) {
          alarm = setTimeout(work, next - Date.now())
          return
        }
      }
    })
  await g.install()
  // The person typing is in the graph from the start, with the address their
  // mail goes to; the agent joins it, writing its own row, when it first
  // calls a tool.
  await g.apply([{
    entity: { eid: you },
    person: {},
    doc: { title: 'You' },
    email: { address: YOURS },
  }])
  let kept = (typed.drafts ?? []).filter((b) =>
    (b.draft as Comp | undefined)?.text
  )
  if (kept.length) {
    await g.apply(kept.map(({ entity, draft }) => {
      let { by, place, text } = draft as Comp
      return { entity: { eid: entity.eid }, draft: { by, place, text } }
    }))
  }
  let met: Promise<unknown> | undefined
  let meet = () =>
    met ??= Promise.resolve(g.apply([{
      entity: { eid: agent },
      persona: {},
      doc: { title: 'Your agent', body: 'Calls the same tools over MCP.' },
      $actor: { by: agent },
    }]))
  let tools = host.tools.filter((t) => OFFERED.has(t.name))
  let calls = host.runner
  await calls.ensure(tools.map((t) => t.name))
  let views = await registry(
    Object.keys(PACKAGES).filter((name) => PACKAGES[name].views),
    (name) => Promise.resolve(PACKAGES[name].views as never),
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
    return { code: faulted(landed, id) || ailing(tool, answer) ? 1 : 0, out }
  }

  /** A tool called as `by`, its answer printed the way `yak` prints it. */
  let calling = async (
    name: string,
    args: Record<string, unknown>,
    by: string,
  ): Promise<Said> => {
    let out: string[] = []
    let say = (text: string) => out.push(...String(text).split('\n'))
    return await said(invoke(name, args, by), say, out)
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

  let named = human(vocab)
  let receive = arrived({
    graph: g,
    domain: SHOP.split('@')[1],
    readings: [inboxMail.reading({ person: you, from: SHOP })!],
  })

  // What the person types and has not sent, kept in the graph and in the
  // stash until it is (@yaks/draft).
  let drafts = desk({
    mutate: (bundles) => g.apply(bundles),
    // A watch reads again after each commit that wrote a draft.
    watch: (q) => {
      let value: Bundle[] = []
      let heard = new Set<(rows: Bundle[]) => void>()
      let read = () =>
        Promise.resolve(g.read(q)).then((rows) => {
          value = rows
          for (let h of heard) h(rows)
        })
      let hear = ({ bundles }: Change) =>
        void (bundles.some((b) => b.draft) && read())
      void read()
      listeners.add(hear)
      return {
        get value() {
          return value
        },
        subscribe: (fn) => (heard.add(fn), () => void heard.delete(fn)),
        close: () => void listeners.delete(hear),
      }
    },
  }, { by: () => you, stash, report: (e) => globalThis.reportError(e) })
  listeners.add(({ bundles }) => {
    if (!stash || !bundles.some((b) => b.draft)) return
    Promise.resolve(g.read('.draft ?draft')).then((drafts) =>
      stash.setItem(TYPED, JSON.stringify({ you, drafts }))
    ).catch((e) => globalThis.reportError(e))
  })

  // The person was written before anything listened.
  for (let b of await g.get([you])) rows.set(b.entity.eid, b)

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
      return await calling(name, args, agent)
    },
    /** A call the person makes from a page in the browser: the same tool,
     * their own name. */
    call: (name: string, args: Record<string, unknown>): Promise<Said> =>
      calling(name, args, you),
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
    /** Settles once every commit so far is in `row`, and the effects it owed
     * have run as far as they can now. */
    settled: async () => {
      await reading
      await working
      await reading
    },
    /** The outbox the mail effect delivers to. */
    outbox: box,
    /** What the person has typed and not sent, by where they typed it. */
    drafts,
    /** What a new session wearing a persona (by its short id) starts with:
     * its text and everything it contains, as @yaks/persona says it to an
     * agent, printed the way a command's answer is. */
    context: async (persona: string): Promise<Said> => {
      let row = [...rows.values()].find((b) => named(b) == persona)
      let worn = row && await wear(storage, vocab)(row.entity.eid)
      return worn
        ? { code: 0, out: voice(vocab)(worn).trimEnd().split('\n') }
        : { code: 1, out: [`${persona} is no persona`] }
    },
    /** Your reply to the letter of `subject`, in `words`, arriving as the
     * mail service hands it in, to the thread's address the letter gives:
     * @yaks/mail records it, and @yaks/inbox reads it as a comment on the
     * question, and the choice it names as your answer. */
    reply: async (subject: string, words: string): Promise<Said> => {
      let asked = [...rows.values()].find((r) =>
        r.mail && r.deliver && (r.doc as Comp | undefined)?.title == subject
      )
      let target = String((asked?.mail as Comp | undefined)?.target ?? '')
      let q = rows.get(target)
      if (!asked || !q) return { code: 1, out: [`no letter ${subject}`] }
      let open = !!q.decision && !q.decided
      await g.apply(
        await receive({
          from: YOURS,
          to: `${target}@${SHOP.split('@')[1]}`,
          headers: new Headers({ From: YOURS, Subject: `Re: ${subject}` }),
        }, {
          eid: mint(),
          text: words,
          reply: asked.entity.eid,
          verified: true,
        }),
      )
      return {
        code: 0,
        out: [
          open
            ? `${named(q)} answered: ${words}`
            : `${named(q)} was already answered`,
        ],
      }
    },
    /** A rule or effect by name, as the vocabulary that declares it writes
     * it, and the package that declares it (`shop`: the page's own). */
    declared: (name: string) =>
      [
        ...Object.entries(PACKAGES).map(([from, p]) => ({
          from,
          docs: (p.vocab as { docs?: VocabDoc[] }).docs ?? [],
        })),
        { from: 'shop', docs: [shopDoc as VocabDoc] },
      ].flatMap(({ from, docs }) =>
        docs.map((d) => ({
          from,
          def: d.$defs?.[name] as Record<string, unknown> | undefined,
        }))
      ).find((d) => d.def),
  }
}
