import { CallError } from '@yaks/tools/errors'
import { copyOf } from './directory-copy.ts'
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
// client can name its stream and resume it after a drop. New ids also seal
// the session's writer instrument for the authenticated person; every POST
// still authenticates independently and stays stateless.
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
// Every request needs sign-in by default, including discovery. `?auth=mixed`
// offers the pre-auth surface (T-33030): static orientation and guide pages,
// plus the tools anon.ts permits over a graph with nobody in it. Its full
// roster keeps each tool's securitySchemes, so clients can offer sign-in at
// the first protected call. `?auth=required` remains the default's alias for
// existing connectors. All three addresses share one resource and OAuth flow.
import {
  type Exchange,
  mcp,
  type Notice,
  roster,
  rosterVersion,
  type Server,
} from '@yaks/mcp'
import { coded } from './agent-code.ts'
import { connectedTools } from './connected-mcp.ts'
import { translated } from '@yaks/mcp/tools'
import { connected, named, reaching, ROWS, searching } from './agent.ts'
import { scope as queryScope } from './query-line.ts'
import { anonymous, asked, opened, READS, scope } from './anon.ts'
import * as dirPart from './directory.ts'
import { directory, url } from './directory.ts'
import { bound, type Env } from './env.ts'
import { ledger } from './ledger.ts'
import { instructions, pageFor } from './guide.ts'
import { asking, challenge, unauthorized } from './asking.ts'
import { narrowed } from './grants.ts'
import { instrumentEid } from './instrument.ts'
import { inReach, listViews, readView } from './declared.ts'
import { answer, asset, docs, SIGNIN } from './preauth.ts'
import type { Reach } from './reach.ts'
import { PROMPTS } from './prompts.ts'
import { says } from '@yaks/platform/routes'
import { connector } from './seo.ts'
import { VERSION } from './running.ts'
import { prompted, type Standing, standing } from './standing.ts'
import { type Ctx, VIEW_MIME } from './tools.ts'
import { type Asked, listen, rostered, said } from './stream.ts'
import { type Clock, clock, timed } from './timing.ts'
import { background, caught, failing, reporter } from './defects.ts'
import { admitted, hearing } from './refusals.ts'
import { isTestAddress } from '@yaks/platform/bots'
import { refuse } from './tool.ts'
import { inApp } from './attachment-core.ts'
import { url as hostUrl } from '@yaks/platform/host'
import { source, within } from '@yaks/workerd/rate'
import * as appAddress from './app-address.ts'
import { opened as unseal, seal } from './lib/token.ts'
import { foresee } from './unseen.ts'
import { scheduleUse } from './used.ts'

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
//
// What is read for them is read only for an exchange that reads it (@yaks/mcp
// `Exchange`): an app's pages for a `resources/` request, its notes for a
// `prompts/` one. A server is built for every call, and a `tools/call` lists
// neither, so it reads no app for them (T-35479). A server serving a whole
// connection has no one exchange, and is given everything.
let reads = (exchange: Exchange | undefined, kind: string) =>
  !exchange || exchange.method.startsWith(`${kind}/`)
