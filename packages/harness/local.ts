// The harness on this machine: the agent runner (./agent.ts) over the graph a
// `yak` config composed (./store.ts `hosted`), with everything a box lends it.
// The shell runs here (@yaks/process), a child assigned a
// task gets its own checkout under the worktree root, a new session snapshots
// the AGENTS.md files above its directory, pictures live in the image
// directory, MCP servers and the OpenRouter sign-in are the person's own, and a
// defect is an `exception` entity. What a box lends is `here()`: the harness
// on its own lends it to its agent, and a `yak` host listing the harness lends
// it to the runner its effects are worked with (./effects.ts). Every `~/.yak`
// path is read here or in ./store.ts and passed down; nothing under the runner
// reads one.

import { responses as openrouter } from '@yaks/openrouter'
import { credential, responses } from '@yaks/openai'
import type { Model } from '@yaks/model'
import { type Bundle, identityEid } from '@yaks/graph'
import type { ChildLimits, Step, Tool } from '@yaks/session'
import { watchMigrations } from '@yaks/sqlite'
import { instructionFiles } from '@yaks/context/host'
import { render as tree } from '@yaks/preact'
import type { VNode } from 'preact'
import { type Agent, agent, type Opts as AgentOpts } from './agent.ts'
import { signins } from './signin.ts'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
import { mcpTools } from './mcp.ts'
import { streamingEnabled } from './streaming.ts'
import { imageContext, registered } from './artifact_tools.ts'
import { configuredImages, type ImageOptions } from './images.ts'
import { diagnostics, type FailureContext } from './diagnostics.ts'
import { homeAt, workspace } from './workspace.ts'
import { dbPath, worktrees } from './paths.ts'
import { collecting, going, homes, sweep } from './worktrees.ts'
import { transcriptViews } from './transcript.ts'
import type { Harness } from './store.ts'
import { harnessTools } from './tools.ts'

export { type Harness, hosted } from './store.ts'
export { graphTools, harnessTools, parametersOf } from './tools.ts'

// A Harness must be passed under `h`, never spread into the options. Explicit
// exclusions also catch spreads, which TypeScript's excess-property check skips.
type NotHarness = { [K in keyof Harness]?: never }

/** How the harness is started here: what it stores in, what serves it, and
 * what the agent may do. */
export type Opts = ChildLimits & NotHarness & {
  /** initial default directory; session home is discovered here */
  cwd?: string
  /** the graph to run over */
  h: Harness
  /** what serves an ask (default: @yaks/openai over the found credential) */
  model?: Model
  /** the model to ask for by name (default `gpt-6-astra`) */
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
  /** each step of every transcript, as it lands */
  each?: (step: Step) => void
  /** where a task child's checkout is cut (default `$HARNESS_WORKTREE_DIR`,
   * else `~/.yak/worktrees`) */
  worktrees?: string
}

/** OpenRouter, the model provider, signed in through a connection its
 * provider entity owns. */
const OPENROUTER_AUTH = 'OpenRouter (model provider)'
const OPENROUTER = identityEid('provider', ['openrouter'])
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
  /** a person authorizing a sign-in: an MCP server, or OpenRouter */
  authorize: (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ) => Promise<MCPAuthReply>
  /** how the default model names the reply a request continues */
  anchor: Model['anchor']
  report: (error: unknown, where: FailureContext) => void
}

/** What this machine lends an agent over `h`: the models behind its
 * credentials and sign-ins, the shell and a checkout per child, the MCP
 * servers, the pictures, the instruction files where a session opens, and
 * where a defect is written. */
