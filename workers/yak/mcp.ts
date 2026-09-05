// The connector part (D-32318 §The agent door): `POST /mcp` at the apex, an
// MCP server over Streamable HTTP — one JSON-RPC request in, one JSON reply
// out, no session id — the same way the dev server mounts src/mcp.ts, so a
// restart strands nobody and a Worker isolate holds nothing between calls
// except a stream a client is holding open: `GET /mcp` is that stream
// (stream.ts), and what goes down it is `notifications/tools/list_changed`
// when an app's own tools move (T-32686). The protocol surface is eight
// methods — initialize, ping, tools/list, tools/call over the tool table in
// tools.ts, resources/list, resources/read over the guide, its deep pages
// (guide.ts, T-32982), the two views below, and the pages an app of the
// person's own declares (declared.ts, T-32687), and prompts/list,
// prompts/get over the four doors a PERSON picks by name (prompts.ts,
// T-32981) — which is what a connector that calls tools, reads a page and
// renders an answer asks for. The stream is the `agents` package's McpAgent
// shape without the package: a Durable Object per signed-in person
// (stream.ts's `Wire`), which is what it takes for the request that deployed
// an app to write to the stream a DIFFERENT request opened. `initialize`
// answers an `Mcp-Session-Id` so a client can name its stream and resume it
// after a drop; nothing else reads that id, and every POST stays stateless.
//
// Every tool reply for a space ends with what is unseen there (unseen.ts):
// each open exception or error not yet served, one line, then marked, so no
// break in an app goes unseen by the agent that builds it (T-32362).
//
// Who is asking is identity.ts's `withAuth`: the platform session cookie a
// browser carries, or the OAuth bearer an agent carries, one answer either
// way. It is deliberately NOT the vouched `x-yak-person` header — the kernel
// sets that header on what it hands an app, and this door is at the apex
// reading a request straight off the internet, where the header is only ever
// a client's claim about itself. A 401 carries identity's `WWW-Authenticate`
// challenge, the line an MCP client follows into the OAuth flow.
//
// Nobody at all is answered too, by preauth.ts (T-33030): what this platform
// is, and the guide, which the web already serves to anybody who asks for it.
// That surface is handed a method and its params and no binding but the
// static assets — no person, no `Ctx`, nothing to read anybody's data with —
// and everything it does not answer meets the same challenge as ever.
import { VERSION } from '../../src/version.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { unauthorized, withAuth } from './identity.ts'
import { callDeclared, listDeclared, listViews, readView } from './declared.ts'
import { answer, asset, type Doc, DOCS, spoken } from './preauth.ts'
import { missing, promptOf, PROMPTS } from './prompts.ts'
import {
  APPS_VIEW,
  type Ctx,
  ERRORS_VIEW,
  type Out,
  TOOLS,
  VIEW_MIME,
} from './tools.ts'
import { listen } from './stream.ts'
import { ceiling, serve, unseenBlock } from './unseen.ts'

