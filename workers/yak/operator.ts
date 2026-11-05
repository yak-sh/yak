import {
  type Bundle,
  type Comp,
  type Graph,
  identityEid,
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
} from '@yaks/session'
import { derivedEid } from '@yaks/graph/identity'
import { LIMIT } from '@yaks/session/status'
import { HEARD, SAID } from './operator-view.ts'
import { listing } from '@yaks/mcp'
import { billed, type Item, type Model, type Price } from '@yaks/model'
import { workersAi } from '@yaks/workers-ai'
import { claude, providerOf, readsOf } from './claude.ts'
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
import { type Args, type Ctx, refuse } from './tool.ts'
import { bound, type Env } from './env.ts'
import type { Held } from './build-door.ts'
import { accounted } from './meter.ts'
import { caught, defect } from './defects.ts'
import { ambient, counts, type Tally, tallying } from './lib/hops.ts'
import { drain, type operatorStore } from './operator-store.ts'
import {
  asIs,
  type File,
  mailSend,
  rootOf,
  SHOWN,
  starting,
} from './operator-channels.ts'
import { textSend } from './operator-texts.ts'
import { phoneSend } from './operator-line.ts'
import { googleTold, googleTools } from './operator-google.ts'
import { notification } from './operator-updates.ts'
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
  oracular,
  TOPIC,
  topicOf,
} from './operator-oracles.ts'

type Store = ReturnType<typeof operatorStore>
export type Options = {
  directory?: () => Directory
  model?: Model
  name?: string
  price?: Price
  tools?: (ctx: Ctx, files: File[]) => Tool[]
  // Told each time a session moved (a step landed, words were given), so a
  // page watching it hears at once (the Builder object's socket).
  tell?: (session: string) => void
  // Told each piece of a reply as the model writes it.
  typing?: (session: string, text: string) => void
  // Told when a model's step ends, its words written (before a tool call it
  // asked for, or its answer).
  stepped?: (session: string) => void
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
    "You talk with each person in one conversation that lasts for weeks: every message they send you, in the chat app, by email or by text, arrives there, marked with how it came when not by chat. Keep the conversation itself light. For anything that needs a tool (reading or changing apps, rows, files or code), use fork with a short prompt saying what to do, then reply at once in a sentence saying what you are doing, and nothing more; your reply goes to them the way their message came. When a fork comes back, tell them in a few lines what was done or what is needed from them. Answer without a fork only what needs no tool.\n\nWhen you were started for a piece of work (a fork, a helper, or a task), do the work with your tools, using the space's existing apps and rows, then end with a short report of what changed and the next step, for the conversation or the task to pass on.",
}

// What a session carrying on a task is told, where it is given the tool that
// closes it.
let ON_TASK =
  ' This session carries on that task: its conversation and tools are recorded on it. Set status done on it only when the requested work is finished; leave it open when asking a question, reporting a limit, or explaining unfinished work.'

// What every session is told where it is given the tool that asks the person
// it works for to choose (operator-updates.ts).
let ASKING =
  ' Ask the person you work for: the question reaches them in their Updates under Needs you, with a button for each choice, and what they choose comes back to you in your conversation with them. Use it for a choice that is theirs to make (spending money, sending to people, deleting), not to confirm routine work.'

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
    description: t.description,
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
// nothing in the app to get around it.
let platformBug = (space: Space): Tool => ({
  name: 'platform_bug',
  title: 'Report a yaks.app fault',
  step: {
    doing: 'Telling the yaks.app team about a fault…',
    done: 'Told the yaks.app team about a fault',
  },
  description:
    "Report that yaks.app itself is at fault, not the app's own files: a tool that answered wrongly, a refusal the guide says should pass, a deploy that lost what was sent. Say what you did, what yaks.app answered, and why the app is not the cause. It reaches the people who run yaks.app; leave the app as it is.",
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What is wrong in yaks.app.' },
      app: { type: 'string', description: 'The app it happened in.' },
    },
    required: ['text'],
  },
  run: (args) => {
    let text = String(args.text ?? '').trim()
    if (!text) throw refuse('arguments', 'say what is wrong in yaks.app')
    defect(Error(text), {
      request: 'operator found a platform fault',
      space: space.slug,
      ...typeof args.app == 'string' ? { app: args.app } : {},
    })
    return Promise.resolve('Reported to the people who run yaks.app.')
  },
})

