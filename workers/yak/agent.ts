// The agent door's two halves (T-33812), so mcp.ts is a mount and nothing
// else: the caller's reach as one `Graph`, and the platform's own tools as a
// `Plugin` on it.
//
// @yaks/mcp brings the generic tier — graph_apply, graph_query, graph_show,
// graph_schema and search — derived from the loaded vocabulary, with a schema
// per tool, so nothing here spells a bundle by hand. What it cannot bring is
// the platform: space_new, the app_* family, domain_*, member_*, feedback and
// about are this place's own verbs, and a plugin is how a graph grows verbs.
// mail_list and mail_send are a second such plugin (letters.ts) — an app's own
// mailbox, said in the tool list so nobody confuses it with a person's.
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
  Bundle,
  Eid,
  Graph,
  Plugin,
  Row,
  Storage,
  Tool,
  Tx,
} from '@yaks/graph'
import { composed as perEntity, detached } from '@yaks/graph'
import { addressed, wordish } from '@yaks/alias'
import { barred, openly } from './anon.ts'
import type { Search } from '@yaks/mcp'
import type { Column, PropSchema, Vocab } from '@yaks/vocab'
import { META } from './directory.ts'
import { vocabIn } from './declared.ts'
import { letters } from './letters.ts'
import { composed, type Reach, read, written } from './reach.ts'
import { titling } from './session.ts'
import {
  type Ctx,
  inApp,
  type Out,
  type Tool as Sugar,
  TOOLS,
} from './tools.ts'
import { ceiling, serve, unseenBlock } from './unseen.ts'
import { appVocab, meant, PLATFORM_APART, wordOf } from './vocab.ts'
import { lined } from './wire.ts'
import { type Host, hosted } from './host.ts'

// One JSON Schema property as Zod. The tool table spells plain shapes — a
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
 * the vocabulary has for an answer somebody's words. The structured `data` a
 * tool used to answer beside its text is gone: every one of them said a second
 * time what the text already says, and a reply's structure is its bundles now
 * — which is the one output schema every tool declares (@yaks/mcp
 * `answerSchema`).
 *
 * What is unseen in the space it worked in (unseen.ts) rides on the sentence —
 * every break not yet served, once, then the month's ceiling. It rode on the
 * door before (mcp.ts `call`) and rides on the tool now, because the door no
 * longer knows what a space is.
 */
export let answered = async (
  ctx: Ctx,
  out: Out,
  call?: Eid,
): Promise<Bundle[]> => {
  // Nobody signed in has no space to be told what is unseen in (anon.ts): the
  // breaks in an app are its members', and a stranger is not one.
  let text = !out.space || !ctx.person ? out.text : out.text +
    unseenBlock(
      await serve(ctx.env, out.space, {
        person: ctx.person,
        role: await ctx.dir.role(out.space, ctx.person),
      }),
    ) + await ceiling(ctx.env, out.space)
  return [{
    entity: { eid: '$said' },
    content: { body: text },
    // A call to say it came from, where there is one: the builder runs these
    // same tools in its own loop (builder.ts), with nothing to point at.
    ...(call ? { output: { source: call } } : {}),
  }]
}

/**
 * One of the platform's own tools, called: the tool, then what is unseen in
 * the space it worked in.
 *
 * It is its own export because two doors run these tools — the connector
 * ({@link sugared}) and the builder we run ourselves (builder.ts) — and a
 * second spelling of these two lines is a second `app_new`.
 */
export let running =
  (ctx: Ctx, t: Sugar) => (args: Record<string, unknown>, call?: Eid) =>
    t.run(ctx, args).then((out) => answered(ctx, out, call))

// What the transport says about a tool beside its schemas: what it declares
// about signing in where that is not the door's own (preauth.ts NOAUTH — every
// other tool takes the door's, stamped by @yaks/mcp from `Options.security`).
// The platform draws no page of its own; an app's view is named by the command
// that has one (declared.ts), never by a tool on this list.
let metaOf = (t: Sugar): Pick<Tool, 'meta'> =>
  t.security ? { meta: { securitySchemes: t.security } } : {}

/** One of the platform's own tools, as a graph `Tool`. The answer is the same
 * sentence it always was, worn as the one bundle that carries words. */