// What a model reads before it has read anything else here (T-32481). It is
// the whole recipe on purpose — the address, the four steps, and the store in
// a paragraph a page can be written from — because the first ask ("can you
// make me a recipe box?") is answered before anyone thinks to open a guide,
// and an agent that has to guess at the data reaches for localStorage.
let INSTRUCTIONS = `When the person asks you to make something — an app, a
page, a tool, somewhere to keep something — make it here, and give them the
link. It lives at their own address, opens on their phone, and keeps its
data; a file on their computer or a page inside this conversation does none
of that.

An app is an index.html and whatever files sit beside it, served live at
<space>.yaks.app/<app>/. No build step, no framework, no install. Four steps:

1. app_new — the app. Leave the space argument out: signing in gave them
   one, and every tool uses it unless they have several.
2. app_files — write index.html, and any css, js or images beside it; the
   whole set in one call, as files: [{path, content}, ...].
3. app_deploy — mark the release. The files are already live; this is the
   version an error will name. It also plants any components the app declares
   in a vocab.json beside index.html — {"recipe": {"serves": "number"}} and
   the app has a recipe of its own, filterable like doc.
4. Give the person the URL.

app_list is what they already have — every app, its address and what is
broken in it — and it draws itself where they can see it.

An app is readable by anyone with the link and writable by its members. When
it is for other people too, say so: app_new (or app_set) takes access 'open',
where anyone with the link can vote, add a line or sign up without signing in,
and 'private', where only members see it at all; member_add invites someone
into the space by email address — name the app and the invitation is mailed to
them with its link, and they sign in there with that address and land back on
the page they were on.

Its data belongs in the app's own store, not localStorage — so it is the same
on their phone and their laptop, and so you can read and repair it yourself.
The page gets it in one line, from the app's own address:

  import { apply, query, search, subscribe } from './api/client.js'

  await apply({ entity: { eid: '$r' },
                doc: { title: 'Lemon cake', body: '3 lemons...' } })
  let all = await query('.doc!')       // everything, oldest first
  let some = await search('lemon')     // the words, ranked
  subscribe('.doc!', draw)             // and again whenever it changes,
                                       // including on their other device

An entity is {entity: {eid}, ...components}: '$name' mints a new one (the
answer maps it to its eid), and a filter line reads them back. A row carries
only the components its filter NAMES — presence filters end at ! and join
with &, and '?' asks for one without filtering on it — so query('.recipe!')
answers recipes with no titles and query('.recipe!&.doc?') answers both. Ask
for what the page will draw. The guide resource is the map of all of this,
and beside it is a page per subject — querying, components, files, tools of
your own, code of your own — so read the one the work calls for rather than
guessing; graph_apply, graph_query and search are the same store from here,
for seeding and fixing.

An eid is the same thing in every app. Two apps can write about one entity —
a reading list app saves the book, a lending app saves the loan — and each
component lives with the app that declares it, so nothing is copied and
nothing is synced. graph_query with no app named reads them all at once and
answers one bundle per entity: '.book!&.loan?' is every book wearing its loan
where it has one, and '.loan?' asks for a component without filtering on it.
A page reads a sibling app the same way, with store('/lending/api/') from
'./api/client.js'.

An app can carry its OWN tools: a tools.json beside index.html declares them
— a name, a sentence, an input, and an apply or query template over the app's
store — and after app_deploy they are listed here as <app>__<tool>, for the
person and for anyone else in the space. The guide has the shape.

An app can carry its own CODE too: a worker.js beside index.html answers
every request that is not /api/ before the files do, and whatever it answers
404 falls through to them, so it owns the routes it names and nothing else.
It reads the app's store as the person looking (env.STORE), its files
(env.FILES), and any key you set with app_secret_set as env.NAME — which is
what a page must not hold and nothing can read back. The guide has a whole
one.

Asked to save things from OTHER sites — a recipe, a listing, an article —
give the app a /clip route on its worker.js: it fetches the address, reads
what the page says about itself (JSON-LD first, then og: meta tags, then the
title), and applies one bundle with a source component of its own. The person
starts it with a bookmarklet the app hands them, because an app's write doors
take same-origin requests only, so a script on somebody else's page cannot
write here. https://yaks.app/guide/clipping.md is the whole thing.

An app is a plugin. app_publish offers one to every other space here by
name, and app_published lists what is on offer; app_install takes one into
the person's own space, where it is an ordinary app of theirs — its own
address, its own store, their data from the first byte, nothing shared but
the code — pinned to the version it took until app_update moves it, which
keeps everything they saved. Look before you build something somebody has
already made.

Whatever breaks — a page's own error, a refused write, a request that failed
— arrives at the end of a later reply, once. Fix what you see. And when a
change of yours is what broke it, or they simply want it back: app_rollback
puts every file of an earlier deploy back and releases it as a new version,
and app_versions is the list to pick from.

When what is wrong is THIS PLATFORM rather than their app — a tool that
refused for no reason you could find, a guide that taught the wrong thing,
something missing you cannot work around — say so with feedback: their words
and what you tried, once, and it reaches the people who run yaks.app by mail.`

