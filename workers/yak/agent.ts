import type { Who } from './session.ts'
import { reacquire } from './tool.ts'
// The agent door's two halves (T-33812), so mcp.ts is a mount and nothing
// else: the caller's reach as one `Graph`, and the platform's own tools as a
// `Plugin` on it.
//
// @yaks/mcp brings the generic tier — graph_apply, graph_query, graph_show,
// graph_schema and search — derived from the loaded vocabulary, with a schema
// per tool, so nothing here writes a bundle by hand. What it cannot bring is
// the platform: space_new, the app_* family, domain_*, member_*, feedback and
// about are this place's own verbs, and a plugin is how a graph grows verbs.
// mail_list is a second such plugin (letters.ts) — an app's own mailbox, said
// in the tool list so nobody confuses it with a person's.
// One server lists every tier because all of them are `Tool`s.
//
// The graph is A composition, not a database. A person's data lives in one
// Store object per app (graph.ts), an entity spans several, and reach.ts
// already asks them all and merges one bundle per eid. `reaching()` wears that
// as the `Graph` the package takes: `read` is the fan-out, `apply` is the
// routed write, and `storage` answers the one identity read `graph_show`
// makes. Everything a Graph does that a composition cannot — DDL, a
// transaction — throws rather than pretending, because nothing calls it.
//
// The vocabulary is every reachable app's `vocab.json` merged over the core
// documents, first declaration winning, which is the same rule a word's HOME
// follows (tools.ts `homesIn`): the schema an agent reads is the words it can
// actually write.
import { z } from 'zod'
import type {
  ApplyOpts,
  Bundle,
  Eid,
  Graph,
  Plugin,
  Query,
  Reduced,
  Row,
  Storage,
  Tool,
  Tx,
} from '@yaks/graph'
import { addressing } from '@yaks/graph/read'
import { aggregate } from '@yaks/graph/read'
import { argsOf } from '@yaks/graph/call'
import { composed as perEntity } from '@yaks/graph/bundle'
import { detached } from '@yaks/graph/storage'
import { parse, stringify, tokens } from '@yaks/query'
import { addressed, wordish } from '@yaks/alias'
import { barred, openly } from './anon.ts'
import type { Search } from '@yaks/mcp'
import type { PropSchema, Vocab } from '@yaks/vocab'
import { clock } from './timing.ts'
import { letters } from './letters.ts'
import { packageTools } from './package-tools.ts'
import { PUBLISHED, sending } from './published.ts'
import { composed, type Reach, read, vocabAt, written } from './reach.ts'
import { titling } from './session.ts'
import {
  type Ctx,
  inApp,
  type Out,
  type Tool as Sugar,
  TOOLS,
} from './tools.ts'
import { ceiling, serve, unseenBlock } from './unseen.ts'
import { appVocab, packagesOf } from './vocab.ts'
import { bare, joined, lined } from './wire.ts'
import { apex, type Host, hosted } from './host.ts'
import { refuse, unavailable } from './tool.ts'
import { inReach } from './declared.ts'

// One JSON Schema property as Zod. The tool table declares plain shapes — a
// string, a number, a flag, a list, an object — and the MCP SDK takes Zod, so
// this is the whole translation. An unknown shape stays unknown rather than
// being guessed at: the tool's own `run` checks its arguments anyway (tools.ts
// `text`, `list`, `files`), and a schema that lied would refuse a call the
// tool would have accepted.
let propOf = (schema: unknown, env: Host = {}): z.ZodTypeAny => {
  let s = (schema ?? {}) as { type?: string; items?: unknown }
  let one = s.type == 'string'
    ? z.string()
    : s.type == 'number' || s.type == 'integer'
    ? z.number()
    : s.type == 'boolean'
    ? z.boolean()
    : s.type == 'array'
    ? z.array(propOf(s.items, env))
    : s.type == 'object'
    ? z.record(z.unknown())
    : z.unknown()
  let said = (schema as { description?: string })?.description
  return said ? one.describe(hosted(said, env)) : one
}

/**
 * A tool's `input` as the MCP SDK wants it: one Zod schema per named argument,
 * optional unless the JSON Schema `required` list names it.
 */
export let inputOf = (
  schema: unknown,
  env: Host = {},
): Record<string, z.ZodTypeAny> => {
  let s = (schema ?? {}) as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  let need = new Set(s.required ?? [])
  return Object.fromEntries(
    Object.entries(s.properties ?? {}).map((
      [name, prop],
    ) => [
      name,
      need.has(name) ? propOf(prop, env) : propOf(prop, env).optional(),
    ]),
  )
}

