// The connector (D-32318 §The agent door): `POST /mcp` at the apex, an MCP
// server over Streamable HTTP — one JSON-RPC request in, one JSON reply out,
// no session held — so a restart strands nobody and a Worker isolate holds
// nothing between calls except a stream a client is holding open: `GET /mcp`
// is that stream (stream.ts), and what is sent down it is
// `notifications/resources/list_changed` when the pages an app's commands draw
// in move (T-33004), and the three lists when the platform is released.
//
// The protocol is the package's (T-33812). @yaks/mcp implements all of it —
// initialize, ping, tools, resources, prompts — over the graph and the
// `Authenticate` it is given, exactly as the Store's own MCP endpoint does
// (graph.ts `door`). Two tiers of tools are listed on that one server:
//
//   the generic tier   graph_apply, graph_query, graph_show, graph_schema and
//                      search over the caller's whole reach, bundles in and
//                      out, with the schemas derived from the loaded
//                      vocabulary
//   the platform tier  space_new, the app_* family, domain_*, member_*,
//                      commands, command, feedback and about, contributed as a
//                      plugin's tools (agent.ts `platform`) rather than read
//                      from a table here
//
// The tool list is fixed (T-34541): the same names, in the same order, for
// every caller — anonymous, signed in, one app or thirty. What an app of the
// person's own declares is not a tool but a command (declared.ts), listed by
// `commands` and run by `command`, because a directory snapshots this list
// when a connector is submitted and serves that snapshot forever: a per-caller
// name in it is a name the published connector can never match. Nothing is
// dropped for want of a token either — a tool a stranger may not call is
// listed as requiring `oauth2` and refuses the call (anon.ts `barred`).
//
// What this file still owns is everything that is NOT the protocol: the
// resources and prompts it registers on the same server through `extend`, the
// stream, and who is asking. `initialize` returns an `Mcp-Session-Id` so a
// client can name its stream and resume it after a drop; nothing else reads
// that id, and every POST stays stateless.
//
// Every tool reply for a space ends with what is unseen there (unseen.ts):
// each open exception or error not yet reported, one line, then marked, so no
// break in an app goes unseen by the agent that builds it (T-32362). That is
// added by the tool now (agent.ts), not here.
//
// Who is asking is identity.ts's `asking`: the platform session cookie a
// browser carries, or the OAuth bearer an agent carries, one answer either
// way — and beside it whether a credential was offered at all, because the two
// refusals differ. It is deliberately not the vouched `x-yak-person` header —
// the platform sets that header on the request it hands an app, and this code
// is at the apex reading a request straight off the internet, where the header
// is only ever a client's claim about itself. A 401 carries identity's
// `WWW-Authenticate` challenge, which is what an MCP client follows into the
// OAuth flow, and a caller that named a JSON-RPC id gets that same challenge
// in the refusal's own `_meta['mcp/www_authenticate']` too (`refused` below) —
// one endpoint, sending the challenge the two ways the two directories read
// it.
//
// A caller who has not signed in is answered too (T-33030, T-34467), in two
// halves. What this platform is, and the guide, come from preauth.ts, which is
// given a method and its params and no binding but the static assets — no
// person, no `Ctx`, nothing to read anybody's data with. Everything else a
// stranger may call comes from `stranger` below: the same @yaks/mcp server the
// signed-in path mounts, over a graph with nobody in it. What a stranger may
// call is the tools that declare they need nobody (anon.ts `openly`) and the
// generic READS scoped to the one public or open app the call names;
// everything else on the list meets the same challenge as ever.
//
// Mixed auth is what that adds up to, and it is the path (T-34465): a stranger
// is answered, is shown the whole tool list with `securitySchemes` marking
// which tools want a token (anon.ts `asked`, `barred`), and is met with the
// challenge the moment one of those is called — which is the sequence OpenAI
// documents and ChatGPT follows (developers.openai.com/plugins/build/auth).
// The half that used to be missing was the menu: a list holding only what a
// stranger may call gives the client nothing to offer a sign-in for — and,
// since a directory scans a mixed-auth server with no token, it is also the
// list the published connector gets forever.
//
// And `?auth=required` is this same endpoint with the pre-auth surface
// switched off (T-34416), kept for a client that cannot do optional auth at
// all — one that probes anonymously, reads the 200 as "no sign-in needed" and
// never asks again. The address is the lever, since a client like that is not
// ours to fix.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { mcp, roster, rosterVersion } from '@yaks/mcp'
import { VERSION } from '../../src/version.ts'
import { reaching, searching } from './agent.ts'
import { anonymous, asked, opened, READS, scope } from './anon.ts'
import * as dirPart from './directory.ts'
import { directory, url } from './directory.ts'
import { bound, type Env } from './env.ts'
import { ledger } from './ledger.ts'
import { instructions, pageFor, UNDO } from './guide.ts'
import { asking, challenge, unauthorized } from './identity.ts'
import { narrowed } from './grants.ts'
import { listViews, readView } from './declared.ts'
import { answer, asset, docs, SIGNIN } from './preauth.ts'
import type { Reach } from './reach.ts'
import { PROMPTS } from './prompts.ts'
import { says } from './route.ts'
import { connector } from './seo.ts'
import { type Entry, prompted, standing } from './standing.ts'
import { type Ctx, inReach, VIEW_MIME } from './tools.ts'
import { listen, rostered } from './stream.ts'
import { type Clock, clock, timed } from './timing.ts'
import { caught, reporter } from './sentry.ts'
import { isTestAddress } from '../../src/bots.ts'
import { refuse } from './tool.ts'
import { url as hostUrl } from './host.ts'
import { source, within } from './rate.ts'

