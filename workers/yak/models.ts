// Providers lent to each app store; model offerings come from successful answers.
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph'
import {
  answers,
  providerResolver,
  running,
  type Tool,
  type ToolContext,
} from '@yaks/session'
import { worded } from '@yaks/tools'
import { edits, mode, writes } from '@yaks/member'
import { confirmed, type Model, ModelError, type Price } from '@yaks/model'

import type { VocabDoc } from '@yaks/vocab'
import { music, said, workersAi } from '@yaks/workers-ai'
import { artifactStore, objectBlobs } from '@yaks/blob'
import { resolve } from '@yaks/connections'
import { gateway as openai } from '@yaks/openai'
import { responses as openrouter } from '@yaks/openrouter'
import { appStore, type Directory, directoryOf } from './directory.ts'
import { ctxOf } from './connections.ts'
import { blobPrefix } from './blob-key.ts'
import { filled, schemaOf } from '@yaks/tools/declared'
import { accounted, metered } from './meter.ts'
import { outbound } from './outbound.ts'
import { caught } from './sentry.ts'
import {
  type Answer,
  type Effect,
  type Install,
  page,
  type Plugin,
  type Stored,
} from './plugin.ts'

export let guess = (sent: unknown) =>
  Math.ceil(JSON.stringify(sent ?? '').length / 4)

export let PROVIDER = 'workers-ai'
let OPENROUTER = 'openrouter'

// Only providers are installed. Model rows stay as history and are never retired
// because a newer release or a code list stopped naming them.
export let planting: Install = async (read, at) => {
  if (at.meta || !at.app) return []
  let held = await read('.provider&*')
  return [PROVIDER, OPENROUTER, 'openai'].flatMap((name): Bundle[] =>
    held.some((b) => (b.provider as Comp).name == name) ? [] : [{
      entity: { eid: identityEid('provider', [name]) },
      provider: { name, transport: 'http', offered: true },
    }]
  )
}

// Who asked for the turn a tool call belongs to: the author of the newest
// entry asking for one (`using`, and not an ask the runner wrote) at or before
// the ask the call came from. Nobody signed in is null.
let asker = (ctx?: ToolContext): string | null => {
  if (!ctx) return null
  let source = (ctx.call.call as Comp | undefined)?.source
  let at = ctx.entries.findIndex((b) => b.entity.eid == source)
  let before = at < 0 ? ctx.entries : ctx.entries.slice(0, at + 1)
  let asked = before.findLast((b) => b.using && !b.ask)
  let by = (asked?.created as Comp | undefined)?.by
  return typeof by == 'string' ? by : null
}

/**
 * The commands an app marks `"model": true`, as the tools its models may call
 * (@yaks/tools/declared). A command runs as the person who asked for the turn, held to
 * what they may write here: a model can do what they could do on the page, and
 * never more. Its `$session` is the transcript the turn is in, and what it
 * writes names that transcript as `created.via`, which no page can. A query answers
 * what it reads.
 */
export let tooled = (at: Stored): Tool[] =>
  Object.entries(at.commands()).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .filter(([, def]) => def.model).map((
      [name, def],
    ) => ({
      name,
      description: def.description,
      parameters: schemaOf(def),
      run: async (args, ctx) => {
        let act = filled(def, args, { session: ctx?.session })
        if (act.query != null) return worded(await at.graph.read(act.query))
        let bundles = Array.isArray(act.apply) ? act.apply : [act.apply]
        return worded(
          await at.as(asker(ctx), bundles as Bundle[], ctx?.session),
        )
      },
    }))

// The space an app's calls are counted against, read fresh each time it is
// asked (meter.ts `metered`).
let payer = (app: string) => async (dir: Directory) =>
  (await dir.appAt(app))?.space ?? null

let mediaStore = (at: Stored): import('@yaks/openai').MediaStore => ({
  store: async (bytes, mediaType) => {
    let found = at.env.STORE
      ? await directoryOf(at.env.STORE).appAt(at.app!)
      : null
    if (!found || !at.env.BLOBS) {
      throw new ModelError('media_storage', 'This app has no blob store')
    }
    return artifactStore(objectBlobs(
      at.env.BLOBS,
      blobPrefix(found.space, found.app),
    ))(bytes, mediaType)
  },
})

// A model calls out as the app whose store is running it. The sentinel comes
// from that app's connected integration, and egress exchanges it only for the
// integration's declared hosts. Nothing here reads or records the key.
let connected = (at: Stored) =>
  openrouter({
    key: async () => {
      if (!at.env.STORE) {
        throw new ModelError('unbound', 'This app has no integration store')
      }
      let link = await resolve(
        ctxOf({ ...at.env, STORE: at.env.STORE }),
        at.app!,
        OPENROUTER,
      )
      if (!link) {
        throw new ModelError(
          'connection',
          'Connect OpenRouter to this app before asking its models',
        )
      }
      return link.sentinel
    },
    fetch: (input, init) => {
      if (!at.env.STORE) {
        throw new ModelError('unbound', 'This app has no integration store')
      }
      return outbound(
        new Request(input, init),
        { ...at.env, STORE: at.env.STORE },
        { app: at.app!, level: 'owner', person: null },
      )
    },
    media: mediaStore(at),
  })