/**
 * A platform tool's answer, as bundles: one entity carrying the sentence it
 * always said, saying which call produced it.
 *
 * These tools answer prose — that is what a platform verb has to say, and the
 * rows it worked on live in a directory nobody's reach holds — so the bundle
 * is `content{body}` with `output{source}` beside it, which is exactly what
 * the vocabulary has for an answer somebody's words. Where a program has
 * something to read in the answer (the files a list names, the roster `about`
 * serves), the tool answers it as data too, and it rides as `output{value}`:
 * the words are for a person and carry more than the answer, so nothing reads
 * them as data (@yaks/tools `valueIn`). The bundle is the one output schema
 * every tool declares (@yaks/mcp `answerSchema`).
 *
 * What is unseen in the space it worked in (unseen.ts) rides on the sentence —
 * every break not yet served, once, then the month's ceiling. It rode on the
 * door before (mcp.ts `call`) and rides on the tool now, because the door no
 * longer knows what a space is.
 *
 * Only a tool that writes carries it. Serving the block marks each break
 * `notified` and the space told, and a tool that says `readOnly` promises the
 * host it changes nothing a person would notice — so a look-up leaves the
 * news where it is, for the next write or `app_errors` to say.
 */
export let answered = async (
  ctx: Ctx,
  out: Out,
  call?: Eid,
  readOnly = false,
): Promise<Bundle[]> => {
  // Nobody signed in has no space to be told what is unseen in (anon.ts): the
  // breaks in an app are its members', and a stranger is not one.
  // The breaks and the ceiling are asked of different doors and neither waits
  // on the other, so they are asked together, each a stage on the call's
  // `Server-Timing` (timing.ts).
  let space = out.space
  let currentWho: Who | undefined
  if (space && ctx.person && !readOnly && ctx.reopen) {
    // Output metadata is not standing. The tool may have committed a change
    // (including removing its own seat); only a fresh seat gets private news.
    try {
      let current = await reacquire(ctx, space, undefined, false)
      space = current.space
      currentWho = current.who
    } catch {
      space = undefined
    }
  }
  let c = ctx.clock ?? clock()
  let text = !space || !ctx.person || readOnly
    ? out.text
    : out.text + (await Promise.all([
      c.time('breaks', async () => {
        let who = currentWho ??
          { person: ctx.person, role: await ctx.dir.role(space, ctx.person) }
        return unseenBlock(await serve(ctx.env, space, who))
      }),
      c.time('ceiling', () => ceiling(ctx.env, space)),
    ])).join('')
  // A call to say it came from, where there is one: the builder runs these
  // same tools in its own loop (builder.ts), with nothing to point at.
  let output = {
    ...(call ? { source: call } : {}),
    ...(out.value ? { value: out.value } : {}),
  }
  return [{
    entity: { eid: '$said' },
    content: { body: text },
    ...(Object.keys(output).length ? { output } : {}),
  }]
}

/**
 * One of the platform's own tools, called: the tool, then what is unseen in
 * the space it worked in.
 *
 * It is its own export because two doors run these tools — the connector
 * ({@link sugared}) and the builder we run ourselves (builder.ts) — and a
 * second copy of these two lines is a second `app_new`.
 */
export let running =
  (ctx: Ctx, t: Sugar) => (args: Record<string, unknown>, call?: Eid) => {
    let invocation = { ...ctx, ...(call ? { call } : {}) }
    return t.run(invocation, args).then((out) =>
      answered(invocation, out, call, t.readOnly)
    )
  }

// What the transport says about a tool beside its schemas: what it declares
// about signing in where that is not the door's own (preauth.ts NOAUTH — every
// other tool takes the door's, stamped by @yaks/mcp from `Options.security`).
// The platform draws no page of its own; an app's view is named by the command
// that has one (declared.ts), never by a tool on this list.
let metaOf = (t: Sugar): Pick<Tool, 'meta'> =>
  t.security ? { meta: { securitySchemes: t.security } } : {}