// The Operator's own model, by default and with the key: Sonnet, which hands
// coding and tricky work to Opus. Without the key it stays on GLM.
let SONNET = 'claude-sonnet-5-5'
let OPUS = 'claude-opus-5-5'
let GLM = '@cf/zai-org/glm-5.3'

/** What serves the Operator's models: Workers AI through the binding, or
 * Anthropic with the platform's key. */
export let operatorModel = (env: Env, provider: string): Model =>
  provider == 'workers-ai'
    ? workersAi(env.AI!, { fetch: env.MODEL_FETCH, gateway: env.AI_GATEWAY })
    : provider == 'anthropic'
    ? claude(env)
    : Object.assign(
      () =>
        Promise.reject(
          new Error(
            'The operator needs a Workers AI or Anthropic model in OPERATOR_MODEL',
          ),
        ),
      { info: () => Promise.resolve(undefined) },
    )

export let readOperator = async (
  { g }: Store,
  task?: string,
  context = false,
) => {
  if (!task) {
    return { tasks: await g.read('.task ?doc .order=-created.at .limit=20') }
  }
  let [row] = await g.get([task])
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
    entries: context
      ? entries
      : entries.map(({ sending: _sending, ...entry }) => entry),
  }
}

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
  let [row] = await g.get([session])
  return comp(row, 'operator_session') as Working | undefined
}
// The space an ask is charged to: its session's, or for an exchange a session
// has on its own behalf (a compaction's summary, whose session is sourced by a
// call from an entry of the one it compacts), the space of that session.
let payerOf = async ({ g }: Store, ask?: string) => {
  for (let eid = ask, hops = 0; eid && hops < 4; hops++) {
    let [row] = await g.get([eid])
    let session = comp(row, 'entry')?.session
    let [held] = session ? await g.get([String(session)]) : []
    let o = comp(held, 'operator_session') as Working | undefined
    if (o) return o.space
    let source = comp(held, 'session')?.source
    let [call] = source ? await g.get([String(source)]) : []
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
let begun = new WeakMap<Tally, number>()
let stepwise = (handlers: Handlers): Handlers =>
  Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      (...args: Parameters<typeof handler>) => {
        let tally: Tally = new Map()
        begun.set(tally, Date.now())
        return tallying(tally, () => handler(...args))
      },
    ]),
  )

// When a step first finished each stage on its way to the model, in ms from
// its start, logged beside its count (`asked`): which stage a slow ask waited
// on, since the waits a tally sums overlap.
let reached = <T>(stage: string, value: T): T => {
  let tally = ambient()
  let at = tally && begun.get(tally)
  if (tally && at != null && !tally.has(`at_${stage}`)) {
    tally.set(`at_${stage}`, Date.now() - at)
  }
  return value
}

