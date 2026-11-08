import {
  type Bundle,
  type Comp,
  type Graph,
  identityEid,
  mint,
  type NamedTool,
  namedTool,
} from '@yaks/graph'
import { begin, lend, seed } from '@yaks/harness'
import {
  kindOf,
  ordered,
  running,
  sessionTools,
  statusOf,
  textOf,
  type Tool,
  transcript,
  transcriptBack,
  transcriptWindow,
} from '@yaks/session'
import { derivedEid } from '@yaks/graph/identity'
import { LIMIT } from '@yaks/session/status'
import { CALLED, channelOf, HEARD, paged } from './operator-view.ts'
import { building } from './made.ts'
import { listing } from '@yaks/mcp'
import {
  billed,
  type Listed,
  type Model,
  ModelError,
  modelReads,
  type Price,
} from '@yaks/model'
import { platform, ready, served } from './providers.ts'
import { attachmentRows } from './operator-attachments.ts'
import { attached, fileContext } from './operator-inputs.ts'
import { agents, providing } from './config.ts'
import { inputSchemaOf } from '@yaks/tools/schema'
import { CallError, invoke } from '@yaks/tools'
import { loadTools, textSearch } from '@yaks/graph/tools'
import { memoryDoc } from '@yaks/memory/vocab'
import { ORACLE } from '@yaks/topic'
import { runs as memoryRuns } from '@yaks/memory/tools'
import { taskDoc } from '@yaks/task/vocab'
import { runs as taskRuns } from '@yaks/task/tools'
import { worded } from '@yaks/tools'
import type { Handlers } from '@yaks/effects'
import {
  type Directory,
  directory,
  directoryOf,
  type Reach,
  type Space,
} from './directory.ts'
import * as directoryPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { narrowed } from './grants.ts'
import { reachOf } from './operator-reach.ts'
import { inReach } from './declared.ts'
import { connected, reaching } from './agent.ts'
import { coded } from './agent-code.ts'
import { ledger } from './ledger.ts'
import { admin, type Args, type Ctx, inSpace, refuse } from './tool.ts'
import { adminTools } from './operator-admin.ts'
import { platformFault } from './unseen.ts'
import { bound, type Env } from './env.ts'
import type { Held } from './build-door.ts'
import { accounted } from './meter.ts'
import { caught, defect } from './defects.ts'
import {
  ambient,
  counts,
  reached,
  since,
  type Tally,
  tallying,
} from './lib/hops.ts'
import { drain, type operatorStore } from './operator-store.ts'
import {
  type File,
  mailSend,
  messageReference,
  starting,
} from './operator-channels.ts'
import { rootAt } from './operator-root.ts'
import { textSend } from './operator-texts.ts'
import { notificationSend } from './operator-alerts.ts'
import { iconic } from './raster.ts'
import { phoneSend } from './operator-line.ts'
import { imageNew } from './operator-images.ts'
import { googleTold, googleTools } from './operator-google.ts'
import { notification } from './operator-updates.ts'
import { wakeTools } from './operator-wakes.ts'
import { subscriptionTools, type Watching } from './operator-subscriptions.ts'
import { type Browsers, browserTools } from './operator-browser.ts'
import {
  bases,
  declare,
  type Declared,
  personaFor,
  spaced,
} from './operator-persona.ts'
import {
  oracleContext,
  oracleMap,
  oracleTopic,
  oracular,
  TOPIC,
  topicOf,
} from './operator-oracles.ts'

type Store = ReturnType<typeof operatorStore>
export type Options = {
  directory?: () => Directory
  model?: Model
  providers?: Record<string, Model>
  name?: string
  price?: Price
  tools?: (ctx: Ctx, files: File[]) => Tool[]
  // Told each time a session moved (a step landed, words were given), so a
  // page watching it hears at once (the Builder object's socket).
  tell?: (session: string) => void
  // Told each piece of a reply as the model writes it, once it is stored.
  typing?: (session: string, text: string) => void
  // Told when a model's step ends, its words written (before a tool call it
  // asked for, or its answer).
  stepped?: (session: string) => void
  // The browsers people lend this Operator (operator-browser.ts): while a
  // person has one connected, their sessions are offered its tools.
  browsers?: Browsers
}
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

// The directory an Operator reads through: the Worker's binding onto it.
let opening = (env: Env) => () =>
  directory(bound(env.DIRECTORY, directoryPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })

// Each space has its own Operator, working on that space and the spaces that
// let it in (operator-reach.ts), the PA's among them.
export let operatorContext = async (
  env: Env,
  held: Pick<Held, 'person' | 'administrative'>,
  space: Space,
  open: () => Directory = opening(env),
  reach: ReturnType<typeof reachOf> = reachOf(open(), space, held.person),
): Promise<Ctx & { pa: boolean; beyond: Reach[] }> => {
  let { pa, beyond } = await reach
  let reopen = () =>
    narrowed(open(), space.slug, space.eid, held.administrative, beyond)
  return {
    env,
    dir: reopen(),
    reopen,
    person: held.person,
    pa,
    beyond,
    who: {
      person: held.person,
      via: 'session',
      ...beyond.length ? {} : { space: space.slug, spaceEid: space.eid },
      actor: space.eid,
    },
  }
}

// How the Operator works in its conversations, declared beside the code that
// makes it so (`operating`): every message arrives in one conversation, which
// forks for the work, and a fork shares its instructions and tools so its
// request starts with the conversation's cached prefix. The base persona
// contains it (operator-persona.ts).
export let conversation: Declared = {
  key: 'conversation',
  title: 'Your conversations, and the work they fork',
  body:
    "You talk with each person in one conversation that lasts for weeks: every message they send you, in the chat app, by email or by text, arrives there, marked with how it came when not by chat. Keep the conversation itself light. For anything that needs a tool (reading or changing apps, rows, files or code), use fork with a short prompt saying what to do, then reply at once in a sentence saying what you are doing, and nothing more; your reply goes to them the way their message came. When a fork comes back, tell them in a few lines what was done or what is needed from them. Answer without a fork only what needs no tool.\n\nWhen a request could mean changing an app the space already has or making a new one, ask the person which they want, naming that app, before doing either.\n\nWhen you were started for a piece of work (a fork, a helper, or a task), do the work with your tools, using the space's existing apps and rows, then end with a short report of what changed and the next step, for the conversation or the task to pass on. If you find an app that already does what was asked and the request did not say whether to change it or make a new one, change nothing: report the app you found and that the person needs to choose.\n\nFor imports, reconciles and other bulk data work, use code_mode. Read schemas and rows there, parse the source, match records, compute changes, write bundles in batches, and verify the stored result inside the script. Return only counts, concise differences and any questions that need your judgment. Whole schemas, rows and write results belong in the script, not your context. Read independent apps together with Promise.all. Use supplied attachment references for pasted text and files: inside code_mode, tools.yaks.attachment_read({attachment: id}) returns the original text in structuredContent.result[0].output.value.text. Parse that text in the script without returning it. For sandbox work, sandbox_write with attachment writes it directly to a file. Never type the source contents back into code. Inspect only a small sample or the specific schema fields you need when deciding how to proceed. Direct graph tools are for small, focused reads or single edits.",
}

// What a session carrying on a task is told, where it is given the tool that
// closes it.
let ON_TASK =
  ' This session carries on that task: its conversation and tools are recorded on it. Set status done on it only when the requested work is finished; leave it open when asking a question, reporting a limit, or explaining unfinished work.'

// What every session is told where it is given the tool that asks the person
// it works for to choose (operator-updates.ts).
let ASKING =
  ' Ask the person you work for: the question reaches them in their Updates under Needs you, with a button for each choice, and what they choose comes back to you in your conversation with them. When they are not in this conversation, tell them it waits with notification_send. Use it for a choice that is theirs to make (spending money, sending to people, deleting), not to confirm routine work.'

