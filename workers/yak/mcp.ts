// The connector part (D-32318 §The agent door): `POST /mcp` at the apex, an
// MCP server over Streamable HTTP — one JSON-RPC request in, one JSON reply
// out, no session held — so a restart strands nobody and a Worker isolate
// holds nothing between calls except a stream a client is holding open:
// `GET /mcp` is that stream (stream.ts), and what goes down it is
// `notifications/resources/list_changed` when the pages an app's commands draw
// in move (T-33004), and the three lists when the platform is released.
//
// THE PROTOCOL IS THE PACKAGE'S (T-33812). @yaks/mcp serves the whole of it —
// initialize, ping, tools, resources, prompts — over the graph and the
// `Authenticate` it is handed, exactly as the Store's own agent door does
// (graph.ts `door`). Two tiers list on that one server:
//
//   the generic tier   graph_apply, graph_query, graph_show, graph_schema and
//                      search over the caller's whole reach, bundles in and
//                      out, with the schemas derived from the loaded
//                      vocabulary
//   the platform tier  space_new, the app_* family, domain_*, member_*,
//                      commands, command, feedback and about, contributed as a
//                      plugin's tools (agent.ts `platform`) rather than a
//                      table this door reads
//
// THE ROSTER IS FIXED (T-34541): the same names, in the same order, for every
// caller — anonymous, signed in, one app or thirty. What an app of the
// person's own declares is not a tool but a COMMAND (declared.ts), said by
// `commands` and run by `command`, because a directory snapshots this list
// when a connector is submitted and serves that snapshot forever: a per-caller
// name in it is a name the published connector can never match. Nothing is
// dropped for want of a token either — a tool a stranger may not call is
// listed saying `oauth2` and refuses (anon.ts `barred`).
//
// What this file still owns is everything that is NOT the protocol: the
// resources and prompts it registers on the same server through `extend`, the
// stream, and who is asking. `initialize` answers an `Mcp-Session-Id` so a
// client can name its stream and resume it after a drop; nothing else reads
// that id, and every POST stays stateless.
//
// Every tool reply for a space ends with what is unseen there (unseen.ts):
// each open exception or error not yet served, one line, then marked, so no
// break in an app goes unseen by the agent that builds it (T-32362). That
// rides on the tool now (agent.ts), not on this door.
//
// Who is asking is identity.ts's `asking`: the platform session cookie a
// browser carries, or the OAuth bearer an agent carries, one answer either
// way — and beside it whether a credential was offered at all, because this
// door treats the two refusals differently. It is deliberately NOT the vouched
// `x-yak-person` header — the kernel sets that header on what it hands an app,
// and this door is at the apex reading a request straight off the internet,
// where the header is only ever a client's claim about itself. A 401 carries
// identity's `WWW-Authenticate` challenge, the line an MCP client follows into
// the OAuth flow, and a caller that named a JSON-RPC id gets that same
// challenge in the refusal's own `_meta['mcp/www_authenticate']` too
// (`refused` below) — one door, said the two ways the two directories read it.
//
// Nobody at all is answered too (T-33030, T-34467), in two halves. What this
// platform is and the guide come off preauth.ts, which is handed a method and
// its params and no binding but the static assets — no person, no `Ctx`,
// nothing to read anybody's data with. Everything else a stranger may call
// comes off `stranger` below: the same @yaks/mcp mount the signed-in door is,
// over a graph with nobody in it. What a stranger may CALL is the tools that
// declare they need nobody (anon.ts `openly`) and the generic READS scoped to
// the ONE public or open app the call names; everything else on the list meets
// the same challenge as ever.
//
// MIXED AUTH is what that adds up to, and it is the path (T-34465): a stranger
// is answered, is SHOWN the whole tool list with `securitySchemes` saying which
// tools want a token (anon.ts `asked`, `barred`), and is met with the challenge
// the moment one of those is called — which is the sequence OpenAI documents
// and ChatGPT walks (developers.openai.com/plugins/build/auth). The half that
// used to be missing was the menu: a list holding only what a stranger may call
// gives the host nothing to offer a sign-in FOR — and, since a directory scans
// a mixed-auth server with no token, it is also the list the published
// connector gets forever.
//
// And `?auth=required` is that same door with the pre-auth surface switched
// off (T-34416), kept for a host that cannot do optional auth at all — one
// that probes anonymously, reads the 200 as "no sign-in needed" and never asks
// again. The address is the lever, since a client like that is not ours to fix.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { mcp, roster, rosterVersion } from '@yaks/mcp'
import { VERSION } from '../../src/version.ts'
import { reaching, searching } from './agent.ts'
import { anonymous, asked, opened, READS, SCOPE } from './anon.ts'
import * as dirPart from './directory.ts'
import { directory, url } from './directory.ts'
import { bound, type Env } from './env.ts'
import { INSTRUCTIONS, pageFor, UNDO } from './guide.ts'
import { asking, challenge, SAYS, unauthorized } from './identity.ts'
import { narrowed } from './grants.ts'
import { listCommands, listViews, readView } from './declared.ts'
import { answer, asset, type Doc, DOCS, SIGNIN } from './preauth.ts'
import type { Reach } from './reach.ts'
import { PROMPTS } from './prompts.ts'
import { CONNECTOR } from './seo.ts'
import { type Entry, prompted, standing } from './standing.ts'
import {
  APPS_VIEW,
  type Ctx,
  ERRORS_VIEW,
  inReach,
  uiMeta,
  VIEW_MIME,
} from './tools.ts'
import { listen, rostered } from './stream.ts'

