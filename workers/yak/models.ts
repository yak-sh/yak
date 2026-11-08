// Providers lent to each app store; model offerings come from successful answers.
import type { Handlers } from '@yaks/effects'
import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid, identityEid } from '@yaks/graph/identity'
import {
  offers,
  providerResolver,
  running,
  type Tool,
  type ToolContext,
} from '@yaks/session'
import { worded } from '@yaks/tools/result'
import { edits, type Level, mode, writes } from '@yaks/member'
import {
  billed,
  confirmed,
  type Lent,
  type Listed,
  type MediaReceipt,
  mediaReceipts,
  type Model,
  ModelError,
  type Price,
} from '@yaks/model'
import { records } from '@yaks/secrets'

import type { Plug } from '@yaks/host/config'
import type { VocabDoc } from '@yaks/vocab'
import { type ArtifactStore, objectBlobs } from '@yaks/blob'
import { artifactStore } from '@yaks/blob/identify'
import { appStore, type Directory, directoryOf } from './directory.ts'
import { vaultOf } from './vault.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { storeOf } from './door.ts'
import { blobPrefix, receiptPrefix } from './blob-key.ts'
import { filled, schemaOf } from '@yaks/tools/declared'
import { accounted, countedMedia, metered } from './meter.ts'
import { mediaRoom } from './usage.ts'
import type { Env } from './env.ts'
import { outbound } from './outbound.ts'
import { caught } from './defects.ts'
import type { Answer, Asked } from './apps.ts'
import type { Stored } from './graph.ts'
import { lending } from './inference.ts'
import { bare, connection, names, served } from './providers.ts'
import { serving } from './config.ts'
import { grantEid } from './app-writes.ts'
import { visitorKey } from './rate.ts'

export let guess = (sent: unknown) =>
  Math.ceil(JSON.stringify(sent ?? '').length / 4)