// What the Operator is told of the spaces it reaches beyond its own.
let told = (
  ctx: Awaited<ReturnType<typeof operatorContext>>,
  space: Space,
) =>
  ctx.beyond.length
    ? `${
      ctx.pa
        ? `${space.slug} is this person's own space, so you are their personal assistant and also reach their other spaces`
        : `You also reach the spaces that let ${space.slug}'s Operator in`
    }, with the role you have in each: ${
      ctx.beyond.map((r) => `${r.space.slug} (${r.role})`).join(', ')
    }. Name the space, or the app as space/app, to work in one of them.`
    : ''

// What the Operator reads of itself: its own store, where each conversation
// and every entry in it, its forks and helpers, its memories, its persona and
// its tasks and requests are kept. The generic reads take `self` to read it
// instead of the apps, and the memory loop works on it alone (@yaks/memory).
let SELF = {
  type: 'boolean',
  description:
    'Use your own store instead of the apps: your conversations and every entry in them, your forks and helpers, your memories, your persona, your app and space topics, and your tasks and requests.',
}
let mine = new Set(['memory_save', 'memory_recall', 'memory_around'])
// The connector's tools the Operator holds as its own: memory_save and
// memory_recall are its own memories (the space's are store_memory_save and
// store_memory_recall), mail_send is its own letter for the person it works
// for (an app's is store_mail_send), and operator_run and operator_read reach
// the Operator itself, whose fork, spawn and reads with self are its own of
// them.
let ownNamed = new Set([...mine, 'mail_send', 'operator_run', 'operator_read'])
// Where the Operator finds what it no longer holds in front of it, declared
// beside the code that gives it `self` and the memory loop. The base persona
// contains it (operator-persona.ts).
export let remembering: Declared = {
  key: 'remembering',
  title: 'What you have done, and finding it again',
  body:
    'Everything you have done is kept in your own store: each conversation and every entry in it, your forks and helpers, your memories and your tasks. When something said earlier is not in front of you, find it there: search, graph_query and graph_show with self true (`.entry` rows are what was said, each in a `.session`), and memory_around for what was said around an entry. When someone tells you something worth keeping, memory_save it with on naming the entry they said it in; memory_recall finds it again. What they want every agent working in the space to know, such as how they like their apps built, goes to the space with store_memory_save, and store_memory_recall finds it.',
}

// Large answers stay inside code_mode; focused direct calls remain useful.
let BULK: Record<string, string> = {
  graph_schema:
    'For bulk work or a schema index, call this inside code_mode and return only the relevant component names and properties. ',
  graph_query:
    'For bulk reads, imports or reconciles, call this inside code_mode; filter, join and compare the rows there and return a concise summary. Direct calls are for small, focused answers. ',
  graph_show:
    'For many entities or large bodies, call this inside code_mode and return only the fields you need. ',
  graph_apply:
    'For bulk changes, imports or reconciles, call this inside code_mode; generate bundles from source data and existing rows in the script, write batches and return counts. Direct calls are for single edits. ',
}

// Discovery is refreshed before every ask: a deploy may add words and tools.
export let operatorRoster = async (
  ctx: Ctx,
  work: Store,
  { space, tasked = false }: { space: string; tasked?: boolean },
): Promise<Tool[]> => {
  ctx.dir = ctx.reopen!()
  let reach = reached('reach', await inReach(ctx))
  let g = reached('vocab', await reaching(ctx, reach))
  // A tool's answer in words is the call's own, as at the connector's door:
  // only what it wrote for an app goes on to the app (ledger.ts).
  let landing = ledger(g)
  let own = new Map(
    [
      ...listing({
        graph: work.g,
        search: textSearch(work.g),
      }),
      ...loadTools([memoryDoc], memoryRuns()),
      ...loadTools([taskDoc], taskRuns()),
    ].map(namedTool).map((t) => [t.name, t]),
  )
  let run =
    (t: NamedTool, host: Graph, target: Graph): Tool['run'] =>
    async (args, context) => {
      let call = context!.call
      let fault: unknown
      let out = await invoke(
        {
          ...call,
          call: {
            ...comp(call, 'call'),
            args,
            actor: { by: ctx.who!.actor!, via: context!.session },
          },
          $actor: {
            by: ctx.who!.actor!,
            via: context!.session,
          },
        },
        t,
        target,
        {
          host,
          report: (e) => {
            fault = e
            caught(e, { request: 'operator tool', tool: t.name })
          },
        },
        (answer, state, keeps) =>
          !t.readOnly && !t.applied && state == 'done' && keeps !== false
            ? target.apply(answer)
            : answer,
      )
      let refusal = out.find((b) => b.refusal)
      if (refusal) {
        throw new CallError(
          String(comp(refusal, 'refusal')?.code),
          String(comp(refusal, 'content')?.body),
        )
      }
      if (fault) throw fault
      // Applied tools already wrote through their own store; generic writes
      // return patches and use the same graph application as the connector.
      return worded(out) || JSON.stringify(out)
    }
  let shaped = (t: NamedTool) => ({
    name: t.name,
    ...t.title ? { title: t.title } : {},
    ...t.step ? { step: t.step } : {},
    description: (BULK[t.name] ?? '') + t.description,
    parameters: inputSchemaOf(t),
    readOnly: t.readOnly,
  })
  // Every tool the connector lists for the person (agent.ts `connected`), to
  // the conversation and each of its forks alike: the list heads the request,
  // so one list keeps the conversation's cached prefix for every fork.
  let apps = listing(coded({
    ...connected(ctx, reach, g),
    calls: ledger(g, work.g),
    report: (e) => caught(e, { request: 'operator code mode' }),
  }, ctx)).map(namedTool)
    .filter((t) => !ownNamed.has(t.name))
  return [
    ...apps.map((t): Tool => {
      let self = own.get(t.name)
      let there = run(t, g, landing)
      if (!self) return { ...shaped(t), run: there }
      let here = run(self, work.g, work.g)
      let tool = shaped(t)
      return {
        ...tool,
        parameters: {
          ...tool.parameters,
          properties: {
            ...tool.parameters.properties as Record<string, unknown>,
            self: SELF,
          },
        },
        run: ({ self: reads, ...args }, context) =>
          (reads ? here : there)(args, context),
      }
    }),
    ...[...own.values()]
      .filter((t) =>
        mine.has(t.name) || (tasked && t.name == 'task_update') ||
        t.name == 'decision_new'
      )
      .map((t) => {
        let tool = { ...shaped(t), run: run(t, work.g, work.g) }
        if (t.name == 'task_update') {
          return { ...tool, description: t.description + ON_TASK }
        }
        if (t.name != 'decision_new') return tool
        // Asked of the person it works for, in their space, whatever the
        // model says.
        let { properties, ...parameters } = tool.parameters
        let { assignee: _, project: __, ...rest } = properties as Record<
          string,
          unknown
        >
        return {
          ...tool,
          description: t.description + ASKING,
          parameters: { ...parameters, properties: rest },
          run: (args, context) =>
            tool.run(
              { ...args, assignee: ctx.person, project: space },
              context,
            ),
        } as Tool
      }),
  ]
}

// What the Operator does when yaks.app, not the app, is at fault: it tells
// the platform's tracker (M-37965), where its people fix it, and changes
// nothing in the app to get around it. A report about a break the tracker
// already has files under that break's fault, so it joins the break's bug
// as its newest occurrence; only a failure no break records is a bug of its
// own. The report is the Operator's words, never a stack of its own: where it
// was written says nothing of where the fault is.
export let platformBug = (ctx: Ctx, space: Space): Tool => ({
  name: 'platform_bug',
  title: 'Report a yaks.app fault',
  step: {
    doing: 'Telling the yaks.app team about a fault…',
    done: 'Told the yaks.app team about a fault',
  },
  description:
    "Report that yaks.app itself is at fault, not the app's own files: a tool that answered wrongly, a refusal the guide says should pass, a deploy that lost what was sent. Say what you did, what yaks.app answered, and why the app is not the cause. When it is about an app's error, give that error's id, as app_errors lists it, and the report joins what yaks.app already knows of it. It reaches the people who run yaks.app; leave the app as it is.",
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What is wrong in yaks.app.' },
      app: { type: 'string', description: 'The app it happened in.' },
      error: {
        type: 'string',
        description:
          'The id of the app error this is about, as app_errors lists it (#13dea90f50).',
      },
    },
    required: ['text'],
  },
  run: async (args) => {
    let text = String(args.text ?? '').trim()
    if (!text) throw refuse('arguments', 'say what is wrong in yaks.app')
    let word = typeof args.error == 'string' ? args.error.trim() : ''
    let about = word
      ? await platformFault(
        ctx.env,
        space,
        (await inSpace(ctx, { space: space.slug })).who,
        word,
      )
      : undefined
    if (word && !about) {
      throw refuse(
        'missing',
        `no error ${word} in ${space.slug}; give an id app_errors lists, or none`,
      )
    }
    defect(text, {
      request: 'operator found a platform fault',
      space: space.slug,
      ...typeof args.app == 'string' ? { app: args.app } : {},
      ...about ? { scope: space.eid, occurrence: about.occurrence } : {},
    }, about ? { fault: about.fault } : {})
    return 'Reported to the people who run yaks.app.'
  },
})

/** What the Operator runs on (config.ts `agents`): the first choice whose
 * provider the Worker holds every credential of, by default Sonnet on the
 * platform's Anthropic key, handing coding and tricky work to Opus, and
 * without the key GLM on Workers AI. `OPERATOR_MODEL` and
 * `OPERATOR_DELEGATE` name other models of the provider chosen. */
export let operatorChoice = (env: Env) => {
  let chosen = agents.operator.find((c) => ready(env, c.provider, providing)) ??
    agents.operator.at(-1)!
  return {
    provider: chosen.provider,
    name: env.OPERATOR_MODEL ?? chosen.model,
    delegate: chosen.delegate && (env.OPERATOR_DELEGATE ?? chosen.delegate),
  }
}

/** This space's operator work as operator_read answers it: the latest tasks
 * and conversations, a task with all its lines, or a conversation's newest
 * lines, a page at a time back from `before` (an entry), with how many come
 * before them and the `before` to pass for the page preceding (`earlier`).
 * Model instruction snapshots are left out unless `context`. */
export let readOperator = async (
  { g }: Store,
  task?: string,
  { context = false, before }: { context?: boolean; before?: string } = {},
) => {
  if (!task) {
    return {
      tasks: await g.read('.task ?doc .order=-created.at .limit=20'),
      conversations: await g.read(
        '.operator_session ?session ?updated .order=-updated.at .limit=20',
      ),
    }
  }
  let [row] = await g.get([task])
  // A conversation is its session: its newest lines, as a task's are read.
  if (row?.session) {
    let page = await transcriptWindow(g, task, { limit: LINES, before })
    let count = page.before ? page.offset ?? 0 : 0
    return {
      sessions: [row],
      entries: sent(page.entries, context),
      ...count
        ? { earlier: { count, before: page.entries[0].entity.eid } }
        : {},
    }
  }
  if (!row?.task) throw refuse('missing', `no operator task ${task}`)
  let comments = await g.read(`.comment.target=${task} ?doc .order=created.at`)
  let links = await g.read(`.contains .edge.from=${task}`)
  let sessions = await g.get(links.map((b) => String(comp(b, 'edge')!.to)))
  let entries =
    (await Promise.all(sessions.map((b) => transcript(g, b.entity.eid)))).flat()
  return {
    task: row,
    comments,
    sessions,
    entries: sent(entries, context),
  }
}

// How many of a conversation's newest lines a read answers.
let LINES = 64
// Lines as read: without the model instruction snapshots unless asked.
let sent = (entries: Bundle[], context: boolean) =>
  context ? entries : entries.map(({ sending: _sending, ...entry }) => entry)

// What an Operator session works with, kept on it (`operator_session`) so
// every step, in whichever wake of the object, reads it again: the space, and
// the person whose reach it has.
type Working = {
  space: string
  person: string
  administrative?: boolean
  files?: File[]
}
let workingOf = async ({ g }: Store, session: string) => {
  let [row] = await g.get([session], ['operator_session'])
  return comp(row, 'operator_session') as Working | undefined
}
// Whether a conversation has begun: its row is a session. Presence is
// counted, so its computed status is never read.
let conversed = async ({ g }: Store, session: string) =>
  Number((await g.rows(`.entity.eid=${session}&.session&.count`))[0]?.n ?? 0) >
    0
// The space an ask is charged to: its session's, or for an exchange a session
// has on its own behalf (a compaction's summary, whose session is sourced by a
// call from an entry of the one it compacts), the space of that session.
let payerOf = async ({ g }: Store, ask?: string) => {
  for (let eid = ask, hops = 0; eid && hops < 4; hops++) {
    let [row] = await g.get([eid], ['entry'])
    let session = comp(row, 'entry')?.session
    let [held] = session
      ? await g.read(
        `.entity.eid=${session}&.fields=operator_session.space,session.source`,
      )
      : []
    let o = comp(held, 'operator_session') as Working | undefined
    if (o) return o.space
    let source = comp(held, 'session')?.source
    let [call] = source ? await g.get([String(source)], ['call']) : []
    eid = comp(call, 'call')?.source as string | undefined
  }
}
let working = async (
  env: Env,
  store: Store,
  session: string,
  open?: () => Directory,
) => {
  let o = await workingOf(store, session)
  if (!o) throw new Error(`Operator session ${session} names no space`)
  let reading = open ?? opening(env)
  // The space, the person's reach in it, and the apps the step's roster and
  // map read next are asked at once: the directory answers them together,
  // and the step's later asks are answered from these (lib/hops.ts
  // `recall`).
  let dir = reading()
  let reach = reachOf(dir, { eid: o.space }, o.person)
  let apps = o.administrative ? undefined : dir.reachable(o.person)
  for (let asked of [reach, apps]) asked?.catch(() => {})
  let space = await (open?.() ?? directoryOf(env.STORE)).at(o.space)
  if (!space || space.trashed) throw refuse('missing', 'That space is gone.')
  let ctx = await operatorContext(env, o, space, reading, reach)
  ctx.who!.instrument = session
  return { space, ctx, files: o.files ?? [] }
}

let ENDED = ['settled', 'failed', 'stopped']

// Each step of an Operator session is counted and remembered as a request
// is (lib/hops.ts): what it reads of the directory is asked once, until it
// writes there, and its tool roster, instructions and payer share the
// answers.
let steps = new WeakSet<Tally>()
let stepwise = (handlers: Handlers): Handlers =>
  Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      (...args: Parameters<typeof handler>) => {
        let tally: Tally = new Map()
        steps.add(tally)
        return tallying(tally, () => handler(...args))
      },
    ]),
  )

// How long a step took to ask its model and hear its answer, and the round
// trips it made on the way, in the Worker's logs: store hops, bucket reads,
// and trips to the cached Files door (files.ts `door`). Its stage marks
// include when the request was sent (`at_submit`) and when the reply's first
// output arrived (`at_first_token`).
let asked = (session?: string) => {
  let tally = ambient()
  let ms = tally && steps.has(tally) && since(tally)
  if (!tally || ms == null || ms === false) return
  console.log(
    'yak operator ask',
    JSON.stringify({
      session,
      ms,
      ...counts(tally),
      files: tally.get('files') ?? 0,
      ...Object.fromEntries(
        [...tally].filter(([name]) =>
          name.endsWith('_wait') || name.startsWith('at_')
        ),
      ),
    }),
  )
}

// The session a helper works for, up its `spawned` links: a person's
// conversation, or a task's session.
let topOf = async (store: Store, session: string): Promise<string> => {
  let [row] = await store.g.get([session], ['spawned'])
  let parent = comp(row, 'spawned')?.parent
  return parent ? topOf(store, String(parent)) : session
}
// The task a session (or the session its helper works for) carries on, or ''
// for a person's conversation.
let taskOf = async (store: Store, session: string) => {
  let [link] = await store.g.read(
    `.contains .edge.to=${await topOf(store, session)}`,
  )
  return String(comp(link, 'edge')?.from ?? '')
}

// The way a request is answered: its channel, and whom it reaches by it.
let routeOf = (request?: Comp) =>
  JSON.stringify(
    ['channel', 'address', 'reply_to', 'via'].map((k) => request?.[k] ?? ''),
  )

// The inputs a turn ending at `end` answers: each line given since the reply
// before it. A helper's result stands for the inputs of the turn that started
// it, so its answer goes where they came from.
// `calls` names the call that started each child (`spawned{parent, call}`).
// Of a transcript's newest lines alone (`whole` false), it is undefined where
// the inputs lie before them.
export let origins = (
  entries: Bundle[],
  end: number,
  calls: Map<string, string>,
  whole = true,
): Bundle[] | undefined => {
  let from = entries.findLastIndex((b, i) =>
    i < end && kindOf(b) == 'output' && !!b.content
  )
  if (from < 0 && !whole) return
  let found: Bundle[] = []
  for (let b of entries.slice(from + 1, end).filter(words)) {
    let child = comp(b, 'delivery')?.child
    if (!child) {
      found.push(b)
      continue
    }
    let call = entries.findIndex((c) =>
      c.entity.eid == calls.get(String(child))
    )
    if (call < 0 && !whole) return
    let more = call < 0 ? [] : origins(entries, call, calls, whole)
    if (!more) return
    found.push(...more)
  }
  return found
}

// A turn's answer: the newest words given, and the inputs the turn that
// followed them answers. The turn ends at its reply, or where the transcript
// does when it ended without one (stopped, failed). Undefined where they lie
// before the lines read (`whole` false).
let turnAt = (
  entries: Bundle[],
  calls: Map<string, string>,
  whole = true,
) => {
  let mark = entries.findLast(words)
  if (!mark) return whole ? { mark, given: [] } : undefined
  let said = entries.findLastIndex((b) => kindOf(b) == 'output' && !!b.content)
  let end = said > entries.indexOf(mark) ? said : entries.length
  let given = origins(entries, end, calls, whole)
  return given && { mark, given }
}

// What a model's refusal tells the person, by its code (@yaks/model
// `ModelError`); any other is a refused request. A ceiling (@yaks/session
// `LIMIT`) is said in its own sentence. yaks.app's own credit with the
// provider spent (@yaks/anthropic `credit`) is no ceiling of the space's.
let REFUSED: Record<string, string> = {
  refusal: 'the model declined to do this',
  busy: 'the model is too busy to answer right now',
  credit: 'the Operator is unavailable for now',
}
let couldnt = (why: string) => `I couldn't finish this: ${why}.`
let TOLD = ' The people who run yaks.app have been told.'

