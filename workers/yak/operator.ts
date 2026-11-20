import { line as q, whole as wholeLine } from '@yaks/query'
import { inputSource } from './operator-provenance.ts'
import { chatFork } from './operator-chat.ts'
import { questionNotice } from './operator-helpers.ts'
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
import type { Conversing } from '@yaks/harness/conversations'
import { skillItems, skillRead } from '@yaks/harness/skills'
import {
  answerOf,
  type ChildLimits,
  grafted,
  inputOf,
  type Intake,
  recall,
  running,
  sessionTools,
  take,
  taskSession,
  type Tool,
  topOf,
  transcript,
  usingOf as usingIn,
} from '@yaks/session'
import { derivedEid } from '@yaks/graph/identity'
import { short } from '@yaks/id'
import { CALLED, channelOf, HEARD } from './operator-view.ts'
import { cameBy } from './operator-draw.ts'
import { fetchable } from './newcomer.ts'
import { listing } from '@yaks/mcp'
import {
  type Listed,
  type Model,
  ModelError,
  modelReads,
  modelResults,
  onward,
  type Price,
  type Request as Step,
} from '@yaks/model'
import { forwarding, PATH } from '@yaks/model/step'
import { AWAY, falling, MACHINE, namesFor } from './operator-machine.ts'
import type { Calling } from '@yaks/tunnel/hosted'
import { platform, ready, served } from './providers.ts'
import { artifactsOf } from '@yaks/blob/attachment'
import { attached, fileContext } from './operator-inputs.ts'
import { agents, operatorProviders } from './config.ts'
import { inputSchemaOf } from '@yaks/tools/schema'
import { CallError, invoke, runner as toolRunner } from '@yaks/tools'
import { loadTools, textSearch } from '@yaks/graph/tools'
import { memoryDoc } from '@yaks/memory/vocab'
import { trialDoc } from '@yaks/trial/vocab'
import { type Options as Trials, runs as trialRuns } from '@yaks/trial/tools'
import { ORACLE } from '@yaks/topic'
import { runs as memoryRuns } from '@yaks/memory/tools'
import { held, workNames } from './operator-tasks.ts'
import { worded } from '@yaks/tools'
import { keepResult, resultValue } from './results.ts'
import { outputView } from '@yaks/context'
import type { Handlers } from '@yaks/effects'
import {
  type Directory,
  directory,
  directoryOf,
  type Reach,
  type Role,
  type Space,
} from './directory.ts'
import * as directoryPart from './directory.ts'
import { copyOf } from './directory-copy.ts'
import { narrowed } from './grants.ts'
import { reachOf } from './operator-reach.ts'
import { conversant, seenBy } from './operator-access.ts'
import { NAMING } from './operator-conversations.ts'
import { writes } from '@yaks/member'
import { inReach } from './declared.ts'
import { connected, reaching } from './agent.ts'
import { coded } from './agent-code.ts'
import { connectedInstructions, connectedTools } from './connected-mcp.ts'
import { decisionRelay, relayTools, waitingOn } from './operator-relay.ts'
import { ledger } from './ledger.ts'
import { admin, type Args, type Ctx, inSpace, refuse } from './tool.ts'
import type { Caller } from './session.ts'
import { adminTools } from './operator-admin.ts'
import { platformFault } from './unseen.ts'
import { bound, type Env } from './env.ts'
import type { Held } from './build-door.ts'
import { accounted, resultOf } from './meter.ts'
import { caught, defect, filed } from './defects.ts'
import { hearing } from './refusals.ts'
import {
  ambient,
  counts,
  reached,
  since,
  spansOf,
  type Tally,
  tallying,
  traced,
} from './lib/hops.ts'
import type { OperatorStore } from './operator-store.ts'
import {
  ANSWERING,
  HEARSAY,
  mailSend,
  messageReference,
  OWN,
  replyRows,
  type Request as Requested,
  TAKING,
  UNASKED,
} from './operator-channels.ts'
import { attachedOf, type File } from './operator-files.ts'
import {
  escalate,
  escalationAnswer,
  given,
  REPLIES,
  threadOf,
} from './operator-escalate.ts'
import { rootAt, spaceOf } from './operator-root.ts'
import { textSend } from './operator-texts.ts'
import { strangerWrote } from './operator-heard.ts'
import { confirmTextContact, contactAdd } from './operator-contacts.ts'
import { SIGNUP, signupTools } from './operator-signup.ts'
import { notificationSend } from './operator-alerts.ts'
import { phoneNumbers, phoneSend } from './operator-line.ts'
import { imageNew } from './operator-images.ts'
import { googleAccounts, googleTold, googleTools } from './operator-google.ts'
import { notification } from './operator-updates.ts'
import {
  type Lending,
  pickTools,
  publicity,
  roundAsking,
  tappingAt,
  trialRunning,
} from './operator-trials.ts'
import {
  finished as workFinished,
  fired,
  helperInput,
  subscriptionTools,
  wakeTools,
  type Watching,
} from './operator-schedules.ts'
import { type Browsers, browserTools } from './operator-browser.ts'
import { based, bases, personaFor, spaced } from './operator-persona.ts'
import {
  BASE,
  type Choice,
  listingOf,
  namedBy,
} from '@yaks/platform/operator-model'
import {
  oracleContext,
  oracleMap,
  oracleTopic,
  TOPIC,
  topicOf,
} from './operator-oracles.ts'
import { attachmentKey } from './attachments.ts'