/**
 * The store's transcript runner, registered on its registry: `session_run`
 * run here, lent Workers AI through the metered binding and the app's marked
 * commands. The store's effect pool keeps each run while the write that asked
 * for it answers immediately; the result arrives through the subscription.
 */
let asking: Effect = (on, at) => {
  if (at.meta || !at.app) return
  let text = workersAi(
    metered(at.env, payer(at.app), {
      price: async (name) => {
        let [row] = await at.graph.get([identityEid('model', [name])])
        return row?.price as Price | undefined
      },
      answered: async (name, info) => {
        await at.graph.apply(
          confirmed(identityEid('provider', [PROVIDER]), name, info),
          { trusted: true },
        )
      },
    }),
    { fetch: at.env.MODEL_FETCH, gateway: at.env.AI_GATEWAY },
  )
  let audio = accounted(
    at.env,
    payer(at.app),
    workersAi(at.env.AI!, {
      media: mediaStore(at),
      gateway: at.env.AI_GATEWAY,
    }),
  )
  let served: Model = Object.assign(
    (req: Parameters<Model>[0]) => music(req.model) ? audio(req) : text(req),
    { info: (name: string) => text.info!(name) },
  )
  let gateway = openai({
    base: at.env.OPENAI_API,
    gateway: at.env.AI_GATEWAY,
    account: at.env.CF_ACCOUNT,
    ai: at.env.AI,
    key: at.env.OPENAI_API_KEY,
    token: at.env.AI_GATEWAY_TOKEN,
    fetch: at.env.MODEL_FETCH,
  })
  let lent = {
    [PROVIDER]: served,
    [OPENROUTER]: accounted(at.env, payer(at.app), connected(at)),
    openai: accounted(at.env, payer(at.app), gateway, async (name) => {
      let [row] = await at.graph.get([identityEid('model', [name])])
      return row?.price as Price | undefined
    }),
  }
  let run = running(at.graph, {
    holder: at.app,
    model: served,
    resolveModel: providerResolver(at.graph, lent),
    answers: answers(at.graph, lent),
    tools: [],
    toolSnapshot: () => Promise.resolve(tooled(at)),
    report: (error, _, phase) => at.broke(`model ${phase}`, error),
  })
  on.handle({
    session_run: (e, tx, write) => run.session_run(e, tx, write),
  })
}

// How each way a model call fails is answered at the door: the allowance
// spent, the model busy, a model the catalogue does not offer, and a host
// with no Workers AI to lend.
let STATUS: Record<string, number> = {
  limit: 429,
  busy: 503,
  model: 400,
  unbound: 503,
}

// What the door is posted: the model's name and its input, as Workers AI
// takes them.
let posted = (
  body: string,
): { model: string; input: object; session_id?: string } | null => {
  try {
    let { model, input, session_id } = JSON.parse(body)
    return typeof model == 'string' && input && typeof input == 'object'
      ? {
        model,
        input,
        ...typeof session_id == 'string' && session_id ? { session_id } : {},
      }
      : null
  } catch {
    return null
  }
}

/**
 * `./api/ai/run`: one call to a model, answered with what the model said, as
 * Workers AI says it, out of any envelope AI Gateway put it in (@yaks/workers-ai
 * `said`) — what a page or the app's own worker asks when it wants
 * an answer back rather than a transcript (the worker's `ai` binding posts
 * here, dispatch.ts `shim`). Asked by whoever may ask the app's models for a
 * turn: its members, or, where its manifest says `"models": "open"`, anyone
 * who may write it, at a visitor's size and pace. Metered like every call.
 */
let run: Answer = async (
  { env, req, path, space, app, who, refuse, json, visiting },
) => {
  if (path != '/ai/run') return null
  if (req.method != 'POST') return json(405, 'method_not_allowed')
  if (!edits(mode(app.access), who.role)) return refuse()
  let body = await req.text()
  if (!writes(who.role)) {
    let manifest = await appStore(env.STORE, space, app, env).consume(
      '/vocab',
      (r) => r.json() as Promise<VocabDoc>,
    )
    if (manifest.models != 'open') {
      return who.person
        ? json(
          403,
          'not_a_member',
          "only this app's members may ask its models — its owner can make " +
            'you an editor',
        )
        : refuse()
    }
    let held = await visiting(body.length)
    if (held) return held
  }
  let asked = posted(body)
  if (!asked) {
    return json(
      400,
      'bad_request',
      'post {"model": "<name>", "input": {…}}: the model, and what it is ' +
        'asked as Workers AI takes it',
    )
  }
  let conversation = req.headers.get('x-session-affinity') || asked.session_id
  try {
    return Response.json(
      said(
        await metered(env, payer(app.eid)).run(
          asked.model,
          asked.input,
          conversation
            ? { extraHeaders: { 'x-session-affinity': conversation } }
            : undefined,
        ),
      ),
    )
  } catch (e) {
    if (e instanceof ModelError) {
      return json(STATUS[e.code] ?? 502, e.code, e.message)
    }
    caught(e, { request: 'POST /api/ai/run', space: space.slug, app: app.slug })
    return json(
      502,
      'model_failed',
      `${asked.model} did not answer: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }
}

/** Models, as a plugin of this Worker: the providers in every app's store,
 * that store's runner, and the door a page or a worker asks one through. */
export let modelsPlugin: Plugin = {
  name: 'models',
  pages: [page('models')],
  installs: [planting],
  effects: [asking],
  answers: [run],
}