export let here = (h: Harness, opts: Omit<Opts, 'h'> = {}): Here => {
  let env = opts.env ?? Deno.env.get
  let detach = diagnostics().attach(h.g)
  let report = (error: unknown, where: FailureContext) =>
    diagnostics().report(error, where)
  let cwd = opts.cwd ?? Deno.cwd()
  let root = opts.worktrees ?? worktrees(env)
  let model = opts.model ??
    responses({
      credential: credential(env, (p) => Deno.readTextFile(p)),
      images: configuredImages(h.artifacts, opts.images),
      web: opts.web ?? env('HARNESS_WEB') != '0',
    })
  const signin = signins(h)
  const mcp = mcpTools(h, signin)
  h.fx.created('mcp_server', mcp.refresh).changed('mcp_server', mcp.refresh)
    .removed('mcp_server', mcp.refresh)
  // A child's own checkout is garbage the moment its session is over: no
  // further step runs in it until somebody resumes it, and a resume cuts it
  // again where it stood (worktrees.ts). The path is the one workspace.ts cut
  // — named after the child — so a child that merely inherited its parent's
  // home is not mistaken for the owner of it, and one without a checkout of
  // its own finds nothing there.
  collecting(
    h.g,
    h.fx,
    (error, session) => report(error, { phase: 'worktree', session }),
    root,
  )
  let lent: AgentOpts<Harness> = {
    ...workspace(h.g, cwd, root),
    ...opts,
    h,
    model: opts.model,
    providers: {
      openai: model,
      openrouter: openrouter({
        key: async () =>
          await signin.key(OPENROUTER, 'openrouter') ?? refuse(
            'OpenRouter is not connected. Press Esc then A to authorize OpenRouter.',
          ),
      }),
      ...opts.providers,
    },
    tools: opts.tools ??
      harnessTools(h.g, { ...opts, worktrees: root, artifacts: h.artifacts }),
    remote: mcp.snapshot,
    streaming: streamingEnabled(opts, env),
    opening: async () => ({
      home: await homeAt(h.g, cwd),
      files: await instructionFiles(cwd),
    }),
    context: (window, entries) =>
      imageContext(h.g, window, entries, h.artifacts),
    report,
    // What abnormal endings left in the worktree root, taken back by the same
    // test one child's end applies — plus the checkouts Git itself has
    // forgotten. Only the harness running over the graph in its own home
    // sweeps: another graph (a test's, a probe's) is not this one, and its run
    // must never reach the live root.
    resuming: async () => {
      if (h.path != dbPath(env)) return
      sweep(h.g, root, await homes(h.g, await going(h.g), root)).catch(
        (error) => report(error, { phase: 'worktree-sweep' }),
      )
    },
    release: async () => {
      signin.cancel()
      await mcp.close()
      await diagnostics().drain()
      detach()
    },
  }
  let authorize = async (
    action: MCPAuthAction,
    name?: string,
    callback?: string,
  ): Promise<MCPAuthReply> => {
    if (name === OPENROUTER_AUTH) {
      if (action === 'begin') return signin.begin(OPENROUTER, 'openrouter')
      if (action === 'cancel') signin.cancel(OPENROUTER)
      if (action === 'complete') {
        await signin.complete(OPENROUTER, 'openrouter', callback ?? '')
      }
      return {
        message: action === 'complete'
          ? 'OpenRouter connected. Select an OpenRouter model explicitly to use it.'
          : 'Authorization cancelled',
      }
    }
    const reply = await mcp.authorize(action, name, callback)
    if (
      action === 'list' && (await h.g.read(`.eid=${OPENROUTER}`)).length
    ) reply.servers = [...reply.servers ?? [], OPENROUTER_AUTH]
    return reply
  }
  return { lent, authorize, anchor: model.anchor, report }
}

/**
 * Start the harness here, over a graph a `yak` config composed: lend the agent
 * this machine, and work the runs its commits owe.
 *
 * ```ts
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
  watch = watchMigrations(h.migrations, (reason) => {
    // Stop scheduling immediately, but leave SQLite open for admitted work to
    // drain. Restart is an explicit owner action, not a migration side effect.
    void l.close(reason).catch((error) =>
      report(error, { phase: 'migration-drain' })
    )
    console.error(reason.message)
  }, opts.migrationPollMs ?? 1000)
  return l
}