type Store = OperatorStore
export type Options = {
  directory?: () => Directory
  model?: Model
  providers?: Record<string, Model>
  name?: string
  price?: Price
  // The machine that answers a person's steps in a space, where not the
  // space's tunnel ({@link machineFor}).
  machine?: (
    space: Space,
    person: string,
    via?: Calling['via'],
  ) => Promise<typeof fetch | null>
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
// Bookkeeping belongs to the invocation's agent and session as much as its
// calls do. Direct provenance also keeps visibility independent of nesting.
let recorded = (g: Graph, session: string, space: string): Graph => {
  let owned = (bundles: Bundle[]) =>
    bundles.map((b) =>
      b.tool ? b : { ...b, $actor: b.$actor ?? { by: space, via: session } }
    )
  return {
    ...g,
    apply: (bundles, opts) => g.apply(owned(bundles), opts),
    admit: (bundles, opts) => g.admit(owned(bundles), opts),
  }
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** The artifact row of each file kept in the space that a decision's choices
 * show by its attachment id (@yaks/task `shows`), its media type read from
 * its first bytes. */
let shownFiles = (
  env: Pick<Env, 'BLOBS'>,
  space: Pick<Space, 'store'> | null,
  choices: unknown,
): Promise<Bundle[]> =>
  !space || !Array.isArray(choices) ? Promise.resolve([]) : artifactsOf(
    choices.map((c) => (c as { shows?: unknown })?.shows)
      .filter((id): id is string =>
        typeof id == 'string' && /^[0-9a-f]{64}$/.test(id)
      ),
    async (sha) => {
      let kept = await env.BLOBS.get(attachmentKey(space, sha), {
        range: { offset: 0, length: 64 },
      })
      return kept && new Uint8Array(await kept.arrayBuffer())
    },
  )

// The directory an Operator reads through: the Worker's binding onto it.
let opening = (env: Env) => () =>
  directory(bound(env.DIRECTORY, directoryPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })

type OperatorCtx = Ctx & { role: Role | null; pa: boolean; beyond: Reach[] }

// Each space has its own Operator, working on that space and the spaces that
// let it in (operator-reach.ts), the PA's among them. Its context comes in
// two parts: `here` reads what needs only its person and its space's eid at
// once, its directory waiting for the reach only to look past the space
// (grants.ts `narrowed`), and `ctx` is the whole context, with the person's
// role and the spaces beyond, once the space and the reach are read.
let opened = (
  env: Env,
  held: Pick<Held, 'person' | 'administrative'>,
  eid: string,
  space: Space | Promise<Space>,
  open: () => Directory,
  reach: ReturnType<typeof reachOf>,
  instrument?: string,
) => {
  let reopen = () =>
    narrowed(
      open(),
      undefined,
      eid,
      held.administrative,
      reach.then((r) => r.beyond),
    )
  let who: Caller = {
    person: held.person,
    via: 'session',
    actor: eid,
    ...instrument ? { instrument } : {},
  }
  // The space it works in narrows its directory, not the person's own MCP
  // servers: those it reaches by its roster's rule (`operatorRoster`), and a
  // machine's only from the space whose tunnel reaches it.
  let here: Ctx = {
    env,
    dir: reopen(),
    reopen,
    person: held.person,
    who,
    remote: true,
  }
  let ctx = Promise.all([space, reach]).then((
    [space, { role, pa, beyond }],
  ): OperatorCtx => ({
    ...here,
    role,
    pa,
    beyond,
    who: {
      ...who,
      ...beyond.length ? {} : { space: space.slug, spaceEid: space.eid },
    },
  }))
  return { here, ctx }
}

export let operatorContext = (
  env: Env,
  held: Pick<Held, 'person' | 'administrative'>,
  space: Space,
  open: () => Directory = opening(env),
  reach: ReturnType<typeof reachOf> = reachOf(
    open(),
    space,
    held.person,
    held.administrative,
  ),
): Promise<OperatorCtx> => opened(env, held, space.eid, space, open, reach).ctx

// How the Operator works in its conversations, which `operating` makes so,
// is the base persona's plugins/yaks.app/persona/conversation.md.

// What a session carrying on a task is told, where it is given the tool that
// closes it.
let ON_TASK =
  ' This session carries on that task: its conversation and tools are recorded on it. Set status done on it only when the requested work is finished; leave it open when asking a question, reporting a limit, or explaining unfinished work.'

// What every session is told where it is given the tool that asks the person
// it works for to choose (operator-updates.ts).
let ASKING =
  ' Ask the person you work for: the question reaches them in their Updates under Needs you, with a button for each choice, and what they choose comes back to you in your conversation with them. It is shown alone there, read later and apart from this conversation, so its question says in plain words, to them, what it is about and what choosing does. When they are not in this conversation, tell them it waits with notification_send. Use it for a choice that is theirs to make (spending money, sending to people, deleting, or a direction their taste settles), not to confirm routine work. A choice can show what it means beside it, by an id in its shows: an image’s attachment id (from image_new, or a file sent in the conversation), a doc’s id for prose, or a draft’s id (from app_files) to show that draft of an app as it stands, each on its own preview, so several directions can be chosen between; an app’s eid shows their own draft of it.'

// What the Operator is told of the spaces it reaches beyond its own.
let told = (
  ctx: OperatorCtx,
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

// What the Operator is told of itself each turn: its conversation, whose
// session row a fork shares with it, so the two keep one cached prefix, and
// the model and provider this session's using{provider, model} names, the
// rows the turn is answered by, so it says so when asked and stays true when
// the model changes.
let serving = (conversation: string, model?: Bundle, provider?: Bundle) => {
  let name = comp(model, 'model')?.name
  let by = comp(provider, 'provider')?.name
  return `This conversation is your session ${
    short(conversation)
  }; read it with self true to see its entries and its using{provider, model}.${
    name
      ? ` This turn is answered by the model ${name}${
        by ? ` from ${by}` : ''
      }: name it when asked which model you are.`
      : ''
  } You are the person's Operator on yaks.app, never ChatGPT, Claude or another company's assistant.`
}

// The rows of the model and provider a session's turns are answered by.
let servedIn = async (g: Graph, session: string) => {
  let using = await usingIn(g, session)
  let eids = [using?.model, using?.provider].filter(Boolean).map(String)
  let rows = eids.length ? await g.get(eids) : []
  let of = (eid: unknown) => rows.find((r) => r?.entity.eid == eid)
  return { model: of(using?.model), provider: of(using?.provider) }
}

// What the Operator is told when the person it is talking with has no seat
// in its space to write with: it has only their permissions.
let outside = (space: Space, role: Role | null = null) =>
  role
    ? `Your role in ${space.slug} is ${role}: read only the apps and rows this person can read through your tools. You cannot change them or read the space's private Operator memories, tasks or other people's conversations. You may also help this person sign up through the sign-up tools when they are offered; ask the question returned by next and record only answers they gave.`
    : `The person you are talking with is not a member of ${space.slug}: you have only their permissions, so you see none of the space's apps, rows, conversations or memories, and you can do for them only what they could do themselves. Answer what they ask from what they tell you, and say plainly when something needs one of the space's people. What needs the person you wrote to them for, raise with escalate.`

// What the Operator reads of itself: its own store, where each conversation
// and every entry in it, its forks and helpers, its memories, its persona and
// its tasks and requests are kept. The generic reads take `self` to read it
// instead of the apps, and the memory loop works on it alone (@yaks/memory).
let SELF = {
  type: 'boolean',
  description:
    'Use your own store instead of the apps: your conversations and every entry in them, your forks and helpers, your memories, your persona, your app and space topics, and your tasks and requests.',
}
// What a refusal of an id that names nothing adds, where the id may be one
// of the other store's: the Operator reads two, and an id names an entity in
// one of them only.
let IN_OWN = 'With self: true it reads your own store, where your ' +
  'conversations and their entries, your helpers, memories and tasks are'
let IN_APPS = "Without self it reads the apps' and the space's own store"
let OWN_ONLY = 'This reads your own store: your conversations and their ' +
  "entries, memories and tasks; an app's rows are read with graph_show"
// Its memories, and the skills the space keeps beside them, are its own
// store's alone (@yaks/harness `skillRead`).
let mine = new Set([
  'memory_save',
  'memory_recall',
  'memory_around',
  skillRead.name,
  // A space improves its skills by trials there (operator-trials.ts).
  ...Object.keys(trialRuns()),
])
// The connector's tools the Operator holds as its own: memory_save and
// memory_recall are its own memories (the space's are store_memory_save and
// store_memory_recall), the tasks and goals are its own store's
// (operator-tasks.ts), mail_send is its own letter for the person it works
// for (an app's is store_mail_send), and operator_chat and operator_read reach
// the Operator itself, whose fork, spawn and reads with self are its own of
// them.
let ownNamed = new Set([
  ...mine,
  ...workNames,
  'mail_send',
  'operator_chat',
  'operator_run',
  'operator_read',
  'helper_spawn',
  'conversation_start',
  'conversation_send',
])
// Where the Operator finds what it no longer holds in front of it, which
// `SELF` and the memory loop give it, is the base persona's
// plugins/yaks.app/persona/remembering.md.

// The tools most turns use, sent whole with every ask. Every other tool the
// Operator holds is sent once it loads it (@yaks/session `tool_load`), and
// costs each ask until then a line of that tool's list, so the request does
// not grow with the platform.
let CORE = new Set([
  'fork',
  'spawn',
  'search',
  'guide',
  'code_mode',
  'graph_schema',
  'graph_query',
  'graph_show',
  'graph_apply',
  'app_list',
  'app_errors',
  'commands',
  'command',
  'attachment_read',
  'memory_save',
  'memory_recall',
  'memory_around',
  'store_memory_save',
  'store_memory_recall',
  skillRead.name,
  ...workNames,
  'decision_relay',
  'notification_send',
  'escalate',
])
// What a break's turn changes beyond its reads: the files of the app that
// broke, checked and released (unseen.ts `fix`).
let RELEASING = new Set(['app_files', 'app_preview', 'app_deploy'])

// A tool that says whether it is deferred keeps its word.
let deferred = (tools: Tool[]): Tool[] =>
  tools.map((t) =>
    t.deferred != null || CORE.has(t.name) ? t : { ...t, deferred: true }
  )

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
  {
    space,
    tasked = false,
    member = true,
    session,
    connecting,
    trials,
    remote: allowRemote = member,
  }: {
    space: string
    tasked?: boolean
    member?: boolean
    session?: string
    remote?: boolean
    /** who would answer a trial's calls, which prices a round */
    trials?: Trials
    // The person's servers, when the step already asked for them.
    connecting?: ReturnType<typeof connectedTools>
  },
): Promise<Tool[]> => {
  ctx.dir = ctx.reopen!()
  // A server on the person's own machine (tunnel.ts `machine`) is offered only
  // to the Operator of the space whose tunnel reaches it, and is told that
  // their Operator asks, and which conversation: the one this session works
  // for, so a fork's calls and a helper's are the conversation's there too.
  // What the person connected is read beside their reach, needing none of it.
  let asking = operatorAsking(work, space, session)
  ctx.remote = allowRemote
  connecting = allowRemote
    ? connecting ?? connectedTools(ctx, asking)
    : Promise.resolve([])
  connecting.catch(() => {})
  let reach = reached('reach', await inReach(ctx))
  let g = reached('vocab', await reaching(ctx, reach))
  // A tool's answer in words is the call's own, as at the connector's door:
  // only what it wrote for an app goes on to the app (ledger.ts). The
  // Operator's own store is read as the person reads it, and only by someone
  // who writes in the space: its memories, tasks and conversations are the
  // space's work, none of a stranger's business (D-151808).
  let landing = ledger(g)
  let self = seenBy(work, ctx.person)
  let own = new Map(
    member
      ? [
        ...listing({ graph: self, search: textSearch(self) }),
        ...loadTools([memoryDoc], memoryRuns()),
        ...loadTools([trialDoc], trialRuns(trials)),
        ...held(),
        skillRead,
      ].map(namedTool).map((t) => [t.name, t])
      : [],
  )
  // What the model reads of an answer from the Operator's own store is drawn
  // (operator-store.ts `readable`): an eid in its prose as the entity's id.
  // A read of the apps whose rows a stranger wrote is `heard`
  // (operator-heard.ts), which leaves the rest of the turn its reads.
  let stranger = async (t: { readOnly?: boolean }, out: Bundle[]) =>
    !!t.readOnly && await strangerWrote(g, ctx.dir, reach, ctx.person, out)
  let run = (
    t: NamedTool,
    host: Graph,
    target: Graph,
    from: 'own' | 'apps' | 'remote',
    elsewhere?: string,
  ): Tool['run'] =>
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
    if (refusal && !refusal.heard) {
      let body = String(comp(refusal, 'content')?.body)
      throw new CallError(
        String(comp(refusal, 'refusal')?.code),
        elsewhere && body.includes(' names nothing')
          ? `${body}. ${elsewhere}`
          : body,
      )
    }
    if (fault) throw fault
    let said = from == 'own' ? await work.readable(out) : out
    // A connected server or code_mode can stamp its own answer `heard`.
    // Preserve that stamp even if the server answered with an error.
    let heard = out.some((b) => b.heard) ||
      from == 'apps' && await stranger(t, out)
    // Applied tools already wrote through their own store; generic writes
    // return patches and use the same graph application as the connector.
    return {
      text: worded(said, Infinity) || JSON.stringify(said),
      with: {
        ...refusal
          ? { refusal: comp(refusal, 'refusal')! }
          : { output: { source: call.entity.eid, value: resultValue(out, t) } },
        ...heard ? { heard: {} } : {},
      },
    }
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
  let remote = reached('connected', await connecting)
  let apps = listing(coded(
    {
      ...connected(ctx, reach, g),
      calls: ledger(g, session ? recorded(work.g, session, space) : work.g),
      report: (e) => caught(e, { request: 'operator code mode' }),
      refused: hearing(ctx.env, () => ({ space, session })),
      strangerWrote: stranger,
    },
    ctx,
    { graph: work.g, person: ctx.person, space },
    remote,
  )).map(namedTool)
    .filter((t) => !ownNamed.has(t.name) && (member || t.readOnly))
  return [
    ...remote.map(namedTool).map((t): Tool => ({
      ...shaped(t),
      run: run(t, g, landing, 'remote'),
    })),
    // Their own words, sent on to their machine as theirs: only someone who
    // writes in the space, as the rest of what changes anything is.
    ...member
      ? [
        ...relayTools(ctx, work, remote, (s) => topOf(work.g, s), asking),
        decisionRelay(ctx, work, (s) => topOf(work.g, s)),
      ]
      : [],
    ...apps.map((t): Tool => {
      let ours = own.get(t.name)
      let there = run(t, g, landing, 'apps', ours && IN_OWN)
      if (!ours) return { ...shaped(t), run: there }
      let here = run(ours, self, self, 'own', IN_APPS)
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
        // Its own store is one store, so the app and space that narrow a
        // read of the apps name nothing there.
        run: ({ self: reads, ...args }, context) => {
          let { space: _, app: __, ...own } = args
          return reads ? here(own, context) : there(args, context)
        },
      }
    }),
    ...[...own.values()]
      .filter((t) => mine.has(t.name) || workNames.has(t.name))
      .map((t) => {
        let tool = { ...shaped(t), run: run(t, self, self, 'own', OWN_ONLY) }
        if (tasked && t.name == 'task_update') {
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
          run: async (args, context) => {
            // A file a choice shows is kept in the space's bucket: its
            // artifact row says what it is, as a file sent in the
            // conversation has one.
            let files = await shownFiles(
              ctx.env,
              await ctx.dir.at(space),
              args.choices,
            )
            if (files.length) await work.g.apply(files, { trusted: true })
            let answer = await tool.run(
              { ...args, assignee: ctx.person, project: space },
              context,
            )
            await questionNotice(
              work,
              context,
              String(args.question),
            )
            return answer
          },
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

/** What the Operator runs on where the directory names nothing
 * (@yaks/platform/operator-model): the first of config.ts `agents` whose
 * provider the Worker holds every credential of, by default GPT-6.2 Sol on
 * the Operator's OpenAI key; without that key Opus on the platform's
 * Anthropic key; and without either GLM on Workers AI. */
export let operatorChoice = (env: Env, machine = false) => {
  // On its person's own machine ({@link machineFor}) it asks for the first
  // model config.ts `agents.machine` names, of the provider `machine`.
  if (machine) {
    let [first] = agents.machine
    return { provider: MACHINE, name: first.model, delegate: first.delegate }
  }
  let chosen =
    agents.operator.find((c) => ready(env, c.provider, operatorProviders)) ??
      agents.operator.at(-1)!
  return {
    provider: chosen.provider,
    name: chosen.model,
    delegate: chosen.delegate,
  }
}

/** The stronger model of `provider` an Operator on it hands coding and tricky
 * work to (config.ts `agents`), if it has one. */
export let delegateOf = (provider: string) =>
  agents.operator.find((c) => c.provider == provider)?.delegate

/**
 * The hosted models a step asked of `asked` goes on to where its provider
 * says that model is retired or unknown (@yaks/model `onward`), in order:
 * `asked`, the models its space may be answered with (`own`), then each of
 * `choices` (config.ts `agents.operator`) whose provider `serves`. Where
 * `asked` is a stronger model handed coding (a `delegate`), each is its
 * provider's stronger model.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { chainOf } from './operator.ts'
 * let choices = [
 *   { provider: 'a', model: 'a1', delegate: 'A1' },
 *   { provider: 'b', model: 'b1' },
 *   { provider: 'c', model: 'c1' },
 * ]
 * let serves = (p: string) => p != 'c'
 * let names = (asked: { provider: string; model: string }) =>
 *   chainOf(asked, [{ provider: 'b', model: 'b2' }], choices, serves)
 *     .map((c) => c.provider + ':' + c.model)
 * equal(names({ provider: 'x', model: 'old' }), ['x:old', 'b:b2', 'a:a1', 'b:b1'])
 * equal(names({ provider: 'a', model: 'A1' }), ['a:A1', 'b:b2', 'b:b1'])
 * equal(
 *   chainOf({ provider: 'b', model: 'A1' }, [choices[0]], choices, serves),
 *   [{ provider: 'b', model: 'A1' }, { provider: 'a', model: 'A1' }, { provider: 'b', model: 'b1' }],
 * )
 * equal(names({ provider: 'b', model: 'b2' }), ['b:b2', 'a:a1', 'b:b1'])
 * ```
 */
export let chainOf = (
  asked: Choice,
  own: Choice[],
  choices: { provider: string; model: string; delegate?: string }[],
  serves: (provider: string) => boolean,
): Choice[] => {
  let strong = choices.some((c) => c.delegate == asked.model)
  let pick = (provider: string, model: string) => ({
    provider,
    model: strong
      ? choices.find((c) => c.provider == provider)?.delegate ?? model
      : model,
  })
  let all = [
    asked,
    ...own.map((c) => pick(c.provider, c.model)),
    ...choices.filter((c) => serves(c.provider)).map((c) =>
      pick(c.provider, c.model)
    ),
  ]
  let key = (c: Choice) => c.provider + '\n' + c.model
  return all.filter((c, i) => all.findIndex((d) => key(d) == key(c)) == i)
}

/**
 * The machine that answers an Operator's model steps for `person` in `space`,
 * as the `fetch` that reaches it through the space's tunnel, or null: the
 * space has a tunnel, the person is its owner (tunnel.ts `machine`), and they
 * are a platform admin. The machine is told its owner's Operator asks, and in
 * which conversation (`via`). The provider and the step's route are anyone's
 * (@yaks/model/step); this is the one place that says only an admin's
 * Operator is served by a machine (D-153799). Everyone else's turn in the
 * same space, a member's or a stranger's, is answered by a hosted model: an
 * Operator has the permissions of the person it is talking with, and a
 * subscription is its owner's alone. Even for them the machine answers only
 * words that name it, or every turn where their space's persona chose it
 * (`using{provider: machine}`); otherwise their Operator runs on the hosted
 * model as everyone's does.
 */
export let machineFor = async (
  env: Env,
  space: Pick<Space, 'eid' | 'tunnel' | 'tunnelTrashed'>,
  person: string,
  open: () => Directory = opening(env),
  via?: Calling['via'],
): Promise<typeof fetch | null> => {
  if (!space.tunnel || space.tunnelTrashed || !person) return null
  // Whether they are the admin and whether the tunnel is theirs are asked at
  // once: neither needs the other's answer.
  let [chief, fetch] = await Promise.all([
    admin({ dir: open(), person }),
    import('./tunnel.ts').then((t) =>
      t.machine(env, space.eid, person, {
        caller: 'operator',
        space: space.eid,
        via,
      })
    ),
  ])
  return chief ? fetch : null
}

// What an Operator session works with, kept on it (`operator_session`) so
// every step, in whichever wake of the object, reads it again: the space, and
// the person whose reach it has.
type Working = {
  space: string
  person: string
  administrative?: boolean
  signup?: string
  channel?: string
  files?: File[]
}
let workingOf = async ({ g }: Store, session: string) => {
  let [row] = await g.get([session], ['operator_session'])
  return comp(row, 'operator_session') as Working | undefined
}
// Pre-change sessions keep the source on their request rather than the session.
let channelAt = async (store: Store, session: string, work?: Working) =>
  work?.channel ??
    String((await requestAt(store, session))?.request?.channel ?? '')
// The newest request of a session's conversation, and when it came.
let requestAt = async (store: Store, session: string) => {
  let top = await topOf(store.g, session)
  let [row] = await store.g.read(
    q`.operator_request.session=${top} .order=-created.at .limit=1 .fields=operator_request,created.at`,
  )
  return row && {
    request: comp(row, 'operator_request') as Requested | undefined,
    at: String(comp(row, 'created')?.at ?? ''),
  }
}
// Whether a tool answered this session with words someone outside the space
// wrote (`heard`) since its conversation's newest request: the person's own
// words, which give the turn after them every tool again.
let overheard = async (store: Store, session: string, since = '') => {
  let [answer] = await store.g.read(
    q`.entry.session=${session} .heard .order=-created.at .limit=1 .fields=created.at`,
  )
  return !!answer && String(comp(answer, 'created')?.at ?? '') > since
}
// Whether a conversation has begun: its row is a session. Presence is
// counted, so its computed status is never read.
let conversed = async ({ g }: Store, session: string) =>
  Number((await g.rows(q`.entity.eid=${session}&.session&.count`))[0]?.n ?? 0) >
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
        q`.entity.eid=${
          String(session)
        }&.fields=operator_session.space,session.source`,
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
  // The space, the person's reach in it, the apps the step's roster and
  // map read next, whether the person is the platform's admin (which the
  // roster and the machine ask) and their Google accounts are asked at once:
  // the directory answers them together, and the step's later asks are
  // answered from these (lib/hops.ts `recall`). What needs only the person
  // and the space's eid is read through `here`; `ctx` waits for the space
  // and the reach.
  let dir = reading()
  let reach = reachOf(dir, { eid: o.space }, o.person, o.administrative)
  let apps = dir.reachable(o.person)
  let platform = admin({ dir, person: o.person })
  let space = (open?.() ?? directoryOf(env.STORE)).at(o.space).then((s) => {
    if (!s || s.trashed) throw refuse('missing', 'That space is gone.')
    return s
  })
  let openedFor = opened(env, o, o.space, space, reading, reach, session)
  let remote = !o.signup && !ANSWERING.has(await channelAt(store, session, o))
  let here = { ...openedFor.here, remote }
  let ctx = openedFor.ctx.then((ctx) => ({ ...ctx, remote }))
  let google = googleAccounts(env, here, { eid: o.space })
  for (let asked of [reach, apps, platform, space, ctx, google]) {
    asked.catch(() => {})
  }
  return { eid: o.space, space, here, ctx, files: o.files ?? [] }
}

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
        traced(tally)
        return tallying(tally, () => handler(...args))
      },
    ]),
  )

// How long a step took to ask its model and hear its answer, and the round
// trips it made on the way, in the Worker's logs: store hops, bucket reads,
// and trips to the cached Files door (files.ts `door`). Its stage marks
// include when the request was sent (`at_submit`) and when the reply's first
// output arrived (`at_first_token`), and its `trace` each wait it made, as
// `<began>+<ms> <wait> <what it asked>`, in ms from the step's start.
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
      trace: spansOf(tally).map(([name, at, ms, what]) =>
        `${at}+${ms} ${name.replace(/_wait$/, '')}${what ? ' ' + what : ''}`
      ),
    }),
  )
}