// The views this door offers beside the guide, whose resources are
// preauth.ts's — the guide is world-readable and served to anybody, and these
// two are a signed-in person's own.
//
// The first is an MCP App view (T-32492, spec 2026-01-26 §Resources): a
// `ui://` page the host renders in a sandboxed iframe and hands the tool's
// answer to over postMessage. app_list links to it by `_meta.ui.resourceUri`
// below; its bytes are public/apps.html, served from the same assets. The
// mimeType is the profile the spec requires, not plain text/html.
//
// Both views are ONE FILE each — every style and every script inline — so the
// policy they declare is the whole truth about them: a sandbox origin of our
// own, and an empty allowlist, because neither page fetches anything. Saying
// nothing at all is what a host reads as no policy, and ChatGPT renders that
// as a red "CSP off" or fails the widget outright (T-34433, T-34350).
let PLATFORM_VIEW = uiMeta('https://yaks.app')

let APPS: Doc = {
  uri: APPS_VIEW,
  name: 'apps',
  title: 'Your apps',
  description: 'Every app the person has here, as a page they can look at.',
  mimeType: VIEW_MIME,
  page: 'https://yaks.app/apps.html',
  _meta: PLATFORM_VIEW,
}

// And the second (T-32601): what is still broken, one card per break,
// each with the button that archives it — the view calls `app_errors` back
// through the host to do it, which is why that tool says `app` in its
// visibility below.
let ERRORS: Doc = {
  uri: ERRORS_VIEW,
  name: 'errors',
  title: 'What is broken',
  description: 'Every break still open in an app, as cards with a fixed ' +
    'button.',
  mimeType: VIEW_MIME,
  page: 'https://yaks.app/errors.html',
  _meta: PLATFORM_VIEW,
}

// A signed-in caller reads all of them, the public ones included: the whole
// list opens with what anybody may read, so the public surface is a subset of
// this one rather than a second surface beside it.
let RESOURCES: Doc[] = [...DOCS, APPS, ERRORS]

type Rpc = {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

let json = (status: number, body: unknown) => Response.json(body, { status })

let result = (id: unknown, result: unknown) =>
  json(200, { jsonrpc: '2.0', id, result })

// A refusal, said to a caller that named a JSON-RPC id. The status and the
// `WWW-Authenticate` header are what they always were — the half every MCP
// client follows into the OAuth flow — and the body carries the SAME challenge
// a second way, in `_meta['mcp/www_authenticate']` with the `error` and
// `error_description` that half wants, because that is the half ChatGPT reads
// to draw its sign-in button. Without it the tool it refused has no link to
// offer and the person is simply stuck
// (developers.openai.com/plugins/build/auth).
let refused = (req: Request, id: unknown) => {
  let said = challenge(new URL(req.url))
  return Response.json({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: SAYS }],
      _meta: {
        'mcp/www_authenticate': [
          `${said}, error="invalid_token", error_description="${SAYS}"`,
        ],
      },
      isError: true,
    },
  }, { status: 401, headers: { 'www-authenticate': said } })
}

