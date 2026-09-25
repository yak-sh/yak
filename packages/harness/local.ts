// The harness on this machine: the agent runner (./agent.ts) over a SQLite
// file, with everything a box lends it. The graph is `~/.yak/yak.db` unless the
// caller opens another; the shell runs here (@yaks/process), a child assigned a
// task gets its own checkout under the worktree root, a new session snapshots
// the AGENTS.md files above its directory, pictures live in the image
// directory, a step holds a file lock against a second process on the same
// graph, MCP servers and the OpenRouter sign-in are the person's own, and a
// defect is an `exception` entity. Every `~/.yak` path is read here or in
// ./store.ts and passed down; nothing under the runner reads one.

import { responses as openrouter } from '@yaks/openrouter'
import { credential, responses } from '@yaks/openai'
import type { Model } from '@yaks/model'
import { type Bundle, identityEid } from '@yaks/graph'
import type { ChildLimits, Step, Tool } from '@yaks/session'
import { watchMigrations } from '@yaks/sqlite'
import { instructionFiles } from '@yaks/context/host'
import { render as tree } from '@yaks/preact'
import type { VNode } from 'preact'
import { type Agent, agent } from './agent.ts'
import { signins } from './signin.ts'
import type { MCPAuthAction, MCPAuthReply } from './mcp_auth.ts'
import { mcpTools } from './mcp.ts'
import { stepLock } from './step_lock.ts'
import { streamingEnabled } from './streaming.ts'
import { imageContext, registered } from './artifact_tools.ts'
import { configuredImages, type ImageOptions } from './images.ts'
import { diagnostics, type FailureContext } from './diagnostics.ts'
import { homeAt, workspace } from './workspace.ts'
import { worktrees } from './paths.ts'
import { collecting, going, homes, sweep } from './worktrees.ts'
import { transcriptViews } from './transcript.ts'
import { dbPath, type Harness, open } from './store.ts'
import { harnessTools } from './tools.ts'

export { dbPath, type Harness, open } from './store.ts'
export { graphTools, harnessTools, parametersOf } from './tools.ts'

// A Harness must be passed under `h`, never spread into the options. Explicit
// exclusions also catch spreads, which TypeScript's excess-property check skips.
type NotHarness = { [K in keyof Harness]?: never }

/** How the harness is started here: what it stores in, what serves it, and
 * what the agent may do. */
export type Opts = ChildLimits & NotHarness & {
  /** initial default directory; session home is discovered here */
  cwd?: string
  /** the graph to run over (default: the one at `HARNESS_DB`) */
  h?: Harness
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

/**
 * Start the harness here: open the graph, lend the agent this machine, and put
 * the daemon on its entries.
 *
 * ```ts
 * import { local, open } from '@yaks/harness/local'
 *
 * let a = local({ h: open(':memory:'), model: fake })
 * let s = await a.start('reply with the word pong')
 * await a.idle(s)
 * ```
 */
export let local = (opts: Opts = {}): Local => {
  // Check before opening any database: a misspelled handle must not fall back
  // to the user's persistent store, including for untyped JavaScript callers.
  for (let key of ['path', 'db', 'store', 'g', 'fx', 'vocab', 'close']) {
    if (Object.hasOwn(opts, key)) {
      throw new TypeError(
        'Pass the harness as local({ h: open(...) }), not spread options',
      )
    }
  }
  let env = opts.env ?? Deno.env.get
  let h = opts.h ?? open(dbPath(env))
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
  let a = agent({
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
    lock: h.path == ':memory:' ? undefined : stepLock(h.path),
    report,
    // What abnormal endings left in the worktree root, taken back by the same
    // test one child's end applies — plus the checkouts Git itself has
    // forgotten. Only the harness running out of its own home sweeps: a store
    // somebody named explicitly (a test, a probe) is not this one, and its run
    // must never reach the live root.
    resuming: async () => {
      if (h.path != dbPath()) return
      sweep(h.g, root, await homes(h.g, await going(h.g), root)).catch(
        (error) => report(error, { phase: 'worktree-sweep' }),
      )
    },
    release: async () => {
      signin.cancel()
      await mcp.close()
      await diagnostics().drain()
      detach()
      h.close()
    },
  })
  let l: Local = Object.assign(a, {
    authorizeMCP: a.admitted(
      async (action: MCPAuthAction, name?: string, callback?: string) => {
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
      },
    ),
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
        anchor: model.anchor,
      }),
  })
  let watch = watchMigrations(h.migrations, (reason) => {
    // Stop scheduling immediately, but leave SQLite open for admitted work to
    // drain. Restart is an explicit owner action, not a migration side effect.
    void l.close(reason).catch((error) =>
      report(error, { phase: 'migration-drain' })
    )
    console.error(reason.message)
  }, opts.migrationPollMs ?? 1000)
  // Daemon-only shutdown is also a supported restart boundary: a replacement
  // agent can reuse h and later close it. The old host must not keep polling
  // that connection (or its cached, now-finalized native statements).
  let stopDaemon = a.d.stop
  a.d.stop = () => {
    watch.stop()
    return stopDaemon()
  }
  return l
}