type Rpc = {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

let json = (status: number, body: unknown) => Response.json(body, { status })

let result = (id: unknown, result: unknown) =>
  json(200, { jsonrpc: '2.0', id, result })

// A refusal sent to a caller that named a JSON-RPC id. The status and the
// `WWW-Authenticate` header are what they always were — the half every MCP
// client follows into the OAuth flow — and the body carries the same challenge
// a second way, in `_meta['mcp/www_authenticate']` with the `error` and
// `error_description` that half wants, because that is the half ChatGPT reads
// to draw its sign-in button. Without it the tool it refused has no link to
// offer and the person is simply stuck
// (developers.openai.com/plugins/build/auth).
let refused = (req: Request, id: unknown, env: Env) => {
  let signIn = says(env)
  let said = challenge(new URL(req.url), env)
  return Response.json({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: signIn }],
      _meta: {
        'mcp/www_authenticate': [
          `${said}, error="invalid_token", error_description="${signIn}"`,
        ],
      },
      isError: true,
    },
  }, { status: 401, headers: { 'www-authenticate': said } })
}

// Everything this connector serves that is not a tool, registered on the same
// server the package built (@yaks/mcp `extend`).
//
// The resources are the guide and its deep pages, which anybody may read, and
// the pages an app declares (declared.ts, T-32687), which only someone who can
// reach that app is told about. The platform contributes none of its own. The
// prompts are the ones a person picks by name (prompts.ts, T-32981).
let extend = (ctx: Ctx, apps: Entry[]) => async (server: McpServer) => {
  for (let doc of docs(ctx.env)) {
    server.registerResource(doc.name, doc.uri, {
      title: doc.title,
      description: doc.description,
      mimeType: doc.mimeType,
    }, async () => ({
      contents: [{
        uri: doc.uri,
        mimeType: doc.mimeType,
        text: await (await asset(ctx.env, doc.page)).text(),
      }],
    }))
  }
  for (let view of await listViews(ctx)) {
    server.registerResource(view.name, view.uri, {
      title: view.title,
      description: view.description,
      mimeType: view.mimeType,
      _meta: view._meta,
    }, async () => {
      let page = await readView(ctx, view.uri)
      if (!page) throw refuse('missing', `no resource ${view.uri}`)
      return { contents: [{ ...page, mimeType: VIEW_MIME }] }
    })
  }
  // What this person has already made, for the prompt that is about that
  // (prompts.ts `app-ideas`): the apps in reach by name and address, taken
  // from what was just gathered rather than read a second time.
  let made = apps.map((e) => ({
    title: e.app.title || e.app.slug,
    url: url(e.space, e.app, ctx.env),
  }))
  for (let p of PROMPTS) {
    server.registerPrompt(p.name, {
      title: p.title,
      description: p.description,
      argsSchema: Object.fromEntries(p.arguments.map((a) => [
        a.name,
        a.required
          ? z.string().describe(a.description)
          : z.string().describe(a.description).optional(),
      ])),
    }, (args: Record<string, string | undefined>) => ({
      description: p.description,
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: p.say(
            Object.fromEntries(
              Object.entries(args ?? {}).map(([k, v]) => [k, String(v ?? '')]),
            ),
            made,
            ctx.env,
          ),
        },
      }],
    }))
  }
  // And one per app that keeps notes beside it (standing.ts, T-34425),
  // offered to the person under the app's own name so they can ask for "the
  // recipes notes" and have them read back. It takes no arguments — the file
  // is the whole message — and `prompts` is already a declared capability,
  // since the four above registered it.
  for (let p of prompted(apps, PROMPTS.map((one) => one.name))) {
    server.registerPrompt(p.name, {
      title: p.title,
      description: p.description,
    }, () => ({
      description: p.description,
      messages: [{
        role: 'user' as const,
        content: { type: 'text' as const, text: p.text },
      }],
    }))
  }
  // Declaring `logging` invites `logging/setLevel`, so it is answered rather
  // than refused. There is nothing to set: the one thing this connector ever
  // logs is a break, at `error`, and nothing quieter is ever sent (unseen.ts
  // `noted`).
  server.server.registerCapabilities({ logging: {} })
  server.server.setRequestHandler(SetLevelRequestSchema, () => ({}))
}