// What one of the platform's tools says about itself: the same for every
// caller of one deployment, so it is built once per tool per apex and not on
// every call — the Zod its input becomes was a tenth of what a call cost.
let described = new WeakMap<Sugar, Map<string, Omit<Tool, 'run'>>>()
let said = (t: Sugar, env: Host): Omit<Tool, 'run'> => {
  let by = described.get(t) ?? new Map<string, Omit<Tool, 'run'>>()
  described.set(t, by)
  let at = apex(env)
  let hit = by.get(at)
  if (!hit) {
    by.set(
      at,
      hit = {
        name: t.name,
        title: t.title,
        description: hosted(t.description, env),
        input: inputOf(t.input, env),
        // What it does, carried whole — the transport turns these four into
        // the MCP annotations (@yaks/mcp `annotated`), and a hint dropped here
        // is a tool the host mis-prompts about.
        ...(t.readOnly ? { readOnly: true } : {}),
        ...(t.destructive == null ? {} : { destructive: t.destructive }),
        ...(t.idempotent ? { idempotent: true } : {}),
        ...(t.openWorld ? { openWorld: true } : {}),
        // The page a host renders this answer in (MCP Apps): the tool names
        // it, the transport hands it over verbatim, and a host without views
        // ignores it.
        ...metaOf(t),
      },
    )
  }
  return hit
}

/** One of the platform's own tools, as a graph `Tool`. The answer is the same
 * sentence it always was, worn as the one bundle that carries words. */
export let sugared = (ctx: Ctx, t: Sugar): Tool => ({
  ...said(t, ctx.env),
  // The runner hands a tool the call and the graph; what a platform verb reads
  // is its arguments, which the runner has already checked, and the call it is
  // answering.
  run: (call) => running(ctx, t)(argsOf(call), call.entity.eid),
})

/**
 * The platform's verbs, as a plugin on the caller's graph: the whole tool
 * table, for everybody. It contributes no components — the words are the apps'
 * own — only tools, and every one of them is bound to the person asking.
 *
 * With nobody asking it is the same list (T-34541): a tool that needs a token
 * (anon.ts `openly` says which do not) is listed saying `oauth2` and refuses
 * the call (anon.ts `barred`), rather than being dropped. One roster, in one
 * order, whoever is asking — which is what a directory that snapshots
 * `tools/list` at submission and serves it forever needs from us
 * (declared.ts). The names a directory listed and no tool carries any more
 * follow, as their translations (published.ts): they answer a call and are
 * left out of `tools/list`, where they would only say a second time what the
 * tool doing their work now says.
 */
export let platform = (ctx: Ctx): Plugin => {
  let bound = (t: Sugar) =>
    ctx.person || openly(t) ? sugared(ctx, t) : barred(sugared(ctx, t), ctx.env)
  let signed = (t: Tool) => ctx.person ? t : barred(t, ctx.env)
  return {
    name: 'yak/platform',
    tools: [
      ...TOOLS.map(bound),
      ...PUBLISHED.map((t) => ({ ...bound(t), listed: false })),
      ...packageTools(ctx).map(signed),
      { ...signed(sending(ctx)), listed: false },
    ],
  }
}

/**
 * The post room's own verb, as a second plugin (letters.ts): `mail_list`. It
 * is apart from the table above because it answers the letters themselves as
 * bundles, where every other verb there answers words. Sending is @yaks/mail's
 * `mail_send`, among the package tools.
 */
export let post = (ctx: Ctx): Plugin => ({
  name: 'yak/mail',
  tools: letters(ctx),
})

/**
 * One app, named: `recipes`, or `space/app` where a slug means two things.
 *
 * Naming is also what reaches the platform's own store, which is in nobody's
 * ordinary reach on purpose (directory.ts `spaces`, apps.ts `kernels`) — its
 * owner's door to it is this tier, and this is how they open it. The same
 * door is how the platform's admin reaches any app's rows: named by space and
 * app, they stand there as its owner (tool.ts `roleIn`).
 */
export let named = (ctx: Ctx, said: string, write = false): Promise<Reach> => {
  // Naming an app is asking about a membership, so a caller with no identity
  // cannot do it: signed out, the app a read answers for is the one the call
  // names and the door resolved (anon.ts `opened`), never a rider on the line.
  if (!ctx.person) {
    throw refuse(
      'access',
      `signed out, a read cannot name an app on the query line (.in=${said}) ` +
        '— name space and app on the call itself',
    )
  }
  let [one, two] = said.split('/')
  return inApp(ctx, two ? { space: one, app: two } : { app: one }, write, true)
}