export let sugared = (ctx: Ctx, t: Sugar): Tool => ({
  name: t.name,
  title: t.title,
  description: hosted(t.description, ctx.env),
  input: inputOf(t.input, ctx.env),
  // What it does, carried whole — the transport turns these four into the
  // MCP annotations (@yaks/mcp `annotated`), and a hint dropped here is a
  // tool the host mis-prompts about.
  ...(t.readOnly ? { readOnly: true } : {}),
  ...(t.destructive == null ? {} : { destructive: t.destructive }),
  ...(t.idempotent ? { idempotent: true } : {}),
  ...(t.openWorld ? { openWorld: true } : {}),
  // The page a host renders this answer in (MCP Apps): the tool names it, the
  // transport hands it over verbatim, and a host without views ignores it.
  ...metaOf(t),
  // The runner hands a tool the call's bundles and a host; what a platform
  // verb reads is its arguments, which the runner has already checked, and the
  // call it is answering.
  run: (_, c) => running(ctx, t)(c.args, c.call),
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
 * (declared.ts).
 */
export let platform = (ctx: Ctx): Plugin => ({
  name: 'yak/platform',
  tools: TOOLS.map((t) =>
    ctx.person || openly(t) ? sugared(ctx, t) : barred(sugared(ctx, t), ctx.env)
  ),
})

/**
 * The post room's own verbs, as a second plugin (letters.ts): `mail_list` and
 * `mail_send`. They are apart from the table above because they answer the
 * letters themselves as bundles, where every other verb there answers words.
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
 * owner's door to it is this tier, and this is how they open it.
 */
export let named = (ctx: Ctx, said: string, write = false): Promise<Reach> => {
  // Naming an app is asking about a membership, so a caller with no identity
  // cannot do it: signed out, the app a read answers for is the one the call
  // names and the door resolved (anon.ts `opened`), never a rider on the line.
  if (!ctx.person) {
    throw new Error(
      `signed out, a read cannot name an app on the query line (.in=${said}) ` +
        '— name space and app on the call itself',
    )
  }
  let [one, two] = said.split('/')
  return inApp(ctx, two ? { space: one, app: two } : { app: one }, write)
}

// The `.in=` rider: which app a read is scoped to. It is the platform's word,
// not the query grammar's, so it comes off the line before any store sees it —
// a store knows about components, and which of several stores to ask is a
// question only this side of the hop can answer.
let scope = (line: string) => {
  let segs = line.replace(/^[?&]+/, '').split('&')
  let said = segs.find((s) => /^\.in=/.test(s))?.slice(4)
  return { said, line: segs.filter((s) => !/^\.in=/.test(s)).join('&') }
}

// The identity operand list, wherever it appears on a line: `.eid=a,b` — which
// is what the page's `id=` becomes (wire.ts `lined`) — names a set rather than
// comparing a column, so its operands are ids and a word among them may be a
// name (T-34390, @yaks/alias). `.eid!=` and the rest are untouched: this is the
// one operator whose right-hand side is an identity.
let IDS = /(^|&)(\.(?:entity\.)?eid=)([^&]*)/g

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

// The one read `graph_show` makes, and the only reason this Graph carries a
// storage at all: these eids, whole, out of every store that holds a piece of
// one (reach.ts `composed`).
let held = (ctx: Ctx, reach: Reach[]): Storage => {
  let self: Storage
  let rows = async (q: unknown) => {
    let { said, line } = scope(String(q))
    let where = said ? [await named(ctx, said)] : reach
    // An agent's grammar is the page's (guide.md): `id=`, `limit=` and `after=`
    // where the store spells `.eid=`, `.limit=` and `.after=`, and a value
    // written as it reads rather than as a store would parse it. One
    // translation for every door a person's own line arrives at (wire.ts).
    return await read(ctx.env, where, await byName(self, lined(line))) as Row[]
  }
  let tx: Tx = {
    read: (q) => rows(q) as Promise<Bundle[]>,
    get: (eids) =>
      composed(ctx.env, reach, eids) as unknown as Promise<Bundle[]>,
    patch: nope('transaction'),
    remove: nope('transaction'),
  }
  self = {
    ddl: () => [],
    install: () => {},
    read: (q) => rows(q) as Promise<Bundle[]>,
    rows,
    tx: (body) => body(tx) as never,
  }
  return self
}

// Every reachable app's `vocab.json`, merged over the core documents. First
// declaration wins, which is where a word lives (T-32728), so the schema an
// agent is handed says each column the way the store that owns it does.
//
// It also says which columns the reach cannot agree on: two spaces may spell
// one word differently (mcp_test.ts "a word two spaces spell differently
// stays two words"), and the merged vocabulary keeps one of the two. A schema
// derived from it would then refuse a write the other store takes, so those
// columns are named here and typed nowhere (`reading` below).
//
// The directory is the other side of that same disagreement, and it is not an
// app: it answers no `/vocab`, and the words it holds are the platform's own
// (vocab.ts `platformDoc`), loaded into that store instead of the packages'
// documents. One of them — `member.role` — both sides spell and mean
// differently: the platform's roster is its access ladder
// (`owner|editor|viewer`, read space-wide by apps.ts), while @yaks/member
// keeps belonging (`owner|member`) apart from access, which it spells as a
// grant or the app's mode. Typed as the package's, the door refused a seat the
// directory itself takes (T-34273).
//
// It is never in the default reach — `dir.spaces` leaves the meta space out,
// so a person who owns `yak` still means their own space when they name none
// — yet a batch may be aimed at it by name (`$app: yak/platform`, `named`
// below). So the question is who may address it, which is who holds a seat in
// the meta space, and that is the same question `named` asks.
let spoken = async (
  ctx: Ctx,
  reach: Reach[],
): Promise<{ vocab: Vocab; clashes: Set<string> }> => {
  // Each store's words as the document it keeps, read once per request
  // (declared.ts `vocabIn`, vocab.ts `meant`): the roster already asked for
  // them (standing.ts `kindsOf`).
  let said = await Promise.all(
    reach.map(async (r) => meant(await vocabIn(ctx, r.space, r.app))),
  )
  let defs: Record<string, PropSchema> = {}
  let clashes = new Set<string>()
  for (let one of said) {
    for (let [name, schema] of Object.entries(one.$defs ?? {})) {
      let mine = defs[name]
      if (!mine) {
        defs[name] = schema
        continue
      }
      // Two apps in two spaces may each home one word, and then one name
      // means two things (reach.ts `apartIn`). The first declarer is the word
      // here — the same rule the space's own union loads by — and a column
      // they spell differently is typed nowhere (`reading` below).
      //
      // Inside one space there is nothing to merge: a word has one home, and
      // a column a borrower declared was planted on the home's manifest by
      // the deploy that brought it (tools.ts `released`), so the home's
      // document already says every column the word has.
      for (let [col, s] of Object.entries(schema.properties ?? {})) {
        let had = mine.properties?.[col]
        if (had && wordOf(had) != wordOf(s)) clashes.add(`${name}.${col}`)
      }
    }
  }
  let meta = ctx.person && await ctx.dir.space(META.space)
  if (meta && await ctx.dir.role(meta, ctx.person)) {
    for (let col of PLATFORM_APART) clashes.add(col)
  }
  return { vocab: appVocab({ $defs: defs }), clashes }
}

/**
 * How this door's columns read and write, where that is not what the
 * vocabulary declares (@yaks/mcp `BundleOpts.column`):
 *
 * - a reference reads back as the eid or as `{eid, name}`, because outputs
 *   speak human (graph.ts `#speak`); a write takes the id;
 * - a column two reachable apps spell differently is typed nowhere, since the
 *   store that owns the word is the one that decides.
 */
export let reading =
  (clashes: Set<string>) =>
  (col: Column, o: { write?: boolean }): z.ZodTypeAny | undefined =>
    clashes.has(`${col.comp}.${col.prop}`)
      ? z.unknown()
      : col.category == 'ref' && !o.write
      ? z.union([z.string(), z.object({ eid: z.string() }).passthrough()])
      : undefined

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
    throw new Error(
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
 * The caller's reach as one graph: every app they can read, asked together and
 * answered as one bundle per entity, with the platform's tools on it — and
 * beside it how a column of this graph reads and writes ({@link reading}),
 * which the schema an agent is handed is derived through.
 *
 * A write routes each component to the app that declares it (reach.ts
 * `written`), which is what an entity spanning apps means — so `graph_apply`
 * needs no app named and never had one to name here.
 */
export let reaching = async (
  ctx: Ctx,
  reach: Reach[],
): Promise<{ graph: Graph; column: ReturnType<typeof reading> }> => {
  let { vocab, clashes } = await spoken(ctx, reach)
  let storage = held(ctx, reach)
  // The post room is a person's own mailbox work (letters.ts), and it is
  // listed for everybody: a caller who has not signed in has no letters to
  // list and none to send, and hears that as the sign-in challenge rather than
  // as two tools that are not there. One roster, one order, whoever is asking
  // (`platform`, T-34541).
  let plugins = [platform(ctx), post(ctx)]
  let self: Graph = {
    vocab,
    storage,
    plugins,
    use: (p) => (plugins.push(p), self),
    ddl: () => [],
    install: () => {},
    read: (q) => storage.read(q),
    rows: (q) => storage.rows(q),
    // A name where an eid goes (T-34390). The ladder is @yaks/alias's and it
    // is nothing but reads by id, so it works here exactly as it does inside a
    // store: `get` fans across the reach, and a name held in whichever store
    // this caller can see answers.
    address: (ids) => addressed(detached(storage), ids),
    apply: async (change) => {
      let asked = (Array.isArray(change) ? change : [change]) as Bundle[]
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
      )
      return aliased(out)
    },
  }
  return { graph: self, column: reading(clashes) }
}