// Who asks a person's connected servers for `space`'s Operator: that
// Operator, in the conversation `session` works for.
let operatorAsking = (
  store: Store,
  space: string,
  session?: string,
): Calling => {
  let top: Promise<string> | undefined
  return {
    caller: 'operator',
    space,
    via: session ? () => top ??= topOf(store.g, session) : undefined,
  }
}

// The task a session (or the session its helper works for) carries on, or ''
// for a person's conversation.
let taskOf = async (store: Store, session: string) => {
  let [link] = await store.g.read(
    q`.contains .edge.to=${await topOf(store.g, session)}`,
  )
  return String(comp(link, 'edge')?.from ?? '')
}

// What a person is told of a conversation a fixed yaks.app bug had stopped
// and that was run again; what came of it is in its chat, and whatever it
// means them to read it tells them itself (notification_send).
let RERAN = {
  subject: 'Work that stopped has started again',
  words:
    "Something you asked for stopped because of a problem in yaks.app. That problem is fixed now, so the work started again from where it stopped. You don't need to do anything.",
}

// The way a request is answered: its channel, and whom it reaches by it.
let routeOf = (request?: Comp) =>
  JSON.stringify(
    ['channel', 'address', 'reply_to', 'via'].map((k) => request?.[k] ?? ''),
  )

// Who the Operator's replies name: yaks.app, where it failed, and itself.

// What a conversation is told when its person's own machine could not answer
// a step and a hosted model answers instead (`operating`'s `fell`).
let HOSTED =
  "The person's own machine did not answer this request, so a hosted model is answering instead of their subscription, and the space pays for it. Tell them so in one short sentence in your reply, once. Carry on with what they asked."
// The failures of a machine's step that say its tunnel did not reach it, and
// how long a turn waits after its machine's providers refused it (ms).
let REACHES = new Set(['unreachable', 'stalled'])

