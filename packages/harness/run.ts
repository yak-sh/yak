import { instructionFiles, promptEntry } from './prompts.ts'
import { homeAt, workspace } from './workspace.ts'
import { render as tree } from '@yaks/preact'
import type { VNode } from 'preact'
import { transcriptViews } from './transcript.ts'
// The harness running: the rows every transcript is served from, the daemon
// over them, and the four things a door asks for — start one, say something to
// one, list them, read one back.
//
// Everything in and out of here is a BUNDLE or a QUERY. Nothing writes SQL,
// nothing reads a table, and no state lives in this process that the graph
// does not already hold: what is running is `.session.status=running`, what
// was said is `.entry.session=<s>`, and the harness could be handed the
// fleet's graph tomorrow with none of this changing. The one thing it keeps in
// memory is the daemon's queue, which is not state but a place in a queue.
//
// The seed is idempotent because its ids are DERIVED from the names — a
// provider is `provider:openai`, a model `model:gpt-6-astra`, a tool
// `tool:shell` — so a second boot patches the rows the first one wrote instead
// of minting a second set. That is what makes `using{model}` on an entry mean
// the same thing across restarts.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { MODEL, type Model, PROVIDER, TOOL } from '@yaks/model'
import { credential, responses } from '@yaks/openai'
import {
  admit,
  type ChildLimits,
  children,
  CONTENT,
  type Daemon,
  daemon,
  ENTRY,
  seqOf,
  type Step,
  taskEntry,
  type Tool,
  transcript,
  views,
} from '@yaks/session'
import { render } from '@yaks/text'
import { type Harness, open } from './store.ts'
import { harnessTools } from './tools.ts'

/** The model the harness asks when nobody says otherwise. */
export let ASTRA = 'gpt-6-astra'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** The eid a name is seeded under — the same one, every boot. */
export let idOf = (comp: string, name: string): Eid => `${comp}:${name}`

/** The provider, model and tool rows a transcript is served from, as one
 * idempotent batch. */
export let seed = (
  o: { provider?: string; model?: string; tools?: Tool[] } = {},
): Bundle[] => {
  let provider = o.provider ?? 'openai'
  let model = o.model ?? ASTRA
  return [
    {
      entity: { eid: idOf(PROVIDER, provider) },
      [PROVIDER]: { name: provider },
    },
    {
      entity: { eid: idOf(MODEL, model) },
      [MODEL]: { name: model, provider: idOf(PROVIDER, provider) },
    },
    ...(o.tools ?? []).map((t) => ({
      entity: { eid: idOf(TOOL, t.name) },
      [TOOL]: { name: t.name, description: t.description },
    })),
  ]
}

/** How a harness is started: what it stores in, what serves it, and what the
 * agent may do. */
export type Opts = ChildLimits & {
  /** initial default directory; session home is discovered here */
  cwd?: string
  /** the graph to run over (default: the one at `HARNESS_DB`) */
  h?: Harness
  /** what serves an ask (default: @yaks/openai over the found credential) */
  model?: Model
  /** the model to ask for by name (default `gpt-6-astra`) */
  name?: string
  /** what the agent may call (default: the shell and the graph) */
  tools?: Tool[]
  /** the system prompt every ask carries */
  instructions?: string
  /** each step of every transcript, as it lands */
  each?: (step: Step) => void
}

/** A running harness. */
export type Agent = {
  h: Harness
  d: Daemon
  tools: Tool[]
  /** the model entity every new session is started under */
  model: Eid
  /** what to call a model or tool entity, for the views */
  names: Record<string, string>
  /** start a transcript with one instruction; the daemon takes it from there */
  start: (prompt: string, o?: { effort?: string }) => Promise<Eid>
  /** say something more to a transcript that is already going */
  send: (session: Eid, text: string) => Promise<Eid>
  /** mint and delegate unfiled work under an existing session */
  taskEntry: (session: Eid, text: string) => Promise<{ task: Eid; child: Eid }>
  /** every session, oldest first, each carrying its derived status */
  sessions: () => Promise<Bundle[]>
  /** open/wip tasks, filed or bare, oldest first */
  tasks: () => Promise<Bundle[]>
  /** direct delegated sessions, including forks */
  children: (session: Eid) => Promise<Bundle[]>
  /** one transcript's entries, in order */
  transcript: (session: Eid) => Promise<Bundle[]>
  /** wake every transcript a restart left mid-step */
  resume: () => Promise<Eid[]>
  /** wait for a transcript to run out of things to do */
  idle: (session: Eid) => Promise<void>
  /** one bundle as a line of text, through @yaks/render's session views */
  entry: (b: Bundle) => VNode | null
  line: (b: Bundle, view?: string, ctx?: Record<string, unknown>) => string
  /** Explicit instruction admission; appends a snapshot, never a user turn. */
  instruct: (session: Eid, text: string, source?: string) => Promise<Eid>
  close: () => void
}