// An old caller is answered, never corrected (C-32607 item 2). The generic
// tier's argument names changed when those tools became @yaks/mcp's (T-33812)
// — `entities` is now `change`, `filter` and `query` are `q`, `text` is
// `words` — and a connector configured against the old names is somebody's,
// already installed. So the argument names are translated here, as the request
// arrives, and the tool sees one shape.
//
// The `app`/`space` pair that named one app moves too: on a write it becomes
// `$app` on each bundle, on a read the `.in=` prefix on the filter — both the
// platform's own forms, each written where the thing it is about is
// (agent.ts). Signed out it moves nowhere: the pair is the call's scope there,
// read off the arguments before any graph exists (anon.ts `opened`), so
// `scoped` tells us whether this caller has a reach for an app to be narrowed
// out of.
let SAID: Record<string, Record<string, string>> = {
  graph_apply: { entities: 'change' },
  graph_query: { filter: 'q', query: 'q' },
  search: { text: 'words' },
}

let heard = (
  name: string,
  args: Record<string, unknown>,
  scoped: boolean,
) => {
  let moved = SAID[name]
  if (!moved) return args
  let out: Record<string, unknown> = {}
  for (let [k, v] of Object.entries(args)) out[moved[k] ?? k] = v
  // The old argument shape let a bundle name no entity at all and had the
  // store mint one; the bundle shape @yaks/mcp accepts wants the alias written
  // out. An old caller keeps its silence, and the alias it never asked for is
  // one this code invents.
  if (
    name == 'graph_apply' && 'entities' in args && Array.isArray(out.change)
  ) {
    out.change = out.change.map((b, i) =>
      b && typeof b == 'object' && !('entity' in b) && !('id' in b)
        ? { entity: { eid: `$b${i}` }, ...b }
        : b
    )
  }
  // Signed out, the pair stays exactly where the caller put it: it is the
  // call's own scope there, declared on the tool (anon.ts scope) and read
  // here, not a narrowing of a reach nobody has.
  if (!scoped) return out
  let { app, space, ...rest } = out
  if (typeof app != 'string') return rest
  let at = typeof space == 'string' ? `${space}/${app}` : app
  if (name == 'graph_apply' && Array.isArray(rest.change)) {
    rest.change = rest.change.map((b) =>
      b && typeof b == 'object' && !('$app' in b) ? { ...b, $app: at } : b
    )
  }
  if (name == 'graph_query' && typeof rest.q == 'string') {
    rest.q = `.in=${at}&${rest.q}`
  }
  return rest
}

// The release this connector is serving: Cloudflare's per-deploy version id, which
// the runtime mints on every deploy — so a release moves the roster version
// with no file edit. Absent under `wrangler dev` and the workerd probes, where
// the human VERSION stands in.
let markOf = (env: Env) => env.CF_VERSION_METADATA?.id ?? VERSION

// Which client a session is: `initialize` mints the session id with the
// client's own name in front (`claude-ai~<uuid>`), so every later POST says
// which client it came from without a read, and every POST stays stateless.
// A session minted before this, or a client that named nothing, is none.
let minted = (info: unknown): string => {
  let name = String((info as { name?: unknown } | null)?.name ?? '')
    .replace(/[^\w.-]/g, '')
    .slice(0, 40)
  return name ? `${name}~${crypto.randomUUID()}` : crypto.randomUUID()
}
let clientOf = (session: string): string | undefined =>
  session.includes('~') ? session.split('~')[0] : undefined