// The `.in=` rider: which app a read is scoped to. It is the platform's word,
// not the query grammar's, so it comes off the line before any store sees it —
// a store knows about components, and which of several stores to ask is a
// question only this side of the hop can answer. It is a clause like any
// other, so whitespace ends it as `&` does.
/// scope('.doc .in=recipes') -> { said: 'recipes', line: '.doc' }
/// scope('.in=me/trip&.doc|.task') -> { said: 'me/trip', line: '.doc|.task' }
export let scope = (line: string) => {
  let segs = tokens(bare(line))
  let said = segs.find((s) => /^\.in=/.test(s))?.slice(4)
  return { said, line: joined(segs.filter((s) => !/^\.in=/.test(s))) }
}

// `.in=` alone says which app to read and nothing about what: a line with no
// clause left reads nothing, and an empty answer reads as an empty app. So it
// is refused with a line that reads what the app keeps.
export let unasked = (
  slug: string,
  said: string,
  defs: Record<string, { tool?: unknown; rule?: unknown; extends?: unknown }>,
) => {
  let kinds = Object.entries(defs)
    .filter(([, d]) => !d.tool && !d.rule && !d.extends)
    .map(([name]) => name)
  let line = kinds.length ? `.${kinds[0]}&?doc` : '.doc'
  return `'.in=${said}' says which app to read, not what: a row carries ` +
    `the components its line names. ${slug} keeps ` +
    `${kinds.length ? kinds.join(', ') : 'doc'}, so ` +
    `'${line}&.in=${said}' reads ${kinds.length ? 'each with its doc' : 'them'}`
}

// The identity operand list, wherever it appears on a line: `.entity.eid=a,b` — which
// is what the page's `id=` becomes (wire.ts `lined`) — names a set rather than
// comparing a property, so its operands are ids and a word among them may be a
// name (T-34390, @yaks/alias). `.entity.eid!=` and the rest are untouched: this is the
// one operator whose right-hand side is an identity.
let IDS = /(^|&)(\.entity\.eid=)([^&]*)/g

// That line with every name in it replaced by the entity it names. Nothing to
// resolve costs nothing: a uuid is not asked about, and a line naming no id is
// not read at all.
let byName = async (
  storage: Storage,
  line: string,
): Promise<string> => {
  let said = [...line.matchAll(IDS)]
    .flatMap((m) => m[3].split(',')).filter(wordish)
  if (!said.length) return line
  let at = await addressed(detached(storage), said)
  if (!at.size) return line
  return line.replaceAll(
    IDS,
    (_, pre, key, vals) =>
      `${pre}${key}${
        String(vals).split(',').map((v) => at.get(v) ?? v).join(',')
      }`,
  )
}

// A composition is not a database: these are the members of `Graph` that only
// mean something to an adapter that owns bytes, and nothing calls them here.
let nope = (what: string) => (): never => {
  throw new Error(`the reach is composed, not stored — no ${what}`)
}

// A reduction comes back from the reach already reduced: a store's `/query`
// door, or the composing read's own `.count`, answers `{count: n}`. `rows` is
// what a reduction is made from (@yaks/graph `reduced` reads them), so the
// value goes back as the rows that make it, and `graph_query` answers a count
// the same way whichever graph is behind it.
let unreduced = (value: Reduced): Row[] =>
  'count' in value
    ? [{ n: value.count }]
    : 'tally' in value
    ? Object.entries(value.tally).map(([v, n]) => ({ value: v, n }))
    : value.distinct.map((v) => ({ value: v }))

