// The agent door's two halves (T-33812), so mcp.ts is a mount and nothing
// else: the caller's REACH as one `Graph`, and the platform's own tools as a
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
// THE GRAPH IS A COMPOSITION, not a database. A person's data lives in one
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
import type { Bundle, Graph, Plugin, Row, Storage, Tool, Tx } from '@yaks/graph'
import { composed as perEntity, detached } from '@yaks/graph'
import { addressed, wordish } from '@yaks/alias'
import { Say, type Search } from '@yaks/mcp'
import type { Column, Vocab } from '@yaks/vocab'
import { META, storeName } from './directory.ts'
import { letters } from './letters.ts'
import { composed, type Reach, read, written } from './reach.ts'
import { titling } from './session.ts'
import { storeOf } from './door.ts'
import {
  type Ctx,
  inApp,
  type Out,
  type Tool as Sugar,
  TOOLS,
} from './tools.ts'
import { ceiling, serve, unseenBlock } from './unseen.ts'
import { appVocab, PLATFORM_APART } from './vocab.ts'
import { lined } from './wire.ts'

// One JSON Schema property as Zod. The tool table spells plain shapes — a
// string, a number, a flag, a list, an object — and the MCP SDK takes Zod, so
// this is the whole translation. An unknown shape stays unknown rather than
// being guessed at: the tool's own `run` checks its arguments anyway (tools.ts
// `text`, `list`, `files`), and a schema that lied would refuse a call the
// tool would have accepted.
let propOf = (schema: unknown): z.ZodTypeAny => {
  let s = (schema ?? {}) as { type?: string; items?: unknown }
  let one = s.type == 'string'
    ? z.string()
    : s.type == 'number' || s.type == 'integer'
    ? z.number()
    : s.type == 'boolean'
    ? z.boolean()
    : s.type == 'array'
    ? z.array(propOf(s.items))
    : s.type == 'object'
    ? z.record(z.unknown())
    : z.unknown()
  let said = (schema as { description?: string })?.description
  return said ? one.describe(said) : one
}

/**
 * A tool's `input` as the MCP SDK wants it: one Zod schema per named argument,
 * optional unless the JSON Schema `required` list names it.
 */
export let inputOf = (
  schema: unknown,
): Record<string, z.ZodTypeAny> => {
  let s = (schema ?? {}) as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  let need = new Set(s.required ?? [])
  return Object.fromEntries(
    Object.entries(s.properties ?? {}).map((
      [name, prop],
    ) => [name, need.has(name) ? propOf(prop) : propOf(prop).optional()]),
  )
}

/**
 * A tool's `output` the same way: the object it answers beside its words. A
 * tool that says nothing about its answer declares nothing, which is what
 * leaves the reply plain text.
 */
export let outputOf = (schema: unknown): z.ZodTypeAny | undefined =>
  schema == undefined ? undefined : z.object(inputOf(schema))

/**
 * A platform tool's answer: the sentence it always said, and the view's data
 * beside it where it draws one.
 *
 * What is unseen in the space it worked in (unseen.ts) rides on the sentence —
 * every break not yet served, once, then the month's ceiling. It rode on the
 * DOOR before (mcp.ts `call`) and rides on the tool now, because the door no
 * longer knows what a space is.
 */
export let answered = async (ctx: Ctx, out: Out): Promise<Say> => {
  if (!out.space) return new Say(out.text, out.data)
  let who = {
    person: ctx.person,
    role: await ctx.dir.role(out.space, ctx.person),
  }
  return new Say(
    out.text + unseenBlock(await serve(ctx.env, out.space, who)) +
      await ceiling(ctx.env, out.space),
    out.data,
  )
}

/**
 * One of the platform's own tools, CALLED: the tool, then what is unseen in
 * the space it worked in.
 *
 * It is its own export because two doors run these tools — the connector
 * ({@link sugared}) and the builder we run ourselves (builder.ts) — and a
 * second spelling of these two lines is a second `app_new`.
 */