/**
 * What ended a session's work: its newest reply, else what kept it from one,
 * in plain words. `fault` is what went wrong, for the tracker: a refusal, a
 * failure, or an end with no reply. A person's stop is no fault, nor a
 * ceiling met (a spent budget says so in its own words), and a step that threw
 * was reported where it threw (@yaks/session `report`).
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { replyOf } from './operator.ts'
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...b,
 * })
 * let said = line(2, { output: { source: 'a' }, content: { body: 'Done.' } })
 * equal(replyOf([said]), { text: 'Done.' })
 * equal(replyOf([said, line(3, {
 *   output: { source: 'a' }, refusal: { code: 'request' },
 *   content: { body: '400 tools.26: input_schema does not support oneOf' },
 * })]), {
 *   text: "I couldn't finish this: the model refused the request." +
 *     ' The people who run yaks.app have been told.',
 *   fault: 'request: 400 tools.26: input_schema does not support oneOf',
 * })
 * equal(replyOf([line(3, {
 *   output: { source: 'a' }, refusal: { code: 'limit' },
 *   content: { body: "clerk's model and voice budget for this month is spent" },
 * })]), { text: "clerk's model and voice budget for this month is spent" })
 * equal(replyOf([]).fault, 'ended without an answer')
 * let refused = line(4, {
 *   result: { call: 'c' }, refusal: { code: 'arguments' },
 *   content: { body: 'Invalid tool arguments: missing command' },
 * })
 * equal(replyOf([said, refused, line(5, { ask: {} })]).fault,
 *   'ended without an answer')
 * ```
 */
