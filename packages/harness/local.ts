// Provider-backed capabilities lent to the native runner. Sessions see the
// graph and machines, never a host checkout. Credentials, MCP and diagnostics
// remain host integrations; shell and file work is routed through providers.

import { responses } from '@yaks/openai'
import { artifactStore } from '@yaks/blob'
import { type Model, prefixCacheMark } from '@yaks/model'
import { claudeDoc } from '@yaks/claude/vocab'
import { openrouterDoc } from '@yaks/openrouter/vocab'
import { type Bundle } from '@yaks/graph'
import type { ChildLimits, Step, Tool } from '@yaks/session'
import { watchMigrations } from '@yaks/sqlite/migration'
import { render as tree } from '@yaks/preact'
import type { VNode } from 'preact'
import { type Agent, agent, type Opts as AgentOpts } from './agent.ts'
import { authorize } from './mcp_authorize.ts'
import { openaiCredential } from './openai_auth.ts'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
import { mcpTools } from './mcp.ts'
import { streamingEnabled } from './streaming.ts'
import { imageContext, registered } from './artifact_tools.ts'
import { configuredImages, type ImageOptions } from './images.ts'
import { diagnostics, type FailureContext } from './diagnostics.ts'
import { homeAt, machines } from './session_machines.ts'
import { earlierInput, instructionsFor } from './instructions.ts'
import { transcriptViews } from './transcript.ts'
import type { Harness } from './store.ts'
import { graphTools, harnessTools } from './tools.ts'
import { skillItems, skillTools } from './skills.ts'
import { pooledHttp } from './http.ts'

export { type Harness, hosted } from './store.ts'
export { graphTools, harnessTools } from './tools.ts'

// A Harness must be passed under `h`, never spread into the options. Explicit
// exclusions also catch spreads, which TypeScript's excess-property check skips.
type NotHarness = {
  [K in Exclude<keyof Harness, 'sandboxes' | 'workspaces'>]?: never
}

/** How the harness is started here: what it stores in, what serves it, and
 * what the agent may do. */
export type Opts = ChildLimits & NotHarness & {
  /** Optional command directory on the explicitly named workspace. */
  cwd?: string
  /** Explicit existing machine entity; otherwise shell/files request a sandbox. */
  /** the graph to run over */
  h: Harness
  /** what serves an ask (default: @yaks/openai over the found credential) */
  model?: Model
  /** the model to ask for by name (otherwise the provider row's using.model) */
  name?: string
  /** Default provider for new sessions; model selection remains graph data. */
  provider?: string
  /** Host implementations keyed by provider.name, for embedding and testing. */
  providers?: Record<string, Model>
  /** Enable native OpenAI image generation with durable external blobs. */
  web?: boolean
  images?: ImageOptions | false
  /** what the agent may call (default: the shell and the graph) */
  tools?: Tool[]
  /** Stream responses by default; false overrides HARNESS_STREAM. */
  streaming?: boolean
  /** Alias for streaming. If both are supplied, streaming takes precedence. */
  stream?: boolean
  /** where settings such as `HARNESS_STREAM` are read (default this process's
   * environment) */
  env?: (name: string) => string | undefined
  /** Cooperating migrations must allow at least this polling interval. */
  migrationPollMs?: number
  /** how long a transcript's lease stands between renewals, so how long a
   * process that died running it holds it up (ms) */
  hold?: number
  checkpointMs?: number
  /** The system prompt every ask carries. */
  instructions?: string
  /** Maximum tool-result code points before model-facing handle projection. */
  outputLimit?: number
  /** the share of its model's context window a transcript fills before it is
   * compacted, for every model (@yaks/session `Deps.compactAt`) */
  compactAt?: number
  /** each step of every transcript, as it lands */
  each?: (step: Step, session?: string) => void | Promise<void>
  /** Override the workspace and sandbox bindings explicitly lent by the host. */
  sandboxes?: Harness['sandboxes']
  workspaces?: Harness['workspaces']
  workspace?: string
}