// Only providers are installed. Model rows stay as history and are never retired
// because a newer release or a code list stopped naming them.
export let planting = async (
  read: Stored['graph']['read'],
  at: Pick<Stored, 'meta' | 'app' | 'env'>,
): Promise<Bundle[]> => {
  if (at.meta || !at.app) return []
  let held = await read('.provider&*')
  return names(at.env, serving).flatMap((name): Bundle[] =>
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

// The visitor whose turn a model call is, if it is one, who spends the
// visitors' share of the space's budget (meter.ts `visiting`) and their own
// calls of the day (meter.ts `visitorCalls`). Only an app whose manifest opens
// its models has visitor turns: elsewhere `using` is an editor's to write
// (app-authority.ts `FLOORS`). There, the turn is the transcript's starter's,
// since a visitor writes lines only in transcripts they started (`WITHIN`): a
// visitor unless it is the app itself or someone whose vouched level here
// writes (app-writes.ts `vouching` keeps it). One signed in is named by their
// person; nobody signed in is a visitor too, named by the transcript, since
// the store never learns their address.
let visitorOf = (at: Stored) => async (req: { conversation?: string }) => {
  if (at.manifest().models != 'open' || !req.conversation) return undefined
  let [session] = await at.graph.get([req.conversation])
  let by = (session?.created as Comp | undefined)?.by
  if (typeof by != 'string') return req.conversation
  if (by == at.app) return undefined
  let [grant] = await at.graph.get([grantEid(at.app!, by)])
  return writes((grant?.grant as Comp | undefined)?.access as Level)
    ? undefined
    : by
}

// Where the media an app's models generate is kept: its own blobs, counted
// among its space's files, which are asked for room before a model is paid.
let artifacts = (at: Stored): ArtifactStore => {
  let kept = async () => {
    let found = at.context ??
      (at.env.STORE ? await directoryOf(at.env.STORE).appAt(at.app!) : null)
    if (!found || !at.env.BLOBS) {
      throw new ModelError('media_storage', 'This app has no blob store')
    }
    return { ...found, blobs: at.env.BLOBS }
  }
  return Object.assign(
    async (bytes: Uint8Array, mediaType: string) => {
      let { space, app, blobs } = await kept()
      return artifactStore(objectBlobs(blobs, blobPrefix(space, app)))(
        bytes,
        mediaType,
      )
    },
    { room: async () => mediaRoom(at.env as Env, (await kept()).space)() },
  )
}

// The vault holds small app-scoped pointers; private object storage holds media.
let receiptsFor = (at: Stored) =>
  at.env.STORE
    ? mediaReceipts(
      records<Partial<MediaReceipt>>(
        {
          apply: (bundles) =>
            meta({ STORE: at.env.STORE! }).apply(bundles, KERNEL),
        },
        vaultOf(at.env),
        'generated-media:' + (at.context?.app.store ?? at.app) + ':',
      ),
      at.env.BLOBS
        ? objectBlobs(
          at.env.BLOBS,
          at.context
            ? `${at.context.app.files}/receipts/`
            : receiptPrefix({ eid: at.app! }),
        )
        : undefined,
    )
    : undefined

/** Recover or account media on its original ask, without generation.
 * An attached recording needs no private receipt or additional download. */
export let recovering = async (at: Stored, call: string) => {
  let [ask] = await at.graph.get([call])
  if (!ask?.ask || !ask.entry || !at.app || !at.env.STORE) {
    throw new ModelError('media_missing', 'No original media ask in this app')
  }
  let found = at.context ?? await directoryOf(at.env.STORE).appAt(at.app)
  if (!found) throw new ModelError('unbound', 'No account bound to this call')
  let outputs = await at.graph.read(`.output.source=${call}&.attachment&*`)
  let cost = ask.cost as { dollars?: number; reported?: boolean } | undefined
  if (outputs.length && cost?.dollars != null) {
    await countedMedia(
      { STORE: at.env.STORE },
      found.space,
      call,
      cost.dollars,
      cost.reported ?? true,
    )
    return outputs
  }
  let receipts = receiptsFor(at)
  let receipt = await receipts?.read(call)
  // A receipt that names no provider is from before receipts named one, when
  // only the first could make media.
  let provider = receipt?.provider ?? names(at.env, serving)[0]
  let model = provided(at)[provider]
  if (!model?.recover) {
    throw new ModelError(
      'media_provider',
      'No delivery adapter for ' + provider,
    )
  }
  let reply = await model.recover!(call)
  let to = (ask.ask as Comp).to
  let [modelRow] = typeof to == 'string' ? await at.graph.get([to]) : []
  let charge = billed(reply, modelRow?.price as Price | undefined)
  if (!charge) {
    throw new ModelError('media_cost', 'No recording cost')
  }
  await countedMedia(
    { STORE: at.env.STORE },
    found.space,
    call,
    charge.dollars,
    charge.reported,
  )
  let session = (ask.entry as Comp).session
  let patches: Bundle[] = [{
    entity: ask.entity,
    cost: charge,
    attempt: { by: null },
    interrupted: null,
    failed: null,
  }]
  for (let artifact of reply.artifacts ?? []) {
    let eid = artifact.address
    patches.push({
      entity: { eid },
      artifact: {
        address: eid,
        media_type: artifact.media_type,
        size: artifact.size,
      },
    }, {
      entity: {
        eid: derivedEid('generated-media-output|' + call + '|' + artifact.call),
      },
      $was: { attachment: { artifact: null } },
      entry: { session },
      attachment: { artifact: eid, call: artifact.call },
      output: { source: call },
      content: { body: 'Recovered generated media: ' + eid },
    })
  }
  return at.graph.apply(patches, { trusted: true })
}

// Only editors can ask; the body names one original ask, never a prompt or URL.
export let recovery: Answer = async (
  { path, req, who, env, app, json, refuse },
) => {
  if (path != '/ai/recover') return null
  if (!writes(who.role)) return refuse()
  if (!app.store) return json(503, 'unbound')
  if (req.method != 'POST') return json(405, 'method_not_allowed')
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, 'bad_request')
  }
  if (
    !body || typeof body != 'object' || Object.keys(body).length != 1 ||
    !('call' in body) || typeof body.call != 'string'
  ) {
    return json(400, 'bad_request')
  }
  return storeOf(env.STORE, app.store).consume(
    '/recover',
    (r) => Promise.resolve(r),
    { method: 'POST', body: JSON.stringify(body) },
    KERNEL,
  )
}