// How long a step took to ask its model, and the round trips it made on the
// way, in the Worker's logs: store hops, bucket reads, and trips to the cached
// Files door (files.ts `door`).
let asked = (session?: string) => {
  let tally = ambient()
  let at = tally && begun.get(tally)
  if (!tally || at == null) return
  console.log(
    'yak operator ask',
    JSON.stringify({
      session,
      ms: Date.now() - at,
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
  let [row] = await store.g.get([session])
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

// The inputs a turn ending at `end` answers: each line given since the reply
// before it. A helper's result stands for the inputs of the turn that started
// it, so its answer goes where they came from.
// `calls` names the call that started each child (`spawned{parent, call}`).
export let origins = (
  entries: Bundle[],
  end: number,
  calls: Map<string, string>,
): Bundle[] => {
  let from = entries.findLastIndex((b, i) =>
    i < end && kindOf(b) == 'output' && !!b.content
  )
  return entries.slice(from + 1, end).filter((b) => kindOf(b) == 'input')
    .flatMap((b) => {
      let child = comp(b, 'delivery')?.child
      if (!child) return [b]
      let call = entries.findIndex((c) =>
        c.entity.eid == calls.get(String(child))
      )
      return call < 0 ? [] : origins(entries, call, calls)
    })
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
 * ```
 */
export let replyOf = (
  entries: Bundle[],
): { text: string; fault?: string } => {
  let end = ordered(entries).findLast((b) =>
    b.content && (b.output || b.refusal || b.exception) || b.failed ||
    kindOf(b) == 'stop'
  )
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

// The entries since the newest words given: the turn being answered.
let turnOf = (entries: Bundle[]) =>
  entries.slice(
    Math.max(0, entries.findLastIndex((b) => kindOf(b) == 'input')),
  )

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
  let name = options.name ?? env.OPERATOR_MODEL ??
    (env.ANTHROPIC_API_KEY ? SONNET : env.BUILDER_MODEL_PAID ?? GLM)
  let provider = providerOf(name)
  // Coding and tricky work go to a stronger model of the same provider, in a
  // child session (`spawn`) whose answer comes back to the one that asked.
  let delegate = provider == 'anthropic'
    ? env.OPERATOR_DELEGATE ?? OPUS
    : undefined
  let spawn = sessionTools(g, { childProperties: { topic: TOPIC } })
    .find((t) => t.name == 'spawn')!
  let delegated: Tool = {
    ...spawn,
    description:
      `${spawn.description} To consult an app or space oracle, supply topic from the Oracles map and the question as prompt. Its answer comes back automatically.` +
      (delegate
        ? ` For writing or fixing code, or work that needs careful reasoning, use spawn with model ${delegate} and a prompt that carries everything it needs; its answer comes back to you.`
        : ''),
  }
  // The model an input asks for: one its provider serves, else the
  // Operator's own.
  let usingOf = (model = name) => ({
    provider: identityEid('provider', [provider]),
    model: identityEid('model', [providerOf(model) == provider ? model : name]),
  })
  let using = usingOf()
  let base = options.model ?? operatorModel(env, provider)
  let reads = readsOf(provider)
  // A file's key is the digest of its bytes, so the bytes the last step
  // showed are kept for the next, which shows them again: a wake reads each
  // file once, and the files of one step all at once.
  let bytes = new Map<string, Promise<Uint8Array>>()
  let bytesOf = (file: File) => {
    let held = bytes.get(file.key) ?? env.BLOBS.get(file.key).then((kept) => {
      if (!kept) throw new Error('Operator attachment is missing: ' + file.name)
      return kept.arrayBuffer().then((b) => new Uint8Array(b))
    })
    bytes.set(file.key, held)
    held.catch(() => bytes.delete(file.key))
    return held
  }
  // The files the model reads as they are, shown beside the words they came
  // with: the newest first, until SHOWN bytes are in the request; one past
  // that is named instead, and its words still say what it held.
  let shown = async (window: Bundle[]) => {
    let out = new Map<string, Item[]>()
    let room = SHOWN
    let wanted: File[] = []
    let placed: [string, (File | Item)[]][] = []
    for (let entry of [...window].reverse()) {
      let files = (comp(entry, 'operator_files')?.files ?? []) as File[]
      let items: (File | Item)[] = []
      for (let file of files.filter((f) => asIs(reads, f))) {
        if (file.size! > room) {
          items.push({
            kind: 'user',
            text:
              `${file.name} was attached earlier, and is not shown again beside the newer files.`,
          })
          continue
        }
        room -= file.size!
        wanted.push(file)
        items.push(file)
      }
      if (items.length) placed.push([entry.entity.eid, items])
    }
    let read = new Map(
      await Promise.all(
        wanted.map(async (f) => [f.key, await bytesOf(f)] as const),
      ),
    )
    for (let key of bytes.keys()) if (!read.has(key)) bytes.delete(key)
    for (let [eid, items] of placed) {
      out.set(
        eid,
        items.map((i): Item =>
          'key' in i
            ? {
              kind: i.mime == 'application/pdf' ? 'document' : 'image',
              bytes: read.get(i.key)!,
              mediaType: i.mime,
              label: 'Attached: ' + i.name,
            }
            : i
        ),
      )
    }
    return out
  }
  // A model's price, from what its provider lists, asked once per name.
  let prices = new Map<string, Promise<Price | undefined>>()
  let priced = (model: string) => {
    if (options.price) return Promise.resolve(options.price)
    let held = prices.get(model) ??
      Promise.resolve(base.info?.(model)).then((info) => info?.price)
    prices.set(model, held)
    held.catch(() => prices.delete(model))
    return held
  }
  // Each ask is charged to the space of the session asking, at the price of
  // the model it asks.
  let model: Model = Object.assign(async (req: Parameters<Model>[0]) => {
    reached('request', req)
    let [price, [ask], space] = await Promise.all([
      priced(req.model),
      req.call ? g.get([req.call]) : [],
      payerOf(store, req.call),
    ])
    if (!options.model && !price) {
      throw new Error(`No catalogue price for operator model ${req.model}`)
    }
    reached('payer', space)
    let session = comp(ask, 'entry')?.session
    let heard = req.onText
    let reply = await accounted(
      env,
      (dir) => space ? dir.at(space) : Promise.resolve(null),
      base,
      () => Promise.resolve(price),
    )({
      ...req,
      onSubmit: async () => {
        await req.onSubmit?.()
        asked(session ? String(session) : undefined)
      },
      ...heard
        ? {
          onText: (delta) => {
            heard(delta)
            if (session) options.typing?.(String(session), delta.text)
          },
        }
        : {},
    })
    if (session && heard) options.stepped?.(String(session))
    let cost = billed(reply, price)
    return { ...reply, cost: cost?.dollars, costReported: cost?.reported }
  }, base)
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
    ]).catch((e) => {
      based = undefined
      caught(e, { request: 'operator base persona' })
    })
  // Each model's rows, written once per wake: the Operator's own and its
  // delegate's, and one an input asks for when it first does. A price is
  // written when its catalogue answers, which no turn waits on: the ask that
  // needs it waits on the same lookup, already in flight, and refuses if it
  // fails.
  let seeded = new Map<string, Promise<void>>()
  let seedOf = (m: string) => {
    let held = seeded.get(m) ?? (async () => {
      priced(m).then(
        async (price) => {
          if (!price) return
          await g.apply(
            [{ entity: { eid: identityEid('model', [m]) }, price }],
            {
              trusted: true,
            },
          )
        },
        () => {},
      ).catch((e) => caught(e, { request: 'operator model price' }))
      await g.apply(seed({ provider, model: m }), { trusted: true })
    })()
    seeded.set(m, held)
    held.catch(() => seeded.delete(m))
    return held
  }
  let seeding = (model?: string) =>
    Promise.all(
      [name, delegate, model && providerOf(model) == provider ? model : null]
        .filter((m): m is string => !!m)
        .map(seedOf),
    )

  // The session's answer, once its turn ends: an answer to each request the
  // turn answers, which its channel delivers (operator_deliver), and on a
  // task's session a comment on its task. A request's words, and a helper's
  // result standing for the words that started it, are answered on the
  // channel they came by: a quick word when the conversation forks, and the
  // outcome when the fork comes back. A helper's end is told to the session
  // that started it, not to the person.
  let answered = async (session: string) => {
    let [row] = await g.get([session])
    if (row?.spawned) return
    let entries = ordered(await transcript(g, session))
    let reply = replyOf(turnOf(entries))
    // One answer for each time it was given words: the turn ended again
    // (stopped, then a step in flight finishing) says it anew.
    let mark = entries.findLast((b) => kindOf(b) == 'input')
    if (!mark) return
    let task = await taskOf(store, session)
    let space = (await workingOf(store, session))?.space
    let children = await g.get([
      ...new Set(
        entries.flatMap((b) => {
          let child = comp(b, 'delivery')?.child
          return child ? [String(child)] : []
        }),
      ),
    ])
    let calls = new Map(
      children.filter((b) => b?.spawned).map((
        b,
      ) => [b.entity.eid, String(comp(b, 'spawned')!.call)]),
    )
    // The turn ends at its reply, or where the transcript does when it
    // ended without one (stopped, failed).
    let said = entries.findLastIndex((b) =>
      kindOf(b) == 'output' && !!b.content
    )
    let end = said > entries.indexOf(mark) ? said : entries.length
    let given = new Set(origins(entries, end, calls).map((b) => b.entity.eid))
    let requests = (await g.read(`.operator_request.session=${session}`))
      .filter((r) => given.has(derivedEid('operator-input|' + r.entity.eid)))
    let comment = task
      ? derivedEid('operator-answer|' + mark.entity.eid)
      : undefined
    let answers = requests.map((r) => ({
      entity: {
        eid: derivedEid(`operator-answer|${r.entity.eid}|${mark.entity.eid}`),
      },
      operator_answer: {
        request: r.entity.eid,
        text: reply.text,
        ...task ? { task } : {},
      },
    }))
    let ids = [...comment ? [comment] : [], ...answers.map((b) => b.entity.eid)]
    let kept = (await g.get(ids)).some(Boolean)
    // A conversation that could not finish reaches the tracker once, when
    // its answer is first written (M-37965).
    if (reply.fault && !kept) {
      let slug = space ? (await dir().at(space))?.slug : null
      defect(Error(`Operator could not finish: ${reply.fault}`), {
        request: 'operator conversation',
        session,
        space: slug,
      })
    }
    if (kept) return
    // A break's fix nobody asked for: what came of it is told to everyone
    // in the space, in their Updates (operator-updates.ts).
    let fixes = space && task
      ? requests.filter((r) => comp(r, 'operator_request')?.channel == 'error')
      : []
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

  fx.handle(stepwise(running(
    g,
    lend({
      h: { g, fx, vocab, me: identityEid('operator', ['runner']) },
      model,
      name,
      provider,
      // Its text is shown as it is written (@yaks/session run.ts `step`).
      streaming: true,
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
        let topic = String(args.topic)
        await oracleContext(ctx, g, topic)
        return {
          operator_session: o,
          session: { persona: ORACLE, topic },
        }
      },
      remote: async (session) => {
        let [{ space, ctx, files }, task, [row]] = await Promise.all([
          working(env, store, session, options.directory),
          taskOf(store, session),
          g.get([session]),
        ])
        reached('working', space)
        let persona = await spaced(g.storage, space)
        if (persona.length) await g.apply(persona, { trusted: true })
        reached('persona', persona)
        let [roster, google] = await Promise.all([
          operatorRoster(ctx, store, { space: space.eid, tasked: !!task })
            .then((r) => reached('roster', r)),
          googleTools(env, ctx, space).then((t) => reached('google', t)),
        ])
        return [
          // A conversation and its forks hand coding and careful reasoning
          // to the stronger model in a fresh helper, which starts no other.
          ...!(row?.spawned && !row.fork && !topicOf(row)) ? [delegated] : [],
          ...roster,
          platformBug(space),
          textSend(env, ctx, space),
          mailSend(env, ctx, space, store),
          phoneSend(env, ctx, space, store),
          ...google,
          ...options.tools?.(ctx, files) ?? [],
        ]
      },
      // The conversation and its work forks share a short topic map. Only a
      // session opened on a topic carries that topic's compiled context.
      instructions: async (session) => {
        let [{ space, ctx }, [row]] = await Promise.all([
          working(env, store, session, options.directory),
          g.get([session]),
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
  // files it was given stay with it.
  let carrying = async (
    session: string,
    held: Asker,
    space: Space,
    o: Asking,
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
    ...o.request && o.files?.length
      ? { operator_files: { request: o.request, files: o.files } }
      : {},
    using: usingOf(o.model),
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
  let readying = async (held: Asker, space: Space, model?: string) => {
    await Promise.all([seeding(model), basing()])
    await g.apply([
      ...await spaced(g.storage, space),
      { entity: { eid: held.person }, person: {} },
    ], { trusted: true })
  }

  let ask: Operator['ask'] = async (held, space, args, o = {}) => {
    let text = typeof args.say == 'string' ? args.say.trim() : ''
    let named = typeof args.task == 'string' ? args.task : o.task
    if (!text) throw refuse('arguments', 'say what you want done')
    let by = o.by ?? held.person
    let input = o.request
      ? derivedEid('operator-input|' + o.request)
      : crypto.randomUUID()
    await readying(held, space, o.model)
    // A person's words with no task are the next input of their one
    // conversation with the Operator.
    if (!named) {
      let session = rootOf(space.eid, held.person)
      if ((await g.get([input]))[0]) return { task: '', session, input }
      if (!(await g.get([session]))[0]?.session) {
        await started(session, held.person, space)
      }
      await g.apply([
        await carrying(session, held, space, o),
        given(session, input, text, by, o),
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
      given(
        session,
        input,
        newest ? text : JSON.stringify({ task: row }),
        by,
        o,
      ),
    ], { trusted: true })
    options.tell?.(session)
    return { task, session, input }
  }

  // What was said on a call its talking model answered itself goes to the
  // person's conversation as passive context: the Operator reads it the next
  // time it is asked, and no turn of its own model starts for it. Its words
  // say who spoke, as a notice is read as the person's side.
  let note: Operator['note'] = async (held, space, text, o) => {
    let session = rootOf(space.eid, held.person)
    let fresh = !(await g.get([session]))[0]?.session
    if (fresh) {
      await readying(held, space)
      await started(session, held.person, space)
    }
    await g.apply([
      ...fresh ? [await carrying(session, held, space, {})] : [],
      {
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        content: { body: (o.said ? SAID : HEARD) + text },
        notice: {},
        operator_call: { call: o.call, ...o.said ? { said: true } : {} },
        $actor: { by: o.said ? space.eid : held.person, via: session },
      },
    ], { trusted: true })
    options.tell?.(session)
  }

  // An agent asking through operator_run waits on one answer, so its words
  // are a task of their own rather than a person's conversation.
  let run: Operator['run'] = async (held, space, args, o = {}) => {
    let { task, session, input } = await ask(held, space, args, {
      task: crypto.randomUUID(),
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
      model: name,
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
    let helpers = row?.session
      ? (await g.read(`.spawned.parent=${session}`)).map((b) => b.entity.eid)
      : []
    let busy = []
    for (let s of [session, ...helpers]) {
      let status = statusOf(await transcript(g, s))
      if (['pending', 'running'].includes(status)) busy.push(s)
    }
    if (!busy.length) {
      return { task: open, session, stopped: false }
    }
    await g.apply(
      busy.map((s) => ({
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

  return { store, reads, ask, note, run, stop, named }
}

export type Asking = {
  // Who the task and its session are by: the person asking, unless the
  // Operator started the work itself (a break, unseen.ts `fix`).
  by?: string
  // The request the words came in, which makes giving them again a no-op.
  request?: string
  // The task the words carry on; without one they go to the person's
  // conversation with the Operator (`rootOf`).
  task?: string
  // The session a new task starts, for a replay to find.
  session?: string
  files?: File[]
  // The model that answers these words, where not the Operator's own (a
  // call's, speech.ts `setupOf`); one its provider does not serve is
  // answered by the Operator's own.
  model?: string
}
type Asker = Pick<Held, 'person' | 'administrative'>
export type Operator = {
  store: Store
  /** What its model reads as it is, beside text (claude.ts `readsOf`). */
  reads: Record<string, number>
  /** Words given: the next input of the person's conversation, or on a task
   * a new task and session or the next input of the task's newest session.
   * Answers at once with where they went (`task` is '' in a conversation). */
  ask: (
    held: Asker,
    space: Space,
    args: Args,
    o?: Asking,
  ) => Promise<{ task: string; session: string; input: string }>
  /** Words said on a call that asked the Operator nothing, the caller's or
   * (`said`) its talking model's: kept in the person's conversation as
   * passive context, starting no turn. */
  note: (
    held: Asker,
    space: Space,
    text: string,
    o: { call: string; said?: boolean },
  ) => Promise<void>
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
}