// Oldest first, by the number the graph minted on first touch — the only
// ordering that is the same for two rows written in the same millisecond.
let byNum = (a: Bundle, b: Bundle) =>
  Number(a.entity.num ?? 0) - Number(b.entity.num ?? 0)

/**
 * Start the harness: open the graph, seed what serves it, and put the daemon
 * on its entries.
 *
 * ```ts
 * import { agent } from '@yaks/harness'
 *
 * let a = agent({ h: open(':memory:'), model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * ```
 */
export let agent = (opts: Opts = {}): Agent => {
  let h = opts.h ?? open()
  let name = opts.name ?? ASTRA
  let model = opts.model ??
    responses({
      credential: credential(Deno.env.get, (p) => Deno.readTextFile(p)),
    })
  let tools = opts.tools ?? harnessTools(h.g, opts)
  h.g.apply(seed({ model: name, tools }), { trusted: true })
  let d = daemon(h.g, h.fx, {
    model,
    tools,
    instructions: opts.instructions,
  }, opts.each)

  let names: Record<string, string> = {
    [idOf(MODEL, name)]: name,
    ...Object.fromEntries(tools.map((t) => [idOf(TOOL, t.name), t.name])),
  }
  let using = {
    provider: idOf(PROVIDER, 'openai'),
    model: idOf(MODEL, name),
  }
  let entries = (session: Eid) => transcript(h.g, session)
  let next = async (session: Eid) =>
    Math.max(0, ...(await entries(session)).map(seqOf)) + 1

  let a: Agent = {
    h,
    d,
    tools,
    names,
    model: idOf(MODEL, name),
    start: (prompt, o = {}) =>
      admit(h.g, undefined, opts, async () => {
        let home = await homeAt(h.g, opts.cwd ?? Deno.cwd())
        let session = crypto.randomUUID() as Eid
        let files = await instructionFiles(opts.cwd ?? Deno.cwd())
        let context = files.map((f, i) =>
          promptEntry(session, i + 1, f.body, f.source, 'shared', f.revision)
        )
        await h.g.apply([
          ...context,
          {
            entity: { eid: session },
            session: { id: session.slice(0, 8) },
            home,
          },
          {
            entity: { eid: crypto.randomUUID() as Eid },
            [ENTRY]: { session, seq: context.length + 1 },
            [CONTENT]: { body: prompt },
            using: { ...using, ...o.effort ? { effort: o.effort } : {} },
          },
        ])
        return session
      }),
    send: (session, text) =>
      d.enqueue(session, async () => {
        let eid = crypto.randomUUID() as Eid
        await h.g.apply([{
          entity: { eid },
          [ENTRY]: { session, seq: await next(session) },
          [CONTENT]: { body: text },
        }])
        return eid
      }),
    taskEntry: (session, text) =>
      d.enqueue(
        session,
        () =>
          taskEntry(h.g, session, text, {
            ...workspace(h.g, opts.cwd),
            ...opts,
          }),
      ),
    sessions: async () => (await h.g.read('.session')).toSorted(byNum),
    children: (session) => children(h.g, session),
    tasks: async () =>
      (await h.g.read('.task.status=open,wip')).toSorted(byNum),
    transcript: entries,
    resume: async () => {
      let live = await h.g.read('.session.status=pending,running')
      // Reconcile receipts lost between a child commit and its effect.
      for (
        let b of await h.g.read(
          '.spawned .session.status=settled,failed,stopped',
        )
      ) {
        d.wake(b.entity.eid)
      }
      let woken = live.map((b) => b.entity.eid)
      for (let s of woken) d.wake(s)
      return woken
    },
    idle: (session) => d.idle(session),
    entry: (b) =>
      tree(transcriptViews, b, 'Transcript', h.vocab, {
        names,
        anchor: model.anchor,
      }),
    line: (b, view = 'Line', ctx = {}) =>
      render(views, b, view, h.vocab, {
        names,
        anchor: model.anchor,
        ...ctx,
      }, 'plain'),
    instruct: (session, text, source = 'explicit') =>
      d.enqueue(session, async () => {
        let entries = await a.transcript(session)
        let entry = promptEntry(
          session,
          entries.length ? Number((entries.at(-1)!.entry as Comp).seq) + 1 : 1,
          text,
          source,
          'local',
        )
        await h.g.apply([entry])
        return entry.entity.eid
      }),
    close: h.close,
  }
  return a
}

/** What a transcript is called on a listing line: the first words anybody said
 * to it. */
export let titleOf = (entries: Bundle[]): string =>
  String(
    comp(entries.find((b) => CONTENT in b) ?? {} as Bundle, CONTENT)
      ?.body ?? '',
  )
    .split('\n')[0].slice(0, 60)