export let running = (ctx: Ctx, t: Sugar) => (args: Record<string, unknown>) =>
  t.run(ctx, args).then((out) => answered(ctx, out))

// What the transport says about a tool beside its schemas: the page a host
// renders its answer in (MCP Apps), and what it declares about signing in
// where that is not the door's own (preauth.ts NOAUTH — every other tool takes
// the door's, stamped by @yaks/mcp from `Options.security`).
let metaOf = (t: Sugar): Pick<Tool, 'meta'> => {
  let meta = {
    ...(t.view
      ? { ui: { resourceUri: t.view, visibility: t.visibility ?? ['model'] } }
      : {}),
    ...(t.security ? { securitySchemes: t.security } : {}),
  }
  return Object.keys(meta).length ? { meta } : {}
}

/** One of the platform's own tools, as a graph `Tool`. The answer is the same
 * sentence it always was, and the view's data beside it where it draws one. */
export let sugared = (ctx: Ctx, t: Sugar): Tool => ({
  name: t.name,
  title: t.title,
  description: t.description,
  input: inputOf(t.input),
  // What it does, carried whole — the transport turns these four into the
  // MCP annotations (@yaks/mcp `annotated`), and a hint dropped here is a
  // tool the host mis-prompts about.
  ...(t.readOnly ? { readOnly: true } : {}),
  ...(t.destructive == null ? {} : { destructive: t.destructive }),
  ...(t.idempotent ? { idempotent: true } : {}),
  ...(t.openWorld ? { openWorld: true } : {}),
  // What it answers, where it says: the `Say`'s data rides as the reply's
  // structuredContent unwrapped (@yaks/mcp `server`), so the schema describes
  // that object itself rather than a value under a key.
  ...(t.output ? { output: outputOf(t.output) } : {}),
  // The page a host renders this answer in (MCP Apps): the tool names it, the
  // transport hands it over verbatim, and a host without views ignores it.
  ...metaOf(t),
  run: (args) => running(ctx, t)(args),
})

/**
 * The platform's verbs, as a plugin on the caller's graph: the whole tool
 * table. It contributes no components — the words are the apps' own — only
 * tools, and every one of them is bound to the person asking.
 */
export let platform = (ctx: Ctx): Plugin => ({
  name: 'yak/platform',
  tools: TOOLS.map((t) => sugared(ctx, t)),
})

/**
 * The post room's own verbs, as a second plugin (letters.ts): `mail_list` and
 * `mail_send`. They are apart from the table above because they answer
 * BUNDLES, so they are described in the vocabulary the caller's apps declare
 * rather than in a sentence — which is a thing only this side of the door,
 * holding the loaded vocabulary, can do.
 */
export let post = (ctx: Ctx, vocab: Vocab): Plugin => ({
  name: 'yak/mail',
  tools: letters(ctx, vocab),
})

/**
 * ONE app, named: `recipes`, or `space/app` where a slug means two things.
 *
 * Naming is also what reaches the platform's own store, which is in nobody's
 * ordinary reach on purpose (directory.ts `spaces`, apps.ts `kernels`) — its
 * owner's door to it is this tier, and this is how they open it.
 */
export let named = (ctx: Ctx, said: string, write = false): Promise<Reach> => {
  let [one, two] = said.split('/')
  return inApp(ctx, two ? { space: one, app: two } : { app: one }, write)
}

// The `.in=` rider: which app a READ is scoped to. It is the platform's word,
// not the query grammar's, so it comes off the line before any store sees it —
// a store knows about components, and which of several stores to ask is a
// question only this side of the hop can answer.
let scope = (line: string) => {
  let segs = line.replace(/^[?&]+/, '').split('&')
  let said = segs.find((s) => /^\.in=/.test(s))?.slice(4)
  return { said, line: segs.filter((s) => !/^\.in=/.test(s)).join('&') }
}