// Everything this door serves that is not a tool, registered on the same
// server the package built (@yaks/mcp `extend`).
//
// The resources are the guide and its deep pages, which anybody may read, plus
// the two views a signed-in person's own answers draw in — and the pages an
// app of theirs declares (declared.ts, T-32687), which only someone who can
// reach that app is told about. The prompts are the doors a PERSON picks by
// name (prompts.ts, T-32981).
let extend = (ctx: Ctx, apps: Entry[]) => async (server: McpServer) => {
  for (let doc of RESOURCES) {
    // A view's `_meta` rides on the listing AND on the bytes: the listing is
    // what a host reads to decide, the content item is what governs the frame
    // it then builds, and the spec has it repeated on both.
    let its = doc._meta ? { _meta: doc._meta } : {}
    server.registerResource(doc.name, doc.uri, {
      title: doc.title,
      description: doc.description,
      mimeType: doc.mimeType,
      ...its,
    }, async () => ({
      contents: [{
        uri: doc.uri,
        mimeType: doc.mimeType,
        text: await (await asset(ctx.env, doc.page)).text(),
        ...its,
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
      if (!page) throw new Error(`no resource ${view.uri}`)
      return { contents: [{ ...page, mimeType: VIEW_MIME }] }
    })
  }
  // What this person has already made, for the prompt that is about that
  // (prompts.ts `app-ideas`): the apps in reach by name and address, off the
  // passage the door just gathered rather than read a second time.
  let made = apps.map((e) => ({
    title: e.app.title || e.app.slug,
    url: url(e.space, e.app),
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
          ),
        },
      }],
    }))
  }
  // And one per app that left standing instructions beside it (standing.ts,
  // T-34425): the same words `initialize` already handed the model, offered
  // to the PERSON by the app's own name so they can say "the recipes rules"
  // and have them read back. It carries no arguments — the file is the whole
  // message — and `prompts` is already a declared capability, since the four
  // above registered it.
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
  // than refused. There is nothing to set: the one thing this door ever logs
  // is a break, at `error`, and nothing quieter is ever sent (unseen.ts
  // `noted`).
  server.server.registerCapabilities({ logging: {} })
  server.server.setRequestHandler(SetLevelRequestSchema, () => ({}))
}

// An old caller is answered, never corrected (C-32607 item 2). The generic
// tier's arguments moved when it became @yaks/mcp's (T-33812) — `entities` is
// `change`, `filter` and `query` are `q`, `text` is `words` — and a connector
// configured against the old spelling is somebody's, already installed. So the
// words are translated HERE, at the door, and the tool sees one shape.
//
// The pair that named ONE app moves too: on a write it becomes `$app` on each
// bundle, on a read the `.in=` rider on the query line — both the platform's
// own words, each said where the thing it is about is (agent.ts). Signed out
// it moves nowhere: the pair IS the call's scope there, read off the arguments
// by the door itself before any graph exists (anon.ts `opened`), so `scoped`
// says whether this caller has a reach for an app to be narrowed out of.
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
  // The old wire let a bundle name no entity at all and had the store mint
  // one; the bundle wire wants the alias said out loud. An old caller keeps
  // its silence, and the alias it never asked for is one this door invents.
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
  // call's own scope there, declared on the tool (anon.ts SCOPE) and read by
  // the door itself, not a narrowing of a reach nobody has.
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

// The release this door is serving: Cloudflare's per-deploy version id, which
// the runtime mints on every deploy — so a release moves the roster version
// with no file edit. Absent under `wrangler dev` and the workerd probes, where
// the human VERSION stands in.
let markOf = (env: Env) => env.CF_VERSION_METADATA?.id ?? VERSION