// The views this door offers beside the guide, whose resources are
// preauth.ts's — the guide is world-readable and served to anybody, and these
// two are a signed-in person's own.
//
// The first is an MCP App view (T-32492, spec 2026-01-26 §Resources): a
// `ui://` page the host renders in a sandboxed iframe and hands the tool's
// answer to over postMessage. app_list links to it by `_meta.ui.resourceUri`
// below; its bytes are public/apps.html, served from the same assets. The
// mimeType is the profile the spec requires, not plain text/html.
let APPS: Doc = {
  uri: APPS_VIEW,
  name: 'apps',
  title: 'Your apps',
  description: 'Every app the person has here, as a page they can look at.',
  mimeType: VIEW_MIME,
  page: 'https://yaks.app/apps.html',
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

let rpcError = (id: unknown, code: number, message: string) =>
  json(200, { jsonrpc: '2.0', id, error: { code, message } })

let result = (id: unknown, result: unknown) =>
  json(200, { jsonrpc: '2.0', id, result })

// One tool call: the answer, or the failure as the tool's own error text —
// a bad argument or a refused write is for the agent to read, never a 500.
// Either way the unseen section rides when a space was in hand.
let call = async (ctx: Ctx, params: Record<string, unknown>) => {
  let name = String(params.name)
  let tool = TOOLS.find((t) => t.name == name)
  let args = (params.arguments ?? {}) as Record<string, unknown>
  let text: string
  let isError = false
  let out: Out | undefined
  try {
    // The platform's own tool, or — when nothing here spells that name — one
    // of the person's own apps' (declared.ts, T-32685), which is a template
    // over that app's store and refuses exactly as its page would.
    out = tool
      ? await tool.run(ctx, args)
      : (await callDeclared(ctx, name, args)) ?? undefined
    if (!out) {
      return {
        content: [{ type: 'text', text: `no tool ${name}` }],
        isError: true,
      }
    }
    text = out.text
  } catch (e) {
    text = e instanceof Error ? e.message : String(e)
    isError = true
  }
  if (out?.space) {
    let who = {
      person: ctx.person,
      role: await ctx.dir.role(out.space, ctx.person),
    }
    text += unseenBlock(await serve(ctx.env, out.space, who)) +
      await ceiling(ctx.env, out.space)
  }
  return {
    content: [{ type: 'text', text }],
    // What the tool's view draws, if it has one: the host hands this to the
    // iframe as `ui/notifications/tool-result`.
    ...(out?.data ? { structuredContent: out.data } : {}),
    ...(isError ? { isError } : {}),
  }
}

let handle = async (ctx: Ctx, rpc: Rpc) => {
  let params = rpc.params ?? {}
  if (rpc.method == 'initialize') {
    let out = result(rpc.id, {
      protocolVersion: spoken(params.protocolVersion),
      // `listChanged` is a promise to say when the tool list moves, which is
      // what an app deploying its own tools does (declared.ts). Resources
      // promise the same, since a release moves an app's views without
      // necessarily touching its tools (T-33004), and prompts for the same
      // reason: an app that deploys prompts of its own moves this list too
      // (T-32983), and the stream already knows how to say so (stream.ts
      // `told`). `logging` is the door for a break PUSHED as it is written
      // (unseen.ts `noted`, T-33006), not held for the next reply's unseen
      // block — which still carries it, for whoever was not listening.
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true },
        logging: {},
      },
      serverInfo: { name: 'yaks.app', version: VERSION },
      instructions: INSTRUCTIONS,
    })
    // The session id, per the transport: the client sends it back on every
    // later request, and the one place it means anything is the GET below,
    // where it names which of this person's streams is which. It is not
    // required and never checked — a POST carries its own answer to who is
    // asking, and a client that has never seen this header still works.
    out.headers.set('mcp-session-id', crypto.randomUUID())
    return out
  }
  if (rpc.method == 'ping') return result(rpc.id, {})
  // Declaring `logging` invites this ask, so it is answered rather than
  // refused. There is nothing to set: the one thing this door ever logs is a
  // break, at `error`, and nothing quieter is ever sent (unseen.ts `noted`).
  if (rpc.method == 'logging/setLevel') return result(rpc.id, {})
  if (rpc.method == 'tools/list') {
    return result(rpc.id, {
      tools: [
        ...TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.input,
          // A tool with a view names it; a host without MCP Apps ignores the
          // field and reads the same answer as text. Visibility is who may
          // call it: the model, and 'app' where the view's own button does.
          ...(t.view
            ? {
              _meta: {
                ui: {
                  resourceUri: t.view,
                  visibility: t.visibility ?? ['model'],
                },
              },
            }
            : {}),
        })),
        // And the tools the person's own apps declare (declared.ts, T-32686),
        // for every app in every space they belong to: an app that grew a tool
        // is one more thing their agent can do, without anything here knowing
        // what it is. A deploy that moves that list says so on the stream
        // below, so a client that listed once lists again.
        ...await listDeclared(ctx),
      ],
    })
  }
  if (rpc.method == 'tools/call') return result(rpc.id, await call(ctx, params))
  // The doors a PERSON picks by name (prompts.ts): the list is short and
  // whole, so no cursor rides the answer.
  if (rpc.method == 'prompts/list') {
    return result(rpc.id, {
      prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({
        name,
        title,
        description,
        arguments: args,
      })),
    })
  }
  if (rpc.method == 'prompts/get') {
    let want = promptOf(params.name)
    if (!want) return rpcError(rpc.id, -32602, `no prompt ${params.name}`)
    let args = (params.arguments ?? {}) as Record<string, unknown>
    let short = missing(want, args)
    if (short.length) {
      return rpcError(rpc.id, -32602, `${want.name} needs ${short.join(', ')}`)
    }
    return result(rpc.id, {
      description: want.description,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: want.say(
            Object.fromEntries(
              Object.entries(args).map(([k, v]) => [k, String(v ?? '')]),
            ),
          ),
        },
      }],
    })
  }
  if (rpc.method == 'resources/list') {
    return result(rpc.id, {
      resources: [
        ...RESOURCES.map((
          { uri, name, title, description, mimeType },
        ) => ({
          uri,
          name,
          title,
          description,
          mimeType,
        })),
        // And the pages the person's own apps draw their tools' answers in
        // (declared.ts, T-32687): the app wrote them, the app's files hold
        // them, and only someone who can reach the app is told they exist.
        ...await listViews(ctx),
      ],
    })
  }
  if (rpc.method == 'resources/read') {
    let want = RESOURCES.find((r) => r.uri == params.uri)
    if (want) {
      let page = await asset(ctx.env, want.page)
      return result(rpc.id, {
        contents: [{
          uri: want.uri,
          mimeType: want.mimeType,
          text: await page.text(),
        }],
      })
    }
    // A view out of an app's own files, if the caller can reach the app that
    // declared it. Anything else is a resource this door does not have —
    // including a page of an app they cannot reach, which is the same answer
    // as a page nobody wrote.
    let view = await readView(ctx, String(params.uri))
    if (!view) return rpcError(rpc.id, -32602, `no resource ${params.uri}`)
    return result(rpc.id, {
      contents: [{ ...view, mimeType: VIEW_MIME }],
    })
  }
  return rpcError(rpc.id, -32601, `no method ${rpc.method}`)
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (new URL(req.url).pathname != '/mcp') {
    return json(404, { error: { code: 'not_found' } })
  }
  if (req.method != 'POST' && req.method != 'GET') {
    return json(405, { error: { code: 'method_not_allowed' } })
  }
  // Who is asking, if anybody. An anonymous request costs nothing to find
  // out — no header to unwrap, no cookie to verify (identity.ts) — and what
  // it gets is the pre-auth surface below rather than the door in its face.
  let auth = await withAuth(env, req)
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
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return auth ? rpcError(null, -32700, 'parse error') : unauthorized(req)
  }
  if (Array.isArray(body)) {
    return auth
      ? json(400, { error: { code: 'no_batches' } })
      : unauthorized(req)
  }
  let rpc = body as Rpc
  if (rpc.id == null) return new Response(null, { status: 202 }) // a notification
  // The pre-auth surface (preauth.ts): what this platform is, and the guide,
  // which the web already serves to anybody. It is handed a method and its
  // params — no person, no Ctx, and no binding but the static assets — so
  // nothing it answers can have read anybody's data, and whatever it will not
  // answer meets the challenge that names our authorization server.
  if (!auth) {
    let open = await answer(String(rpc.method), rpc.params ?? {}, {
      ASSETS: env.ASSETS,
    })
    return open ? result(rpc.id, open) : unauthorized(req)
  }
  let ctx: Ctx = {
    env,
    // Fresh, every read: a tool answers about what a tool just wrote, and the
    // directory's read cache belongs to whichever isolate warmed it
    // (directory.ts). A deploy from anywhere else is news this door has to
    // have (C-32905 item 5).
    dir: directory(bound(env.DIRECTORY, dirPart.fetch, env), true),
    person: auth.person,
  }
  return handle(ctx, rpc)
}