export let replyOf = (
  entries: Bundle[],
): { text: string; fault?: string } => {
  // A model asked after its calls were answered, a refusal among them, is
  // where the work stands: what it answered, or that it answered nothing.
  let end = ordered(entries).findLast((b) =>
    b.content && (b.output || b.refusal || b.exception) || b.failed ||
    kindOf(b) == 'stop' || kindOf(b) == 'ask'
  )
  if (end && kindOf(end) == 'ask' && !end.failed) end = undefined
  let said = end ? textOf(end) : ''
  let kind = end && kindOf(end)
  if (kind == 'stop') return { text: said }
  if (kind == 'refusal' && comp(end, 'refusal')?.code == LIMIT) {
    return { text: said }
  }
  if (kind == 'output' && !end!.notice && said) return { text: said }
  let broke = couldnt('something in yaks.app failed while working on it')
  if (kind == 'exception') return { text: broke + TOLD }
  let code = String(comp(end, 'refusal')?.code)
  let fault = kind == 'refusal'
    ? `${code}: ${said}`
    : String(comp(end, 'failed')?.reason ?? '') || said ||
      'ended without an answer'
  let why = kind == 'refusal'
    ? couldnt(REFUSED[code] ?? 'the model refused the request')
    : end
    ? broke
    : 'This ended without an answer.'
  return { text: why + TOLD, fault }
}

// Words given to a session. A notice the runner writes with prose, as a
// compaction's checkpoint, is no one's words, so it never starts a turn.
let words = (b: Bundle) => kindOf(b) == 'input' && !b.notice

/**
 * The entries since the newest words given: the turn being answered.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { replyOf, turnOf } from './operator.ts'
 * let line = (seq: number, b: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...b,
 * })
 * let stopped = turnOf([
 *   line(1, { content: { body: 'Check the app' } }),
 *   line(2, { stop: {}, content: { body: 'Stopped by the person watching.' } }),
 *   line(3, { notice: {}, checkpoint: {}, content: { body: 'Summary' } }),
 * ])
 * equal(stopped.length, 3)
 * equal(replyOf(stopped), { text: 'Stopped by the person watching.' })
 * ```
 */
export let turnOf = (entries: Bundle[]) =>
  entries.slice(Math.max(0, entries.findLastIndex(words)))

/**
 * The space's Operator: @yaks/harness's runner registered on the store's
 * pool, so every step of every Operator session is a durable effect
 * (@yaks/session `running`). Words given to it land in their task's session
 * even while it works ({@link Operator.ask}); its answer is written when the
 * session ends.
 */
