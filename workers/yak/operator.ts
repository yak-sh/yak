import { url as hostUrl } from '@yaks/platform/host'
import { chatPath } from '@yaks/platform/routes'
import { line as q, whole as wholeLine } from '@yaks/query'
import { inputSource } from './operator-provenance.ts'
import { inputBody } from '@yaks/platform/operator-source'
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
import { readAt, readOpen, readsOf } from '@yaks/harness/worn'
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
  type Told,
  type Tool,
  topOf,
  transcript,
  usingOf as usingIn,
} from '@yaks/session'
import { passes } from '@yaks/session/turn'
import { derivedEid } from '@yaks/graph/identity'
import { short } from '@yaks/id'
import { CALLED, channelOf, HEARD } from './operator-view.ts'
import { cameBy } from './operator-draw.ts'
import { fetchable } from './newcomer.ts'
import { listing } from '@yaks/mcp'
import {
  type Listed,
  listPrice,
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
import {
  CallError,
  invoke,
  runner as toolRunner,
  unreferenced,
  watched,
} from '@yaks/tools'
import { loadTools, textSearch } from '@yaks/graph/tools'
import { memoryDoc } from '@yaks/memory/vocab'
import { trialDoc } from '@yaks/trial/vocab'
import { type Options as Trials, runs as trialRuns } from '@yaks/trial/tools'
import { ORACLE } from '@yaks/topic'
import { runs as memoryRuns } from '@yaks/memory/tools'
import { memoryAudience } from '@yaks/platform/operator-memory'
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
import { conversant, type Reader, seenBy } from './operator-access.ts'
import { NAMING } from './operator-conversations.ts'
import { writes } from '@yaks/member'
import { inReach } from './declared.ts'
import { connected, reaching } from './agent.ts'
import { coded } from './agent-code.ts'
import { connectedInstructions, connectedTools } from './connected-mcp.ts'
import { decisionRelay, relayTools, waitingOn } from './operator-relay.ts'
import { listsOf } from './operator-lists.ts'
import { ledger } from './ledger.ts'
import { admin, type Args, type Ctx, inSpace, refuse } from './tool.ts'
import type { Caller } from './session.ts'
import { adminTools } from './operator-admin.ts'
import { platformFault } from './unseen.ts'
import { bound, type Env } from './env.ts'
import type { Held } from './build-door.ts'
import { HEED_OPERATOR } from './door.ts'
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
import { embedder, FLOORS, withheld } from './embedding.ts'
import { embeddings } from './metered.ts'
import { readsNote } from './operator-reads.ts'
import {
  ANSWERING,
  confirmOf,
  fromWhom,
  HEARSAY,
  mailSend,
  OWN,
  proofOf,
  replyRows,
  type Request as Requested,
  SMS,
  speaker,
  speakersOf,
  TAKING,
  UNASKED,
  UNPROVEN,
} from './operator-channels.ts'
import { HANDOFF, handoffNote } from '@yaks/platform/operator-handoff'
import { handoffsTool, handoffTool } from './operator-handoff.ts'
import { spacesTool } from './operator-staff.ts'
import { attachedOf, type File } from './operator-files.ts'
import {
  escalate,
  escalationAnswer,
  investigatorOf,
  oddReport,
} from './operator-escalate.ts'
import { rootAt, spaceOf } from './operator-root.ts'
import { textPerson, textSend } from './operator-texts.ts'
import { whereaboutsShow } from './whereabouts.ts'
import {
  acquainted,
  approvals,
  asker,
  confirming,
  ESCALATING,
  type Press,
  type Standing,
} from './operator-approvals.ts'
import { heardIn, unvouched } from './operator-heard.ts'
import { confirmTextContact, contactAdd } from './operator-contacts.ts'
import { SIGNUP, signupTools } from './operator-signup.ts'
import { notificationSend } from './operator-alerts.ts'
import {
  chatRead,
  chatRoomSet,
  chatSend,
  peopleIn,
  privateIn,
  roomsOf,
  spaceRooms,
} from './operator-rooms.ts'
import { PLATFORMS } from './chat.ts'
import { phoneNumbers, phoneSend } from './operator-line.ts'
import { imageNew } from './operator-images.ts'
import { googleAccounts, googleTold, googleTools } from './operator-google.ts'
import { apiCall, integrationsTold } from './operator-integrations.ts'
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
  UNSUBSCRIBABLE,
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
  local = false,
) => {
  let reopen = (fresh = false) => {
    let dir = open()
    let current = fresh && !local
      ? reachOf(dir, { eid }, held.person, held.administrative)
      : reach
    return narrowed(
      dir,
      undefined,
      eid,
      held.administrative,
      local ? [] : current.then((r) => r.beyond),
    )
  }
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
      ...pa || beyond.length ? {} : { space: space.slug, spaceEid: space.eid },
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
  ' Ask the person you work for: the question reaches them in their Updates under Needs you, with a button for each choice, and what they choose comes back to you in your conversation with them. It is shown alone there, read later and apart from this conversation, so its question says in plain words, to them, what it is about and what choosing does. It is also told to them the way they chose to be alerted, so it reaches them away from this conversation; send no notification_send about it. Use it for a choice that is theirs to make (spending money, sending to people, deleting, or a direction their taste settles), not to confirm routine work. A choice can show what it means beside it, by an id in its shows: an image’s attachment id (from image_new, or a file sent in the conversation), a doc’s id for prose, or a draft’s id (from app_files) to show that draft of an app as it stands, each on its own preview, so several directions can be chosen between; an app’s eid shows their own draft of it.'

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

// The conversation and model serving this turn are known only after routing.
// They follow the transcript with the other turn context.
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
    : `The person you are talking with is not a member of ${space.slug}: you have only their permissions, so you see none of the space's apps, rows, conversations or memories, and you can do for them only what they could do themselves. You are a helper with a guest's tools (web search and pages, feedback, the space's public parts, and your answer), not the Operator that works for the space's people. Answer what they ask from what they tell you and what those tools find. What needs one of the space's people (their answer, their choice, their data or their permissions), raise with escalate: who asked and what they want, in a line or two of your own words, and tell them you passed it on.`

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
// Whether a read was refused for an id that names nothing in its store.
let nowhere = (error: unknown) =>
  error instanceof CallError && error.message.includes(' names nothing')
let OWN_ONLY = 'This reads your own store: your conversations and their ' +
  "entries, memories and tasks; an app's rows are read with graph_show"
// Its memories, and the skills the space keeps beside them, are its own
// store's alone (@yaks/harness `skillRead`).
let mine = new Set([
  'memory_save',
  'memory_recall',
  'memory_forget',
  'memory_around',
  skillRead.name,
  // The Reads its persona names, the base's read from the directory.
  'read_open',
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
let connectorConversations = [
  'operator_chat',
  'operator_run',
  'operator_read',
  'helper_spawn',
  'conversation_start',
  'conversation_send',
]
let ownNamed = new Set([
  ...mine,
  ...workNames,
  'mail_send',
  ...connectorConversations,
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
  'graph_query',
  'graph_show',
  'graph_apply',
  'memory_save',
  'memory_recall',
  skillRead.name,
  'read_open',
  'escalate',
])
// What a break's turn changes beyond its reads: the files of the app that
// broke, checked and released, and its errors archived once the fix is seen
// live (unseen.ts `fix`).
let RELEASING = new Set([
  'app_files',
  'app_preview',
  'app_deploy',
  'app_errors',
])

// Why a turn whose words came from outside the space (operator-channels.ts
// `HEARSAY`) holds only some of the Operator's tools, as `tool_load` tells it
// of the rest (@yaks/session `withheld`).
let OUTSIDE =
  'this turn answers words from outside the space (a break, or what ' +
  'visitors wrote), so it holds reads, telling ' +
  'the person, and for a break app_files, app_preview, app_deploy and ' +
  "app_errors; do the work with those. The person's own next message gives " +
  'back every tool.'

// Why a member's turn on RCS (operator-channels.ts `UNPROVEN`) holds only
// some of the Operator's tools.
let TEXTED =
  'this turn answers an RCS message, whose sender number can be faked, so it ' +
  'holds reads, telling the person, and its answer, which goes by text to ' +
  'their number. Anything that changes the space or sends elsewhere waits ' +
  'for them to ask in their chat, where a link in your answer signs them in, ' +
  'or by email; tell them so.'

// Whether words on `channel` are proven the person's own, so their turn
// reaches the servers they connected: not a reply from someone outside the
// space (`ANSWERING`) nor a text, whose number anyone can show (`UNPROVEN`).
let proven = (channel: string) =>
  !ANSWERING.has(channel) && !UNPROVEN.has(channel)

// What anyone's turn holds beside reads, member or not: telling the platform
// what they found. Web search and page reads are the provider's own, offered
// to every turn.
let OPEN = new Set(['feedback'])

// What a turn on words from outside the space keeps of a member's own tools:
// telling the person, and reporting a platform bug.
let TELLING = new Set(['platform_bug', 'text_send', 'notification_send'])

// The tools a turn holds, and the rest withheld with why.
let holding = (tools: Tool[], held: (t: Tool) => boolean, why: string) =>
  tools.map((t) => held(t) ? t : { ...t, withheld: why })

// The tools whose answer in words is the platform's own: a receipt of what
// the call did, or what the space's own people and its Operator wrote (its
// apps' files and settings, its memories, tasks, wakes and trials). Every
// other answer is `heard` unless it is made only of rows no stranger wrote
// (operator-heard.ts `heardIn`, T-1860): a command's display, a page, a
// calendar, a letter, the gallery, a sandbox's output. The mark tells the
// model whose words it reads; it takes no tool away. A tool answers rows, or
// is named here once its words are known to be the space's own. code_mode and a child session stamp their own
// answer from what they heard, an app command its own unless it only says
// what it wrote (@yaks/platform/app-command `commandReply`), the
// integration directory its own when it lists what an owner wrote, the
// gallery (app_published) its own when it lists any offer, and library_add its
// own when a page is named by its site's title. The unseen errors a write's
// answer carries say whose words they quote (unseen.ts `unseenBlock`).
let OWN_WORDS = new Set([
  // the space, its apps, their files, releases and settings
  'graph_schema',
  'space_new',
  'space_set',
  'space_delete',
  'space_restore',
  'space_sell',
  'app_new',
  'app_files',
  'app_deploy',
  'app_versions',
  'app_rollback',
  'app_set',
  'app_delete',
  'app_restore',
  'app_erase',
  'app_list',
  'app_publish',
  'app_unpublish',
  'app_published',
  'app_rate',
  'app_secret_set',
  'app_secret_list',
  'app_secret_remove',
  'commands',
  'sandbox_write',
  'sandbox_stop',
  'sandbox_ship',
  'store_load',
  'store_restore',
  'store_retry',
  'store_effect_retry',
  'domain_attach',
  'domain_status',
  'domain_detach',
  'member_add',
  'member_remove',
  'grant',
  'screen_pair',
  'feedback',
  'guide',
  'about',
  'operator_remove',
  'operator_stop',
  'operator_retry',
  'library_add',
  'library_remove',
  'connection_attach',
  'connection_lend',
  'connection_need',
  'connection_list',
  'service_connect',
  'integration_publish',
  'integration_set',
  'integration_list',
  'mcp_connect',
  'mcp_remove',
  'number_find',
  'number_buy',
  'number_assign',
  'number_release',
  'number_verify',
  'number_status',
  'search_sitemap',
  'builder_choose',
  'builder_build',
  'builder_supply',
  'store_builder_build',
  'store_builder_supply',
  'store_builder_choose',
  'store_memory_save',
  'store_memory_forget',
  'store_connection_need',
  'store_connection_list',
  'store_mail_send',
  'mail_reply',
  'code_mode',
  'command',
  // the Operator's own work
  'memory_save',
  'memory_recall',
  'memory_forget',
  'memory_around',
  'trial_pass',
  'trial_hold',
  'trial_tally',
  'trial_plan',
  'trial_match',
  'trial_cap',
  'trial_adopt',
  'trial_pairs',
  'trial_pick',
  'task_new',
  'task_list',
  'task_update',
  'decision_new',
  'decision_relay',
  'goal_new',
  'goal_list',
  'goal_update',
  'skill_read',
  'read_open',
  'fork',
  'spawn',
  // what the person's own doors sent, set and hold
  'platform_bug',
  'text_send',
  'whereabouts_show',
  'contact_add',
  'notification_send',
  'mail_send',
  'phone_send',
  'phone_numbers',
  'image_new',
  'wake_set',
  'wake_list',
  'wake_cancel',
  'subscription_set',
  'subscription_list',
  'subscription_cancel',
  'escalate',
  'escalation_answer',
  'odd_report',
  'calendar_add',
  'gmail_send',
  'gmail_draft',
  'admin_budget',
  'admin_fee',
])

// An answer recorded as `heard`.
let heardOf = (said: Told): Told =>
  typeof said == 'string'
    ? { text: said, with: { heard: {} } }
    : { ...said, with: { ...said.with, heard: {} } }

// A tool whose answer is words, as the turn hears them: `heard`, unless its
// words are its own (`OWN_WORDS`).
let attended = (t: Tool): Tool =>
  OWN_WORDS.has(t.name) ? t : {
    ...t,
    run: async (args, context) => heardOf(await t.run(args, context)),
    ...t.recover && {
      recover: async (args, context) => {
        let said = await t.recover!(args, context)
        return said === undefined ? said : heardOf(said)
      },
    },
  }

// What a caller other than a turn's own runner offers: the tools it holds.
let offerable = (tools: Tool[]) => tools.filter((t) => !t.withheld)

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

// What a tool's description says when a subscription can watch its answer.
let SUBSCRIBABLE =
  ' Subscribable: subscription_set with this tool and its args watches its answer live.'

// A tool whose declaration names the query it answers (@yaks/tools
// `watched`), as the Operator offers it: its description says it can be
// subscribed to, and `watch` says the query for a call's arguments, over the
// Operator's own store when it reads there (`local`).
let watchOf = (
  t: Pick<NamedTool, 'name' | 'watch'>,
  local: boolean,
): Tool['watch'] =>
  t.watch &&
  ((args) => {
    let said = watched(t.watch!, args)
    if ('refused' in said) {
      throw new CallError(
        'arguments',
        `A subscription to ${t.name} watches the query it answers, which ${said.refused} plays no part in: leave ${said.refused} out`,
      )
    }
    return { query: said.query, ...local ? { local } : {} }
  })
let watchable = (
  tool: Tool,
  t: Pick<NamedTool, 'name' | 'watch'>,
  local: boolean,
): Tool => {
  let watch = watchOf(t, local)
  return watch
    ? { ...tool, description: tool.description + SUBSCRIBABLE, watch }
    : tool
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
    unscripted,
  }: {
    space: string
    tasked?: boolean
    member?: boolean
    session?: string
    remote?: boolean
    /** who would answer a trial's calls, which prices a round */
    trials?: Trials
    /** the tools code_mode's scripts may not call (agent-code.ts) */
    unscripted?: Set<string>
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
  let self = seenBy(work, { person: ctx.person, member })
  let memories = member
    ? loadTools([memoryDoc], memoryRuns()).map((t) =>
      t.name == 'memory_save' ? memoryAudience(t, ctx.person) : t
    )
    : []
  let own = new Map(
    member
      ? [
        ...listing({ graph: self, search: textSearch(self) }),
        ...memories,
        ...loadTools([trialDoc], trialRuns(trials)),
        ...held(),
        skillRead,
      ].map(namedTool).map((t) => [t.name, t])
      : [],
  )
  // Every turn opens the Reads its persona lists, a stranger's helper's too:
  // the tool reaches only those, so it reads the whole store.
  let wear = { bases: bases(ctx.env) }
  let reads = namedTool(readOpen(wear))
  // An id given to a tool that names nothing there may be a Read's: its
  // refusal says to open it with read_open.
  let aRead = async (args: Record<string, unknown>, session?: string) => {
    let ids = Object.values(args).filter((v) => typeof v == 'string')
    if (!session || !ids.length) return
    let names = await readsOf(work.g, session, wear)
    let id = ids.find((v) => readAt(work.g, names, v as string, false))
    return id && `${id} is one of your Reads: open it with read_open`
  }
  // What the model reads of an answer from the Operator's own store is drawn
  // (operator-store.ts `readable`): an eid in its prose as the entity's id.
  // An answer is `heard` (operator-heard.ts) unless its words are the
  // tool's own or it is made only of rows no stranger wrote: in the
  // Operator's own store, rows that are not hearsay (`heardIn`); in the apps,
  // rows no app or stranger wrote (`unvouched`).
  let hears = async (
    t: { name?: string },
    out: Bundle[],
    from: 'own' | 'apps' | 'remote' = 'apps',
  ) =>
    !OWN_WORDS.has(t.name ?? '') &&
    (from == 'own'
      ? await heardIn(self, out)
      : await unvouched(g, ctx.dir, reach, ctx.person, space, out))
  let run = (
    t: NamedTool,
    host: Graph,
    target: Graph,
    from: 'own' | 'apps' | 'remote',
    elsewhere?: string,
  ): Tool['run'] =>
  async (args, context) => {
    try {
      return await ran(t, host, target, from)(args, context)
    } catch (error) {
      if (!nowhere(error)) throw error
      let more = (await aRead(args, context?.session)) ?? elsewhere
      if (!more) throw error
      let { code, message } = error as CallError
      throw new CallError(code, `${message}. ${more}`)
    }
  }
  let ran = (
    t: NamedTool,
    host: Graph,
    target: Graph,
    from: 'own' | 'apps' | 'remote',
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
      throw new CallError(
        String(comp(refusal, 'refusal')?.code),
        String(comp(refusal, 'content')?.body),
      )
    }
    if (fault) throw fault
    let said = from == 'own' ? await work.readable(out) : out
    // A connected server or code_mode can stamp its own answer `heard`.
    // Preserve that stamp even if the server answered with an error.
    let heard = out.some((b) => b.heard) ||
      await hears(t, out, from)
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
  let recovery = (
    t: NamedTool,
    host: Graph,
    target: Graph,
    from: 'own' | 'apps' | 'remote',
  ): Pick<Tool, 'recover'> => {
    if (!t.recover) return {}
    return {
      recover: async (args, context) => {
        let found = false
        let read = run(
          {
            ...t,
            applied: true,
            run: async (call, graph) => {
              let answer = await t.recover!(call, graph)
              found = answer.length > 0
              return answer
            },
          },
          host,
          target,
          from,
        )
        let answer = await read(args, context)
        if (found) return answer
      },
    }
  }
  let shaped = (t: NamedTool) => ({
    name: t.name,
    ...t.title ? { title: t.title } : {},
    ...t.step ? { step: t.step } : {},
    description: (BULK[t.name] ?? '') + t.description,
    // Its run resolves each id where the tool reads (`invoke`), never
    // first in the conversation's store.
    parameters: unreferenced(inputSchemaOf(t)),
    readOnly: t.readOnly,
  })
  // Every tool the connector lists for the person (agent.ts `connected`), to
  // the conversation and each of its forks alike: the list heads the request,
  // so one list keeps the conversation's cached prefix for every fork.
  let remote = reached('connected', await connecting)
  let calls = session ? recorded(work.g, session, space) : work.g
  let apps = listing(coded(
    {
      ...connected(ctx, reach, g),
      calls: ledger(g, calls),
      ...member ? { own: { tools: memories, graph: self, calls } } : {},
      report: (e) => caught(e, { request: 'operator code mode' }),
      refused: hearing(ctx.env, () => ({ space, session })),
      hears: (t, out) =>
        hears(t, out, memories.some((m) => m.name == t.name) ? 'own' : 'apps'),
      unscripted: new Set([...connectorConversations, ...unscripted ?? []]),
    },
    ctx,
    { graph: work.g, person: ctx.person, space },
    remote,
  )).map(namedTool)
    .filter((t) =>
      !ownNamed.has(t.name) && (member || t.readOnly || OPEN.has(t.name))
    )
  return [
    ...remote.map(namedTool).map((t): Tool => ({
      ...shaped(t),
      run: run(t, g, landing, 'remote'),
      ...recovery(t, g, landing, 'remote'),
    })),
    // Their own words, sent on to their machine as theirs: only someone who
    // writes in the space, as the rest of what changes anything is. What
    // they answer is a receipt of the relay, in the platform's words.
    ...member
      ? [
        ...relayTools(ctx, work, remote, (s) => topOf(work.g, s), asking),
        decisionRelay(ctx, work, (s) => topOf(work.g, s)),
      ]
      : [],
    ...apps.map((t): Tool => {
      let ours = own.get(t.name)
      let there = run(t, g, landing, 'apps', ours && IN_OWN)
      if (!ours) {
        return watchable(
          { ...shaped(t), run: there, ...recovery(t, g, landing, 'apps') },
          t,
          false,
        )
      }
      let here = run(ours, self, self, 'own', IN_APPS)
      let tool = shaped(t)
      // Watched as it is read: over the apps, or with self over its own
      // store.
      let overApps = watchOf(t, false), overOwn = watchOf(ours, true)
      return {
        ...tool,
        ...(overApps || overOwn) && {
          description: tool.description + SUBSCRIBABLE,
          watch: ({ self: reads, ...args }: Record<string, unknown>) => {
            let { space: _, app: __, ...mine } = args
            let watch = reads ? overOwn : overApps
            if (!watch) throw new CallError('arguments', UNSUBSCRIBABLE(t.name))
            return watch(reads ? mine : args)
          },
        },
        ...(t.recover || ours.recover) && {
          recover: ({ self: reads, ...args }, context) => {
            let { space: _, app: __, ...own } = args
            return reads
              ? recovery(ours, self, self, 'own').recover?.(own, context)
              : recovery(t, g, landing, 'apps').recover?.(args, context)
          },
        },
        parameters: {
          ...tool.parameters,
          properties: {
            ...tool.parameters.properties as Record<string, unknown>,
            self: SELF,
          },
        },
        // Its own store is one store, so the app and space that narrow a
        // read of the apps name nothing there. An id the apps do not hold
        // is read there too, since an eid names one entity in one store, and
        // refused as the apps refused it when that store holds none either.
        run: async ({ self: reads, ...args }, context) => {
          let { space: _, app: __, ...own } = args
          if (reads) return here(own, context)
          try {
            return await there(args, context)
          } catch (error) {
            if (!nowhere(error)) throw error
            return await Promise.resolve(here(own, context)).catch(() => {
              throw error
            })
          }
        },
      }
    }),
    { ...shaped(reads), run: run(reads, work.g, work.g, 'own') },
    ...[...own.values()]
      .filter((t) => mine.has(t.name) || workNames.has(t.name))
      .map((t) => {
        let tool = watchable(
          {
            ...shaped(t),
            run: run(t, self, self, 'own', OWN_ONLY),
            ...recovery(t, self, self, 'own'),
          },
          t,
          true,
        )
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
    return { provider: MACHINE, name: first.model }
  }
  let chosen =
    agents.operator.find((c) => ready(env, c.provider, operatorProviders)) ??
      agents.operator.at(-1)!
  return { provider: chosen.provider, name: chosen.model }
}

/**
 * The hosted models a step asked of `asked` goes on to where its provider
 * says that model is retired or unknown (@yaks/model `onward`), in order:
 * `asked`, the models its space may be answered with (`own`), then each of
 * `choices` (config.ts `agents.operator`) whose provider `serves`.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { chainOf } from './operator.ts'
 * let choices = [
 *   { provider: 'a', model: 'a1' },
 *   { provider: 'b', model: 'b1' },
 *   { provider: 'c', model: 'c1' },
 * ]
 * let serves = (p: string) => p != 'c'
 * let names = (asked: { provider: string; model: string }) =>
 *   chainOf(asked, [{ provider: 'b', model: 'b2' }], choices, serves)
 *     .map((c) => c.provider + ':' + c.model)
 * equal(names({ provider: 'x', model: 'old' }), ['x:old', 'b:b2', 'a:a1', 'b:b1'])
 * equal(names({ provider: 'a', model: 'a1' }), ['a:a1', 'b:b2', 'b:b1'])
 * equal(names({ provider: 'b', model: 'b2' }), ['b:b2', 'a:a1', 'b:b1'])
 * ```
 */
export let chainOf = (
  asked: Choice,
  own: Choice[],
  choices: Choice[],
  serves: (provider: string) => boolean,
): Choice[] => {
  let all = [asked, ...own, ...choices.filter((c) => serves(c.provider))]
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
  // The number the links its privileged acts wait on are texted to
  // (operator-channels.ts `confirmOf`).
  confirm?: string
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
// The number the links a session's privileged acts wait on are texted to
// (operator-channels.ts `confirmOf`): as its words were carried, or for a
// session carried before that was kept, from its conversation's newest words.
let confirmAt = async (store: Store, session: string, work?: Working) => {
  if (work?.confirm) return work.confirm
  let channel = await channelAt(store, session, work)
  if (!SMS.has(channel) && channel != 'voice') return undefined
  let request = (await requestAt(store, session))?.request
  return confirmOf({ channel, address: request?.address })
}
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
/** Whom a step of a conversation acts for: its person, or, in a room the
 * space hears in full (chat.ts `arrived`), whose conversation is a guest's
 * standing for the room, the member who wrote its newest words, with that
 * member's tools (T-2089). A chat platform's words are kept as their writer's
 * only when their account there is linked to them; anyone else's are a
 * guest's, who holds no seat, so the room's guest acts for them. */
export let actorOf = async (
  store: Store,
  session: string,
  o: Working,
  dir: Pick<Directory, 'role'>,
): Promise<Working> => {
  let [newest] = await store.g.read(
    q`.entry.session=${await topOf(
      store.g,
      session,
    )} .intake .order=-entry.seq .limit=1 .fields=channel.name,created.by`,
  )
  let writer = comp(newest, 'created')?.by as string | undefined
  if (
    !writer || writer == o.person ||
    !PLATFORMS.has(String(comp(newest, 'channel')?.name))
  ) return o
  return await dir.role({ eid: o.space }, writer)
    ? { ...o, person: writer, administrative: undefined }
    : o
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
  let held = await workingOf(store, session)
  if (!held) throw new Error(`Operator session ${session} names no space`)
  let reading = open ?? opening(env)
  let dir = reading()
  let o = await actorOf(store, session, held, dir)
  // The space, the person's reach in it, the apps the step's roster and
  // map read next, whether the person is the platform's admin (which the
  // roster and the machine ask) and their Google accounts are asked at once:
  // the directory answers them together, and the step's later asks are
  // answered from these (lib/hops.ts `recall`). What needs only the person
  // and the space's eid is read through `here`; `ctx` waits for the space
  // and the reach.
  let channel = await channelAt(store, session, o)
  let reach = reachOf(dir, { eid: o.space }, o.person, o.administrative)
  if (channel == HANDOFF) {
    reach = reach.then(({ role }) => ({ role, pa: false, beyond: [] }))
  }
  let apps = dir.reachable(o.person)
  let platform = admin({ dir, person: o.person })
  let space = (open?.() ?? directoryOf(env.STORE)).at(o.space).then((s) => {
    if (!s || s.trashed) throw refuse('missing', 'That space is gone.')
    return s
  })
  let openedFor = opened(
    env,
    o,
    o.space,
    space,
    reading,
    reach,
    session,
    channel == HANDOFF,
  )
  let remote = !o.signup && channel != HANDOFF && proven(channel)
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
  subject: 'I started your work again',
  words:
    "Something you asked me for stopped because of a problem in yaks.app. That problem is fixed now, so I started again from where it stopped. You don't need to do anything, and you can reply with any question.",
}

// The way a request is answered: its channel, and whom it reaches by it, the
// same for every request said in one group text, whoever in it wrote it.
let routeOf = (request?: Comp) => {
  let group = request?.group as string[] | undefined
  return JSON.stringify([
    request?.channel ?? '',
    group ? [request?.address, ...group].sort().join() : request?.address ?? '',
    request?.reply_to ?? '',
    request?.via ?? '',
  ])
}

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
  wake: () => 'doing something you set me to do later',
  subscription: () => 'looking into a change I watch for you',
  escalated: () => 'handling a reply someone sent you',
  decision: () => 'following up on your answer',
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
    let eid = await spaceOf(store)
    let space = eid ? await dir().at(eid) : null
    if (!space || space.trashed) throw refuse('missing', 'That space is gone.')
    let ctx = await operatorContext(
      env,
      { person },
      space,
      options.directory ?? opening(env),
    )
    // A watch's query is its own, as the subscription wrote it.
    if (local) {
      return await seenBy(store, { person, member: writes(ctx.role) })
        .read(wholeLine(query))
    }
    // Each app it reads is asked to tell this store of its commits, so the
    // subscription looks again at once rather than on a clock (graph.ts
    // `#heed`).
    let heed = { [HEED_OPERATOR]: space.eid }
    let reach = (await inReach(ctx)).map((r) => ({
      ...r,
      headers: { ...r.headers, ...heed },
    }))
    return await (await reaching(ctx, reach)).read(wholeLine(query))
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
  // Operator's helpers do. A helper runs on a machine only where helper_spawn
  // names one.
  let machined = identityEid('provider', [MACHINE])
  let children: ChildLimits = {
    using: async (u) => {
      if (u.provider != machined) return u
      let hosted = await current()
      return { ...u, provider: hosted.provider, model: hosted.model }
    },
  }
  let spawn = sessionTools(g, {
    ...children,
    childProperties: { topic: TOPIC },
  })
    .find((t) => t.name == 'spawn')!
  // A child session (`spawn`) whose answer comes back to the one that
  // asked, on the model the session is on: an app or space oracle consulted.
  let consulting: Tool = {
    ...spawn,
    description:
      `${spawn.description} To consult an app or space oracle, supply topic from the Oracles map and the question as prompt. Its answer comes back automatically.`,
  }
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
  let catalogued = async (model: string) => {
    let row = await listingOf(bases(env), model)
    let long = listPrice(model)?.cache_write_12h
    return row?.price && long != null && row.price.cache_write_12h == null
      ? { ...row, price: { ...row.price, cache_write_12h: long } }
      : row
  }
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
          ...!options.model && from != 'openai' && from != 'anthropic' &&
              req.turnContext?.length
            ? {
              items: [...req.items, ...req.turnContext],
              turnContext: undefined,
              cachePrefix: undefined,
            }
            : {},
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
        result: resultOf(env, modelResults(g), implementations),
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
      let own = namesFor(req.model, agents.machine)
        .map((name) => ({ model: lent, name }))
      return await unasked(await sessionOf(req.call)) ? own : [
        ...own,
        { model: models[hosted.provider], name: hosted.model, hosted: true },
      ]
    }, fell),
    { result: resultOf(env, modelResults(g), implementations) },
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
    let active = space ? await dir().at(space) : null
    if (space && (!active || active.trashed)) return false
    let rerun = !!space && request == 'operator conversation'
    let sent = filed(Error(`Operator could not finish: ${fault}`), {
      request,
      session,
      space: active?.slug ?? null,
      ...rerun ? { rerun: space } : {},
    })
    if (!rerun || !sent) return true
    let { faultOf } = await import('@yaks/tracker')
    await g.apply([{
      entity: { eid: session },
      stalled: { fault: faultOf(sent) },
    }], {
      trusted: true,
    })
    return true
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
      subject: `I couldn't finish ${doing}`,
      words:
        `I was ${doing} when something went wrong on yaks.app's side, so I stopped before finishing. The people who run yaks.app have been told. You don't need to do anything, and you can reply to ask me to try again.`,
      ...asked.app ? { about: String(asked.app) } : {},
      by: space,
      via: session,
      id: 'stopped|' + r.entity.eid,
    })]
  }
  // `carrying`: a reply said while newer words wait, whose turn goes on to
  // them; only the words it answers hear from it now.
  let answered = async (session: string, carrying = false) => {
    let [row] = await g.get([session], ['spawned', 'occurrence'])
    if (carrying && row?.occurrence) return
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
      let handoff = comp(r, 'operator_request')?.channel == HANDOFF
      let carrier = handoff ? undefined : carriers.get(route)
      if (!carrier && !handoff) carriers.set(route, eid)
      return {
        entity: { eid },
        ...reply.broke && handoff ? { failed: { reason: reply.text } } : {},
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
    // A turn that passed (@yaks/session/turn) sends nothing, and one that
    // answers several messages said in one room answers there once, to the
    // newest.
    let heard = passes(reply.text) ? [] : reply.given.flatMap((b) => {
      let item = comp(b, 'intake')?.item
      let channel = String(comp(b, 'channel')?.name ?? '')
      return item && TAKING.has(channel)
        ? [{ item: String(item), channel }]
        : []
    })
    let from = heard.length && space ? await dir().at(space) : undefined
    let items = from ? await g.get(heard.map((h) => h.item)) : []
    let room = (i: number) =>
      `${heard[i].channel}|${comp(items[i], 'chat_message')?.room ?? i}`
    let newest = new Map(heard.map((_, i) => [room(i), i]))
    let people = await Promise.all(heard.map((_, i) => {
      let at = comp(items[i], 'chat_message')?.room
      return at && newest.get(room(i)) == i ? peopleIn(env, g, String(at)) : []
    }))
    let sent = heard.flatMap(({ channel }, i) =>
      items[i] && !items[i].operator_request && from &&
        newest.get(room(i)) == i
        ? replyRows(env, from, channel, items[i], {
          eid: derivedEid(
            `operator-reply|${items[i].entity.eid}|${mark.entity.eid}`,
          ),
          text: reply.text,
        }, people[i])
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
    if (
      reply.fault && !kept &&
      !await unfinished(session, reply.fault, 'operator conversation')
    ) return
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
    let continued = !reply.broke && !passes(reply.text) && reply.text.trim() &&
        space
      ? requests.find((r) => comp(r, 'operator_request')?.channel == 'decision')
      : undefined
    let handoffs = space
      ? requests.filter((r) => comp(r, 'operator_request')?.channel == HANDOFF)
      : []
    await g.apply([
      ...await Promise.all(handoffs.map(async (r) => {
        let request = comp(r, 'operator_request')!
        let root = await rootAt(store, space!, String(request.person))
        return handoffNote(
          root,
          mark.entity.eid,
          space!,
          `Replied to ${request.address}'s Operator.\n\n${reply.text}`,
        )
      })),
      ...continued
        ? [notification({
          to: String(comp(continued, 'operator_request')!.person),
          subject: 'Follow-up to your answer',
          words: reply.text,
          by: space,
          via: session,
          id: 'decision-follow-up|' + mark.entity.eid,
        })]
        : [],
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
  // A member's privileged acts wait for their tap (operator-approvals.ts):
  // `confirm` names the number its links are texted to, and left out, the
  // session's own words say (`confirmAt`). An act a tap `approved` asks
  // nothing again.
  let roster = async (
    session: string,
    o: { confirm?: string; approved?: boolean } = {},
  ): Promise<Tool[]> => {
    reached('tools', null)
    // A step its person's machine answers reaches for the machine now, beside
    // its roster: what that reads of the directory is read once a step
    // (lib/hops.ts `recall`), so the step finds it read when it is sent.
    Promise.resolve(g.read(
      q`.entry.session=${session} .using .order=-entry.seq .limit=1 .fields=using.provider`,
    )).then(([using]) => {
      if (
        comp(using, 'using')?.provider == identityEid('provider', [MACHINE])
      ) {
        return machineAt(session)
      }
    }).catch(() => {})
    let [{ eid, space: at, here, ctx: context, files }, task, [row]] =
      await Promise.all([
        working(env, store, session, options.directory),
        taskOf(store, session),
        g.read(
          q`.entity.eid=${session}&.fields=spawned.parent,fork.from,session.topic`,
        ),
      ])
    // The person's servers need only them and the space's eid, so they are
    // asked beside the reach and the space.
    let work = await workingOf(store, session)
    let channel = await channelAt(store, session, work)
    let confirm = o.confirm ?? await confirmAt(store, session, work)
    // A turn started by words nobody in the space wrote (operator-channels.ts
    // `HEARSAY`) holds only what keeps the space's data with its person. A
    // turn the person started keeps every tool they hold: what others said in
    // the room, or a tool's answer, is marked `heard` and read as information,
    // never instructions, and takes none of their tools away (T-1902).
    let heard = HEARSAY.has(channel)
    let remote = !work?.signup && channel != HANDOFF && proven(channel) &&
      !heard
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
    // A member known only by the number they texted from is heard as anyone
    // showing it would be.
    let texted = member && UNPROVEN.has(channel)
    heard ||= texted
    let acts = member && !heard
    // A turn that holds no escalating tool asks for no tap.
    let asking = acts && !o.approved
    let [roster, google, platform, [text], rooms, wide] = await Promise.all([
      operatorRoster(ctx, store, {
        space: space.eid,
        tasked: !!task,
        member,
        session,
        connecting,
        remote,
        trials,
        // A tap confirms an escalating call only when it is called direct.
        ...asking ? { unscripted: new Set(Object.keys(ESCALATING)) } : {},
      })
        .then((r) => reached('roster', r)),
      acts ? accounts.then((t) => reached('google', t)) : [],
      !heard && channel != HANDOFF &&
      admin({ dir: whole, person: ctx.person! }),
      member ? [] : g.read(
        q`.operator_request.session=${await topOf(
          g,
          session,
        )} .operator_request.channel=text,texted .order=-created.at .limit=1 .fields=operator_request.address`,
      ),
      roomsOf(store, session),
      acts ? spaceRooms(store) : [],
    ])
    // Addressed in a chat room, it reads back what was said there, and
    // anything else a member there could see. From any turn it writes there,
    // and from a member's own turn in any room of the space, to answer a
    // request where it was asked.
    // Where it holds none, tool_load says why, since the persona names it in
    // every space.
    let chat = [
      ...rooms.length ? [chatRead(env, store, speakersOf(env, space))] : [],
      // An owner says which rooms are private (operator-route.ts).
      ...rooms.length && acts && ctx.role == 'owner'
        ? [chatRoomSet(store)]
        : [],
      acts && wide.length
        ? chatSend(env, store, true)
        : rooms.length
        ? chatSend(env, store)
        : {
          ...chatSend(env, store),
          withheld: acts
            ? 'nobody has addressed you in a chat room (a Discord channel) in this space yet, so there is none to write in'
            : 'nobody addressed you in a chat room in this conversation',
        },
    ]
    // Any service's API: a room's platform on any turn there, the person's
    // connections on their own (operator-integrations.ts).
    let vias = rooms.map((r) => r.via)
    let api = (acting: boolean) =>
      acting || vias.length
        ? [apiCall(env, space, { ...acting ? { ctx } : {}, store, vias })]
        : []
    // The tools this turn holds, once they are listed: a subscription to a
    // reading tool finds it there by name.
    let listed: Tool[] = []
    let kept = (tools: Tool[]) => (listed = tools)
    let hold = (name: string) =>
      listed.find((t) => t.name == name && !t.withheld)
    // What a member's turn holds beyond the space's tools: their alerts,
    // texts, mail, numbers, wakes and subscriptions.
    let mine = () => [
      platformBug(ctx, space),
      textSend(env, ctx, space),
      whereaboutsShow(env, ctx.person!, space.eid),
      contactAdd(env, ctx, space, store),
      notificationSend(ctx, space, store),
      mailSend(env, ctx, space, store),
      phoneSend(env, ctx, space, store),
      phoneNumbers(env, ctx, space, store),
      imageNew(env, space, store),
      ...pickTools(store, ctx.person!),
      ...wakeTools(store),
      ...subscriptionTools(store, watching, hold),
      escalationAnswer(store, ctx, space),
    ]
    // Any turn may report an odd request for a guest-tooled helper to look
    // into, but that helper itself.
    let odd = ctx.person == investigatorOf(space.eid)
      ? []
      : [oddReport(store, ctx, space, children)]
    // Every tool beside the roster's, whose answers its own runner hears
    // (`operatorRoster`), answers as the turn hears it (`attended`).
    let ruled = new Set(roster.map((t) => t.name))
    let listened = (tools: Tool[]) =>
      tools.map((t) => ruled.has(t.name) ? t : attended(t))
    // A member's privileged acts wait for their tap: on a link texted to
    // their number, on a card in their chat, or on a link given in the answer
    // (operator-approvals.ts). In a private room, anyone whose role allows
    // one may vouch for them; one their role does not allow waits for
    // someone's whose does (operator-route.ts).
    let closed = asking && PLATFORMS.has(channel) &&
      await privateIn(store, session)
    let confirmed = (tools: Tool[]) =>
      asking
        ? deferred(confirming(
          tools,
          asker(
            env,
            store,
            space,
            {
              person: ctx.person!,
              session,
              number: confirm,
              chat: channel == 'chat',
              private: closed,
              // A turn from a chat room asks there, privately.
              ...PLATFORMS.has(channel) && rooms[0] ? { room: rooms[0] } : {},
            },
            (to, words) => textPerson(env, space, to, words),
            Date.now,
            {
              seats: () => ctx.dir.roles(space),
              names: async (people) =>
                (await Promise.all(
                  people.map(async (p) => await named(p) ?? 'someone'),
                )).join(' or '),
            },
          ),
          {
            role: ctx.role ?? undefined,
            known: acquainted(store, async () => {
              let people = await ctx.dir.persons(await ctx.dir.members(space))
              return [...people.values()].map((k) => k.email)
            }),
            texted: !!confirm,
            place: space.title || space.slug,
          },
        ))
        : tools
    if (heard) {
      let why = texted ? TEXTED : OUTSIDE
      return kept(confirmed(deferred(listened([
        ...odd,
        ...holding(
          [
            ...sessionTools(g, children).filter((t) => t.name == 'fork'),
            consulting,
            ...roster,
          ],
          (t) => !!t.readOnly || (channel == 'error' && RELEASING.has(t.name)),
          why,
        ),
        // A member keeps telling themselves.
        ...member
          ? holding(
            [...mine(), ...await accounts],
            (t) => !!t.readOnly || TELLING.has(t.name),
            why,
          )
          : [],
        ...chat,
        ...api(false),
        ...holding(
          options.tools?.(ctx, files) ?? [],
          (t) => !!t.readOnly,
          why,
        ),
        // The member's browser keeps its reads of the tab, never its steps.
        ...member && options.browsers
          ? holding(
            browserTools(env, space, ctx.person, options.browsers, store),
            (t) => !!t.readOnly,
            why,
          )
          : [],
      ]))))
    }
    // Someone who is not a member is answered in their own conversation, a
    // helper with a guest's tools: no fork or helper at the space's cost, and what needs more is raised with the space's people
    // (operator-escalate.ts).
    let seated = !!ctx.role
    return kept(confirmed(deferred(listened([
      ...odd,
      ...seated
        ? sessionTools(g, children).filter((t) => t.name == 'fork')
        : [],
      // A conversation and its forks start helpers, which start no other.
      ...seated && !(row?.spawned && !row.fork && !topicOf(row))
        ? [consulting]
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
      ...member ? [...mine(), ...google] : [],
      ...acts && !work?.signup && proven(channel) && !confirm &&
          !SMS.has(channel)
        ? [
          handoffTool(env, store, space, ctx.person),
          handoffsTool(store, ctx.person),
          ...ctx.pa ? [spacesTool(env, space, ctx.person, ctx.beyond)] : [],
        ]
        : [],
      ...seated ? [] : [escalate(store, ctx, space, hostUrl(env))],
      ...chat,
      ...api(member),
      ...platform ? adminTools(env, whole) : [],
      ...(options.tools?.(ctx, files) ?? []).filter((t) =>
        member || t.readOnly
      ),
      ...member && options.browsers
        ? browserTools(env, space, ctx.person, options.browsers, store)
        : [],
    ]))))
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
        let offered = offerable(await roster(occurrence))
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
    elideCold: true,
    typed: options.typing,
    context: shown,
    inputSource,
    inputBody,
    // The conversation forks for its work.
    tools: [],
    // Each ask wears the space's persona on the platform's base, read from
    // the directory (operator-persona.ts).
    wear: { bases: bases(env) },
    cachePrefix: {
      persona: BASE,
      key: 'yaks.app/operator',
      retention: 43_200,
      tools: ['tool_load'],
    },
    // The skills the space keeps, by title and description, for a session
    // offered skill_read: the same rule as the box's (@yaks/harness).
    requestItems: async (_, __, current) => {
      let [skills, served, conversation] = await Promise.all([
        skillItems(g, current),
        servedIn(g, current.session),
        topOf(store.g, current.session),
      ])
      return [
        ...skills ?? [],
        {
          kind: 'instruction',
          text: serving(conversation, served.model, served.provider),
        },
      ]
    },
    // Where the person of the conversation is now, for them alone, sent
    // after the conversation and never kept in it (whereabouts.ts). The turn
    // needs none of it: one that can't be read is reported, and the turn goes
    // on without it (M-37965). A directory a deploy reached before this object
    // refuses a word it no longer speaks, so even its refusal is ours.
    // So are its other threads in the rooms the conversation was addressed
    // in, read as the person may read them (operator-threads.ts).
    turnItems: async (_, __, { session }) => {
      let o = await workingOf(store, session)
      if (!o?.person || !o.space) return []
      let failed = (request: string) => (e: unknown) => {
        defect(e, { request, session, space: o.space })
        return undefined
      }
      let [{ whereaboutsItem }, { threadsItem }] = await Promise.all([
        import('./whereabouts.ts'),
        import('./operator-threads.ts'),
      ])
      let member = async () => {
        if (o.administrative) return true
        let seat = await dir().seat(o.space, o.person)
        return !!seat.administrative || writes(seat.role ?? null)
      }
      let texts = await Promise.all([
        whereaboutsItem(env, o.person, o.space).catch(
          failed('operator whereabouts'),
        ),
        member().then((m) => threadsItem(store, session, m)).catch(
          failed('operator threads'),
        ),
      ])
      return texts.flatMap((text) =>
        text ? [{ kind: 'instruction' as const, text }] : []
      )
    },
    // A child works for the same space and person as the session that
    // started it, and is charged to that space.
    prepareChild: async ({ parent, args }) => {
      let o = await workingOf(store, parent)
      if (!o) return {}
      // A helper looking into an odd request works as nobody with a seat,
      // with a guest's tools (operator-escalate.ts `oddReport`).
      if (args.investigate) {
        return {
          operator_session: {
            space: o.space,
            person: investigatorOf(o.space),
            channel: 'chat',
          },
        }
      }
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
    // The conversation and its work forks share a short topic map. Only a
    // session opened on a topic carries that topic's compiled context.
    instructions: async (session) => {
      reached('instructing', null)
      let [{ eid, space: at, here, ctx: context }, [row]] = await Promise.all([
        working(env, store, session, options.directory),
        g.read(q`.entity.eid=${session}&.fields=session.topic`),
      ])
      // Reply channels carry no personal server instructions.
      let work = await workingOf(store, session)
      let servers =
        work?.signup || !proven(await channelAt(store, session, work))
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
          [outside(space, ctx.role), await servers].filter(Boolean)
            .join('\n\n'),
        )
      }
      let [map, connected, accounts, said] = await Promise.all([
        topic ? oracleContext(ctx, g, topic) : oracleMap(ctx, g),
        integrationsTold(env, here, space),
        googleTold(env, here, space),
        servers,
      ])
      return reached(
        'instructions',
        [map, told(ctx, space), connected, accounts, said].filter(
          Boolean,
        ).join('\n\n'),
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
    // A reply said while newer words wait goes back now, the way the words
    // it answers came: the turn carrying on answers the newer ones.
    replied: (session) => answered(session, true),
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
        confirm: o.confirm ?? null,
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
  // the model cannot read it as it is.
  let words = (
    session: string,
    id: string,
    body: string,
    by: string,
    o: Asking,
  ): Intake => ({
    session,
    body,
    by,
    id,
    ...o.request ? { item: o.request } : {},
    ...o.from ? { from: o.from } : {},
    ...o.channel ? { channel: channelOf(o.channel, o.framing) } : {},
    files: (o.files ?? []).map(attachedOf),
    source: '',
    using: usingOf(o.model, o.provider, o.effort),
    // An error the platform asks the Operator to fix, or what another of
    // its conversations raised, is its own words, not the person's it is
    // said for (unseen.ts).
    system: OWN.has(o.channel ?? ''),
    with: {
      ...o.call ? { operator_call: { call: o.call, asked: true } } : {},
      ...o.unverified ? { unverified: { number: o.unverified } } : {},
    },
  })
  // What the person said before on the subject of the words they now give
  // their conversation, as a note beside those words: what its model no
  // longer has in front of it (@yaks/session `recall`). The hosted embedder
  // reserves and settles spend around an inference call. Give that path
  // more time than the box's deadline, while bounding how long intake waits.
  let recalling = (reader: Reader) =>
    recall({
      graph: seenBy(store, reader),
      meaning: store.meaningFor?.(reader),
      floors: FLOORS,
      report: (e) => void caught(e, { request: 'operator recall' }),
    }, 2_500)
  let before = async (
    session: string,
    text: string,
    held: Asker,
    space: Space,
  ): Promise<Bundle[]> => {
    // Read as the person reads the store: someone outside the space recalls
    // only what is theirs (operator-access.ts `sight`).
    let seat = await dir().seat(space.eid, held.person, held.administrative)
    let member = !!seat.administrative || writes(seat.role ?? null)
    let body = await recalling({ person: held.person, member }).said(
      text,
      new Date().toISOString(),
      {
        by: held.person,
        session,
      },
    )
    return body
      ? [{
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        prompt: { scope: 'turn', source: 'operator:earlier' },
        content: { body },
        $actor: { by: space.eid, via: session },
      }]
      : []
  }
  // The Reads the person's words open, as a note beside them, held to the
  // space's budget like recall (operator-reads.ts). A failure to embed opens
  // none and is reported; the turn goes on, and read_open still opens them.
  let readsBeside = async (
    session: string,
    text: string,
    space: Space,
    signup: boolean,
  ): Promise<Bundle[]> => {
    let embed = env.AI
      ? embedder({
        ...env,
        AI: withheld(
          embeddings(env, async (d) => await d.at(space.eid) ?? null),
        ),
      })
      : null
    let body = await readsNote(
      store.g,
      bases(env),
      session,
      text,
      embed,
      signup,
    ).catch((e) => {
      caught(e, { request: 'operator reads' })
      return undefined
    })
    return body
      ? [{
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        prompt: { scope: 'turn', source: 'operator:reads' },
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
    // What their machine's lists hold, read as the page reads them; one that
    // is off holds nothing here.
    let { lists } = await listsOf(env, held.person, space.eid)
    let body = await waitingOn(store, held.person, lists)
    return body
      ? [{
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        prompt: { scope: 'turn', source: 'operator:decisions' },
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
    let session = o.resume ??
      (o.signup
        ? derivedEid(`operator-signup|${space.eid}|${held.person}`)
        : await rootAt(store, space.eid, held.person))
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
            !o.signup && !o.resume,
          ),
          ...theirs ? await before(session, said, held, space) : [],
          ...theirs ? await waiting(session, held, space) : [],
          ...theirs || o.signup
            ? await readsBeside(session, said, space, !!o.signup)
            : [],
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
    if (!text.trim() && !o.files?.length) {
      throw refuse('arguments', 'say what you want done')
    }
    let by = o.by ?? held.person
    let id = o.request ?? crypto.randomUUID()
    let input = inputOf(id)
    // A person's words with no task are the next input of their one
    // conversation with the Operator.
    if (!named) {
      let [kept] = await g.get([input], ['entry'])
      let session = comp(kept, 'entry')?.session
      if (typeof session == 'string') return { task: '', session, input }
      let open = await listening(held, space, o)
      let given = {
        ...words(open.session, id, text, by, o),
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
    let handoff = o.channel == HANDOFF
    let root = handoff ? await rootAt(store, space.eid, held.person) : ''
    if (root && !await conversed(store, root)) {
      await started(root, held.person, space)
      await g.apply([await carrying(root, held, space, {}, true)], {
        trusted: true,
      })
    }
    await take(
      g,
      words(
        session,
        id,
        newest || handoff ? text : JSON.stringify({ task: row }),
        by,
        o,
      ),
      [
        await carrying(session, held, space, o),
        ...root
          ? [
            { entity: { eid: id }, operator_request: { session } },
            handoffNote(
              root,
              id,
              by,
              `[Handoff from ${o.from}](${
                chatPath(space.slug, task)
              }).\n\n${text}`,
            ),
          ]
          : [],
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
      content: { body: o.began ? CALLED : text },
      intake: { source: '' },
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
  let tools: Operator['tools'] = async (held, space, confirm) => {
    let { session, fresh } = await conversing(held, space)
    if (fresh) await g.apply([fresh], { trusted: true })
    let offered = offerable(await roster(session, { confirm }))
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
  // An outside agent signed in as the person speaks with their authority:
  // its words are framed as theirs, verified, with their role.
  let connectorSpeaker = async (held: Asker, space: Space) => {
    let dir = directoryOf(env.STORE)
    let [known, role] = await Promise.all([
      dir.known(held.person),
      dir.role(space, held.person),
    ])
    let who = speaker(
      known?.name || 'the person',
      proofOf({ channel: 'connector' }),
      role ?? null,
      space,
    )
    return fromWhom(who, 'Through an outside agent signed in as them: ')
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
        return {
          words: {
            ...words,
            source: '',
            from: 'an outside agent',
            channel: channelOf(
              'connector',
              await connectorSpeaker(held, space),
            ),
            using: usingOf(selected.model, selected.provider, asked.effort),
            files: files.map(attachedOf),
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

  // An approved act, run as a call of the session that asked it, through
  // the person's tools as they stand now and asking nothing again; one
  // their role does not allow, as a call of the conversation of whoever
  // approved it, through theirs (operator-approvals.ts, operator-route.ts).
  let approve = approvals(
    store,
    async (a, { who, space }) => {
      let session = a.session
      // An approver who never talked with the Operator has their
      // conversation begun to do it from.
      if (a.why == 'authority' && who) {
        let at = await dir().at(space)
        if (!at) throw new CallError('tool', 'That space is gone.')
        let begun = await conversing({ person: who }, at)
        if (begun.fresh) await g.apply([begun.fresh], { trusted: true })
        session = begun.session
      }
      let tool = offerable(await roster(session, { approved: true }))
        .find((t) => t.name == a.tool)
      if (!tool) {
        throw new CallError('tool', `${a.tool} is not theirs to use any more.`)
      }
      let call = {
        entity: { eid: crypto.randomUUID() },
        call: { to: a.tool, args: a.args },
      }
      let told = await tool.run(a.args, { session, call, entries: [] })
      options.tell?.(await topOf(g, a.session))
      return typeof told == 'string' ? told : told.text
    },
    Date.now,
    async (person) => await named(person) ?? 'someone',
  )

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
    approve,
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
  // The task the words carry on; without one they go to the person's
  // conversation with the Operator (`rootAt`).
  task?: string
  // The session a new task starts, for a replay to find.
  session?: string
  // The existing conversation whose work an answer continues.
  resume?: string
  files?: File[]
  // The channel the words came by, and what the model is told before them
  // of how they came (operator-channels.ts `BY`), which the conversation
  // leaves out of the person's words.
  channel?: string
  signup?: string
  // The number the words came from, by text or call: their turn's
  // privileged acts wait for a tap on a link texted to it
  // (operator-approvals.ts).
  confirm?: string
  // The number that alone vouches for the words, kept on them
  // (operator-channels.ts `unverifiedOf`).
  unverified?: string
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
    o?: Pick<Asking, 'model' | 'provider' | 'effort' | 'signup' | 'resume'>,
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
  tools: (
    held: Asker,
    space: Space,
    /** the number the links its privileged acts wait on are texted to;
     * left out, as the conversation's newest words came
     * (operator-approvals.ts) */
    confirm?: string,
  ) => Promise<{
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
  /** Where the act a link approves stands for `who`, signed in, and with
   * `press` the tap that carries it out, or with `decline` the one that
   * spends it undone (operator-approvals.ts `approvals`). */
  approve: (
    approval: string,
    digest: string,
    press?: Press,
  ) => Promise<Standing>
}