// The MCP server itself, built per request around the person the edge
// verified: the caller's whole reach as one graph, the platform's tools on it
// as a plugin, and the same `Authenticate` callback every other way into this
// data uses — here it has already run, so it returns what the edge decided.
//
// It returns the handler and the tool list it is about to serve (T-34277): the
// tool names, and the version naming them, which `initialize` records for this
// session and every later call is compared against.
let door = async (ctx: Ctx, session: string) => {
  // Each read made before any tool runs is a named stage on the call's
  // `Server-Timing` (timing.ts): this runs on every call, so what it costs is
  // the floor under every write (T-34986).
  let c = ctx.clock ?? clock()
  let reach = await c.time('reach', () => inReach(ctx, {}))
  // The commands the apps in reach declare (declared.ts). They are not tools
  // and never appear in the tool list; they are read here so the instructions
  // can name them under their app, and `commands` lists them again with their
  // arguments when an agent asks.
  // What the apps in reach report about themselves (standing.ts, T-34425):
  // every one of them named, with what it holds and its own commands. That
  // list is carried in the instructions, which is what a model reads before it
  // reads anything else, so an app already made is found rather than made a
  // second time. What an app's owner wrote beside it, and what they have said
  // in this space, is `about`'s answer instead (T-34632): an MCP client treats
  // the instructions and the tool list as the platform's own, and somebody
  // else's prose there reads as an attempt to steer the model rather than as
  // their own notes.
  //
  // The graph, and how a property of it reads and writes: a reference reads
  // back in human form, and a component two of the caller's spaces declare
  // differently is given no type at all (agent.ts `reading`). The schemas in
  // the tool list are derived through it, so they describe what this server
  // actually accepts and returns.
  //
  // The two are read at once, over the reach just paid for: each is its own
  // fan-out across the apps, and what both need — a store's vocabulary — is
  // read once per request (tool.ts `once`). The commands are not listed here
  // any more: the instructions name them from each app's declaration as it is
  // read, and `commands` returns them with their arguments when asked. This
  // runs on every call, so it is the floor under every write (T-34986).
  let [apps, { graph, prop }] = await Promise.all([
    c.time('standing', () => standing(ctx, reach)),
    c.time('reaching', () => reaching(ctx, reach)),
  ])
  ctx.standing = apps.notes
  let opts = {
    graph,
    // Where the call about to be served is recorded (ledger.ts): its own
    // in-memory graph, because the one above is a composition over other
    // people's stores and a question is not their data.
    calls: ledger(graph),
    prop,
    // A read's schema is left at property names here, while the write tools are
    // typed in full (@yaks/mcp, T-34153). Measured over a space of three apps:
    // the typed write tools cost 9 KB of tool list, and typing the four read
    // schemas as well costs 33 KB more. The types are what a write needs — a
    // read hands over the values themselves — and this connector's vocabulary
    // is a union of every store in reach, so those 33 KB are the least exact
    // part of it, paid on every connection.
    schema: 'names' as const,
    // And where a component is documented at length, so graph_schema hands
    // over the page beside the properties (guide.ts `pageFor`).
    guide: (comp: string) => pageFor(comp, ctx.env),
    // And the way back out of a delete here, which the generic tier could not
    // know: a store is not a place a mistake is final (recover.ts, T-34509).
    undo: UNDO,
    authenticate: () => ({ by: ctx.person }),
    report: reporter(ctx, clientOf(session)),
    // The name, the one-line description and the picture, from the one place
    // they are written (seo.ts connector, T-34415): a client that reads
    // `serverInfo` shows this connector with a face, and nobody has to type
    // any of it into a form.
    ...connector(ctx.env),
    version: VERSION,
    instructions: apps.text
      ? `${instructions(ctx.env)}\n\n---\n\n${apps.text}`
      : instructions(ctx.env),
    search: searching(ctx, reach),
    // What this connector needs: a token (preauth.ts SIGNIN). A tool that
    // works either way declares that itself and keeps it (tools.ts
    // `security: EITHER`) — which is every tool a stranger may call except the
    // generic reads, and those are anonymous only on the anonymous server
    // below, where they read one named app rather than the whole of somebody's
    // reach.
    security: SIGNIN,
    extend: (server: McpServer) =>
      c.time('extend', () => extend(ctx, apps.apps)(server)),
  }
  // What this connector lists right now, and the version naming that list.
  // `about` returns both (tools.ts), so a client that suspects its list is old
  // has one call that settles it without reconnecting.
  //
  // A release is the only thing that changes that version (T-34541). Nothing a
  // person does moves this list any more: an app made, an app that grew a
  // component, a deploy that declared a command — all of those are commands
  // and components, and the tools that carry them are the same tools they
  // always were. So the version moves when we deploy, and a client is told its
  // list is stale only when it is.
  let names = roster(opts)
  let listed = { version: rosterVersion(names, markOf(ctx.env)), names }
  ctx.roster = listed
  return {
    listed,
    // Every result carries a line when this session connected against an older
    // tool list — the same news `notifications/tools/list_changed` sends to a
    // client holding a stream, put where a client without one will read it.
    handle: mcp({
      ...opts,
      roster: () => rostered(ctx.env, ctx.person, { session, ...listed }),
    }),
  }
}

