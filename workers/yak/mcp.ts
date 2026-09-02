// The connector part (D-32318 §The agent door): `POST /mcp` at the apex, an
// MCP server over Streamable HTTP in its stateless form — one JSON-RPC
// request in, one JSON reply out, no session id, no event stream — the same
// way the dev server mounts src/mcp.ts, so a restart strands nobody and a
// Worker isolate holds nothing between calls. The protocol surface is six
// methods — initialize, ping, tools/list, tools/call over the tool table in
// tools.ts, and resources/list, resources/read over the one guide below,
// which is what a connector that calls tools and reads a page asks for. The
// `agents` package's McpAgent — a hibernating Durable
// Object per client session — is the shape to grow into the day a tool
// streams progress or the server pushes; it would cost a second DO class, a
// migration, and the MCP SDK bundled into a Worker that today has no
// package.json, to hold state nothing yet reads. Its handler composes with
// this router, so that day is a swap inside this file.
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
import { VERSION } from '../../src/version.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { unauthorized, withAuth } from './identity.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { serve, unseenBlock } from './unseen.ts'

// The versions this door speaks, newest first. A client asks for one in
// initialize; we answer with the same when we know it, else with ours, and
// the client decides whether it can live with that — echoing whatever was
// asked would claim a protocol we have never seen.
let PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

let spoken = (asked: unknown) =>
  typeof asked == 'string' && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0]

let INSTRUCTIONS =
  'yaks.app hosts little apps you build for the person you talk to. Make ' +
  'them a space (space_new), an app in it (app_new), write its files ' +
  '(app_files), deploy (app_deploy); its data is a graph (graph_apply, ' +
  'graph_query, search). Every reply ends with any error the app hit that ' +
  'you have not seen; fix what you see.'

// The one resource this door offers: how an app is built here, and how its
// pages save and list through the client the kernel serves them
// (public/guide.md). Its URI is the address that actually serves it, so a
// client may read it through this door or simply follow the link.
let GUIDE = {
  uri: 'https://yaks.app/guide.md',
  name: 'building-an-app',
  title: 'Building an app on yaks.app',
  description:
    'What an app is, how its pages read and write its store through ' +
    './api/client.js, and the components and filters they have.',
  mimeType: 'text/markdown',
}

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
  let tool = TOOLS.find((t) => t.name == params.name)
  if (!tool) {
    return {
      content: [{ type: 'text', text: `no tool ${params.name}` }],
      isError: true,
    }
  }
  let args = (params.arguments ?? {}) as Record<string, unknown>
  let text: string
  let isError = false
  let out: Awaited<ReturnType<typeof tool.run>> | undefined
  try {
    out = await tool.run(ctx, args)
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
    text += unseenBlock(await serve(ctx.env, out.space, who))
  }
  return { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) }
}

let handle = async (ctx: Ctx, rpc: Rpc) => {
  let params = rpc.params ?? {}
  if (rpc.method == 'initialize') {
    return result(rpc.id, {
      protocolVersion: spoken(params.protocolVersion),
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'yaks.app', version: VERSION },
      instructions: INSTRUCTIONS,
    })
  }
  if (rpc.method == 'ping') return result(rpc.id, {})
  if (rpc.method == 'tools/list') {
    return result(rpc.id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input,
      })),
    })
  }
  if (rpc.method == 'tools/call') return result(rpc.id, await call(ctx, params))
  if (rpc.method == 'resources/list') {
    return result(rpc.id, { resources: [GUIDE] })
  }
  if (rpc.method == 'resources/read') {
    if (params.uri != GUIDE.uri) {
      return rpcError(rpc.id, -32602, `no resource ${params.uri}`)
    }
    let page = await ctx.env.ASSETS.fetch(new Request(GUIDE.uri))
    return result(rpc.id, {
      contents: [{
        uri: GUIDE.uri,
        mimeType: GUIDE.mimeType,
        text: await page.text(),
      }],
    })
  }
  return rpcError(rpc.id, -32601, `no method ${rpc.method}`)
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (new URL(req.url).pathname != '/mcp') {
    return json(404, { error: { code: 'not_found' } })
  }
  // No stream to open and no session to end: the stateless form.
  if (req.method != 'POST') {
    return json(405, { error: { code: 'method_not_allowed' } })
  }
  let auth = await withAuth(env, req)
  if (!auth) return unauthorized(req)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return rpcError(null, -32700, 'parse error')
  }
  if (Array.isArray(body)) return json(400, { error: { code: 'no_batches' } })
  let rpc = body as Rpc
  if (rpc.id == null) return new Response(null, { status: 202 }) // a notification
  let ctx: Ctx = {
    env,
    dir: directory(bound(env.DIRECTORY, dirPart.fetch, env)),
    person: auth.person,
  }
  return handle(ctx, rpc)
}