// The identity operand list, wherever it appears on a line: `.eid=a,b` — which
// is what the page's `id=` becomes (wire.ts `lined`) — names a SET rather than
// comparing a column, so its operands are ids and a word among them may be a
// NAME (T-34390, @yaks/alias). `.eid!=` and the rest are untouched: this is the
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
    // An agent's grammar is the PAGE's (guide.md): `id=`, `limit=` and `after=`
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
// declaration wins, which is where a word LIVES (T-32728), so the schema an
// agent is handed says each column the way the store that owns it does.
//
// It also says which columns the reach CANNOT agree on: two spaces may spell
// one word differently (mcp_test.ts "a word two spaces spell differently
// stays two words"), and the merged vocabulary keeps one of the two. A schema
// derived from it would then refuse a write the other store takes, so those
// columns are named here and typed nowhere (`reading` below).
//
// The DIRECTORY is the other side of that same disagreement, and it is not an
// app: it answers no `/vocab`, and the words it holds are the platform's own
// (vocab.ts `platformDoc`), loaded into that store instead of the packages'
// documents. One of them — `member.role` — both sides spell and MEAN
// differently: the platform's roster is its access ladder
// (`owner|editor|viewer`, read space-wide by apps.ts), while @yaks/member
// keeps belonging (`owner|member`) apart from access, which it spells as a
// grant or the app's mode. Typed as the package's, the door refused a seat the
// directory itself takes (T-34273).
//
// It is never in the default REACH — `dir.spaces` leaves the meta space out,
// so a person who owns `yak` still means their own space when they name none
// — yet a batch may be AIMED at it by name (`$app: yak/platform`, `named`
// below). So the question is who may address it, which is who holds a seat in
// the meta space, and that is the same question `named` asks.
let spoken = async (
  ctx: Ctx,
  reach: Reach[],
): Promise<{ vocab: Vocab; clashes: Set<string> }> => {
  let said = await Promise.all(reach.map(async (r) => {
    let door = storeOf(ctx.env.STORE, storeName(r.space, r.app))
    let got = await door('/vocab')
    if (!got.ok) {
      await got.body?.cancel()
      return {}
    }
    return await got.json() as Record<string, unknown>
  }))
  let all: Record<string, unknown> = {}
  let clashes = new Set<string>()
  let cols = (v: unknown) => (v ?? {}) as Record<string, unknown>
  for (let one of said) {
    for (let [name, held] of Object.entries(one)) {
      if (!(name in all)) {
        all[name] = held
        continue
      }
      let mine = cols(all[name])
      for (let [col, type] of Object.entries(cols(held))) {
        if (col in mine && mine[col] != type) clashes.add(`${name}.${col}`)
      }
    }
  }
  let meta = await ctx.dir.space(META.space)
  if (meta && await ctx.dir.role(meta, ctx.person)) {
    for (let col of PLATFORM_APART) clashes.add(col)
  }
  return { vocab: appVocab(all), clashes }
}

/**
 * How this door's columns read and write, where that is not what the
 * vocabulary declares (@yaks/mcp `BundleOpts.column`):
 *
 * - a REFERENCE reads back as the eid or as `{eid, name}`, because outputs
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
// SPANNING apps was answered once per store it landed in (reach.ts `written`);
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
// It is said ON THE BUNDLE, `$app`, beside the other `$` words the wire
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
 * The caller's reach as ONE graph: every app they can read, asked together and
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
  let plugins = [platform(ctx), post(ctx, vocab)]
  let self: Graph = {
    vocab,
    storage,
    plugins,
    use: (p) => (plugins.push(p), self),
    ddl: () => [],
    install: () => {},
    read: (q) => storage.read(q),
    rows: (q) => storage.rows(q),
    // A NAME where an eid goes (T-34390). The ladder is @yaks/alias's and it
    // is nothing but reads by id, so it works here exactly as it does inside a
    // store: `get` fans across the reach, and a name held in whichever store
    // this caller can see answers.
    address: (ids) => addressed(detached(storage), ids),
    apply: async (change) => {
      let asked = (Array.isArray(change) ? change : [change]) as Bundle[]
      let { batch, where } = await aimed(ctx, asked)
      // The SAME `Reach` the fan-out is holding, where it holds one: reach.ts
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