// A tool's own refusal, returned to a caller turned away before the protocol
// handler ran: the 200 a tool error uses, never the 401, which answers "you
// are not signed in" and not "that app is private".
let erred = (id: unknown, err: unknown) =>
  result(id, {
    content: [{
      type: 'text',
      text: err instanceof Error ? err.message : String(err),
    }],
    isError: true,
  })

// The server for a caller who has not signed in (anon.ts, T-34467). It is the
// same @yaks/mcp server, over a graph with nobody in it:
//
//   the platform's tools that declare they need nobody — about, the guide,
//   the gallery and feedback (tools.ts `security: EITHER`);
//   the generic READS, scoped to the one public or open app the call names,
//   which read that app's store exactly as its own page does;
//   and the whole of the rest of the tool list beside them — the write, the
//   mail pair, every platform tool — listed as requiring `oauth2` and refusing
//   the call (anon.ts `barred`, `asked`), so the client has something to offer
//   the sign-in for and the list is the same one a signed-in caller sees.
//
// Claim-later — a stranger writing now and owning it once they sign in — is
// what would be built here, and is deliberately not: it needs somewhere to
// hold a write nobody owns yet, and there is nowhere on this platform to put
// one. Signing in first is the whole of it for now.
//
// Everything else is `refused`: a method not served publicly, a tool nobody
// may call anonymously, and a tool that does not exist all get the same 401,
// so nothing here reveals what a signed-in list would hold.
let stranger = async (
  req: Request,
  rpc: Rpc,
  env: Env,
  said: string,
): Promise<Response> => {
  let name = rpc.method == 'tools/call' ? String(rpc.params?.name ?? '') : ''
  if (rpc.method != 'tools/list' && !(name && anonymous(name))) {
    return refused(req, rpc.id, env)
  }
  let ctx: Ctx = {
    env,
    dir: directory(bound(env.DIRECTORY, dirPart.fetch, env), true),
    // Nobody. Everything below reads this as no reach, no membership and no
    // mailbox rather than as a person whose eid happens to be empty
    // (directory.ts `member`, agent.ts `platform`).
    person: '',
    source: source(req),
  }
  // The app a read answers for, resolved before anything is built — so a call
  // that named none, or named one nobody may read, is refused with a message
  // rather than with an empty answer. Listing the tools names no app and needs
  // none: the schemas are the same whichever app is read.
  let args = (rpc.params?.arguments ?? {}) as Record<string, unknown>
  let reach: Reach[] = []
  if (READS.includes(name)) {
    try {
      reach = await opened(ctx, args)
    } catch (err) {
      caught(err, { tool: name, request: 'POST /mcp (anonymous)' })
      return erred(rpc.id, err)
    }
  }
  let { graph, prop } = await reaching(ctx, reach)
  let opts = {
    graph,
    calls: ledger(graph),
    prop,
    schema: 'names' as const,
    guide: (comp: string) => pageFor(comp, env),
    search: searching(ctx, reach),
    // Every tool, and what each one declares about signing in (anon.ts
    // `asked`): `EITHER`, both schemes, for what a stranger may call, `oauth2`
    // alone for the rest, which is the field an MCP client reads to offer the
    // sign-in. The write is listed too — signed out it is a tool that refuses
    // rather than a tool that is not there (T-34541), because this list is the
    // one a directory snapshots at submission, and a name missing from that
    // snapshot is a tool the published connector can never offer its signed-in
    // people.
    security: asked,
    scope: scope(env),
    report: reporter(ctx, clientOf(req.headers.get('mcp-session-id') ?? '')),
    ...connector(env),
    version: VERSION,
  }
  // No tool-list line and no session: both are a person's own — the roster
  // version names what a client cached at connect, and a stranger's list
  // changes only when we deploy. `about` signed out returns the same text for
  // everyone, which is what makes it safe to answer without knowing who is
  // asking.
  return mcp(opts)(
    new Request(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: said,
    }),
  )
}