// How an app's model calls leave: those of the app's own providers through
// its egress, which exchanges the sentinel of a connection the app uses for
// its key on the way to the integration's hosts (nothing here reads or
// records the key), and those of the platform's over its model transport.
// One transport each per app, so what a provider keeps by transport (a
// catalogue) is read once.
let leaving = (env: Stored['env'], app: string, own: boolean): typeof fetch => {
  let apps = transports.get(env) ?? new Map<string, typeof fetch>()
  transports.set(env, apps)
  let key = (own ? 'app:' : 'platform:') + app
  let send = apps.get(key)
  if (send) return send
  send = own
    ? (input, init) => {
      if (!env.STORE) {
        throw new ModelError('unbound', 'This app has no integration store')
      }
      return outbound(new Request(input, init), { ...env, STORE: env.STORE }, {
        app,
        level: 'owner',
        person: null,
      })
    }
    : (input, init) => (env.MODEL_FETCH ?? fetch)(input, init)
  apps.set(key, send)
  return send
}
let transports = new WeakMap<object, Map<string, typeof fetch>>()

// What an app's store lends each provider config.ts `serving` names: one
// named bare is the app's own, called on the app's connection to the
// integration it asks for, through its egress; any other is the platform's.
// Both are lent the app's media store and receipts.
let lent = (at: Stored) => (plug: Plug): Lent => {
  let own = bare(plug)
  return {
    fetch: leaving(at.env, at.app!, own),
    key: (integration) =>
      own
        ? connection(at.env, at.app!, integration)
        : Promise.resolve(undefined),
    refresh: () => Promise.resolve(undefined),
    store: artifacts(at),
    env: () => undefined,
    receipts: receiptsFor(at),
  }
}

/** The models an app's store is lent, by the provider name each serves
 * under. */
export let provided = (at: Stored): Record<string, Model> =>
  served(at.env, lent(at), serving)

let modelRows = (graph: {
  read(query: string): Bundle[] | Promise<Bundle[]>
  apply(bundles: Bundle[]): unknown
}) => ({
  price: async (name: string) => {
    let [row] = await graph.read(
      `.entity.eid=${identityEid('model', [name])}&?price`,
    )
    return row?.price as Price | undefined
  },
  answered: async (provider: string, name: string, info: Listed) => {
    await graph.apply(
      confirmed(identityEid('provider', [provider]), name, info),
    )
  },
})

/**
 * The store's transcript runner, registered on its registry: `session_run`
 * run here, lent the providers config.ts `serving` names, each metered
 * against the app's space, and the app's marked commands. The store's effect pool keeps each run while the write that asked
 * for it answers immediately; the result arrives through the subscription.
 */
export let asking = (at: Stored): Handlers => {
  if (at.meta || !at.app) return {}
  let price = async (name: string) => {
    let [row] = await at.graph.get([identityEid('model', [name])])
    return row?.price as Price | undefined
  }
  let lent: Record<string, Model> = {}
  for (let [name, model] of Object.entries(provided(at))) {
    lent[name] = accounted(
      at.env,
      payer(at.app),
      model,
      price,
      visitorOf(at),
      name,
    )
  }
  let first = names(at.env, serving)[0]
  let resolveModel = providerResolver(
    at.graph,
    lent,
    undefined,
    (provider) => lending(at, provider),
  )
  let run = running(at.graph, {
    holder: at.app,
    model: lent[first],
    resolveModel: async (using, model) => {
      // A turn may precede the app's first deploy. Provider identities are
      // needed to dispatch it; only a successful answer creates an offering.
      let rows = await planting(at.graph.read, at)
      if (rows.length) await at.graph.apply(rows, { trusted: true })
      // A model no row says the provider of is asked of the first.
      if (
        !using?.provider &&
        !(await offers(at.graph, model.entity.eid, lent)).length
      ) using = { ...using, provider: identityEid('provider', [first]) }
      return resolveModel(using, model)
    },
    // This store owns every model turn in its app. There is no other host
    // to wait for: an unresolved selection must reach the runner's refusal.
    answers: () => Promise.resolve(true),
    tools: [],
    toolSnapshot: () => Promise.resolve(tooled(at)),
    report: (error, _, phase) => at.broke(`model ${phase}`, error),
  })
  return {
    session_input: run.session_input,
    session_run: run.session_run,
  }
}

