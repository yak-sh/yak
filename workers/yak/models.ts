// The models a space may spend its model allowance on, each with its price:
// the platform's catalogue (D-40545). A model with no row here has no price,
// so nothing asks it: a call is weighed in dollars by its row and counted on
// the space's meter (meter.ts `models`), and a call that could not be weighed
// could not be counted.
//
// Prices are Workers AI's own, in dollars per million tokens, from each
// model's page at developers.cloudflare.com/workers-ai/models. A row an app
// may ask is `offered`; the rest are the builder's alone (builder.ts).
//
// It is also how an app asks one, as a plugin (plugin.ts): the catalogue's
// offered rows planted in every app's store as @yaks/model's provider, model
// and serves rows, and that store's own transcript runner (@yaks/session),
// lent Workers AI through the one metered binding (meter.ts `metered`) and the
// commands the app marks `"model": true` as its tools. A page writes an entry
// wearing `using{model}` and the answer lands beside it.
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph'
import { edgeEid } from '@yaks/edge'
import {
  answers,
  providerResolver,
  running,
  type Tool,
  type ToolContext,
} from '@yaks/session'
import { worded } from '@yaks/tools'
import { edits, mode, writes } from '@yaks/member'
import { ModelError } from '@yaks/model'
import type { VocabDoc } from '@yaks/vocab'
import { workersAi } from '@yaks/workers-ai'
import { appStore, type Directory } from './directory.ts'
import { filled, schemaOf } from './lib/tools.ts'
import { metered } from './meter.ts'
import { caught } from './sentry.ts'
import {
  type Answer,
  type Effect,
  type Install,
  page,
  type Plugin,
  type Stored,
} from './plugin.ts'

/** What a model costs, in dollars per million tokens. `cached` is the price
 * of an input token the provider read from its cache, where it has one. */
export type Price = { input: number; output: number; cached?: number }

/** One model in the catalogue, by the name Workers AI runs it under. */
export type Row = Price & { name: string; label: string; offered: boolean }

export let CATALOGUE: Row[] = [
  {
    name: '@cf/zai-org/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    input: 0.15,
    cached: 0.03,
    output: 0.5,
    offered: true,
  },
  {
    name: 'typesafe/jev',
    label: 'Jev',
    input: 0.042,
    output: 0,
    offered: true,
  },
  {
    name: '@cf/baai/bge-base-en-v1.5',
    label: 'BGE base (embeddings)',
    input: 0.067,
    output: 0,
    offered: true,
  },
  {
    name: '@cf/zai-org/glm-5.3',
    label: 'GLM 5.3',
    input: 1.4,
    cached: 0.26,
    output: 4.4,
    offered: false,
  },
]

let priced = new Map(CATALOGUE.map((r) => [r.name, r]))

/** A model's row, or undefined for one the catalogue does not price. */
export let priceOf = (name: string): Row | undefined => priced.get(name)

/** The token counts a call is weighed by: @yaks/model's `Usage`, which is what
 * @yaks/workers-ai `usageOf` reads off an answer. */
export type Counts = {
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
}

/**
 * What a call cost, in dollars: its cached input at the cached price, the rest
 * of its input and all of its output at theirs.
 *
 * ```ts
 * import { assertAlmostEquals } from '@std/assert'
 * import { weigh } from './models.ts'
 *
 * let flash = { input: 0.15, cached: 0.03, output: 0.5 }
 * let cost = weigh(flash, {
 *   input_tokens: 2_000_000,
 *   cached_tokens: 1_000_000,
 *   output_tokens: 1_000_000,
 * })
 * assertAlmostEquals(cost, 0.15 + 0.03 + 0.5)
 * ```
 */
export let weigh = (price: Price, n: Counts) => {
  let cached = Math.min(n.cached_tokens ?? 0, n.input_tokens ?? 0)
  let fresh = (n.input_tokens ?? 0) - cached
  return (fresh * price.input + cached * (price.cached ?? price.input) +
    (n.output_tokens ?? 0) * price.output) / 1e6
}

/** A count a model left unsaid, estimated from what was sent or said: four
 * characters to a token, the usual rule for English. An embedding model
 * reports no usage at all, and its text is what it is billed on. */
export let guess = (sent: unknown) =>
  Math.ceil(JSON.stringify(sent ?? '').length / 4)

// ---- in an app's store ------------------------------------------------------

/** The provider every model in the catalogue is served by, as its row names
 * it and the runner is lent it. */
export let PROVIDER = 'workers-ai'

let provider = identityEid('provider', [PROVIDER])
let modelEid = (name: string): Eid => identityEid('model', [name])