// The canary (T-37865): a test account's POST here is a defect sent to Sentry
// as that account's, through the same `reporter` a tool's defect takes, which
// is how a deploy proves its defects arrive with their tags. Anyone else finds
// nothing here.
let CANARY = '/api/defect'
let canary = async (req: Request, env: Env): Promise<Response> => {
  let { who } = await asking(env, req)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  if (!who || !isTestAddress(await dir.emailAt(who.person) ?? '')) {
    return json(404, { error: { code: 'not_found' } })
  }
  let ctx: Ctx = { env, dir, person: who.person }
  await reporter(ctx, 'canary')(
    new Error('a deliberate defect, from a test account'),
    { entity: { eid: CANARY }, call: {} },
    'canary',
  )
  return json(500, { error: { code: 'defect', message: 'sent' } })
}

// The entry point, with the stopwatch and the round-trip tally running
// (timing.ts, hops.ts): `answered` below is the whole call, and everything it
// awaits counts its hops here, so `Server-Timing` reports both where the time
// went and how many trips it took to get there.
export let fetch = (req: Request, env: Env): Promise<Response> => {
  let c = clock()
  return c.counting(() => answered(req, env, c))
}

let answered = async (
  req: Request,
  env: Env,
  c: Clock,
): Promise<Response> => {
  let url = new URL(req.url)
  if (url.pathname == CANARY && req.method == 'POST') return canary(req, env)
  if (url.pathname != '/mcp') {
    return json(404, { error: { code: 'not_found' } })
  }
  if (req.method != 'POST' && req.method != 'GET') {
    return json(405, { error: { code: 'method_not_allowed' } })
  }
  // The same endpoint, told to skip the pre-auth surface: `?auth=required`
  // (T-34416). An MCP client that decides whether a server has an
  // authorization server by probing it anonymously reads our 200 as "no auth"
  // and never looks at `WWW-Authenticate`, so it configures the connector with
  // the tools a stranger gets and never offers to sign in. The address is the
  // lever because the client's behaviour is not ours to change: a client that
  // cannot ask twice is given an address that only ever answers the challenge,
  // and `/mcp` stays lazy — and mixed — for the clients that can (anon.ts
  // `asked`). A query parameter rather than a second path so there is still
  // one resource here — one route, one `WWW-Authenticate`, one
  // `/.well-known/…/mcp`, which the challenge already builds from the
  // pathname.
  let strict = url.searchParams.get('auth') == 'required'
  // Who is asking, if anybody. An anonymous request costs nothing to find
  // out — no header to unwrap, no cookie to verify (identity.ts) — and what
  // it gets is the pre-auth surface below rather than a refusal.
  let { who: auth, tried } = await c.time('asking', () => asking(env, req))
  // A credential that did not verify is NOT an anonymous caller: an expired or
  // revoked token, or one minted for something else, is refused here with the
  // 401 and the challenge, before the pre-auth surface can answer it. The spec
  // requires that 401, and Claude ignores `WWW-Authenticate` on a 200 — so
  // answering the public surface instead is a connector silently losing every
  // tool where it should have been asked to sign in again (T-34344).
  if (!auth && (tried || strict)) return unauthorized(req, env)
  // The GET is the session's stream (stream.ts): a client holds it open to
  // hear what the server sends between its own calls, which today is one
  // thing — that its tool list moved, because an app of theirs deployed new
  // tools (T-32686). It lives in a Durable Object of the person's own, so a
  // deploy in one request reaches the stream another request opened, and a
  // connection that dropped resumes from its `Last-Event-ID` (T-32734).
  // Everything else is still one POST in, one JSON out. A stream is a
  // person's own, so there is no public one.
  if (req.method == 'GET') {
    return auth ? listen(env, auth.person, req) : unauthorized(req, env)
  }
  // Before anyone has signed in, this endpoint answers exactly three ways: the
  // public result, a 202 for a notification, and the challenge for everything
  // else — a method it does not serve publicly, a tool or a page it will not
  // hand over, and anything that was not a request at all. So a body that does
  // not parse, and a JSON-RPC batch (an array of requests), which are refusals
  // every caller gets, are still the 401 for an anonymous one.
  // The body is read here and passed on as text: who is answered is decided
  // before the protocol handler sees anything, and a request body is read
  // once.
  let said = await req.text()
  let body: unknown
  try {
    body = JSON.parse(said)
  } catch {
    return auth
      ? json(200, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'parse error' },
      })
      : unauthorized(req, env)
  }
  if (Array.isArray(body)) {
    return auth
      ? json(400, { error: { code: 'no_batches' } })
      : unauthorized(req, env)
  }
  let rpc = body as Rpc
  if (rpc.id == null) return new Response(null, { status: 202 }) // a notification
  // A prompt picked with nothing filled in is a prompt with no arguments, not
  // a malformed call: every one of them still reads correctly that way
  // (prompts.ts `or`), while the schema behind it requires the `arguments`
  // object to be present.
  if (rpc.method == 'prompts/get' && rpc.params?.arguments == null) {
    rpc.params = { ...rpc.params, arguments: {} }
    said = JSON.stringify(rpc)
  }
  if (rpc.method == 'tools/call' && rpc.params) {
    rpc.params = {
      ...rpc.params,
      arguments: heard(
        String(rpc.params.name),
        (rpc.params.arguments ?? {}) as Record<string, unknown>,
        !!auth,
      ),
    }
    said = JSON.stringify(rpc)
  }
  // The pre-auth surface, in its two halves. preauth.ts first: what this
  // platform is, and the guide, which the web already serves to anybody. It is
  // given a method and its params — no person, no Ctx, and no binding but the
  // static assets — so nothing it answers can have read anybody's data. What
  // it does not answer goes to the anonymous server (`stranger`), which serves
  // the tools a stranger may call and challenges everything else.
  if (!auth) {
    // Per source (rate.ts): a stranger's calls cost us store reads and, for
    // feedback, a letter, and there is no person to hold to an allowance.
    // Listing the tools and the handshake are not counted, only calls.
    if (
      rpc.method == 'tools/call' &&
      !await within(env.TOOL_RATE, source(req))
    ) {
      return erred(
        rpc.id,
        refuse(
          'limit',
          'Too many calls from one place without signing in. Try again in a ' +
            `minute, or sign in at ${hostUrl(env, '/login')}.`,
        ),
      )
    }
    let open = await answer(String(rpc.method), rpc.params ?? {}, env)
    return open ? result(rpc.id, open) : await stranger(req, rpc, env, said)
  }
  // Fresh, every read: a tool answers about what a tool just wrote, and the
  // directory's read cache belongs to whichever isolate warmed it
  // (directory.ts). A deploy from anywhere else is news this request has to
  // have (C-32905 item 5).
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let ctx: Ctx = {
    env,
    // A grant narrowed to one space is narrowed here, over the directory every
    // tool reads membership out of (grants.ts `narrowed`), so the narrowing
    // holds for the generic tier, the platform tier and an app's own tools at
    // once rather than tool by tool.
    dir: auth.space ? narrowed(dir, auth.space) : dir,
    person: auth.person,
    who: auth,
    clock: c,
  }
  // The session id, per the transport: minted at `initialize` and sent back by
  // the client on every later request. It names which of this person's streams
  // is which (the GET above), and which roster this client cached (stream.ts
  // `roster`). It is not required and never checked — a POST carries its own
  // answer to who is asking, and a client that has never seen this header
  // still works, sharing the nameless session with every other such client.
  let session = rpc.method == 'initialize'
    ? minted(rpc.params?.clientInfo)
    : req.headers.get('mcp-session-id') ?? ''
  let built = await c.time('door', () => door(ctx, session))
  let out = timed(
    await built.handle(
      new Request(req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: said,
      }),
    ),
    c,
  )
  if (rpc.method != 'initialize') return out
  // The list this client is about to cache, remembered for the session it is
  // caching it under: every later reply is compared against this.
  await rostered(env, auth.person, { session, ...built.listed, init: true })
  let named = new Response(out.body, out)
  named.headers.set('mcp-session-id', session)
  return named
}