// The door itself, built per request around the person the edge verified: the
// caller's whole reach as one graph, the platform's verbs on it as a plugin,
// and the same `Authenticate` seam every other door onto this data takes —
// here it has already run, so it hands back what the edge decided.
//
// It answers the handler and the ROSTER it is about to serve (T-34277): the
// tool names, and the version naming them, which `initialize` records for this
// session and every later call is compared against.
let door = async (ctx: Ctx, session: string) => {
  let reach = await inReach(ctx, {})
  // The COMMANDS the apps in reach declare (declared.ts). They are not tools
  // and never appear in the list; they are read here so the instructions can
  // name them under their app, and `commands` says them again with their
  // arguments when an agent asks.
  let own = await listCommands(ctx)
  // What the apps in reach say about themselves (standing.ts, T-34425): every
  // one of them named, with what it holds, its own commands and whatever
  // AGENTS.md its person left beside it. It rides on the INSTRUCTIONS, which
  // is what a model reads before it reads anything else, so an app already
  // made is found rather than made a second time and a standing rule is
  // followed without anybody quoting it.
  //
  // The reach and the commands are handed over rather than read again: this
  // runs on every call at the door, and both were just paid for.
  let apps = await standing(ctx, reach, own)
  ctx.standing = apps.text
  // The graph, and how a column of it reads and writes: a reference answers
  // human, and a word two of the caller's spaces spell differently is typed
  // nowhere (agent.ts `reading`). The schemas in the tool list are derived
  // through it, so they describe what this door actually says.
  let { graph, column } = await reaching(ctx, reach)
  let opts = {
    graph,
    column,
    // What a READ answers is left at names here, while the write door is
    // typed whole (@yaks/mcp, T-34153). Measured over a space of three apps:
    // the typed write door costs 9 KB of tool list, and typing the four read
    // schemas as well costs 33 KB more. The types are what a WRITE needs — a
    // read hands over the values themselves — and this door's vocabulary is a
    // union of every store in reach, so those 33 KB are the least exact part
    // of it, paid on every connection.
    schema: 'names' as const,
    // And where a word is written about at length, so graph_schema hands over
    // the page beside the columns (guide.ts `pageFor`).
    guide: pageFor,
    // And the way back out of a delete here, which the generic tier could not
    // know: a store is not a place a mistake is final (recover.ts, T-34509).
    undo: UNDO,
    authenticate: () => ({ eid: ctx.person }),
    // The name, the line and the picture, from the one place they are written
    // (seo.ts CONNECTOR, T-34415): a client that reads `serverInfo` shows this
    // door with a face, and nobody has to type any of it into a form.
    ...CONNECTOR,
    version: VERSION,
    instructions: apps.text
      ? `${INSTRUCTIONS}\n\n---\n\n${apps.text}`
      : INSTRUCTIONS,
    search: searching(ctx, reach),
    // What this door needs: a token (preauth.ts SIGNIN). A tool that works
    // either way says so itself and keeps it (tools.ts `security: EITHER`) —
    // which is every tool a stranger may call except the generic reads, and
    // those are anonymous only on the door a stranger reads, where they are
    // ONE named app rather than the whole of somebody's reach.
    security: SIGNIN,
    extend: extend(ctx, apps.apps),
  }
  // What this door lists right now, and the name for it. `about` says both
  // (tools.ts), so a client that suspects its list is old has one call that
  // settles it without reconnecting.
  //
  // The RELEASE is the only thing that names it (T-34541). Nothing a person
  // does moves this list any more: an app made, an app that grew a word, a
  // deploy that declared a command — all of them are commands and words, and
  // the tools that carry them are the same tools they always were. So the
  // version moves when we deploy, and a client is told its list is stale only
  // when it actually is.
  let names = roster(opts)
  let listed = { version: rosterVersion(names, markOf(ctx.env)), names }
  ctx.roster = listed
  return {
    listed,
    // Every result carries the line when this session connected against
    // another roster — the news `notifications/tools/list_changed` carries to
    // a client holding a stream, said where a client without one is reading.
    handle: mcp({
      ...opts,
      roster: () => rostered(ctx.env, ctx.person, { session, ...listed }),
    }),
  }
}

// A tool's own refusal, said to a caller the door turned away before the
// protocol machine ran: the 200 a tool error takes, never the 401, which is
// the answer to "you are not signed in" and not to "that app is private".
let erred = (id: unknown, err: unknown) =>
  result(id, {
    content: [{
      type: 'text',
      text: err instanceof Error ? err.message : String(err),
    }],
    isError: true,
  })