let extend = (ctx: Ctx, stood: Standing) =>
async (
  server: Server,
  exchange?: Exchange,
) => {
  for (let doc of docs(ctx.env)) {
    server.resource(doc.name, doc.uri, {
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
  for (let view of reads(exchange, 'resources') ? await listViews(ctx) : []) {
    server.resource(view.name, view.uri, {
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
  // from what the door gathers rather than read a second time, and only when
  // a prompt is asked for.
  let made = async () =>
    (await stood.listed()).map((e) => ({
      title: e.app.title || e.app.slug,
      url: url(e.space, e.app, ctx.env),
    }))
  for (let p of PROMPTS) {
    server.prompt(p.name, {
      title: p.title,
      description: p.description,
      arguments: p.arguments.map((a) => ({
        name: a.name,
        description: a.description,
        required: !!a.required,
      })),
    }, async (args) => ({
      description: p.description,
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: p.say(
            Object.fromEntries(
              Object.entries(args ?? {})
                .filter(([name]) => p.arguments.some((a) => a.name == name))
                .map(([k, v]) => [k, String(v ?? '')]),
            ),
            await made(),
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
  let apps = reads(exchange, 'prompts') ? await stood.apps() : []
  for (let p of prompted(apps, PROMPTS.map((one) => one.name))) {
    server.prompt(p.name, {
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
  server.capable({ logging: {} })
  server.handle('logging/setLevel', () => ({}))
}

// An old caller is answered, never corrected (C-32607 item 2). A connector
// configured against the generic tier's former argument names is somebody's,
// already installed; @yaks/mcp `translated` renames them at every door, and
// here first, so what follows reads the current names.
//
// The `app`/`space` pair that named one app moves too: on a write it becomes
// `$app` on each bundle, on a read an `.in=` filter — both the
// platform's own forms, each written where the thing it is about is
// (attachment-core.ts `inApp`), and here first so the door reads only
// that app's reach. Signed out it moves nowhere: the pair is the call's scope there,
// read off the arguments before any graph exists (anon.ts `opened`), so
// `scoped` tells us whether this caller has a reach for an app to be narrowed
// out of.
let SCOPED = new Set(['graph_apply', 'graph_query', 'search'])

let heard = (
  name: string,
  args: Record<string, unknown>,
  scoped: boolean,
) => {
  if (!SCOPED.has(name)) return args
  let out = translated(name, args)
  // The old argument shape let a bundle name no entity at all and had the
  // store mint one; the bundle shape @yaks/mcp accepts wants the alias written
  // out. An old caller keeps its silence, and the alias it never asked for is
  // one this code invents.
  if (
    name == 'graph_apply' && 'entities' in args && Array.isArray(out.bundles)
  ) {
    out.bundles = out.bundles.map((b, i) =>
      b && typeof b == 'object' && !('entity' in b) && !('id' in b)
        ? { entity: { eid: `$b${i}` }, ...b }
        : b
    )
  }
  // Signed out, the pair stays exactly where the caller put it: it is the
  // call's own scope there, declared on the tool (anon.ts scope) and read
  // here, not a narrowing of a reach nobody has.
  if (!scoped) return out
  if (name != 'search') return inApp(name, out)
  let { app: _, space: __, ...rest } = out
  return rest
}

// The release this connector is serving: Cloudflare's per-deploy version id, which
// the runtime mints on every deploy — so a release moves the roster version
// with no file edit. Absent under `wrangler dev` and the workerd probes, where
// the human VERSION stands in.
let markOf = (env: Env) => env.CF_VERSION_METADATA?.id ?? VERSION

// Which client a session is: `initialize` mints the session id with the
// client's own name in front (`claude-ai~<seal>`), so every later POST says
// which client it came from without a read, and every POST stays stateless.
// A session minted before this, or a client that named nothing, is none.
let minted = async (
  info: unknown,
  person: string,
  secret: string | undefined,
): Promise<string> => {
  let name = String((info as { name?: unknown } | null)?.name ?? '')
    .replace(/[^\w.-]/g, '')
    .slice(0, 40)
  let via = crypto.randomUUID()
  let id = secret ? await seal('instrument', { person, via }, secret) : via
  return name ? `${name}~${id}` : id
}
let clientOf = (session: string): string | undefined =>
  session.includes('~') ? session.split('~')[0] : undefined

// A session id supplies an instrument only when the kernel sealed it for
// this authenticated person. Old or caller-invented ids still name their
// streams and rosters; the credential supplies their writer instrument.
let instrumentOf = async (
  session: string,
  person: string,
  secret: string | undefined,
) => {
  if (!secret) return null
  let instrument = await unseal<{ person: string; via: string }>(
    'instrument',
    session.slice(session.indexOf('~') + 1),
    secret,
  )
  return instrument?.person == person && typeof instrument.via == 'string' &&
      instrument.via
    ? instrumentEid(instrument.via)
    : null
}

let needsReach = (
  rpc: Rpc,
) => (rpc.method == 'initialize' ||
  reads({ method: rpc.method }, 'resources') ||
  reads({ method: rpc.method }, 'prompts') ||
  rpc.method == 'tools/call' &&
    [
      'graph_apply',
      'graph_query',
      'graph_show',
      'graph_schema',
      'search',
      'code_mode',
    ]
      .includes(String(rpc.params?.name)))

// The MCP server itself, built per request around the person the edge
// verified: the caller's whole reach as one graph, the platform's tools on it
// as a plugin, and the same `Authenticate` callback every other way into this
// data uses — here it has already run, so it returns what the edge decided.
//
// It returns the handler and the tool list it is about to serve (T-34277): the
// tool names, and the version naming them, which `initialize` records for this
// session and every later call is compared against.
let door = async (ctx: Ctx, session: string, rpc: Rpc) => {
  // Each read made before any tool runs is a named stage on the call's
  // `Server-Timing` (timing.ts): this runs on every call, so what it costs is
  // the floor under every write (T-34986). The reach is a fixed number of
  // directory reads however many spaces and apps it holds (T-35479).
  let c = ctx.clock ?? clock()
  let args = rpc.params?.arguments as Record<string, unknown> | undefined
  let selected =
    rpc.method == 'tools/call' && rpc.params?.name == 'graph_query' &&
      typeof args?.q == 'string'
      ? queryScope(
        [args.q, ...(Array.isArray(args.filters) ? args.filters : [])].join(
          '&',
        ),
      ).said
      : undefined
  let reach = selected
    ? [await c.time('reach', () => named(ctx, selected))]
    : needsReach(rpc)
    ? await c.time('reach', () => inReach(ctx))
    : undefined
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
  // Each is read only by the exchange that says it — `initialize` the roster,
  // `about` the notes, a prompt the apps — and once (standing.ts): every other
  // call reads no app's notes and no space's memories.
  let stood = standing(ctx, reach)
  ctx.standing = stood.notes
  // The caller's reach as one graph. A store's vocabulary is read once per
  // request (hops.ts `recall`), and the roster reads the same declarations.
  let graph = await c.time('reaching', () => reaching(ctx, reach ?? []))
  let opts = {
    // The generic tier and the platform's verbs over the caller's reach
    // (agent.ts `connected`), as the Operator lists them too.
    ...connected(ctx, reach ?? [], graph),
    // Where the call about to be served is recorded (ledger.ts): its own
    // in-memory graph, because the one above is a composition over other
    // people's stores and a question is not their data.
    calls: ledger(graph),
    authenticate: () => ({
      by: ctx.person,
      ...(ctx.who?.instrument ? { via: ctx.who.instrument } : {}),
    }),
    report: reporter(ctx, clientOf(session)),
    // A refusal is no defect, and reaches TaskMaster in the hour's report
    // instead (refusals.ts), with the space the call was made in.
    refused: hearing(ctx.env, admitted(ctx)),
    // The name, the one-line description and the picture, from the one place
    // they are written (seo.ts connector, T-34415): a client that reads
    // `serverInfo` shows this connector with a face, and nobody has to type
    // any of it into a form.
    ...connector(ctx.env),
    // Said for `initialize` only, the one reply that carries them (@yaks/mcp
    // `instructed`).
    instructions: async () => {
      let apps = await stood.text()
      return apps
        ? `${instructions(ctx.env)}\n\n---\n\n${apps}`
        : instructions(ctx.env)
    },
    // What a row here is, `kind` beside its components (agent.ts `ROWS`), so
    // a client checking an answer against its tool's listing finds it fits.
    answer: ROWS,
    // What this connector needs: a token (preauth.ts SIGNIN). A tool that
    // works either way declares that itself and keeps it (tools.ts
    // `security: EITHER`) — which is every tool a stranger may call except the
    // generic reads, and those are anonymous only on the anonymous server
    // below, where they read one named app rather than the whole of somebody's
    // reach.
    security: SIGNIN,
    extend: (server: Server, exchange?: Exchange) =>
      c.time('extend', () => extend(ctx, stood)(server, exchange)),
    // The skills each space the person writes in keeps (operator-skills.ts),
    // listed beside the guide's pages.
    skills: async (server: Server, exchange?: Exchange) => {
      let { attachSkills } = await import('@yaks/mcp/skills')
      let { spaceSkills } = await import('./operator-skills.ts')
      await attachSkills(server, () => spaceSkills(ctx), exchange)
    },
  }
  let shared = coded(opts, ctx, undefined, () => connectedTools(ctx))
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
  let names = roster(shared)
  let listed = { version: rosterVersion(names, markOf(ctx.env)), names }
  ctx.roster = listed
  return {
    listed,
    // Every result carries a line when this session connected against an older
    // tool list — the same news `notifications/tools/list_changed` sends to a
    // client holding a stream, put where a client without one will read it —
    // and the platform's answers this agent is owed (stream.ts `Reply`).
    handle: mcp({
      ...shared,
      roster: () =>
        noticed(ctx, {
          session,
          ...listed,
          agent: ctx.who?.agent ?? '',
        }, c),
    }),
  }
}

// What the person's Wire has for this reply, asked beside the tool and never
// waited for (@yaks/mcp `Options.roster`, T-143066). On `Server-Timing` as
// `roster` when it came back before the reply left. The ask outlives a reply
// it was too slow for, and the Wire forgets a line only once a reply carried
// it, after that reply, so a line is never lost to a quick tool.
let noticed = (
  ctx: Ctx,
  asked: Asked,
  c: Clock,
): Promise<Notice | undefined> => {
  let heard = c.time('roster', () => rostered(ctx.env, ctx.person, asked))
  background(heard.then(() => {}, () => {}))
  return heard.then(({ line, notices, replies }) =>
    line
      ? {
        line,
        said: () =>
          background(
            said(ctx.env, ctx.person, { ...asked, notices, replies }).catch((
              e,
            ) => caught(e, { request: 'POST /mcp roster said' })),
          ),
      }
      : undefined
  )
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
    dir: directory(bound(env.DIRECTORY, dirPart.fetch, env), {
      copy: copyOf(env),
      time: env.CLOCK,
    }),
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
  let graph = await reaching(ctx, reach)
  let opts = {
    graph,
    calls: ledger(graph),
    guide: (comp: string) => pageFor(comp, env),
    search: searching(ctx, reach),
    answer: ROWS,
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
    refused: hearing(env),
    ...connector(env),
  }
  // No tool-list line and no session: both are a person's own — the roster
  // version names what a client cached at connect, and a stranger's list
  // changes only when we deploy. `about` signed out returns the same text for
  // everyone, which is what makes it safe to answer without knowing who is
  // asking.
  return mcp(coded(opts, ctx))(
    new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: said,
    }),
  )
}

// The canary (T-37865): a test account's POST here is a defect sent to the tracker
// as that account's, through the same `reporter` a tool's defect takes, which
// is how a deploy proves its defects arrive with their tags. Anyone else finds
// nothing here.
let CANARY = '/api/defect'
let canary = async (req: Request, env: Env): Promise<Response> => {
  let { who } = await asking(env, req)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
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
  if (url.pathname == '/api/app') return appAddress.fetch(req, env)
  if (url.pathname != '/mcp') {
    return json(404, { error: { code: 'not_found' } })
  }
  if (req.method != 'POST' && req.method != 'GET') {
    return json(405, { error: { code: 'method_not_allowed' } })
  }
  // Mixed auth is opt-in; every other value keeps discovery protected.
  let strict = url.searchParams.get('auth') != 'mixed'
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
    if (auth?.space && auth.via == 'session') {
      return json(403, {
        error: {
          code: 'access',
          message:
            'A credential for one space cannot subscribe to account events',
        },
      })
    }
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
  // A body with an id and no method — a response posted back, say — is not a
  // request, and is refused as JSON-RPC's own invalid one.
  if (typeof rpc.method != 'string') {
    return auth
      ? json(400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'not a JSON-RPC request' },
      })
      : unauthorized(req, env)
  }
  // A prompt picked with nothing filled in is a prompt with no arguments, not
  // a malformed call: every one of them still reads correctly that way
  // (prompts.ts `or`), while the schema behind it requires the `arguments`
  // object to be present.
  if (rpc.method == 'prompts/get' && rpc.params?.arguments == null) {
    rpc.params = { ...rpc.params, arguments: {} }
    said = JSON.stringify(rpc)
  }
  if (rpc.method == 'tools/call' && rpc.params) {
    // Arguments are an object by the protocol; a string or a list is the
    // caller's own mistake, refused as one rather than crashing `heard`.
    let args = rpc.params.arguments
    if (args != null && (typeof args != 'object' || Array.isArray(args))) {
      return auth
        ? erred(
          rpc.id,
          refuse(
            'arguments',
            `a tool's arguments are an object of its named parameters, ` +
              `not ${Array.isArray(args) ? 'a list' : `a ${typeof args}`}`,
          ),
        )
        : unauthorized(req, env)
    }
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
    // Per source (@yaks/workerd/rate): a stranger's calls cost us store reads and, for
    // feedback, a letter, and there is no person to hold to an allowance.
    // Listing the tools and the handshake are not counted, only calls.
    if (
      rpc.method == 'tools/call' &&
      !await within(env.TOOL_RATE, source(req), failing('rate limit'))
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
  // have (C-32905 item 5). Within the request a line is read once, until the
  // request itself writes to the directory.
  let reopen = () => {
    let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
      copy: copyOf(env),
      time: env.CLOCK,
    })
    return auth.space ? narrowed(dir, auth.space, auth.spaceEid) : dir
  }
  let dir = reopen()
  // The person is active whatever the call does: an assistant's tool calls
  // are theirs (the directory's "last active", used.ts).
  let ctx: Ctx = {
    env,
    // A grant narrowed to one space is narrowed here, over the directory every
    // tool reads membership out of (grants.ts `narrowed`), so the narrowing
    // holds for the generic tier, the platform tier and an app's own tools at
    // once rather than tool by tool.
    dir,
    reopen,
    person: auth.person,
    who: auth,
    clock: c,
    // A write's answer ends with what is unseen in its space (agent.ts
    // `answered`), and this request counts its reads (hops.ts), so that
    // reading begins as soon as the write knows its space.
    ahead: (space, who) => foresee(env, space, who),
    // A connector gives a call about a minute; a release may take longer.
    outlast: true,
  }
  // The session id, per the transport: minted at `initialize` and sent back by
  // the client on every later request. It names which of this person's streams
  // is which (the GET above), and which roster this client cached (stream.ts
  // `roster`). It is not required — a POST carries its own
  // answer to who is asking, and a client that has never seen this header
  // still works, sharing the nameless session with every other such client.
  let session = rpc.method == 'initialize'
    ? await minted(rpc.params?.clientInfo, auth.person, env.SESSION_SECRET)
    : req.headers.get('mcp-session-id') ?? ''
  let instrument = await instrumentOf(session, auth.person, env.SESSION_SECRET)
  if (instrument) ctx.who = { ...auth, instrument }
  // A connector's token or the CLI's grant is held by an agent writing for the
  // person, named as the client named itself at `initialize` (M-31958); a
  // browser's cookie is the person's own hand.
  if (auth.via != 'session') {
    ctx.who = {
      ...ctx.who!,
      agent: clientOf(session) ?? (auth.via == 'grant' ? 'yak' : 'agent'),
    }
  }
  // Building the reach and tool schemas is read-only. If a directory commit
  // overtakes it, discard the entire provisional reach, not just its epoch.
  let built: Awaited<ReturnType<typeof door>> | undefined
  for (let attempt = 0; !built; attempt++) {
    ctx.dir = reopen()
    try {
      built = await c.time('door', () => door(ctx, session, rpc))
    } catch (error) {
      if (error instanceof CallError) return timed(erred(rpc.id, error), c)
      if (
        attempt >= 2 || error == null || typeof error != 'object' ||
        !('status' in error) || error.status != 503
      ) throw error
    }
  }
  let out = timed(
    await built.handle(
      new Request(req.url, {
        method: 'POST',
        headers: req.headers,
        body: said,
      }),
    ),
    c,
  )
  if (rpc.method == 'tools/call' && auth.person) scheduleUse(env, auth.person)
  if (rpc.method != 'initialize') return out
  // The list this client is about to cache, remembered for the session it is
  // caching it under: every later reply is compared against this. Nothing
  // here waits for it — a call that overtakes it finds the session unrecorded,
  // which the Wire records silently against the same list.
  background(
    rostered(env, auth.person, { session, ...built.listed, init: true })
      .then(() => {}, (e) => caught(e, { request: 'POST /mcp roster' })),
  )
  let named = new Response(out.body, out)
  named.headers.set('mcp-session-id', session)
  return named
}