// The one read `graph_show` makes, and the only reason this Graph carries a
// storage at all: these eids, whole, out of every store that holds a piece of
// one (reach.ts `composed`).
let held = (
  ctx: Ctx,
  reach: Reach[],
  fresh: <T>(run: () => Promise<T>) => Promise<T> = (run) => run(),
): Storage => {
  let self: Storage
  // The reach's answer to a line, and whether the line asked for a reduction.
  // A tree is the graph's own read (a reference looked up by title, a tool's
  // query), already in the store's grammar, so it is written as text and not
  // translated again.
  let asked = async (q: Query) => {
    let { said, line } = scope(stringify(q))
    let where = said ? [await named(ctx, said)] : reach
    if (said && !line) {
      let { space, app } = where[0]
      let defs = (await vocabAt(ctx.env, space, app)).$defs ?? {}
      throw refuse('arguments', unasked(app.slug, said, defs))
    }
    // An agent's grammar is the page's (guide.md): `id=`, `limit=` and `after=`
    // where the store writes `.entity.eid=`, `.limit=` and `.after=`, and a value
    // written as it reads rather than as a store would parse it. One
    // translation for every door a person's own line arrives at (wire.ts).
    let one = await byName(self, typeof q == 'string' ? lined(line) : line)
    let answer = await read(ctx.env, where, one)
    return { answer, reduced: !!aggregate(parse(one)) }
  }
  let rows = async (q: Query): Promise<Row[]> => {
    let { answer, reduced } = await fresh(() => asked(q))
    return reduced ? unreduced(answer as Reduced) : answer as Row[]
  }
  // A reduction has no members to list, so a read of one lists none, as a
  // store's own read of it does.
  let bundles = async (q: Query): Promise<Bundle[]> => {
    let { answer, reduced } = await fresh(() => asked(q))
    return reduced ? [] : answer as Bundle[]
  }
  let tx: Tx = {
    read: bundles,
    get: (eids, comps) =>
      fresh(() =>
        composed(ctx.env, reach, eids, {
          want: comps ? new Set(comps) : null,
        })
      ) as unknown as Promise<Bundle[]>,
    patch: nope('transaction'),
    remove: nope('transaction'),
    revive: nope('transaction'),
  }
  self = {
    install: () => {},
    read: bundles,
    rows,
    get: tx.get,
    tx: (body) => body(tx) as never,
  }
  return self
}

// Every reachable app's `vocab.json`, merged over the core documents. First
// declaration wins, which is where a word lives (T-32728): two apps in two
// spaces may each home one word, and then one name means two things (reach.ts
// `apartIn`), and the first declarer is the word here, the same rule the
// space's own union loads by. The platform declares first: an app that held a
// word before the platform said it keeps it in its own store (vocab.ts
// `beneath`), and here the word is the platform's. Each store still decides
// what it takes: a write routes each component to the store that declares it
// (reach.ts `written`).
let spoken = async (ctx: Ctx, reach: Reach[]): Promise<Vocab> => {
  // Each store's words as the document it keeps, read once per request
  // (reach.ts `vocabAt`): the roster already asked for them (standing.ts
  // `kindsOf`).
  let said = await Promise.all(
    reach.map((r) => vocabAt(ctx.env, r.space, r.app)),
  )
  let defs: Record<string, PropSchema> = {}
  let core = appVocab()
  for (let one of said) {
    for (let [name, schema] of Object.entries(one.$defs ?? {})) {
      if (!defs[name] && !core.def(name)) defs[name] = schema
    }
  }
  // And the words their `"platform"` dependencies lend (vocab.ts `lent`),
  // beneath every app's own.
  let packages = [...new Set(said.flatMap(packagesOf))].sort()
  return appVocab({ $defs: defs, ...packages.length ? { packages } : {} })
}

// The batch as applied, as `graph_apply` promises it: one bundle per entity,
// each minted under an alias carrying the name the batch called it by — which
// is how a caller matches the id it just minted to the word it asked for.
//
// Each store composed its own answer (@yaks/graph `composed`), and an entity
// spanning apps was answered once per store it landed in (reach.ts `written`);
// composing the parts is what makes that one entity again. The alias is put on
// after, because this door minted the aliases itself before the batch was
// split, so no store ever saw one.
let aliased = (
  out: { bundles: Bundle[]; aliases: Record<string, string> },
): Bundle[] => {
  let named = new Map(
    Object.entries(out.aliases).map(([alias, eid]) => [eid, alias]),
  )
  return perEntity(out.bundles).map((b) =>
    named.has(b.entity.eid) ? { $alias: named.get(b.entity.eid), ...b } : b
  )
}

// Which app a write goes in, when nothing else can say. A word's HOME decides
// most of it (reach.ts `routed`) — the app that declared the component owns
// the write, and a shared word rides with the app's own words beside it — but
// a brand-new entity wearing nothing but shared words has no home to go to,
// and then somebody has to name one.
//
// It is said on the bundle, `$app`, beside the other `$` words the wire
// already carries, rather than as an argument to the tool: which store a
// component lives in is a fact about the entity, which is what a read answers
// in `_stores`. One batch names one app, because one batch is one write.
//
// `$actor` comes off here too. @yaks/api signs every batch with the identity
// the door authenticated, which is how a graph in this process learns who
// wrote — but a write across the hop says it the way the stores already
// listen for it, as the vouch on the request (session.ts `titling`), and a
// store handed a component it never planted refuses the batch.
let aimed = async (ctx: Ctx, batch: Bundle[]) => {
  let slugs = new Set<string>()
  let said = batch.map((e) => {
    let { $app: at, $actor: _, ...rest } = e as Record<string, unknown>
    if (typeof at == 'string' && at) slugs.add(at)
    return rest as Bundle
  })
  if (slugs.size > 1) {
    throw refuse(
      'arguments',
      `$app names ${[...slugs].join(' and ')} — one batch goes in one app`,
    )
  }
  let [slug] = [...slugs]
  return {
    batch: said,
    where: slug ? await named(ctx, slug, true) : undefined,
  }
}