// The door for a caller who has not signed in (anon.ts, T-34467). It is the
// same @yaks/mcp mount, over a graph with NOBODY in it:
//
//   the platform's tools that declare they need nobody — about, the guide,
//   the gallery and feedback (tools.ts `security: EITHER`);
//   the generic READS, scoped to the one public or open app the call names,
//   which read that app's store exactly as its own page does;
//   and the WHOLE of the rest of the roster beside them — the write, the mail
//   pair, every platform verb — listed, saying `oauth2`, refusing the call
//   (anon.ts `barred`, `asked`), so the host has something to offer the
//   sign-in for and the list is the same one a signed-in caller sees.
//
// Claim-later — a stranger writing now and owning it once they sign in — is
// what would be built HERE, and is deliberately not: it needs somewhere to
// hold a write nobody owns yet, and there is nowhere on this platform to put
// one. Signing in first is the whole of it for now.
//
// Everything else is `refused`: a method this door does not serve publicly, a
// tool nobody may call anonymously, and a tool nobody wrote all answer the
// same 401, so nothing here says what a signed-in list would hold.
let stranger = async (
  req: Request,
  rpc: Rpc,
  env: Env,
  said: string,
): Promise<Response> => {
  let name = rpc.method == 'tools/call' ? String(rpc.params?.name ?? '') : ''
  if (rpc.method != 'tools/list' && !(name && anonymous(name))) {
    return refused(req, rpc.id)
  }
  let ctx: Ctx = {
    env,
    dir: directory(bound(env.DIRECTORY, dirPart.fetch, env), true),
    // Nobody. Every door below reads this as no reach, no membership and no
    // mailbox rather than as a person whose eid happens to be empty
    // (directory.ts `member`, agent.ts `platform`).
    person: '',
  }
  // The app a READ answers for, resolved before anything is built — so a call
  // that named none, or named one nobody may read, is refused in a sentence
  // rather than by an empty answer. Listing names no app and needs none: the
  // schemas are the same whichever app is read.
  let args = (rpc.params?.arguments ?? {}) as Record<string, unknown>
  let reach: Reach[] = []
  if (READS.includes(name)) {
    try {
      reach = await opened(ctx, args)
    } catch (err) {
      return erred(rpc.id, err)
    }
  }
  let { graph, column } = await reaching(ctx, reach)
  let opts = {
    graph,
    column,
    schema: 'names' as const,
    guide: pageFor,
    search: searching(ctx, reach),
    // Every tool, and what each one declares about signing in (anon.ts
    // `asked`): the pair for what a stranger may call, `oauth2` for the rest,
    // which is the field a host reads to offer the sign-in. The WRITE is
    // listed too — signed out it is a tool that refuses rather than a tool
    // that is not there (T-34541), because this list is the one a directory
    // snapshots at submission, and a name missing from that snapshot is a tool
    // the published connector can never offer its signed-in people.
    security: asked,
    scope: SCOPE,
    ...CONNECTOR,
    version: VERSION,
  }
  // No roster line and no session: both are a person's own — a roster names
  // what a client cached at connect, and a stranger's list moves only when we
  // deploy. `about` signed out says the same words for everyone, which is
  // what makes it safe to answer without knowing who is asking.
  return mcp(opts)(
    new Request(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: said,
    }),
  )
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  if (url.pathname != '/mcp') {
    return json(404, { error: { code: 'not_found' } })
  }
  if (req.method != 'POST' && req.method != 'GET') {
    return json(405, { error: { code: 'method_not_allowed' } })
  }
  // The same door, told to skip the pre-auth surface: `?auth=required`
  // (T-34416). A host that decides whether a server has an authorization
  // server by PROBING it anonymously reads our 200 as "no auth" and never
  // looks at `WWW-Authenticate`, so it lands the connector on the tools a
  // stranger gets and never offers to sign in. The address is the lever
  // because the client's behaviour is not ours to change: a host that cannot
  // ask twice is given an address that only ever answers the challenge, and
  // `/mcp` stays lazy — and mixed — for the hosts that can (anon.ts `asked`).
  // A query rather than a second path so there is still ONE resource here —
  // one route, one `WWW-Authenticate`, one `/.well-known/…/mcp`, which the
  // challenge already builds from the pathname.
  let strict = url.searchParams.get('auth') == 'required'
  // Who is asking, if anybody. An anonymous request costs nothing to find
  // out — no header to unwrap, no cookie to verify (identity.ts) — and what
  // it gets is the pre-auth surface below rather than the door in its face.
  let { who: auth, tried } = await asking(env, req)
  // A credential that did not verify is NOT an anonymous caller: an expired or
  // revoked token, or one minted for something else, is refused here with the
  // 401 and the challenge, before the pre-auth surface can answer it. The spec
  // requires that 401, and Claude ignores `WWW-Authenticate` on a 200 — so
  // answering the public surface instead is a connector silently losing every
  // tool where it should have been asked to sign in again (T-34344).
  if (!auth && (tried || strict)) return unauthorized(req)
  // The GET is the session's STREAM (stream.ts): a client holds it open to
  // hear what the server says between its own calls, which today is one
  // thing — that its tool list moved, because an app of theirs deployed new
  // tools (T-32686). It lives in a Durable Object of the person's own, so a
  // deploy in one request reaches the stream another request opened, and a
  // connection that dropped resumes from its `Last-Event-ID` (T-32734).
  // Everything else is still one POST in, one JSON out. A stream is a
  // person's own, so there is no public one.
  if (req.method == 'GET') {
    return auth ? listen(env, auth.person, req) : unauthorized(req)
  }
  // Before anyone has signed in this door answers exactly three ways: the
  // public result, a 202 for a notification, and the challenge for everything
  // else — a method it does not serve publicly, a tool or a page it will not
  // hand over, and anything that was not a request at all. So a body that
  // does not parse and a batch, which are refusals every caller gets, are
  // still the 401 for an anonymous one.
  // The body is read HERE and passed on as text: this door decides who is
  // answered before the protocol machine sees anything, and a request body is
  // read once.
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
      : unauthorized(req)
  }
  if (Array.isArray(body)) {
    return auth
      ? json(400, { error: { code: 'no_batches' } })
      : unauthorized(req)
  }
  let rpc = body as Rpc
  if (rpc.id == null) return new Response(null, { status: 202 }) // a notification
  // A prompt picked BARE is a prompt with no arguments, not a malformed call:
  // every one of them reads as a sentence with nothing filled in (prompts.ts
  // `or`), while the schema behind it wants the object said out loud.
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
  // handed a method and its params — no person, no Ctx, and no binding but the
  // static assets — so nothing it answers can have read anybody's data. What
  // it does not answer goes to the anonymous door (`stranger`), which serves
  // the tools a stranger may call and challenges everything else.
  if (!auth) {
    let open = await answer(String(rpc.method), rpc.params ?? {}, {
      ASSETS: env.ASSETS,
    })
    return open ? result(rpc.id, open) : await stranger(req, rpc, env, said)
  }
  // Fresh, every read: a tool answers about what a tool just wrote, and the
  // directory's read cache belongs to whichever isolate warmed it
  // (directory.ts). A deploy from anywhere else is news this door has to
  // have (C-32905 item 5).
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let ctx: Ctx = {
    env,
    // A grant narrowed to one space is narrowed HERE, over the directory every
    // tool reads membership out of (grants.ts `narrowed`), so the narrowing
    // holds for the generic tier, the platform tier and an app's own tools at
    // once rather than tool by tool.
    dir: auth.space ? narrowed(dir, auth.space) : dir,
    person: auth.person,
    who: auth,
  }
  // The session id, per the transport: minted at `initialize` and sent back by
  // the client on every later request. It names which of this person's streams
  // is which (the GET above), and which roster this client cached (stream.ts
  // `roster`). It is not required and never checked — a POST carries its own
  // answer to who is asking, and a client that has never seen this header
  // still works, sharing the nameless session with every other such client.
  let session = rpc.method == 'initialize'
    ? crypto.randomUUID()
    : req.headers.get('mcp-session-id') ?? ''
  let built = await door(ctx, session)
  let out = await built.handle(
    new Request(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: said,
    }),
  )
  if (rpc.method != 'initialize') return out
  // The list this client is about to cache, remembered for the session it is
  // caching it under: every later reply is compared against this.
  await rostered(env, auth.person, { session, ...built.listed, init: true })
  let named = new Response(out.body, out)
  named.headers.set('mcp-session-id', session)
  return named
}