// How each way a model call fails is answered at the door: the allowance
// spent, the model busy, a model not offered here (no model by that name, or
// its license unaccepted), an input the model refuses, which is the caller's
// to correct, a host with no provider to lend, and a space whose files have
// no room for the media asked for.
let STATUS: Record<string, number> = {
  limit: 429,
  busy: 503,
  model: 400,
  bad_request: 400,
  unbound: 503,
  space_full: 413,
}

// What the door is posted: the model's name and its input, as its provider's
// own door takes them.
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

/** How `./api/ai/run` answers a call that threw: the status, code and message
 * for a refusal that is the caller's or the account's to hear, or nothing for
 * a failure that is ours (a break, answered 502). An input the model refuses
 * (`bad_request`) is 400, theirs to correct. */
export let refusal = (e: unknown): [number, string, string] | null =>
  e instanceof ModelError ? [STATUS[e.code] ?? 502, e.code, e.message] : null

/**
 * `./api/ai/run`: one call to a model through its provider's own door
 * (meter.ts `metered`, Workers AI's binding as config.ts `serving` names it),
 * answered with what the model said — what a page or the app's own worker asks
 * when it wants an answer back rather than a transcript (the worker's `ai`
 * binding posts here, dispatch.ts `shim`). Asked by whoever may ask the app's models for a
 * turn: its members, or, where its manifest says `"models": "open"`, anyone
 * who may write it. Metered like every call.
 * The input is the caller's, passed whole, so one the model refuses is
 * answered 400 as theirs to correct.
 */
export let modelAccess = async (
  { env, app, space, who, refuse, json }: Asked,
): Promise<Response | null> => {
  if (!edits(mode(app.access), who.role)) return refuse()
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
  }
  return null
}

export let modelRun: Answer = async (
  { env, req, path, space, app, who, refuse, json },
) => {
  if (path != '/ai/run') return null
  if (req.method != 'POST') return json(405, 'method_not_allowed')
  let denied = await modelAccess({
    env,
    req,
    path,
    space,
    app,
    who,
    refuse,
    json,
  })
  if (denied) return denied
  let body = await req.text()
  let asked = posted(body)
  if (!asked) {
    return json(
      400,
      'bad_request',
      'post {"model": "<name>", "input": {…}}: the model, and what it is ' +
        'asked as its provider takes it',
    )
  }
  let conversation = req.headers.get('x-session-affinity') || asked.session_id
  let graph = metaOf(appStore(env.STORE, space, app, env), KERNEL)
  try {
    return Response.json(
      await metered(
        env,
        payer(app.eid),
        modelRows({
          read: (query) => graph.query(query, { trusted: true }),
          apply: graph.apply,
        }),
        writes(who.role) ? undefined : visitorKey(who, req),
      ).run(
        asked.model,
        asked.input,
        conversation
          ? { extraHeaders: { 'x-session-affinity': conversation } }
          : undefined,
      ),
    )
  } catch (e) {
    let no = refusal(e)
    if (no) return json(...no)
    let why = e instanceof Error ? e.message : String(e)
    caught(e, {
      request: 'POST /api/ai/run',
      space: space.slug,
      app: app.slug,
    })
    return json(502, 'model_failed', `${asked.model} did not answer: ${why}`)
  }
}