/** Ranked search over everything in reach, as the package's `search` seam. */
export let searching =
  (ctx: Ctx, reach: Reach[]): Search => async (words, opts) => {
    let q = `${encodeURIComponent(words)}&limit=${opts?.limit ?? 20}`
    let hits = await read(ctx.env, reach, lined(q))
    return Array.isArray(hits) ? hits as Bundle[] : []
  }

/**
 * A Store refuses a call whose directory revision a later directory write
 * superseded, before it does anything with it, so the caller is asked again
 * from a fresh view of its reach: standing is read anew, never carried over.
 * A batch that may have committed in some of its stores is not asked again.
 */
export let renewing =
  (ctx: Ctx, reach: Reach[], again = () => inReach(ctx)) =>
  async <T>(run: () => Promise<T>): Promise<T> => {
    for (let attempt = 0;; attempt++) {
      try {
        return await run()
      } catch (e) {
        if (
          !ctx.reopen || attempt >= 2 || !unavailable(e) ||
          (e as { partial?: boolean }).partial
        ) throw e
        ctx.dir = ctx.reopen()
        reach.splice(0, reach.length, ...await again())
      }
    }
  }

/**
 * The caller's reach as one graph: every app they can read, asked together and
 * answered as one bundle per entity, with the platform's tools on it.
 *
 * A write routes each component to the app that declares it (reach.ts
 * `written`), which is what an entity spanning apps means — so `graph_apply`
 * needs no app named and never had one to name here.
 */
export let reaching = async (
  ctx: Ctx,
  reach: Reach[],
): Promise<Graph> => {
  let vocab = await spoken(ctx, reach)
  let fresh = renewing(ctx, reach)
  let storage = held(ctx, reach, fresh)
  // The post room is a person's own mailbox work (letters.ts), and it is
  // listed for everybody: a caller who has not signed in has no letters to
  // list, and hears that as the sign-in challenge rather than as a tool that
  // is not there. One roster, one order, whoever is asking (`platform`,
  // T-34541).
  let plugins = [platform(ctx), post(ctx)]
  let writing = (bundles: Bundle[], opts?: ApplyOpts) =>
    fresh(() => writes(bundles, opts))
  let writes = async (bundles: Bundle[], opts?: ApplyOpts) => {
    let asked = (Array.isArray(bundles) ? bundles : [bundles]) as Bundle[]
    let { batch, where } = await aimed(ctx, asked)
    // The same `Reach` the fan-out is holding, where it holds one: reach.ts
    // routes by identity — a word's declarers are picked out of this very
    // list — so a second object naming the same app is not it.
    let one = where &&
      (reach.find((r) => r.app.eid == where.app.eid) ?? where)
    let out = await written(
      ctx.env,
      one && !reach.includes(one) ? [...reach, one] : reach,
      one,
      batch,
      await titling(ctx.dir, ctx.person),
      opts?.check === true,
    )
    return aliased(out)
  }
  let self: Graph = {
    vocab,
    worn: () => false,
    storage,
    outside: detached(storage),
    plugins,
    use: (p) => (plugins.push(p), self),
    install: () => {},
    rewrites: () => false,
    scope: (opts = {}) => opts,
    // Each reached store owns its answer hooks; this composition addresses
    // queries but does not reinterpret bundles already answered by a store.
    ask: (q) => addressing(vocab)(q, self.address),
    answer: (bundles) => bundles,
    view: () => null,
    read: (q) => storage.read(q),
    rows: (q) => storage.rows(q),
    get: (eids, comps) => storage.get(eids, comps),
    // A name where an eid goes (T-34390). The ladder is @yaks/alias's and it
    // is nothing but reads by id, so it works here exactly as it does inside a
    // store: `get` fans across the reach, and a name held in whichever store
    // this caller can see answers.
    address: (ids) => addressed(detached(storage), ids),
    apply: writing,
    admit: (bundles, opts) => writing(bundles, { ...opts, check: true }),
  }
  return self
}