const refuse = (message: string): never => {
  throw new Error(message)
}

/** The harness running here: the agent, and what only a box offers it. */
export type Local = Agent<Harness> & {
  authorizeMCP: (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ) => Promise<MCPAuthReply>
  image: (eid: string) => Promise<Uint8Array>
  /** one bundle as the terminal draws it */
  entry: (b: Bundle) => VNode | null
}

/** What this machine lends an agent: its options, and what answers a person
 * here. */
export type Here = {
  /** the agent's options; their `release` lets go of what was opened for
   * them, and leaves the graph open */
  lent: AgentOpts<Harness>
  /** a person authorizing a sign-in: an MCP server or model provider */
  authorize: (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ) => Promise<MCPAuthReply>
  /** how the default model names the reply a request continues */
  anchor: Model['anchor']
  report: (error: unknown, where: FailureContext) => void
}

// Provider transports are opened on use. Their synchronous recorders stay
// available before the first request, just as a directly constructed Model's.
let deferred = (
  load: () => Promise<Model>,
  meta: Pick<Model, 'mark' | 'vocab' | 'anchor'> & {
    recover?: true
    info?: true
  },
): Model => {
  let pending: Promise<Model> | undefined
  let get = () => pending ??= load()
  return Object.assign(
    async (...args: Parameters<Model>) => (await get())(...args),
    {
      ...Object.fromEntries(
        Object.entries(meta).filter(([key]) =>
          key != 'recover' && key != 'info'
        ),
      ),
      list: async () => await (await get()).list?.() ?? [],
      ...meta.info
        ? { info: async (name: string) => await (await get()).info?.(name) }
        : {},
      ...meta.recover
        ? { recover: async (call: string) => (await get()).recover!(call) }
        : {},
    },
  ) as Model
}

/** What this machine lends an agent over `h`: the models behind its
 * credentials and sign-ins, the workspace and sandbox bindings, the MCP
 * servers, the pictures, the instruction files where a session opens, and
 * where a defect is written. */
export let here = (h: Harness, opts: Omit<Opts, 'h'> = {}): Here => {
  let env = opts.env ?? Deno.env.get
  let detach = h.report ? diagnostics().attach(h.report) : () => {}
  let report = (error: unknown, where: FailureContext) =>
    diagnostics().report(error, where)
  let binding = machines(
    h.g,
    opts.sandboxes ?? h.sandboxes,
    h.resolveHome,
    opts.workspaces ?? h.workspaces,
  )
  let auth = authorize(h)
  let openaiAuth = openaiCredential(h, env, auth.signin)
  let http = pooledHttp()
  let model = opts.model ??
    responses({
      ...openaiAuth,
      fetch: http.fetch,
      redact: true,
      images: configuredImages(h.artifacts, opts.images),
      web: opts.web ?? env('HARNESS_WEB') != '0',
    })
  const mcp = mcpTools(h, auth.signin, auth.mcp)
  h.fx.created('mcp_server', mcp.refresh).changed('mcp_server', mcp.refresh)
    .removed('mcp_server', mcp.refresh)
  let named: Tool[] | undefined
  let lent: AgentOpts<Harness> = {
    ...binding.limits,
    ...opts,
    h,
    model: opts.model,
    providers: {
      openai: model,
      claude: deferred(
        () => import('@yaks/claude').then(({ claude }) => claude()),
        {
          vocab: claudeDoc,
          info: true,
          mark: (reply) => ({
            claude: {
              response_id: reply.id,
              session_id: (reply as typeof reply & { claudeSession?: string })
                .claudeSession,
            },
          }),
        },
      ),
      openrouter: deferred(
        () =>
          import('@yaks/openrouter').then(({ responses }) =>
            responses({
              fetch: http.fetch,
              media: { store: artifactStore(h.artifacts) },
              key: async () =>
                (h.person
                  ? await auth.signin.key(h.person, 'openrouter')
                  : undefined) ?? refuse(
                    'OpenRouter is not connected. Run yak auth openrouter.',
                  ),
            })
          ),
        {
          vocab: openrouterDoc,
          info: true,
          mark: (reply, cache) => ({
            openrouter: {
              response_id: reply.id,
              ...prefixCacheMark(reply, cache),
            },
          }),
          recover: true,
        },
      ),
      ...opts.providers,
    },
    tools: opts.tools ??
      [
        ...harnessTools(h.g, {
          ...opts,
          machines: binding,
          workspaces: opts.workspaces ?? h.workspaces,
          artifacts: h.artifacts,
          reply: h.reply,
        }),
        ...skillTools(h.g, h.reply),
      ],
    remote: mcp.snapshot,
    // The host's other tools, its plugins' own among them, adapted the first
    // time a transcript names one: a builder's session offered memory_around
    // and memory_save carries those and nothing else.
    named: () =>
      named ??= graphTools(h.g, { tools: h.hostTools?.(), reply: h.reply }),
    streaming: streamingEnabled(opts, env),
    opening: async (persona) => {
      let home = opts.workspace
        ? { workspace: opts.workspace, ...opts.cwd ? { cwd: opts.cwd } : {} }
        : homeAt(undefined, opts.cwd)
      let files = await instructionsFor(
        h.g,
        home,
        opts.workspaces ?? h.workspaces,
        { persona },
      )
      return {
        home,
        files,
      }
    },
    context: (window, entries) =>
      imageContext(h.g, window, entries, h.artifacts),
    requestItems: async (_, entries, current) => [
      ...await skillItems(h.g, current),
      ...await earlierInput(h.g, entries, h.person, h.meaning),
    ],
    report,
    release: async () => {
      http.close()
      await auth.close()
      await diagnostics().drain()
      detach()
    },
  }
  return { lent, authorize: auth.run, anchor: model.anchor, report }
}