// The channels whose run nobody watches as it goes, by what the run was
// doing, said to its person: none of it reaches them unless the run tells
// them (notification_send), or could not finish (`stoppedNotice`).
let UNWATCHED: Record<string, (app: string) => string> = {
  error: (app) => `fixing an error in ${app}`,
  wake: () => 'doing something you set it to do later',
  subscription: () => 'looking into a change it watches for you',
  escalated: () => 'handling a reply someone sent you',
}
let SPENT = 60 * 60_000

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
  // What a subscription watches, read as the person its wake is set for:
  // over the space through their reach, as their graph_query reads it, or
  // over this store (operator-schedules.ts).
  let watching: Watching = async (wake, { query, local }) => {
    let person = String((wake.wake as { for?: string } | undefined)?.for ?? '')
    if (!person) throw refuse('missing', 'That subscription names nobody.')
    // A watch's query is its own, as the subscription wrote it.
    if (local) return await seenBy(store, person).read(wholeLine(query))
    let eid = await spaceOf(store)
    let space = eid ? await dir().at(eid) : null
    if (!space || space.trashed) throw refuse('missing', 'That space is gone.')
    let ctx = await operatorContext(
      env,
      { person },
      space,
      options.directory ?? opening(env),
    )
    return await (await reaching(ctx, await inReach(ctx))).read(
      wholeLine(query),
    )
  }
  // What it answers with where the directory names nothing (`current`).
  let choice = operatorChoice(env)
  let name = options.name ?? choice.name
  let provider = choice.provider
  // What it asks its person's own machine for, where one serves them.
  let mine = operatorChoice(env, true)
  let reachMachine = options.machine ??
    ((space: Space, person: string, via?: Calling['via']) =>
      machineFor(env, space, person, options.directory ?? opening(env), via))
  // A machine serves only its person's own conversation. What that
  // conversation starts, a fork or a helper, asks the hosted model as every
  // Operator's helpers do: the stronger one where it asked the machine for
  // its stronger one. A helper runs on a machine only where helper_spawn
  // names one.
  let machined = identityEid('provider', [MACHINE])
  let strong = new Set(
    agents.machine.flatMap((l) =>
      l.delegate ? [identityEid('model', [l.delegate])] : []
    ),
  )
  let children: ChildLimits = {
    using: async (u) => {
      if (u.provider != machined) return u
      let hosted = await current()
      let to = strong.has(String(u.model)) && delegateOf(hosted.provider)
      return { ...u, provider: hosted.provider, model: to || hosted.model }
    },
  }
  let spawn = sessionTools(g, {
    ...children,
    childProperties: { topic: TOPIC },
  })
    .find((t) => t.name == 'spawn')!
  // Coding and tricky work go to a stronger model of the provider a session
  // is on (`delegateOf`), in a child session (`spawn`) whose answer comes
  // back to the one that asked.
  let delegates = new Map(
    agents.operator.map((
      c,
    ) => [identityEid('provider', [c.provider]), c.delegate]),
  )
  // `to` is the stronger model of the provider the session is on, if any.
  let delegated = (to?: string): Tool => ({
    ...spawn,
    description:
      `${spawn.description} To consult an app or space oracle, supply topic from the Oracles map and the question as prompt. Its answer comes back automatically.` +
      (to
        ? ` For writing or fixing code, or work that needs careful reasoning, use spawn with model ${to} and a prompt that carries everything it needs; its answer comes back to you.`
        : ''),
  })
  // The model an input asks for, once its provider lists it (`chosen`). Both
  // are named by their names, so the store gives one it has not met a row as
  // it writes the input (@yaks/model `requesting`), and the provider's answer
  // records the window, output limit and price its catalogue lists for the
  // model (@yaks/session `providerResolver`).
  let usingOf = (model = name, from = provider, effort?: string) => ({
    provider: from,
    model,
    ...effort ? { effort } : {},
  })
  // The session an ask is an entry of.
  let sessionOf = async (ask?: string) => {
    let [row] = ask ? await g.get([ask], ['entry']) : []
    let session = comp(row, 'entry')?.session
    return session ? String(session) : undefined
  }
  // The machine a step is asked of: the one that serves the person its
  // session works for, read as the step is asked, so a session is never
  // answered by a machine its person has no claim to.
  let machineOf = async (ask?: string) => machineAt(await sessionOf(ask))
  let machineAt = async (session?: string) => {
    let o = session ? await workingOf(store, session) : undefined
    let space = o ? await dir().at(o.space) : undefined
    if (!session || !o || !space || space.trashed) return null
    return reachMachine(space, o.person, () => topOf(g, session))
  }
  // Whether the turn a session takes was started without its person asking
  // at that moment: the newest words of its conversation are routine news
  // (operator-channels.ts `UNASKED`), or it is scheduled
  // work's helper (operator-schedules.ts). Such a turn never falls to a hosted
  // model, which would spend the space's money nobody chose to spend: it
  // waits for its person's machine.
  let unasked = async (session?: string) => {
    if (!session) return false
    let top = await topOf(g, session)
    let [[work], [said]] = await Promise.all([
      g.get([top], ['occurrence']),
      g.read(
        q`.entry.session=${top}&.content&.using&!ask&.order=-entry.seq&.limit=1&.fields=channel.name,operator_channel.channel`,
      ),
    ])
    let channel = said && cameBy(said).name
    return !!work?.occurrence || UNASKED.has(String(channel ?? ''))
  }
  let machine: Model = async (req) => {
    let fetch = reached('machine', await machineOf(req.call))
    if (!fetch) {
      throw new ModelError(
        'unreachable',
        'No machine serves the person this conversation is with',
      )
    }
    return forwarding({ fetch })(req)
  }
  let implementations: Record<string, Model> = {
    ...options.model
      ? { [provider]: options.model }
      : served(env, () => platform(env), operatorProviders),
    [MACHINE]: machine,
    ...options.providers,
  }
  // Whether a machine serves this person in this space.
  let servedTo = (held: Asker, space: Space) => async () =>
    !!await reachMachine(space, held.person)
  // The model a machine answers this person's words with before any other,
  // where the space's persona chose its owner's machine (`using` naming the
  // provider `machine`) and a machine serves them: the model `using` names,
  // else the first `agents.machine` lends. No persona chooses it unless its
  // owner sets it, so every Operator answers on the hosted model.
  let firstTo = (held: Asker, space: Space) => async () => {
    let [row] = await g.get([personaFor(space.eid)], ['using'])
    let using = comp(row, 'using')
    if (using?.provider != machined) return undefined
    if (!await reachMachine(space, held.person)) return undefined
    let [named] = using.model ? await g.get([String(using.model)]) : []
    return String(comp(named, 'model')?.name ?? mine.name)
  }
  let reads: Operator['reads'] = async (model, from, held, space) => {
    let selected = await chosen(
      await current(space?.eid),
      model,
      from,
      held && space ? servedTo(held, space) : undefined,
      held && space ? firstTo(held, space) : undefined,
    )
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
  // What a model's own row in the directory says of it (its price, window
  // and longest reply), the platform's one catalogue
  // (@yaks/platform/operator-model); what its provider lists where the row
  // is silent.
  let catalogued = (model: string) => listingOf(bases(env), model)
  let priced = async (model: string, from = provider) =>
    options.price && from == provider
      ? options.price
      : (await catalogued(model))?.price ?? (await listed(model, from))?.price
  // A model as the meter and the session weigh it: its row's word over its
  // provider's, and its provider not asked where the row says all they need.
  let rowed = (base: Model): Model =>
    Object.assign((req: Parameters<Model>[0]) => base(req), base, {
      info: async (model: string) => {
        let row = await catalogued(model)
        if (row?.price && row.context) return row
        let own = await base.info?.(model)
        return own || row ? { name: model, ...own, ...row } : undefined
      },
    })
  // The hosted model it answers its space with, read at every turn so a
  // write applies to the next one: what the space's persona names, else what
  // the directory's base persona names, where a provider here serves it;
  // else `operatorChoice`'s. A persona naming its person's machine asks the
  // machine first, and leaves the hosted model to the base. A test naming
  // its model keeps it.
  let current = async (space?: string): Promise<Choice> =>
    (await namings(space))[0]
  // Every hosted model its space may be answered with, in that order: what
  // the space's persona names, what the directory's base persona names, each
  // where a provider here serves it, then `operatorChoice`'s.
  let namings = async (space?: string): Promise<Choice[]> => {
    let fallback = { provider, model: name }
    if (options.name) return [fallback]
    space ??= await spaceOf(store)
    let own = space ? await namedBy(g, personaFor(space)) : undefined
    let all = [
      own?.provider == MACHINE ? undefined : own,
      await namedBy(bases(env), BASE),
    ]
    return [
      ...all.filter((c): c is Choice => !!c && !!implementations[c.provider]),
      fallback,
    ]
  }
  // A space's trials are asked of its providers, charged to it.
  let lending: Lending = { models: implementations, priced, provider, name }
  trialRunning(store, env, lending)
  let trials: Trials = {
    asking: (round) => roundAsking(env, store, lending, round),
    notice: (round) => publicity(dir(), env, round),
    page: (round) => tappingAt(env, dir(), store, round),
  }
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
  // Words that name neither are answered on the person's own machine where
  // they chose it and it serves them (`first`), and only they may name it
  // (`served`).
  let chosen = async (
    own: Choice,
    model?: string,
    asked?: string,
    served?: () => Promise<boolean>,
    first?: () => Promise<string | undefined>,
  ): Promise<Choice> => {
    let theirs = !model && !asked ? await first?.() : undefined
    if (theirs) return { provider: MACHINE, model: theirs }
    let from = asked ?? own.provider
    if (from == MACHINE && !await served?.()) {
      throw refuse(
        'arguments',
        `The Operator has no available ${from} provider.`,
      )
    }
    // A machine lists nothing: it answers the model or refuses the step.
    if (from == MACHINE && model) return { provider: from, model }
    if (!implementations[from]) {
      throw refuse(
        'arguments',
        `The Operator has no available ${from} provider.`,
      )
    }
    if (from != own.provider && !model) {
      throw refuse(
        'arguments',
        'Name a model when selecting an Operator provider.',
      )
    }
    if (!model || (from == own.provider && model == own.model)) {
      return { provider: from, model: own.model }
    }
    if (await catalogued(model)) return { provider: from, model }
    let info = await catalogue(from, () => listed(model, from))
    if (info) return { provider: from, model }
    if (from != own.provider) {
      throw await unknown(model, from)
    }
    return own
  }
  // Each ask is charged to the space of the session asking, at the price of
  // the model it asks. One a machine answers (`free`) is its owner's own, on
  // their subscription: the space is charged nothing, and no price is asked
  // of a machine, which lists none.
  let accounting = (base: Model, from: string, free = false): Model =>
    Object.assign(
      async (req: Parameters<Model>[0]) => {
        reached('request', req)
        let [price, [ask], space] = await Promise.all([
          free ? undefined : priced(req.model, from),
          req.call ? g.get([req.call]) : [],
          payerOf(store, req.call),
        ])
        if (!free && !options.model && !price) {
          throw new Error(`No catalogue price for operator model ${req.model}`)
        }
        reached('payer', space)
        // The space may ask its provider to keep the cached prefix longer than
        // the default (@yaks/model `cache{retention}` on its persona).
        let [[own], payer] = space
          ? await Promise.all([
            g.get([personaFor(space)], ['cache']),
            dir().at(space),
          ])
          : [[], null]
        let kept = comp(own, 'cache')?.retention as number | undefined
        // A newcomer's Operator reads only the site they gave (newcomer.ts
        // `fetchable`).
        let sites = payer ? fetchable(payer) : undefined
        let session = comp(ask, 'entry')?.session
        let charged = free ? base : accounted(
          env,
          (dir) => space ? dir.at(space) : Promise.resolve(null),
          rowed(base),
          () => Promise.resolve(price),
          undefined,
          from,
          modelResults(g),
        )
        let reply = await charged({
          ...req,
          ...kept ? { cacheRetention: kept } : {},
          ...sites ? { sites } : {},
          onSubmit: async () => {
            reached('submitting', null)
            await req.onSubmit?.()
            reached('submit', null)
          },
          onFirst: () => {
            reached('first_token', null)
            req.onFirst?.()
          },
        }).finally(() => asked(session ? String(session) : undefined))
        if (free && session) await returned(String(session))
        if (session && req.onText) options.stepped?.(String(session))
        // What the step cost the space, where the machine did not say: none,
        // rather than the model's price weighed at its list (@yaks/session
        // `weighing`).
        return free && reply.cost == null ? { ...reply, cost: 0 } : reply
      },
      // What it says of a model is its row's word, so the store's own row
      // takes the window and price the directory's says (@yaks/session
      // `providerResolver`).
      free ? base : rowed(base),
      {
        result: resultOf(env, modelResults(g)),
      },
    )
  // The line that tells a conversation a hosted model is answering it
  // (`operator_hosted`), while its machine has not answered since: said once,
  // until the machine answers again. A helper's step says nothing of its own;
  // its conversation's next step meets the same machine.
  let hosting = async (session: string) => {
    let [line] = await g.read(
      q`.entry.session=${session}&.operator_hosted&!completed&.limit=1&.fields=entity.eid`,
    )
    return line?.entity.eid
  }
  // The sessions read this wake with no such line standing.
  let clear = new Set<string>()
  let returned = async (session: string) => {
    if (clear.has(session)) return
    let line = await hosting(session)
    if (line) {
      await g.apply([{ entity: { eid: line }, completed: {} }], {
        trusted: true,
      })
    }
    clear.add(session)
  }
  let fell = async (req: Step, error: ModelError): Promise<Step> => {
    let session = await sessionOf(req.call)
    if (
      !session || await topOf(g, session) != session ||
      await hosting(session)
    ) return req
    clear.delete(session)
    await g.apply([{
      entity: { eid: mint() },
      entry: { session, from: 'the system' },
      notice: {},
      content: { body: HOSTED },
      operator_hosted: { code: error.code },
    }], { trusted: true })
    return {
      ...req,
      items: [...req.items, {
        kind: 'user',
        text: 'From the system:\n' + HOSTED,
      }],
    }
  }
  // A turn that waits for its machine (`unasked`) has its newest ask owed
  // again after the machine failed it (@yaks/session `provisional`), and is
  // not asked again until the machine looks able: one the tunnel did not
  // reach (`unreachable`, `stalled`) once the tunnel reaches it, looked at
  // once per AWAY at most; one whose providers refused it (an allowance
  // spent), SPENT after it failed. Neither a look nor an ask spends a try:
  // the machine's failure is a wait (operator-machine.ts `away`).
  let looked = new Map<string, { at: number; up: Promise<boolean> }>()
  let up = (session: string, reach: typeof globalThis.fetch) => {
    let held = looked.get(session)
    if (held && Date.now() - held.at < AWAY) return held.up
    let seen = reach('http://machine' + PATH, { method: 'HEAD' }).then(
      async (r) => (await r.body?.cancel(), r.status < 500),
      () => false,
    )
    looked.set(session, { at: Date.now(), up: seen })
    return seen
  }
  let away = async (session: string) => {
    let [owed] = await g.read(
      q`.provisional&.ask&.entry.session=${session}&.limit=1&.fields=interrupted.code,created.at`,
    )
    if (!owed || !await unasked(session)) return false
    let reach = await machineAt(session)
    if (!reach) return false
    if (!REACHES.has(String(comp(owed, 'interrupted')?.code))) {
      return Date.now() - Date.parse(String(comp(owed, 'created')?.at)) < SPENT
    }
    return !await up(session, reach)
  }
  let charged = Object.fromEntries(
    Object.entries(implementations).filter(([p]) => p != MACHINE)
      .map(([p, m]) => [p, accounting(m, p)]),
  )
  // A hosted step whose provider says its model is retired or unknown goes
  // on to the next model the Operator's choices name (`chainOf`), each
  // charged as its own provider's step; the turn ends only when none is
  // left. The model that failed is reported, so its row or its caller is
  // fixed.
  let serves = (p: string) => !!charged[p] && ready(env, p, operatorProviders)
  let models: Record<string, Model> = Object.fromEntries(
    Object.entries(charged).map(([p, m]) => [
      p,
      Object.assign(
        onward(
          async (req) =>
            chainOf(
              { provider: p, model: req.model },
              await namings(),
              agents.operator,
              serves,
            ).map((c) => ({ model: charged[c.provider], name: c.model })),
          (name, error) =>
            caught(error, { request: 'operator model', model: name }),
        ),
        m,
      ),
    ]),
  )
  // A step asked of the machine goes to each provider it lends and then to
  // the hosted model (operator-machine.ts), which is charged as any hosted
  // step is.
  let lent = accounting(implementations[MACHINE], MACHINE, true)
  // A turn nobody asked for at that moment has no hosted leg, so it waits
  // for the machine (`unasked`, `away`).
  models[MACHINE] = Object.assign(
    falling(async (req) => {
      let hosted = await current()
      let names = namesFor(req.model, agents.machine, {
        model: hosted.model,
        delegate: delegateOf(hosted.provider),
      })
      let own = names.machine.map((name) => ({ model: lent, name }))
      return await unasked(await sessionOf(req.call)) ? own : [
        ...own,
        { model: models[hosted.provider], name: names.hosted, hosted: true },
      ]
    }, fell),
    { result: resultOf(env, modelResults(g)) },
  )
  // The base persona as plugins/yaks.app/persona says it, kept in the
  // directory once per wake; one that could not be written is reported and
  // tried again on the next ask, while the Operator wears the base the
  // directory holds.
  let basing: Promise<void> | undefined
  let base = () =>
    basing ??= based(env).catch((e) => {
      basing = undefined
      caught(e, { request: 'operator base persona' })
    })

  // A conversation's report names its space as whose stopped work it is
  // (`rerun`), and the conversation keeps the fault it was filed under, so
  // the bug's resolution takes it up again (operator-rerun.ts); a fork's
  // ends in the session that started it.
  let unfinished = async (session: string, fault: string, request: string) => {
    let space = (await workingOf(store, session))?.space
    let rerun = !!space && request == 'operator conversation'
    let sent = filed(Error(`Operator could not finish: ${fault}`), {
      request,
      session,
      space: space ? (await dir().at(space))?.slug : null,
      ...rerun ? { rerun: space } : {},
    })
    if (!rerun || !sent) return
    let { faultOf } = await import('@yaks/tracker')
    await g.apply([{
      entity: { eid: session },
      stalled: { fault: faultOf(sent) },
    }], {
      trusted: true,
    })
  }
  // The session's answer, once its turn ends: an answer to each request the
  // turn answers, which its channel delivers (operator_deliver), and on a
  // task's session a comment on its task. A request's words, and a helper's
  // result standing for the words that started it, are answered on the
  // channel they came by: a quick word when the conversation forks, and the
  // outcome when the fork comes back. A helper's end is told to the session
  // that started it, not to the person.
  // The one notice a run nobody watches gets when it could not finish: what
  // it was doing, that yaks.app stopped it, and that nothing waits on them.
  let stoppedNotice = async (r: Bundle, space: string, session: string) => {
    let asked = comp(r, 'operator_request')!
    let [at, held] = await Promise.all([
      dir().at(space),
      asked.app ? dir().appAt(String(asked.app)) : null,
    ])
    if (!at) return []
    let doing = UNWATCHED[String(asked.channel)](
      held?.app.title || held?.app.slug || 'one of your apps',
    )
    return [notification({
      to: String(asked.person),
      subject: `${at.operator} couldn't finish ${doing}`,
      words:
        `${at.operator} was ${doing} when something went wrong on yaks.app's side, so it stopped before finishing. The people who run yaks.app have been told. You don't need to do anything.`,
      ...asked.app ? { about: String(asked.app) } : {},
      by: space,
      via: session,
      id: 'stopped|' + r.entity.eid,
    })]
  }
  let answered = async (session: string) => {
    let [row] = await g.get([session], ['spawned', 'occurrence'])
    let reply = await answerOf(g, session, NAMING)
    if (row?.occurrence) {
      await workFinished(store, row, reply.text, reply.fault)
      return
    }
    // A fork or helper that could not finish reaches the tracker as it ends;
    // what it ended with goes to the session that started it (M-37965).
    if (row?.spawned && comp(row, 'spawned')?.quiet == null) {
      if (reply.fault) await unfinished(session, reply.fault, 'operator fork')
      return
    }
    // One answer for each time it was given words: the turn ended again
    // (stopped, then a step in flight finishing) says it anew.
    let { mark } = reply
    if (!mark) return
    let task = await taskOf(store, session)
    let space = (await workingOf(store, session))?.space
    let given = new Set(reply.given.map((b) => b.entity.eid))
    let requests = (await g.read(
      q`.operator_request.session=${session} .order=created.at`,
    )).filter((r) => given.has(inputOf(r.entity.eid)))
    let comment = task
      ? derivedEid('operator-answer|' + mark.entity.eid)
      : undefined
    // The turn answers each request, and says so once each way it was asked
    // by: two calls' turns, or two texts, answered together hear it once.
    let carriers = new Map<string, string>()
    let answers = requests.map((r) => {
      let eid = derivedEid(
        `operator-answer|${r.entity.eid}|${mark.entity.eid}`,
      )
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
    // Words a channel's door took in itself name the item they arrived as
    // (@yaks/session `intake`), and are answered in its package's words
    // (operator-channels.ts `replyRows`). A queued request from before its
    // channel moved is answered by `operator_deliver` above.
    let heard = reply.given.flatMap((b) => {
      let item = comp(b, 'intake')?.item
      let channel = String(comp(b, 'channel')?.name ?? '')
      return item && TAKING.has(channel)
        ? [{ item: String(item), channel }]
        : []
    })
    let from = heard.length && space ? await dir().at(space) : undefined
    let items = from ? await g.get(heard.map((h) => h.item)) : []
    let sent = heard.flatMap(({ channel }, i) =>
      items[i] && !items[i].operator_request && from
        ? replyRows(env, from, channel, items[i], {
          eid: derivedEid(
            `operator-reply|${items[i].entity.eid}|${mark.entity.eid}`,
          ),
          text: reply.text,
        })
        : []
    )
    let ids = [
      ...comment ? [comment] : [],
      ...answers.map((b) => b.entity.eid),
      ...sent.filter((b) => b.deliver).map((b) => b.entity.eid),
    ]
    let kept = (await g.get(ids)).some(Boolean)
    // A conversation that could not finish reaches the tracker once, when
    // its answer is first written (M-37965).
    if (reply.fault && !kept) {
      await unfinished(session, reply.fault, 'operator conversation')
    }
    if (kept) return
    // A run nobody watches (a break's fix, a wake-up that fired, a
    // subscription that saw a change, what another conversation raised)
    // tells its person what it means them to read itself, with
    // notification_send; its last words stay in its chat. One that could
    // not finish is told for it, in plain words.
    let unwatched = reply.broke && space
      ? requests.filter((r) =>
        UNWATCHED[String(comp(r, 'operator_request')?.channel)]
      )
      : []
    let stopped = await Promise.all(
      unwatched.map((r) => stoppedNotice(r, space!, session)),
    )
    // A conversation a yaks.app bug had stopped, taken up again once it was
    // fixed (operator-rerun.ts): its person is told so once, with what came
    // of it, about the task or conversation it carried on.
    let reran = requests.filter((r) =>
      comp(r, 'operator_request')?.channel == 'fixed'
    )
    await g.apply([
      ...reran.map((r) => {
        let asked = comp(r, 'operator_request')!
        return notification({
          to: String(asked.person),
          subject: RERAN.subject,
          words: RERAN.words,
          about: task || String(asked.about ?? session),
          by: space,
          via: session,
          id: 'reran|' + r.entity.eid,
        })
      }),
      ...stopped.flat(),
      ...comment
        ? [{
          entity: { eid: comment },
          comment: { target: task },
          doc: { body: reply.text },
          $actor: { by: space ?? task, via: session },
        }]
        : [],
      ...answers,
      ...sent,
    ], { trusted: true })
  }

  // The tools a session of this Operator is offered beside its own: the
  // person's apps through their reach, and the Operator's own doors. Every
  // one of them is the person's to have: the doors that text, mail, wake,
  // watch, draw, report, and reach their Google are the space's work, offered
  // to someone who writes in it and to nobody else (D-151808).
  let roster = async (session: string): Promise<Tool[]> => {
    reached('tools', null)
    // A step its person's machine answers reaches for the machine now, beside
    // its roster: what that reads of the directory is read once a step
    // (lib/hops.ts `recall`), so the step finds it read when it is sent.
    let last = Promise.resolve(g.read(
      q`.entry.session=${session} .using .order=-entry.seq .limit=1 .fields=using.provider`,
    ))
    last.then(([using]) => {
      if (
        comp(using, 'using')?.provider == identityEid('provider', [MACHINE])
      ) {
        return machineAt(session)
      }
    }).catch(() => {})
    let [{ eid, space: at, here, ctx: context, files }, task, [row], [using]] =
      await Promise.all([
        working(env, store, session, options.directory),
        taskOf(store, session),
        g.read(
          q`.entity.eid=${session}&.fields=spawned.parent,fork.from,session.topic`,
        ),
        last,
      ])
    // The person's servers need only them and the space's eid, so they are
    // asked beside the reach and the space.
    let work = await workingOf(store, session)
    let newest = await requestAt(store, session)
    let channel = work?.channel ?? String(newest?.request?.channel ?? '')
    // Words nobody in the space wrote, whether they started the turn
    // (operator-channels.ts `HEARSAY`) or a tool brought them since, leave it
    // holding only what keeps the space's data with its person, whoever's
    // conversation it is in.
    let heard = HEARSAY.has(channel) ||
      await overheard(store, session, newest?.at)
    let remote = !work?.signup && !ANSWERING.has(channel) && !heard
    let connecting = remote
      ? connectedTools(here, operatorAsking(store, eid, session))
      : Promise.resolve([])
    connecting.catch(() => {})
    let space = await at
    if (work?.signup) return signupTools(env, space, here.person, work.signup)
    reached('working', space)
    // Only a writer's authenticated channels can reach personal accounts.
    let accounts = googleTools(env, here, space)
    accounts.catch(() => {})
    let persona = await spaced(g.storage, space, env)
    if (persona.length) await g.apply(persona, { trusted: true })
    reached('persona', persona)
    let ctx = await context
    // The platform admin's sessions also read the platform: who they are is
    // read through the whole directory, which the Operator's is not.
    let whole = (options.directory ?? opening(env))()
    let member = writes(ctx.role)
    let acts = member && !heard
    // A reply on a writer's thread goes back to them, and only there.
    let onThread = (
      t: NonNullable<Awaited<ReturnType<typeof threadOf>>>,
    ) =>
      t.kind == 'letter'
        ? given(
          mailSend(env, ctx, space, store),
          { to: t.address, answering: t.reply },
          `Here it writes back to ${t.address} on their own thread, and to nobody else.`,
        )
        : given(
          phoneSend(env, ctx, space, store),
          { to: t.address },
          `Here it texts ${t.address} back, and nobody else.`,
        )
    // Someone who replied to what was sent for a person raises with that
    // person's conversation what needs them (operator-escalate.ts).
    let replied = g.read(
      q`.operator_request.person=${ctx.person}&.operator_request.channel=${REPLIES}&.limit=1&.fields=entity.eid`,
    )
    let [roster, google, platform, [reply], [text]] = await Promise.all([
      operatorRoster(ctx, store, {
        space: space.eid,
        tasked: !!task,
        member,
        session,
        connecting,
        remote,
        trials,
      })
        .then((r) => reached('roster', r)),
      acts ? accounts.then((t) => reached('google', t)) : [],
      !heard && admin({ dir: whole, person: ctx.person! }),
      replied,
      member ? [] : g.read(
        q`.operator_request.session=${await topOf(
          g,
          session,
        )} .operator_request.channel=text,texted .order=-created.at .limit=1 .fields=operator_request.address`,
      ),
    ])
    if (heard) {
      let thread = member && channel == 'escalated'
        ? await threadOf(store, newest?.request)
        : undefined
      return deferred([
        ...roster.filter((t) =>
          t.readOnly || (channel == 'error' && RELEASING.has(t.name))
        ),
        ...member
          ? [
            platformBug(ctx, space),
            textSend(env, ctx, space),
            notificationSend(ctx, space, store),
            ...(await accounts).filter((t) => t.readOnly),
          ]
          : [],
        // What a writer's conversation raised is decided with the person's
        // reads, and answered to that conversation and on the writer's own
        // thread, to them alone (T-151880).
        ...member && channel == 'escalated'
          ? [escalationAnswer(store, ctx, space)]
          : [],
        ...thread ? [onThread(thread)] : [],
        ...(options.tools?.(ctx, files) ?? []).filter((t) => t.readOnly),
      ])
    }
    return deferred([
      ...sessionTools(g, children).filter((t) => t.name == 'fork'),
      // A conversation and its forks hand coding and careful reasoning
      // to the stronger model in a fresh helper, which starts no other.
      ...!(row?.spawned && !row.fork && !topicOf(row))
        ? [
          delegated(
            comp(using, 'using')?.provider == machined
              ? delegateOf((await current(space.eid)).provider)
              : delegates.get(String(comp(using, 'using')?.provider)),
          ),
        ]
        : [],
      ...roster,
      ...text
        ? signupTools(
          env,
          space,
          ctx.person,
          String(comp(text, 'operator_request')!.address),
        )
        : [],
      ...member
        ? [
          platformBug(ctx, space),
          textSend(env, ctx, space),
          contactAdd(env, ctx, space, store),
          notificationSend(ctx, space, store),
          mailSend(env, ctx, space, store),
          phoneSend(env, ctx, space, store),
          phoneNumbers(env, ctx, space, store),
          imageNew(env, space, store),
          ...pickTools(store, ctx.person!),
          ...wakeTools(store),
          ...subscriptionTools(store, watching),
          ...google,
          escalationAnswer(store, ctx, space),
        ]
        : [],
      ...reply ? [escalate(store, space)] : [],
      ...platform ? adminTools(env, whole) : [],
      ...(options.tools?.(ctx, files) ?? []).filter((t) =>
        member || t.readOnly
      ),
      ...member && options.browsers
        ? browserTools(env, space, ctx.person, options.browsers, store)
        : [],
    ])
  }

  // This object's runner, a new one each time the object starts: a Durable
  // Object has one instance at a time, so a call or lease held by any other
  // was held by an instance a reset or a kill ended, and is taken up now
  // (@yaks/tools `whose`), rather than left `running` with nobody to finish it.
  let me = mint()
  let gone = (holder: string) => holder != me
  // What a wake set for a person asks when it fires (operator-schedules.ts
  // `fired`): its call through a runner over the person's tools as they
  // stand now, with this object's claims, and a helper in its occurrence.
  let scheduled: Operator['scheduled'] = async (row, at) => {
    let space = await spaceOf(store)
    if (!space) throw new Error('This Operator store holds no space')
    await fired(store, space, row, at, {
      runner: async (occurrence, ask) => {
        let offered = await roster(occurrence)
        return toolRunner(recorded(g, occurrence, ask.space), {
          tools: offered.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters,
            run: async (asked: Bundle): Promise<Bundle[]> => {
              let answer = await tool.run(
                comp(asked, 'call')?.args as Comp ?? {},
                {
                  session: occurrence,
                  call: asked,
                  entries: await transcript(g, occurrence),
                },
              )
              let call = asked.entity.eid
              return [{
                entity: { eid: '$answer' },
                content: {
                  body: typeof answer == 'string' ? answer : answer.text,
                },
                ...typeof answer == 'string' ? {} : answer.with,
                output: {
                  source: call,
                  ...typeof answer == 'string'
                    ? {}
                    : comp(answer.with as Bundle, 'output'),
                },
              }]
            },
          })),
          owner: me,
          gone,
          report: (e) =>
            caught(e, { request: 'operator scheduled tool', run: occurrence }),
          otherwise: {
            name: 'unavailable',
            description: 'A scheduled tool that is no longer available.',
            run: () => {
              throw new Error(
                'Scheduled tool is no longer available to this person.',
              )
            },
          },
        })
      },
      helper: async (session, ask, brief) => {
        let input = helperInput(session)
        if ((await g.get([input]))[0]) return
        let space = await dir().at(ask.space)
        if (!space || space.trashed) {
          throw refuse('missing', 'That space is gone.')
        }
        let selected = await readying(ask, space)
        await started(session, ask.space, space)
        await g.apply([{
          entity: { eid: input },
          entry: { session, from: 'the system' },
          content: {
            body:
              `You are a scheduled helper. Do this work here and give a short report. Your report stays with this run and reaches nobody: when the person should hear something, tell them yourself with notification_send.\n\n${brief}`,
          },
          using: usingOf(selected.model, selected.provider),
          $actor: { by: ask.space, via: session },
        }], { trusted: true })
        options.tell?.(session)
      },
    })
  }
  let runner = lend({
    h: { g, fx, vocab, me, gone },
    providers: models,
    provider,
    // A summary is asked of the model it answers with now (`current`), its
    // rows written where the store has not met it.
    ...options.name ? { name } : {
      defaultUsing: async () => {
        let own = await current()
        let rows = seed({ provider: own.provider, model: own.model })
        let held = await g.get(rows.map((b) => b.entity.eid))
        if (held.filter(Boolean).length < rows.length) {
          await g.apply(rows, { trusted: true })
        }
        return {
          provider: rows[0].entity.eid,
          model: rows[1].entity.eid,
        }
      },
    },
    // Its text is shown as it is written, once it is stored, so a reset
    // under a reply takes back none of what a person saw.
    streaming: true,
    typed: options.typing,
    context: shown,
    inputSource,
    // The conversation forks for its work.
    tools: [],
    // Each ask wears the space's persona on the platform's base, read from
    // the directory (operator-persona.ts).
    wear: { bases: bases(env) },
    // The skills the space keeps, by title and description, for a session
    // offered skill_read: the same rule as the box's (@yaks/harness).
    requestItems: (_, __, current) => skillItems(g, current),
    // A child works for the same space and person as the session that
    // started it, and is charged to that space.
    prepareChild: async ({ parent, args }) => {
      let o = await workingOf(store, parent)
      if (!o) return {}
      if (!args.topic) return { operator_session: o }
      let ctx = await (await working(env, store, parent, options.directory))
        .ctx
      if (!writes(ctx.role)) return { operator_session: o }
      let topic = await oracleTopic(ctx, g, String(args.topic))
      await oracleContext(ctx, g, topic)
      return {
        operator_session: o,
        session: { persona: ORACLE, topic },
      }
    },
    remote: roster,
    resultText: async (entry) => {
      let session = String(comp(entry, 'entry')?.session)
      let work = await workingOf(store, session)
      if (!work) throw new Error('Operator result has no working session')
      return outputView(
        g,
        entry,
        undefined,
        (value, source) => keepResult(g, value, source, work.person),
      )
    },
    instructionScope: async (session) => {
      let [work, served] = await Promise.all([
        workingOf(store, session),
        servedIn(g, session),
      ])
      return JSON.stringify([
        served.model?.entity.eid,
        served.provider?.entity.eid,
        work?.person,
        work?.administrative,
        work?.signup,
        ANSWERING.has(await channelAt(store, session, work)),
      ])
    },
    // The conversation and its work forks share a short topic map. Only a
    // session opened on a topic carries that topic's compiled context.
    instructions: async (session) => {
      reached('instructing', null)
      let [{ eid, space: at, here, ctx: context }, [row], served] =
        await Promise.all([
          working(env, store, session, options.directory),
          g.read(q`.entity.eid=${session}&.fields=session.topic`),
          servedIn(g, session),
        ])
      let self = serving(
        await topOf(store.g, session),
        served.model,
        served.provider,
      )
      // Reply channels carry no personal server instructions.
      let work = await workingOf(store, session)
      let servers =
        work?.signup || ANSWERING.has(await channelAt(store, session, work))
          ? Promise.resolve('')
          : connectedInstructions(here, operatorAsking(store, eid, session))
      servers.catch(() => {})
      let space = await at
      if (work?.signup) return outside(space) + '\n\n' + SIGNUP
      let topic = topicOf(row)
      let ctx = await context
      // Someone who does not write in the space is told none of its work.
      if (!writes(ctx.role)) {
        return reached(
          'instructions',
          [outside(space, ctx.role), self, await servers].filter(Boolean)
            .join('\n\n'),
        )
      }
      let [map, accounts, said] = await Promise.all([
        topic ? oracleContext(ctx, g, topic) : oracleMap(ctx, g),
        googleTold(env, here, space),
        servers,
      ])
      return reached(
        'instructions',
        [map, told(ctx, space), self, accounts, said].filter(Boolean)
          .join('\n\n'),
      )
    },
    each: (_, session) => void (session && options.tell?.(session)),
    report: (e, where) => caught(e, { request: 'operator', ...where }),
    // Each refusal a tool gave the conversation, with its space
    // (refusals.ts): a connector tool's is its own call's, heard here once.
    refused: hearing(env, async (call) => {
      let session = String(comp(call, 'entry')?.session ?? '')
      return {
        session: session || null,
        space: session ? (await workingOf(store, session))?.space : null,
      }
    }),
  })
  // A turn that waits for its machine is looked at again every half of AWAY,
  // and asked again once it looks able (`away`). Words given meanwhile owe a
  // run of their own, which does not wait.
  fx.handle(stepwise(running(g, {
    ...runner,
    // Its answer goes back the way the words it answers came, however its
    // turn ended: a reply, a failure, or a stop.
    ended: async (session) => {
      await answered(session)
      options.tell?.(session)
    },
    waiting: AWAY / 2,
    answers: async (using, session) =>
      (await runner.answers?.(using, session) ?? true) &&
      !(session && await away(session)),
  })))
  // A helper on its person's machine stopped here is stopped there
  // (operator-helpers.ts `stopOnMachine`).
  fx.handle({
    operator_machine_stop: async (event) => {
      let { stopOnMachine } = await import('./operator-helpers.ts')
      await stopOnMachine(store, machineAt, event.entity.eid)
    },
  })

  // Whoever carries a session on, the newest words' reach applies, and the
  // files it was given stay with it. A person's one conversation says so.
  let carrying = async (
    session: string,
    held: Asker,
    space: Space,
    o: Asking,
    conversation = false,
  ) => {
    // The words read from a file stay on its attachment.
    let files = [
      ...new Map(
        [...(await workingOf(store, session))?.files ?? [], ...o.files ?? []]
          .map(({ text: _, ...f }) => [f.key, f]),
      ).values(),
    ]
    return {
      entity: { eid: session },
      completed: null,
      operator_session: {
        space: space.eid,
        person: held.person,
        channel: o.channel ?? null,
        ...o.signup ? { signup: o.signup } : {},
        administrative: held.administrative ?? null,
        ...conversation ? { conversation } : {},
        ...files.length ? { files } : {},
      },
    }
  }
  // The words given, as the session bus takes them in (@yaks/session
  // `take`): named by their request, or by `id` where none brought them, and
  // with the files they came with, each with the words read from it where
  // the model cannot read it as it is, and the original message's text
  // beside them (`kept`).
  let words = (
    session: string,
    id: string,
    body: string,
    by: string,
    o: Asking,
    kept?: File,
  ): Intake => ({
    session,
    body,
    by,
    id,
    ...o.request ? { item: o.request } : {},
    ...o.from ? { from: o.from } : {},
    ...o.channel ? { channel: channelOf(o.channel, o.framing) } : {},
    files: [...o.files ?? [], ...kept ? [kept] : []].map(attachedOf),
    using: usingOf(o.model, o.provider, o.effort),
    // An error the platform asks the Operator to fix, or what another of
    // its conversations raised, is its own words, not the person's it is
    // said for (unseen.ts).
    system: OWN.has(o.channel ?? ''),
    ...o.call ? { with: { operator_call: { call: o.call, asked: true } } } : {},
  })
  // What the person said before on the subject of the words they now give
  // their conversation, as a note beside those words: what its model no
  // longer has in front of it (@yaks/session `recall`). A recall slower than
  // RECALL or one that fails is reported or left out, and the words go on
  // alone.
  let recalling = recall({
    graph: g,
    meaning: store.meaning,
    report: (e) => void caught(e, { request: 'operator recall' }),
  })
  let before = async (
    session: string,
    text: string,
    held: Asker,
    space: Space,
  ): Promise<Bundle[]> => {
    let body = await recalling.said(text, new Date().toISOString(), {
      by: held.person,
      session,
    })
    return body
      ? [{
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        prompt: { scope: 'local', source: 'operator:earlier' },
        content: { body },
        $actor: { by: space.eid, via: session },
      }]
      : []
  }
  // The decisions waiting on the person, as a note beside their words, so a
  // message that answers one is recorded as its answer (operator-relay.ts
  // `decisionRelay`).
  let waiting = async (
    session: string,
    held: Asker,
    space: Space,
  ): Promise<Bundle[]> => {
    let body = await waitingOn(store, held.person)
    return body
      ? [{
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        prompt: { scope: 'local', source: 'operator:decisions' },
        content: { body },
        $actor: { by: space.eid, via: session },
      }]
      : []
  }
  let started = async (session: string, by: string, space: Space) => {
    let own = await current(space.eid)
    return begin(g, undefined, {
      eid: session,
      persona: personaFor(space.eid),
      by,
      project: space.eid,
      using: usingOf(own.model, own.provider),
    })
  }

  // What any words given need first: the model and persona rows, the space
  // and the person.
  let readying = async (
    held: Asker,
    space: Space,
    asked?: string,
    from?: string,
  ) => {
    let selected = await chosen(
      await current(space.eid),
      asked,
      from,
      servedTo(held, space),
      firstTo(held, space),
    )
    await base()
    await g.apply([
      ...await spaced(g.storage, space, env),
      { entity: { eid: held.person }, person: {} },
    ], { trusted: true })
    return selected
  }

  // Where words for a person go, ready for the session bus to take them in
  // (@yaks/session `take`): their one conversation, begun where it has not
  // been, or the one a sign-up by text has; the model chosen for them; and
  // what is written beside them.
  let listening: Operator['listening'] = async (held, space, o = {}) => {
    let selected = await readying(held, space, o.model, o.provider)
    let session = o.signup
      ? derivedEid(`operator-signup|${space.eid}|${held.person}`)
      : await rootAt(store, space.eid, held.person)
    if (!await conversed(store, session)) {
      await started(session, held.person, space)
    }
    return {
      session,
      using: usingOf(selected.model, selected.provider, o.effort),
      beside: async (words, { files = [], said = '' } = {}) => {
        let channel = words.channel?.name
        let theirs = words.by == held.person && !o.signup && !words.system
        return [
          await carrying(
            session,
            held,
            space,
            { files, channel, ...o.signup ? { signup: o.signup } : {} },
            !o.signup,
          ),
          ...theirs ? await before(session, said, held, space) : [],
          ...theirs ? await waiting(session, held, space) : [],
        ]
      },
      told: () => options.tell?.(session),
    }
  }

  // The person's one conversation begun with another transcript's lines,
  // where it has not begun: one that has is theirs, and keeps what it holds.
  let begunWith: Operator['begunWith'] = async (held, space, lines) => {
    await readying(held, space)
    let session = await rootAt(store, space.eid, held.person)
    if (await conversed(store, session)) return false
    await started(session, held.person, space)
    await g.apply([
      await carrying(session, held, space, { channel: 'chat' }, true),
      ...grafted(lines, session),
    ], { trusted: true })
    return true
  }

  let ask: Operator['ask'] = async (held, space, args, o = {}) => {
    let text = typeof args.say == 'string' ? args.say : ''
    let named = typeof args.task == 'string' ? args.task : o.task
    if (!text.trim()) throw refuse('arguments', 'say what you want done')
    let by = o.by ?? held.person
    let id = o.request ?? crypto.randomUUID()
    let input = inputOf(id)
    // A person's words with no task are the next input of their one
    // conversation with the Operator.
    if (!named) {
      if ((await g.get([input]))[0]) {
        let session = o.signup
          ? derivedEid(`operator-signup|${space.eid}|${held.person}`)
          : await rootAt(store, space.eid, held.person)
        return { task: '', session, input }
      }
      let open = await listening(held, space, o)
      let { reference, file: sourceFile } = await messageReference(
        env,
        space,
        o.source ?? text,
      )
      let given = {
        ...words(open.session, id, text + reference, by, o, sourceFile),
        using: open.using,
      }
      await take(
        g,
        given,
        await open.beside(given, { files: o.files, said: text }),
        { trusted: true },
      )
      open.told()
      return { task: '', session: open.session, input }
    }
    o = { ...o, ...await readying(held, space, o.model, o.provider) }
    let { reference, file: sourceFile } = await messageReference(
      env,
      space,
      o.source ?? String(args.say ?? ''),
    )
    let task = named
    let [old] = await g.get([task])
    if (args.task && !old?.task) {
      throw refuse('missing', `no operator task ${task}`)
    }
    let newest = old ? await taskSession(g, task) : undefined
    let session = newest ?? o.session ?? crypto.randomUUID()
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
    await take(
      g,
      words(
        session,
        id,
        (newest ? text : JSON.stringify({ task: row })) + reference,
        by,
        o,
        sourceFile,
      ),
      [
        await carrying(session, held, space, o),
        ...old
          ? [{
            entity: { eid: derivedEid('operator-comment|' + input) },
            comment: { target: task },
            doc: { body: text },
            $actor: { by },
          }]
          : [],
      ],
      { trusted: true },
    )
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
      channel: channelOf('voice', o.began ? '' : HEARD),
    }
    await g.apply([
      ...fresh ? [fresh] : [],
      {
        entity: { eid: crypto.randomUUID() },
        entry: {
          session,
          from: o.said
            ? 'your voice on the call'
            : o.began
            ? 'the system'
            : 'the person on the phone',
        },
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
  // conversation. Forking and starting helpers are the conversation's own,
  // so they are left out.
  let tools: Operator['tools'] = async (held, space) => {
    let { session, fresh } = await conversing(held, space)
    if (fresh) await g.apply([fresh], { trusted: true })
    let offered = (await roster(session))
      .filter((t) => t.name != spawn.name && t.name != 'fork')
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
        let entry = {
          entity: call.entity,
          content: { body: typeof told == 'string' ? told : told.text },
          ...typeof told == 'string' ? {} : told.with,
        }
        return outputView(
          g,
          entry,
          undefined,
          (value, source) => keepResult(g, value, source, held.person),
        )
      },
    }
  }

  // A conversation an outside agent has with the Operator for the person
  // (@yaks/harness `conversations`): theirs, in the model chosen for it,
  // with the files of theirs it names. Each begins as a fork of the
  // person's own conversation under a private task, which only its closing
  // notice reaches.
  // Words carrying on a task's conversation open the task again, and are
  // said on it.
  let reopened = async ({ session, body, by }: Intake) => {
    let [link] = await g.read(q`.contains .edge.to=${session}`)
    let task = comp(link, 'edge')?.from as string | undefined
    return task
      ? [{ entity: { eid: task }, completed: null, cancelled: null }, {
        entity: { eid: crypto.randomUUID() },
        comment: { target: task },
        doc: { body },
        $actor: { by },
      }]
      : []
  }
  let chats: Operator['chats'] = async (held, space) => {
    // The space is the project it talks in, and the person its owner.
    await readying(held, space)
    return {
      ...conversant(store, { ...held, space: space.eid }),
      given: async (_, words) => {
        let asked = (words.using ?? {}) as Record<string, string | undefined>
        let selected = await chosen(
          await current(space.eid),
          asked.model,
          asked.provider,
          servedTo(held, space),
          firstTo(held, space),
        )
        if (asked.model && selected.model != asked.model) {
          throw await unknown(asked.model, selected.provider)
        }
        let files = await attached(
          store,
          held,
          space,
          words.files?.map((f) => f.address),
        )
        // The words as they were sent are kept as a file the model may read
        // or pass on by its reference.
        let { reference, file } = await messageReference(
          env,
          space,
          words.body,
        )
        return {
          words: {
            ...words,
            body: words.body + reference,
            from: 'an outside agent',
            using: usingOf(selected.model, selected.provider, asked.effort),
            files: [...files, ...file ? [file] : []].map(attachedOf),
          },
          beside: [
            await carrying(words.session, held, space, { files }),
            ...await reopened(words),
          ],
        }
      },
      start: async (_, { words: { session }, said: body }) => {
        let task = derivedEid('operator-chat|' + session)
        await g.apply([{
          entity: { eid: task },
          task: {},
          doc: { title: body.split('\n')[0].slice(0, 160), body },
          filed: { project: space.eid },
          $actor: { by: held.person },
        }], { trusted: true })
        await started(session, held.person, space)
        let parent = await rootAt(store, space.eid, held.person)
        if (!await conversed(store, parent)) {
          await started(parent, held.person, space)
          await g.apply([await carrying(parent, held, space, {}, true)], {
            trusted: true,
          })
        }
        return [
          ...await chatFork(g, parent, session),
          {
            entity: { eid: derivedEid('operator-chat-task|' + session) },
            edge: { from: task, to: session },
            contains: {},
          },
        ]
      },
    }
  }

  // The model that answers words given naming `model` (and `from`, its
  // provider), else the Operator's own, with what any words given need
  // first: one its provider does not list is refused.
  let choose: Operator['choose'] = async (held, space, model, from) => {
    let selected = await readying(held, space, model, from)
    if (model && selected.model != model) {
      throw await unknown(model, selected.provider)
    }
    return selected
  }

  // What to call a person in what the Operator shows of its work.
  let named = (person: string) => dir().nameAt(person)

  return {
    store,
    confirmContact: async (held, id, number, agreed, code) => {
      let space = (await dir().at(held.space))!
      let ctx = await operatorContext(env, held, space, options.directory)
      return confirmTextContact(
        env,
        ctx,
        space,
        store,
        id,
        number,
        agreed,
        code,
      )
    },
    reads,
    listening,
    begunWith,
    ask,
    note,
    tools,
    chats,
    choose,
    children,
    machine: (held, space, session) =>
      reachMachine(space, held.person, () => topOf(g, session)),
    named,
    watching,
    scheduled,
  }
}