/** The catalogue as an app's store holds it: the provider, each model an app
 * may ask, and the edge saying the one serves the other under the model's own
 * name, which is what a request is sent with. */
export let catalogued = (): Bundle[] => [
  {
    entity: { eid: provider },
    provider: { name: PROVIDER, transport: 'http', offered: true },
  },
  ...CATALOGUE.filter((r) => r.offered).flatMap((r): Bundle[] => [
    {
      entity: { eid: modelEid(r.name) },
      model: { name: r.name, label: r.label, offered: true },
    },
    {
      entity: { eid: edgeEid(provider, 'serves', modelEid(r.name)) },
      edge: { from: provider, to: modelEid(r.name) },
      serves: { name: r.name },
    },
  ]),
]

// Whether a store's row already says everything a wanted one does.
let says = (want: Bundle, held: Bundle | undefined) =>
  !!held && Object.entries(want).every(([name, comp]) =>
    name == 'entity' ||
    Object.entries(comp as Comp).every(([prop, v]) =>
      (held[name] as Comp | undefined)?.[prop] == v
    )
  )

/**
 * The catalogue brought up to date in an app's store, as a change: a row that
 * is missing or moved is written again, and a model the catalogue has stopped
 * offering stays (a past ask still names it) and is marked not offered.
 */
export let planting: Install = async (read, at) => {
  if (at.meta || !at.app) return []
  let want = catalogued()
  let held = new Map(
    (await read(`.eid=${want.map((b) => b.entity.eid).join(',')}&*`))
      .map((b) => [b.entity.eid, b]),
  )
  let names = new Set(want.map((b) => (b.model as Comp | undefined)?.name))
  let retired = (await read('.model&*')).filter((b) => {
    let m = b.model as Comp
    return m.offered && !names.has(m.name)
  })
  return [
    ...want.filter((b) => !says(b, held.get(b.entity.eid))),
    ...retired.map((b) => ({ entity: b.entity, model: { offered: false } })),
  ]
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
 * (lib/tools.ts). A command runs as the person who asked for the turn, held to
 * what they may write here: a model can do what they could do on the page, and
 * never more. A query answers what it reads.
 */
export let tooled = (at: Stored): Tool[] =>
  Object.entries(at.commands()).filter(([, def]) => def.model).map((
    [name, def],
  ) => ({
    name,
    description: def.description,
    parameters: schemaOf(def),
    run: async (args, ctx) => {
      let act = filled(def, args)
      if (act.query != null) return worded(await at.graph.read(act.query))
      let bundles = Array.isArray(act.apply) ? act.apply : [act.apply]
      return worded(await at.as(asker(ctx), bundles as Bundle[]))
    },
  }))

// The space an app's calls are counted against, read fresh each time it is
// asked (meter.ts `metered`).
let payer = (app: string) => async (dir: Directory) =>
  (await dir.appAt(app))?.space ?? null

/**
 * The store's transcript runner, registered on its registry: `session_run`
 * run here, lent Workers AI through the metered binding and the app's marked
 * commands. A run is not waited for: a turn takes seconds, and the write that
 * asked for it is answered as soon as it lands — the answer arrives through
 * the page's subscription. The object stays up while a call is in flight, as
 * a Durable Object does while it has I/O pending.
 */
let asking: Effect = (on, at) => {
  if (at.meta || !at.app) return
  let served = workersAi(metered(at.env, payer(at.app)))
  let lent = { [PROVIDER]: served }
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
    session_run: (e, tx, write) =>
      void Promise.resolve(run.session_run(e, tx, write))
        .catch((error) => at.broke('model', error)),
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
let posted = (body: string): { model: string; input: object } | null => {
  try {
    let { model, input } = JSON.parse(body)
    return typeof model == 'string' && input && typeof input == 'object'
      ? { model, input }
      : null
  } catch {
    return null
  }
}

/**
 * `./api/ai/run`: one call to a model, answered with what the model said, as
 * Workers AI says it — what a page or the app's own worker asks when it wants
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
    let manifest = await appStore(env.STORE, space, app, env)('/vocab')
      .then((r) => r.json() as Promise<VocabDoc>)
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
  try {
    return Response.json(
      await metered(env, payer(app.eid)).run(asked.model, asked.input),
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

/** Models, as a plugin of this Worker: the catalogue in every app's store,
 * that store's runner, and the door a page or a worker asks one through. */
export let modelsPlugin: Plugin = {
  name: 'models',
  pages: [page('models')],
  installs: [planting],
  effects: [asking],
  answers: [run],
}