export let operating = (
  store: Store,
  env: Env,
  options: Options = {},
): Operator => {
  let { g, fx, vocab } = store
  let dir = () => options.directory?.() ?? directoryOf(env.STORE)
  // What a subscription watches, read as the person who set it: over the
  // space through their reach, as their graph_query reads it, or over this
  // store (operator-subscriptions.ts).
  let watching: Watching = async (ask, query, mine) => {
    if (mine) return await g.read(query)
    let space = await dir().at(ask.space)
    if (!space || space.trashed) throw refuse('missing', 'That space is gone.')
    let ctx = await operatorContext(
      env,
      ask,
      space,
      options.directory ?? opening(env),
    )
    return await (await reaching(ctx, await inReach(ctx))).read(query)
  }
  let choice = operatorChoice(env)
  let name = options.name ?? choice.name
  let provider = choice.provider
  // Coding and tricky work go to a stronger model of the same provider, in a
  // child session (`spawn`) whose answer comes back to the one that asked.
  let delegate = choice.delegate
  let spawn = sessionTools(g, { childProperties: { topic: TOPIC } })
    .find((t) => t.name == 'spawn')!
  let delegated = (same: boolean): Tool => ({
    ...spawn,
    description:
      `${spawn.description} To consult an app or space oracle, supply topic from the Oracles map and the question as prompt. Its answer comes back automatically.` +
      (same && delegate
        ? ` For writing or fixing code, or work that needs careful reasoning, use spawn with model ${delegate} and a prompt that carries everything it needs; its answer comes back to you.`
        : ''),
  })
  // The model an input asks for, once its provider lists it (`chosen`).
  let usingOf = (model = name, from = provider) => ({
    provider: identityEid('provider', [from]),
    model: identityEid('model', [model]),
  })
  let using = usingOf()
  let implementations = {
    ...options.model
      ? { [provider]: options.model }
      : served(env, () => platform(env)),
    ...options.providers,
  }
  let reads = async (model?: string, from?: string) => {
    let selected = await chosen(model, from)
    return modelReads(implementations[selected.provider], selected.model)
  }
  let shown = fileContext(store, env, async (session) => {
    let space = (await workingOf(store, session))?.space
    let at = space ? await dir().at(space) : undefined
    if (!at) throw new Error('Operator attachment has no space')
    return at
  })
  // A model's price, from what its provider lists, asked once per name.
  let infos = new Map<string, Promise<Listed | undefined>>()
  let listed = (model: string, from = provider) => {
    let key = from + ':' + model
    let held = infos.get(key) ??
      Promise.resolve(implementations[from]?.info?.(model))
    infos.set(key, held)
    held.catch(() => infos.delete(key))
    return held
  }
  let priced = (model: string, from = provider) =>
    options.price && from == provider
      ? Promise.resolve(options.price)
      : listed(model, from).then((info) => info?.price)
  let catalogue = async <T>(
    from: string,
    read: () => T | Promise<T>,
  ): Promise<T> => {
    try {
      return await read()
    } catch (error) {
      if (!(error instanceof ModelError)) throw error
      throw refuse(
        'unavailable',
        `${from} model catalogue failed (${error.code}): ${error.message}`,
      )
    }
  }
  let unknown = async (model: string, from: string) => {
    let all = await catalogue(from, () => implementations[from].list?.())
    let names = [...new Set(all?.map((model) => model.name) ?? [])]
    let choices = all == null
      ? ''
      : names.length
      ? ' Available models: ' + names.slice(0, 20).join(', ') +
        (names.length > 20 ? ` (and ${names.length - 20} more).` : '.')
      : ' Its catalogue lists no models.'
    return refuse(
      'arguments',
      `${from} does not list model ${model}.` + choices,
    )
  }
  // An explicitly selected provider/model must be available; legacy channels
  // naming an unavailable model of the default provider retain their fallback.
  let chosen = async (model?: string, from = provider) => {
    if (!implementations[from]) {
      throw refuse(
        'arguments',
        `The Operator has no available ${from} provider.`,
      )
    }
    if (from != provider && !model) {
      throw refuse(
        'arguments',
        'Name a model when selecting an Operator provider.',
      )
    }
    if (!model || (from == provider && model == name)) {
      return { provider: from, model: name }
    }
    let info = await catalogue(from, () => listed(model, from))
    if (info) return { provider: from, model }
    if (from != provider) {
      throw await unknown(model, from)
    }
    return { provider, model: name }
  }
  // Each ask is charged to the space of the session asking, at the price of
  // the model it asks.
  let accounting = (base: Model, from: string): Model =>
    Object.assign(async (req: Parameters<Model>[0]) => {
      reached('request', req)
      let [price, [ask], space] = await Promise.all([
        priced(req.model, from),
        req.call ? g.get([req.call]) : [],
        payerOf(store, req.call),
      ])
      if (!options.model && !price) {
        throw new Error(`No catalogue price for operator model ${req.model}`)
      }
      reached('payer', space)
      // The space may ask its provider to keep the cached prefix longer than
      // the default (`operator{cache_retention}`).
      let kept = space ? (await dir().at(space))?.cache_retention : undefined
      let session = comp(ask, 'entry')?.session
      let reply = await accounted(
        env,
        (dir) => space ? dir.at(space) : Promise.resolve(null),
        base,
        () => Promise.resolve(price),
      )({
        ...req,
        ...kept ? { cacheRetention: kept } : {},
        onSubmit: async () => {
          await req.onSubmit?.()
          reached('submit', null)
        },
        onFirst: () => {
          reached('first_token', null)
          req.onFirst?.()
        },
      }).finally(() => asked(session ? String(session) : undefined))
      if (session && req.onText) options.stepped?.(String(session))
      let cost = billed(reply, price)
      return { ...reply, cost: cost?.dollars, costReported: cost?.reported }
    }, base)
  let models = Object.fromEntries(
    Object.entries(implementations).map(([p, m]) => [p, accounting(m, p)]),
  )
  // The base persona as this code declares it, written once per wake; one
  // that could not be written is reported and tried again on the next ask,
  // while the Operator wears the base the directory holds.
  let based: Promise<void> | undefined
  let basing = () =>
    based ??= declare(env, [
      oracular,
      conversation,
      remembering,
      starting,
      iconic,
      paged,
      building,
    ]).catch((e) => {
      based = undefined
      caught(e, { request: 'operator base persona' })
    })
  // Each model's rows, written once per wake: the Operator's own and its
  // delegate's, and one an input asks for when it first does. What its
  // catalogue says is written when it answers, which no turn waits on: its
  // price and output limit (the ask that needs them waits on the same lookup,
  // already in flight, and refuses if it fails), and the window where its row names
  // none, so a transcript compacts at its share of the model's own window
  // rather than of @yaks/session's default `CONTEXT`.
  let seeded = new Map<string, Promise<void>>()
  let seedOf = (m: string, from = provider) => {
    let key = from + ':' + m
    let held = seeded.get(key) ?? (async () => {
      Promise.all([priced(m, from), listed(m, from).catch(() => undefined)])
        .then(
          async ([price, info]) => {
            let eid = identityEid('model', [m])
            let [row] = await g.get([eid])
            let own = Number((row?.model as Comp | undefined)?.context) > 0
            let context = !own && info?.context
            let output = info?.output
            if (!price && !context && !output) return
            await g.apply([{
              entity: { eid },
              ...price ? { price } : {},
              ...context || output
                ? {
                  model: {
                    name: m,
                    ...context ? { context } : {},
                    ...output ? { output } : {},
                  },
                }
                : {},
            }], { trusted: true })
          },
          () => {},
        ).catch((e) => caught(e, { request: 'operator model price' }))
      await g.apply(seed({ provider: from, model: m }), { trusted: true })
    })()
    seeded.set(key, held)
    held.catch(() => seeded.delete(key))
    return held
  }
  let seeding = (model: string, from = provider) =>
    Promise.all([
      ...[...new Set([name, delegate])]
        .filter((m): m is string => !!m)
        .map((m) => seedOf(m)),
      seedOf(model, from),
    ])

  // The session's answer, once its turn ends: an answer to each request the
  // turn answers, which its channel delivers (operator_deliver), and on a
  // task's session a comment on its task. A request's words, and a helper's
  // result standing for the words that started it, are answered on the
  // channel they came by: a quick word when the conversation forks, and the
  // outcome when the fork comes back. A helper's end is told to the session
  // that started it, not to the person.
  let unfinished = async (session: string, fault: string, request: string) => {
    let space = (await workingOf(store, session))?.space
    defect(Error(`Operator could not finish: ${fault}`), {
      request,
      session,
      space: space ? (await dir().at(space))?.slug : null,
    })
  }
  // What a step's end reads of its transcript, oldest first, never every
  // line a conversation has held for weeks: a fork's or helper's own turn,
  // and a conversation's back to the reply before the words it answers and
  // before each call that started a helper whose result stands for words.
  // A call's lines are context, never a turn's words or its reply. `calls`
  // names the call that started each child these lines deliver from.
  let ending = async (session: string, spawned: boolean) => {
    let calls = new Map<string, string>()
    let looked = new Set<string>()
    let lines = (read: Bundle[]) =>
      read.filter((b) => !(b.notice && b.operator_call))
    let starts = async (entries: Bundle[]) => {
      let children = [
        ...new Set(entries.flatMap((b) => {
          let child = comp(b, 'delivery')?.child
          return child && !looked.has(String(child)) ? [String(child)] : []
        })),
      ]
      for (let child of children) looked.add(child)
      for (let b of await g.get(children, ['spawned'])) {
        let call = comp(b, 'spawned')?.call
        if (call) calls.set(b.entity.eid, String(call))
      }
    }
    let read = await transcriptBack(g, session, async (read) => {
      let entries = lines(read)
      if (spawned) return entries.some(words)
      await starts(entries)
      return !!turnAt(entries, calls, false)
    })
    let entries = lines(read.entries)
    if (!spawned) await starts(entries)
    return { entries, calls, whole: read.whole }
  }
  let answered = async (session: string) => {
    let [row] = await g.get([session], ['spawned'])
    let { entries, calls, whole } = await ending(session, !!row?.spawned)
    let reply = replyOf(turnOf(entries))
    // A fork or helper that could not finish reaches the tracker as it ends;
    // what it ended with goes to the session that started it (M-37965).
    if (row?.spawned) {
      if (reply.fault) await unfinished(session, reply.fault, 'operator fork')
      return
    }
    // One answer for each time it was given words: the turn ended again
    // (stopped, then a step in flight finishing) says it anew.
    let turn = turnAt(entries, calls, whole)
    if (!turn?.mark) return
    let { mark } = turn
    let task = await taskOf(store, session)
    let space = (await workingOf(store, session))?.space
    let given = new Set(turn.given.map((b) => b.entity.eid))
    let requests = (await g.read(
      `.operator_request.session=${session} .order=created.at`,
    )).filter((r) => given.has(derivedEid('operator-input|' + r.entity.eid)))
    let comment = task
      ? derivedEid('operator-answer|' + mark.entity.eid)
      : undefined
    // The turn answers each request, and says so once each way it was asked
    // by: two calls' turns, or two texts, answered together hear it once.
    let carriers = new Map<string, string>()
    let answers = requests.map((r) => {
      let eid = derivedEid(`operator-answer|${r.entity.eid}|${mark.entity.eid}`)
      let route = routeOf(comp(r, 'operator_request'))
      let carrier = carriers.get(route)
      if (!carrier) carriers.set(route, eid)
      return {
        entity: { eid },
        operator_answer: {
          request: r.entity.eid,
          text: reply.text,
          ...task ? { task } : {},
          ...carrier ? { with: carrier } : {},
        },
      }
    })
    let ids = [...comment ? [comment] : [], ...answers.map((b) => b.entity.eid)]
    let kept = (await g.get(ids)).some(Boolean)
    // A conversation that could not finish reaches the tracker once, when
    // its answer is first written (M-37965).
    if (reply.fault && !kept) {
      await unfinished(session, reply.fault, 'operator conversation')
    }
    if (kept) return
    // A break's fix nobody asked for: what came of it is told to everyone
    // in the space, in their Updates (operator-updates.ts).
    let fixes = space && task
      ? requests.filter((r) => comp(r, 'operator_request')?.channel == 'error')
      : []
    // A wake-up that fired, or a subscription that saw a change, is told to
    // whoever set it, in their Updates, as what came of it: the quick word
    // when the conversation forks, and the outcome in its place when the fork
    // comes back.
    let woken = requests.filter((r) =>
      ['wake', 'subscription'].includes(
        String(comp(r, 'operator_request')?.channel),
      )
    )
    await g.apply([
      ...fixes.map((r) =>
        notification({
          to: space!,
          words: reply.text,
          about: task,
          by: space,
          id: r.entity.eid,
        })
      ),
      ...woken.map((r) =>
        notification({
          to: String(comp(r, 'operator_request')!.person),
          words: reply.text,
          by: space,
          id: r.entity.eid,
        })
      ),
      ...comment
        ? [{
          entity: { eid: comment },
          comment: { target: task },
          doc: { body: reply.text },
          $actor: { by: space ?? task, via: session },
        }]
        : [],
      ...answers,
    ], { trusted: true })
  }

  // The tools a session of this Operator is offered beside its own: the
  // person's apps through their reach, and the Operator's own doors.
  let roster = async (session: string): Promise<Tool[]> => {
    let [{ space, ctx, files }, task, [row], [using]] = await Promise.all([
      working(env, store, session, options.directory),
      taskOf(store, session),
      g.read(
        `.entity.eid=${session}&.fields=spawned.parent,fork.from,session.topic`,
      ),
      g.read(
        `.entry.session=${session} .using .order=-entry.seq .limit=1 .fields=using.provider`,
      ),
    ])
    reached('working', space)
    let persona = await spaced(g.storage, space)
    if (persona.length) await g.apply(persona, { trusted: true })
    reached('persona', persona)
    // The platform admin's sessions also read the platform: who they are is
    // read through the whole directory, which the Operator's is not.
    let whole = (options.directory ?? opening(env))()
    let [roster, google, platform] = await Promise.all([
      operatorRoster(ctx, store, { space: space.eid, tasked: !!task })
        .then((r) => reached('roster', r)),
      googleTools(env, ctx, space).then((t) => reached('google', t)),
      admin({ dir: whole, person: ctx.person! }),
    ])
    return [
      // A conversation and its forks hand coding and careful reasoning
      // to the stronger model in a fresh helper, which starts no other.
      ...!(row?.spawned && !row.fork && !topicOf(row))
        ? [
          delegated(
            comp(using, 'using')?.provider ==
              identityEid('provider', [provider]),
          ),
        ]
        : [],
      ...roster,
      platformBug(ctx, space),
      textSend(env, ctx, space),
      notificationSend(ctx, space, store),
      mailSend(env, ctx, space, store),
      phoneSend(env, ctx, space, store),
      imageNew(env, space),
      ...wakeTools(store, space),
      ...subscriptionTools(store, space, watching),
      ...google,
      ...platform ? adminTools(env, whole) : [],
      ...options.tools?.(ctx, files) ?? [],
      ...options.browsers
        ? browserTools(env, space, ctx.person, options.browsers)
        : [],
    ]
  }

  // This object's runner, a new one each time the object starts: a Durable
  // Object has one instance at a time, so a call or lease held by any other
  // was held by an instance a reset or a kill ended, and is taken up now
  // (@yaks/tools `whose`), rather than left `running` with nobody to finish it.
  let me = mint()
  let gone = (holder: string) => holder != me
  fx.handle(stepwise(running(
    g,
    lend({
      h: { g, fx, vocab, me, gone },
      providers: models,
      name,
      provider,
      // Its text is shown as it is written, once it is stored, so a reset
      // under a reply takes back none of what a person saw.
      streaming: true,
      typed: options.typing,
      context: shown,
      // The conversation forks for its work.
      tools: sessionTools(g).filter((t) => t.name == 'fork'),
      // Each ask wears the space's persona on the platform's base, read from
      // the directory (operator-persona.ts).
      wear: { bases: bases(env) },
      // A child works for the same space and person as the session that
      // started it, and is charged to that space.
      prepareChild: async ({ parent, args }) => {
        let o = await workingOf(store, parent)
        if (!o) return {}
        if (!args.topic) return { operator_session: o }
        let { ctx } = await working(env, store, parent, options.directory)
        let topic = await oracleTopic(ctx, g, String(args.topic))
        await oracleContext(ctx, g, topic)
        return {
          operator_session: o,
          session: { persona: ORACLE, topic },
        }
      },
      remote: roster,
      // The conversation and its work forks share a short topic map. Only a
      // session opened on a topic carries that topic's compiled context.
      instructions: async (session) => {
        let [{ space, ctx }, [row]] = await Promise.all([
          working(env, store, session, options.directory),
          g.read(`.entity.eid=${session}&.fields=session.topic`),
        ])
        let topic = topicOf(row)
        let [map, google] = await Promise.all([
          topic ? oracleContext(ctx, g, topic) : oracleMap(ctx, g),
          googleTold(env, ctx, space),
        ])
        return reached(
          'instructions',
          [map, told(ctx, space), google].filter(Boolean).join('\n\n'),
        )
      },
      each: async (step, session) => {
        if (!session) return
        if (ENDED.includes(step.status)) await answered(session)
        options.tell?.(session)
      },
      report: (e, where) => caught(e, { request: 'operator', ...where }),
    }),
  )))

  // Whoever carries a session on, the newest words' reach applies, and the
  // files it was given stay with it. A person's one conversation says so.
  let carrying = async (
    session: string,
    held: Asker,
    space: Space,
    o: Asking,
    conversation = false,
  ) => {
    let files = [
      ...new Map(
        [...(await workingOf(store, session))?.files ?? [], ...o.files ?? []]
          .map((f) => [f.key, f]),
      ).values(),
    ]
    return {
      entity: { eid: session },
      operator_session: {
        space: space.eid,
        person: held.person,
        ...held.administrative ? { administrative: true } : {},
        ...conversation ? { conversation } : {},
        ...files.length ? { files } : {},
      },
    }
  }
  let given = (
    session: string,
    input: string,
    body: string,
    by: string,
    o: Asking,
  ) => ({
    entity: { eid: input },
    entry: { session },
    content: { body },
    ...o.files?.length
      ? { operator_files: { request: o.request ?? input, files: o.files } }
      : {},
    ...o.channel ? { operator_channel: channelOf(o.channel, o.framing) } : {},
    ...o.call ? { operator_call: { call: o.call, asked: true } } : {},
    // An error the platform asks the Operator to fix is its own words, not
    // the person's it is said for (unseen.ts).
    ...o.channel == 'error' ? { system: {} } : {},
    using: usingOf(o.model, o.provider),
    $actor: { by, via: session },
  })
  let started = (session: string, by: string, space: Space) =>
    begin(g, undefined, {
      eid: session,
      persona: personaFor(space.eid),
      by,
      project: space.eid,
      using,
    })

  // What any words given need first: the model and persona rows, the space
  // and the person.
  let readying = async (
    held: Asker,
    space: Space,
    asked?: string,
    from?: string,
  ) => {
    let selected = await chosen(asked, from)
    await Promise.all([seeding(selected.model, selected.provider), basing()])
    await g.apply([
      ...await spaced(g.storage, space),
      { entity: { eid: held.person }, person: {} },
    ], { trusted: true })
    return selected
  }

  let ask: Operator['ask'] = async (held, space, args, o = {}) => {
    let text = typeof args.say == 'string' ? args.say : ''
    let named = typeof args.task == 'string' ? args.task : o.task
    if (!text.trim()) throw refuse('arguments', 'say what you want done')
    let by = o.by ?? held.person
    let input = o.request
      ? derivedEid('operator-input|' + o.request)
      : crypto.randomUUID()
    o = { ...o, ...await readying(held, space, o.model, o.provider) }
    let { reference, file: sourceFile } = await messageReference(
      env,
      space,
      o.source ?? String(args.say ?? ''),
    )
    // A person's words with no task are the next input of their one
    // conversation with the Operator.
    if (!named) {
      let session = await rootAt(store, space.eid, held.person)
      if ((await g.get([input]))[0]) return { task: '', session, input }
      if (!await conversed(store, session)) {
        await started(session, held.person, space)
      }
      await g.apply([
        await carrying(session, held, space, o, true),
        given(session, input, text + reference, by, o),
        ...attachmentRows(o.request ?? input, [
          ...o.files ?? [],
          ...sourceFile ? [sourceFile] : [],
        ]),
      ], { trusted: true })
      options.tell?.(session)
      return { task: '', session, input }
    }
    let task = named
    let [old] = await g.get([task])
    if (args.task && !old?.task) {
      throw refuse('missing', `no operator task ${task}`)
    }
    let links = old ? await g.read(`.contains .edge.from=${task}`) : []
    let newest = (await g.get(links.map((b) => String(comp(b, 'edge')!.to))))
      .filter((b) => b.session)
      .sort((a, b) =>
        String(comp(a, 'created')?.at).localeCompare(
          String(comp(b, 'created')?.at),
        )
      ).at(-1)
    let session = newest?.entity.eid ?? o.session ?? crypto.randomUUID()
    if ((await g.get([input]))[0]) return { task, session, input }
    await g.apply([
      old ? { entity: { eid: task }, completed: null, cancelled: null } : {
        entity: { eid: task },
        task: {},
        doc: { title: text.split('\n')[0].slice(0, 160), body: text },
        filed: { project: space.eid },
        $actor: { by },
      },
    ], { trusted: true })
    if (!newest) {
      await started(session, by, space)
      await g.apply([{
        entity: { eid: crypto.randomUUID() },
        edge: { from: task, to: session },
        contains: {},
      }])
    }
    let [row] = await g.get([task])
    await g.apply([
      await carrying(session, held, space, o),
      ...old
        ? [{
          entity: { eid: derivedEid('operator-comment|' + input) },
          comment: { target: task },
          doc: { body: text },
          $actor: { by },
        }]
        : [],
      ...attachmentRows(o.request ?? input, [
        ...o.files ?? [],
        ...sourceFile ? [sourceFile] : [],
      ]),
      given(
        session,
        input,
        (newest ? text : JSON.stringify({ task: row })) + reference,
        by,
        o,
      ),
    ], { trusted: true })
    options.tell?.(session)
    return { task, session, input }
  }

  // A call its talking model hears and speaks goes to the person's
  // conversation as passive context, starting no turn of the Operator's own
  // model: where it began, then each line as it was said, the caller's as
  // their words by phone and the talking model's as the Operator's own
  // (`notice.own`), so its next turn reads what it said as said by itself.
  let note: Operator['note'] = async (held, space, text, o) => {
    let { session, fresh } = await conversing(held, space)
    let line = o.said ? { content: { body: text }, notice: { own: true } } : {
      content: { body: o.began ? CALLED : HEARD + text },
      notice: {},
      operator_channel: channelOf('voice', o.began ? '' : HEARD),
    }
    await g.apply([
      ...fresh ? [fresh] : [],
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        ...line,
        operator_call: {
          call: o.call,
          ...o.said ? { said: true } : {},
          ...o.began ? { began: true } : {},
        },
        $actor: { by: o.said ? space.eid : held.person, via: session },
      },
    ], { trusted: true })
    options.tell?.(session)
  }

  // The person's one conversation, begun where it has not been: `fresh` is
  // then what it carries on with, for the caller's write to apply.
  let conversing = async (held: Asker, space: Space) => {
    let session = await rootAt(store, space.eid, held.person)
    if (await conversed(store, session)) return { session }
    await readying(held, space)
    await started(session, held.person, space)
    return { session, fresh: await carrying(session, held, space, {}, true) }
  }

  // What another model working for the person is offered (a call's backend
  // on OpenAI's side, operator-calls.ts): the tools their conversation is
  // offered, through their reach in the space, each run as a call of that
  // conversation. Starting helpers is the conversation's own, so it is left
  // out.
  let tools: Operator['tools'] = async (held, space) => {
    let { session, fresh } = await conversing(held, space)
    if (fresh) await g.apply([fresh], { trusted: true })
    let offered = (await roster(session)).filter((t) => t.name != spawn.name)
    let named = new Map(offered.map((t) => [t.name, t]))
    return {
      tools: offered.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      })),
      run: async (name, args) => {
        let tool = named.get(name)
        if (!tool) {
          throw new CallError('tool', `There is no tool called ${name}.`)
        }
        let call = {
          entity: { eid: crypto.randomUUID() },
          call: { to: name, args },
        }
        let told = await tool.run(args, { session, call, entries: [] })
        return typeof told == 'string' ? told : told.text
      },
    }
  }

  // An agent asking through operator_run waits on one answer, so its words
  // are a task of their own rather than a person's conversation.
  let run: Operator['run'] = async (held, space, args, o = {}) => {
    let files = await attached(store, held, space, args.attachments)
    let selected = await chosen(
      o.model ?? (typeof args.model == 'string' ? args.model : undefined),
      o.provider ??
        (typeof args.provider == 'string' ? args.provider : undefined),
    )
    if (typeof args.model == 'string' && selected.model != args.model) {
      throw await unknown(args.model, selected.provider)
    }
    let { task, session, input } = await ask(held, space, args, {
      task: crypto.randomUUID(),
      ...selected,
      ...files.length ? { files } : {},
      ...o,
    })
    let entries = await transcript(g, session)
    while (!ENDED.includes(statusOf(entries))) {
      let next = await drain(store)
      entries = await transcript(g, session)
      if (ENDED.includes(statusOf(entries)) || next == null) break
      await new Promise((ok) =>
        setTimeout(ok, Math.min(1000, Math.max(0, next - Date.now())))
      )
    }
    let mine = entries.slice(entries.findIndex((b) => b.entity.eid == input))
    return {
      task,
      session,
      text: replyOf(mine).text,
      status: statusOf(entries),
      cost: mine.reduce(
        (sum, b) => sum + Number(comp(b, 'cost')?.dollars ?? 0),
        0,
      ),
      model: selected.model,
    }
  }

  // The harness's interrupt (runtime.ts): a stop that withdraws the step in
  // flight, its model request or tool call, and that no step goes on past
  // (@yaks/session run.ts `withdrawn`). A person's conversation stops with
  // the helpers working for it.
  let stop: Operator['stop'] = async (open, by) => {
    let [row] = await g.get([open])
    let links = row?.task ? await g.read(`.contains .edge.from=${open}`) : []
    let newest = row?.session ? row : (await g.get(
      links.map((b) => String(comp(b, 'edge')!.to)),
    ))
      .filter((b) => b?.session)
      .sort((a, b) =>
        String(comp(a, 'created')?.at).localeCompare(
          String(comp(b, 'created')?.at),
        )
      ).at(-1)
    if (!newest) throw refuse('missing', `no operator conversation ${open}`)
    let session = newest.entity.eid
    // Every helper under it, however deep: a helper a helper started works
    // for the same conversation.
    let helpers: string[] = []
    for (let parents = row?.session ? [session] : []; parents.length;) {
      parents = (await g.read(`.spawned.parent=${parents.join(',')}`))
        .map((b) => b.entity.eid)
      helpers.push(...parents)
    }
    // Each one's status as the store computes it (`session.status`): a tree
    // of hundreds read transcript by transcript cost more CPU than a request
    // has.
    let busy: string[] = [], idle: string[] = []
    for (let b of await g.get([session, ...helpers], ['session'])) {
      let status = comp(b, 'session')?.status
      if (status == 'pending' || status == 'running') busy.push(b.entity.eid)
      else if (status != 'stopped') idle.push(b.entity.eid)
    }
    if (!busy.length) {
      return { task: open, session, stopped: false }
    }
    // One waiting on a helper stops too, so the helper's report does not
    // wake it again (@yaks/session children.ts `deliverChild`).
    await g.apply(
      [...busy, ...idle].map((s) => ({
        entity: { eid: crypto.randomUUID() },
        entry: { session: s },
        stop: {},
        content: { body: 'Stopped by the person watching.' },
        $actor: { by, via: s },
      })),
      { trusted: true },
    )
    if (busy.includes(session)) await answered(session)
    options.tell?.(session)
    return { task: open, session, stopped: true }
  }

  // What to call a person in what the Operator shows of its work.
  let named = (person: string) => dir().nameAt(person)

  return { store, reads, ask, note, tools, run, stop, named, watching }
}