/** Where words for a person go ({@link Operator.listening}). */
export type Listening = {
  session: string
  using: Comp
  beside: (
    words: Intake,
    o?: { files?: File[]; said?: string },
  ) => Promise<Bundle[]>
  told: () => void
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
  signup?: string
  framing?: string
  /** Writer of injected words, independent of the person whose access applies. */
  from?: string
  // The call whose talking model asked in these words, for the caller.
  call?: string
  // The model that answers these words, where not the Operator's own (a
  // call's, speech.ts `setupOf`); one its provider does not serve is
  // answered by the Operator's own.
  model?: string
  provider?: string
  // How much that model reasons before it answers (@yaks/model
  // `Request.effort`); its provider's default where absent.
  effort?: string
}
type Asker = Pick<Held, 'person' | 'administrative'>
export type Operator = {
  store: Store
  confirmContact: (
    held: Held,
    id: string,
    number: string,
    agreed: boolean,
    code?: string,
  ) => Promise<{ confirmed: string } | import('./phone-contact.ts').PhoneProof>
  /** What the model that answers `held`'s words in `space` reads as it is,
   * beside text (@yaks/model `Model.reads`). */
  reads: (
    model?: string,
    provider?: string,
    held?: Asker,
    space?: Space,
  ) => Promise<Record<string, number>>
  /** Where words that came for `held` in `space` go, for the session bus to
   * take them in (@yaks/session `take`): their one conversation, begun where
   * it has not been, or the one signing up by text (`signup`, their number);
   * what they are answered by (`using`): the model named, on its provider,
   * where that provider serves it, else the Operator's own;
   * the rows written beside them (`beside`): the conversation carried on
   * with the files they came with and how they came, and for the person's
   * own words what they said before on the subject (`said`, @yaks/session
   * `recall`); and `told`, which wakes whoever watches it once they are in. */
  listening: (
    held: Asker,
    space: Space,
    o?: { model?: string; provider?: string; effort?: string; signup?: string },
  ) => Promise<Listening>
  /** `held`'s one conversation in `space` (operator-root.ts `rootAt`)
   * begun with another transcript's lines (@yaks/session `grafted`): a
   * home-page demo's through the step they stepped in at (stepping.ts
   * `walkedTo`), so the words they give next follow them. A conversation
   * that has begun is left as it is, nothing grafted into it. Answers
   * whether the lines began it. */
  begunWith: (
    held: Asker,
    space: Space,
    lines: Bundle[],
  ) => Promise<boolean>
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
  /** How an outside agent's conversation with the Operator for `held` in
   * `space` goes (@yaks/harness `conversations`). */
  chats: (held: Asker, space: Space) => Promise<Conversing>
  /** The model that answers words given naming `model` (and `provider`),
   * else the Operator's own, with the rows any words given need written: one
   * its provider does not list is refused. */
  choose: (
    held: Asker,
    space: Space,
    model?: string,
    provider?: string,
  ) => Promise<{ provider: string; model: string }>
  /** What a child of one of its sessions is started with (@yaks/session
   * `spawnChild`): on the hosted model, where its parent is answered by a
   * machine. */
  children: ChildLimits
  /** The machine `space`'s tunnel goes to, as `held`'s Operator reaches it
   * in the conversation `session` works for ({@link machineFor}), or null
   * where none serves them. */
  machine: (
    held: Asker,
    space: Space,
    session: string,
  ) => Promise<typeof fetch | null>
  /** What to call a person, as the page names them (directory `nameAt`). */
  named: (person: string) => Promise<string | null>
  /** A subscription's query, read as the person who set it. */
  watching: Watching
  /** One occurrence of a scheduled tool call and its optional checking helper. */
  scheduled: (row: Bundle, at: string) => Promise<void>
}