/**
 * Start the harness here, over a graph a `yak` config composed: lend the agent
 * this machine, and work the runs its commits owe.
 *
 * ```ts ignore
 * import { hosted, local } from '@yaks/harness/local'
 *
 * let a = local({ h: hosted(host), model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * ```
 */
export let local = (opts: Opts): Local => {
  // A harness spread into the options is refused, including for untyped
  // JavaScript callers, whose options TypeScript never saw.
  for (let key of ['path', 'db', 'store', 'g', 'fx', 'vocab', 'close']) {
    if (Object.hasOwn(opts, key)) {
      throw new TypeError(
        'Pass the harness as local({ h: hosted(host) }), not spread options',
      )
    }
  }
  let h = opts.h
  let env = opts.env ?? Deno.env.get
  let { lent, authorize, anchor, report } = here(h, opts)
  let watch: { stop: () => void } | undefined
  let a = agent({
    ...lent,
    release: async () => {
      watch?.stop()
      await lent.release?.()
      await h.close()
    },
  })
  let l: Local = Object.assign(a, {
    authorizeMCP: a.admitted(authorize),
    // What the terminal draws inline: a PNG, and not a large one.
    image: a.admitted(async (eid: string) => {
      let { bytes, mediaType } = await registered(h.g, eid, h.artifacts)
      if (mediaType != 'image/png' || bytes.length > 4 * 1024 * 1024) {
        throw new Error('Not a displayable PNG artifact')
      }
      return bytes
    }),
    entry: (b: Bundle) =>
      tree(transcriptViews, b, 'Transcript', h.vocab, {
        inlineImages: env('HARNESS_GRAPHICS') == 'kitty',
        image: (eid: string) => l.image(eid),
        names: a.names,
        anchor,
      }),
  })
  watch = h.migrations && watchMigrations(h.migrations, (reason) => {
    // Stop scheduling immediately, but leave SQLite open for admitted work to
    // drain. Restart is an explicit owner action, not a migration side effect.
    void l.close(reason).catch((error) =>
      report(error, { phase: 'migration-drain' })
    )
    console.error(reason.message)
  }, opts.migrationPollMs ?? 1000)
  return l
}