export type Asking = {
  // Who the task and its session are by: the person asking, unless the
  // Operator started the work itself (a break, unseen.ts `fix`).
  by?: string
  // The request the words came in, which makes giving them again a no-op.
  request?: string
  // Exact original words before channel framing or attachment extraction.
  source?: string
  // The task the words carry on; without one they go to the person's
  // conversation with the Operator (`rootAt`).
  task?: string
  // The session a new task starts, for a replay to find.
  session?: string
  files?: File[]
  // The channel the words came by, and what the model is told before them
  // of how they came (operator-channels.ts `BY`), which the conversation
  // leaves out of the person's words.
  channel?: string
  framing?: string
  // The call whose talking model asked in these words, for the caller.
  call?: string
  // The model that answers these words, where not the Operator's own (a
  // call's, speech.ts `setupOf`); one its provider does not serve is
  // answered by the Operator's own.
  model?: string
  provider?: string
}
type Asker = Pick<Held, 'person' | 'administrative'>
export type Operator = {
  store: Store
  /** What its model reads as it is, beside text (@yaks/model `Model.reads`). */
  reads: (model?: string, provider?: string) => Promise<Record<string, number>>
  /** Words given: the next input of the person's conversation, or on a task
   * a new task and session or the next input of the task's newest session.
   * Answers at once with where they went (`task` is '' in a conversation). */
  ask: (
    held: Asker,
    space: Space,
    args: Args,
    o?: Asking,
  ) => Promise<{ task: string; session: string; input: string }>
  /** A line of a call its talking model hears and speaks: the caller's
   * words, its talking model's (`said`), or that the call began (`began`),
   * kept in the person's conversation as passive context, starting no turn. */
  note: (
    held: Asker,
    space: Space,
    text: string,
    o: { call: string; said?: boolean; began?: boolean },
  ) => Promise<void>
  /** The tools the person's conversation is offered, for another model
   * working for them to call through the same reach: each `run` answers in
   * words, and refuses with a CallError as a tool does. */
  tools: (held: Asker, space: Space) => Promise<{
    tools: { name: string; description: string; parameters: object }[]
    run: (name: string, args: Record<string, unknown>) => Promise<string>
  }>
  /** Stop a conversation (with its helpers) or a task's running session at
   * once, the step in flight included: nothing more is done until new words
   * reopen it. */
  stop: (
    open: string,
    by: string,
  ) => Promise<{ task: string; session: string; stopped: boolean }>
  /** operator_run's door: the words, then the answer once the session ends,
   * working the pool meanwhile as the object's alarm does. */
  run: (held: Asker, space: Space, args: Args, o?: Asking) => Promise<{
    task: string
    session: string
    text: string
    status: string
    cost: number
    model: string
  }>
  /** What to call a person, as the page names them (directory `nameAt`). */
  named: (person: string) => Promise<string | null>
  /** A subscription's query, read as the person who set it. */
  watching: Watching
}
