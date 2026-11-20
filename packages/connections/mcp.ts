// Person-owned remote commands. The host supplies graph, vault and transport;
// OAuth and invocation remain in the existing connections and MCP packages.
//
// A server is reached one of two ways. One on the public internet is an HTTPS
// address its person signs in to. One on a machine (`mcp_server.machine`, the
// space whose tunnel goes there) is a path on that machine's own server, asked
// through the tunnel with no sign-in: the host answers the tunnel as a `fetch`
// to the space's owner alone, so such a server is its person's only while the
// space is, and to anyone else it is not connected.
import { line } from '@yaks/query'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import {
  checkNamespaces,
  checkToolNames,
  connect as client,
  MCPAuthorizationRequired,
  MCPError,
  nameOf,
  type Options,
  unsaid,
} from '@yaks/mcp-client'
import { AuthorizationError, discover } from '@yaks/mcp-client/oauth'
import { type GraphServer, serverOf } from '@yaks/mcp-client/servers'
import { connect, credential, type Ctx, need, pick } from './connections.ts'
import { integrationEid } from './identity.ts'
import { keyed, known } from './integrations.ts'

let refuse = (code: string, text: string) => new CallError(code, text)

/** What one command answers: its words, and the rest of its reply. */
export type Out = { text: string; value?: Record<string, unknown> }
/** One remote command, as a host lists it: `at` is its server's address,
 * `mcp:<server eid>`, and `name` its exact remote name. */
export type Command = {
  at: string
  name: string
  title: string
  description: string
  readOnly: boolean
  input: unknown
}

type Host = Ctx & {
  report: (e: unknown) => void
  signIn: string
  /** The machine a space's tunnel goes to, as a fetch for this person when
   * the space is theirs, and null to anyone else. A host without one reaches
   * no machine. */
  machine?: (space: string) => Promise<typeof fetch | null>
  /** The spaces this person owns: the machines they can name. */
  owned?: () => Promise<string[]>
}
export type Settings = {
  name: string
  url: string
  machine?: string
  enabled?: boolean
  allow?: string[]
  client_id?: string
  // The header the key it takes goes in, where it takes one; null sends a
  // credential as a bearer token. The key itself arrives through `give`,
  // never with these, which a tool call carries as its text.
  header?: string | null
  // The lists this server offers the person's Operator page, in order
  // (operator-lists.ts): each replaces the ones before, and none says none.
  lists?: Offered[]
  // Where an id it names opens, `{id}` where the id goes; null opens none.
  mentions?: string | null
}
/** One server a person keeps, as their connections page shows it. `status`
 * is its connection's (`connection`), `open` where it asked for no
 * credential yet, and `machine` for one reached through a tunnel. */
export type Shown = {
  id: string
  name: string
  url: string
  machine?: string
  enabled: boolean
  allow?: string[]
  header?: string
  trashed: boolean
  status: 'open' | 'machine' | 'needed' | 'connected' | 'broken'
  connection?: string
  /** whether its credential is a key the person gives, rather than a
   * sign-in; absent where it asked for neither */
  keyed?: boolean
}
/** One list a server offers, as `mcp_connect` takes it. */
export type Offered = {
  title: string
  tool: string
  args: Record<string, unknown>
  waits: boolean
}
// `machine` is the space whose tunnel reaches the server, where it is on one.
/** One tool of a server, as a command at its address. */
export type RemoteCommand = Command & { namespace: string; machine?: string }
type Listed = Awaited<ReturnType<ReturnType<typeof client>['list']>>
// A server with the way to its machine, where it is on one.
type Reached = GraphServer & { fetch?: typeof fetch }
/** How much of what one server says to read before its tools an Operator is
 * told, in characters: about 16k tokens. A server's instructions are its own
 * text, which a stranger's server writes, and they are sent with every ask of
 * the Operator they reach. */
export let SAID = 64_000
/** One ask of a server: a tool of its, and what it is called with. */
export type Ask = { name: string; args: Record<string, unknown> }
/** What one ask answered, or why it failed. */
export type Asked = { out: Out } | { error: unknown }
/** What one server said to read before its tools, cut at {@link SAID}. */
export type Told = { label: string; namespace: string; text: string }
let cut = (text: string) =>
  text.length > SAID
    ? `${
      text.slice(0, SAID)
    }\n\n[Cut at ${SAID} of the ${text.length} characters the server said.]`
    : text
// A server on a machine that did not answer as one: the machine is off, its
// tunnel has no gateway, or it opened no such path. Its owner sees that, and
// it is no fault of the platform's to report.
let away = (s: GraphServer, e: unknown): e is MCPError =>
  !!s.server.machine && e instanceof MCPError
// A challenge to sign in, which only a server on the public internet makes: a
// machine's tunnel is its owner's already.
let challenged = (
  s: GraphServer,
  e: unknown,
): e is MCPAuthorizationRequired =>
  !s.server.machine && e instanceof MCPAuthorizationRequired
// The address of a server on the public internet, as it is kept.
let https = (said: string) => {
  let url: URL
  try {
    url = new URL(said)
  } catch {
    throw refuse('arguments', 'An MCP server needs an HTTPS URL.')
  }
  if (url.protocol != 'https:' || url.username || url.password) {
    throw refuse(
      'arguments',
      'An MCP server needs an HTTPS URL without credentials.',
    )
  }
  return url.href
}
let comp = (row: Bundle | undefined, name: string) =>
  (row?.[name] ?? {}) as Comp
let integration = (id: string) => `mcp:${id}`
let input = { type: 'object', properties: {} }
let status = (s: GraphServer, description: string): RemoteCommand => ({
  at: integration(s.id),
  name: 'connection_status',
  namespace: s.server.namespace!,
  title: `Check ${s.label}`,
  description,
  readOnly: true,
  input,
})
// A server's schema as this host reads it. A graph's own MCP door says `ref`
// on each argument that takes an id, naming a kind in its graph, and a host
// resolves every `ref` it reads in its own (@yaks/tools `resolved`): left on,
// an id only the server knows is refused here before the call leaves.
let foreign = (schema: unknown): unknown =>
  Array.isArray(schema)
    ? schema.map(foreign)
    : schema && typeof schema == 'object'
    ? Object.fromEntries(
      Object.entries(schema)
        .filter(([k, v]) => k != 'ref' || typeof v != 'string')
        .map(([k, v]) => [k, foreign(v)]),
    )
    : schema
let described = (s: GraphServer, tools: Listed): RemoteCommand[] =>
  tools.map((t) => {
    nameOf(s.server.namespace!, t.name)
    return {
      at: integration(s.id),
      name: t.name,
      namespace: s.server.namespace!,
      ...s.server.machine ? { machine: s.server.machine } : {},
      title: `${s.label}: ${t.title ?? t.name}`,
      description: `[${s.label}] ${t.description ?? t.name}`,
      readOnly: t.annotations?.readOnlyHint === true,
      input: foreign(t.inputSchema) as typeof t.inputSchema,
    }
  })

/** One tool a server offers, with whether its allow list offers it. */
export type Choice = {
  name: string
  title: string
  description: string
  allowed: boolean
}

/** A person's MCP servers, as {@link remoteCommands} gives them. */
export type Remote = {
  set: (
    id: string,
    patch: { enabled?: boolean; allow?: string[] | null },
  ) => Promise<void>
  tools: (id: string) => Promise<Choice[]>
  shown: () => Promise<Shown[]>
  list: (at?: string) => Promise<RemoteCommand[]>
  call: (
    at: string,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Out>
  calls: (at: string, asks: Ask[]) => Promise<Asked[]>
  told: () => Promise<Told[]>
  configure: (
    settings: Settings,
  ) => Promise<{ server: string; commands: RemoteCommand[] }>
  give: (id: string, key: string) => Promise<void>
  remove: (id: string) => Promise<void>
  restore: (id: string) => Promise<void>
  kept: () => Promise<Bundle[]>
}

/** Each operation reads ownership anew; no roster retains authority. */
export let remoteCommands = (
  person: string,
  host: Host,
  options: Options = {},
): Remote => {
  // Every server the person keeps, those in the trash (`trashed{}`) too.
  let kept = async () =>
    person ? await host.graph.read(line`.mcp_server.owner=${person}&*`) : []
  let rows = async () => (await kept()).filter((r) => !r.trashed)
  let reached = async (s: GraphServer): Promise<Reached | null> => {
    if (!s.server.machine) return s
    let fetch = await host.machine?.(s.server.machine)
    return fetch ? { ...s, fetch } : null
  }
  let servers = async () => {
    let all = (await Promise.all(
      (await rows()).map(serverOf).filter((s) => s != null).map(reached),
    )).filter((s) => s != null)
    checkNamespaces(all.map((s) => s.server))
    return all
  }
  let owned = async (id: string) => {
    let found = (await servers()).find((s) => s.id == id)
    if (!found) {
      throw refuse('access', 'This MCP server is not connected for you.')
    }
    return found
  }
  // The server's integration as one a person gives a key to: no sign-in, and
  // the key sent to the server's host alone. One it signed in through before
  // becomes this, and its connection asks for a key.
  let keying = (s: GraphServer) =>
    host.graph.apply([{
      entity: { eid: integrationEid(integration(s.id)) },
      integration: {
        name: integration(s.id),
        owner: person,
        title: s.label,
        resource: s.server.url,
        hosts: [new URL(s.server.url).hostname],
        authorize: null,
        token: null,
        client_id: null,
        scopes: null,
        issuer: null,
        userinfo: null,
        auth: null,
      },
    }])
  // The person's connection to a server's integration, asked for where they
  // hold none.
  let holding = async (s: GraphServer) => {
    let name = integration(s.id)
    let b = await pick(host.graph.read, person, name)
    if (b) return b
    await host.graph.apply(
      await need(host.graph.read, { owner: person, integration: name }),
    )
    return await pick(host.graph.read, person, name)
  }
  let authorization = async (
    s: GraphServer,
    challenge: MCPAuthorizationRequired['challenge'] = {},
  ): Promise<Out> => {
    await owned(s.id)
    let name = integration(s.id)
    let i = await known(host.graph.read, name)
    if (i && (i.owner != person || i.resource != s.server.url)) {
      throw refuse(
        'access',
        'This MCP credential belongs to another connection.',
      )
    }
    let found = i ? undefined : await discover(
      s.server.url,
      challenge,
      options.fetch,
    ).catch((e) => {
      // A server that asks for a credential and names no sign-in takes a key.
      if (e instanceof AuthorizationError) return undefined
      throw e
    })
    if (!i && !found) await keying(s)
    if (found) {
      let client = s.server.oauth?.clientId ??
        await found.register(host.redirect!)
      await host.graph.apply([{
        entity: { eid: integrationEid(name) },
        integration: {
          ...found.integration,
          name,
          owner: person,
          title: s.label,
          client_id: client,
          auth: 'post',
        },
      }])
    } else if (
      i && !keyed(i) && s.server.oauth?.clientId &&
      i.client_id != s.server.oauth.clientId
    ) {
      await host.graph.apply([{
        entity: { eid: integrationEid(name) },
        integration: { client_id: s.server.oauth.clientId },
      }])
    }
    let held = await holding(s)
    if (
      held &&
      (comp(held, 'connection').status == 'connected' || challenge.scope)
    ) {
      let scopes = comp(held, 'connection').scopes as string[] ?? []
      await host.graph.apply([{
        entity: held.entity,
        connection: {
          ...comp(held, 'connection').status == 'connected'
            ? { status: 'broken' }
            : {},
          ...challenge.scope
            ? {
              scopes: [...new Set([...scopes, ...challenge.scope.split(' ')])],
            }
            : {},
        },
      }])
    }
    let link = `${host.signIn}#${encodeURIComponent(name)}`
    let key = i ? keyed(i) : !found
    return {
      text: `${
        key ? `${s.label} takes a key: give it` : `Sign in to ${s.label}`
      } at ${link}, then ask again. No call was retried.`,
      value: {
        authorization: {
          server: s.id,
          connection: held?.entity.eid,
          url: link,
        },
      },
    }
  }
  // A connection to the server; `every` lists its tools past its allow list,
  // for the person choosing them.
  let using = async <T>(
    s: Reached,
    run: (c: ReturnType<typeof client>) => Promise<T>,
    every = false,
  ) => {
    let c = client(
      every ? { ...s.server, allow: undefined } : s.server,
      s.fetch ? { ...options, fetch: s.fetch } : {
        ...options,
        token: async () => {
          let current = await owned(s.id)
          if (JSON.stringify(current.server) != JSON.stringify(s.server)) {
            throw refuse(
              'access',
              'The MCP connection changed; discover its tools again.',
            )
          }
          let i = await known(host.graph.read, integration(s.id))
          if (i && (i.owner != person || i.resource != s.server.url)) {
            throw refuse(
              'access',
              'This MCP credential belongs to another connection.',
            )
          }
          let held = await pick(host.graph.read, person, integration(s.id))
          if (!held || comp(held, 'connection').status != 'connected') {
            return null
          }
          return await credential(host, held.entity.eid) ?? null
        },
      },
    )
    try {
      return await run(c)
    } finally {
      await c.close().catch(host.report)
    }
  }
  let listing = async (s: Reached): Promise<RemoteCommand[]> => {
    try {
      return await using(s, async (c) => described(s, await c.list()))
    } catch (e) {
      let auth = challenged(s, e)
      let description =
        `${s.label} is unavailable. Check the connection to discover its tools again.`
      if (challenged(s, e)) {
        try {
          description = (await authorization(s, e.challenge)).text
        } catch (failure) {
          host.report(failure)
          auth = false
        }
      } else if (!away(s, e)) host.report(e)
      return [{
        at: integration(s.id),
        name: auth ? 'sign_in' : 'connection_status',
        namespace: s.server.namespace!,
        title: auth ? `Sign in to ${s.label}` : `Check ${s.label}`,
        description,
        readOnly: true,
        input,
      }]
    }
  }
  let list = async (at = ''): Promise<RemoteCommand[]> => {
    let all = (await servers()).filter((s) => !at || integration(s.id) == at)
    let commands = (await Promise.all(all.map(listing))).flat()
    let names = commands.map((c) => nameOf(c.namespace, c.name))
    try {
      checkToolNames(names.map((name) => ({ name })))
      return commands
    } catch (e) {
      host.report(e)
      let duplicates = new Set(
        names.filter((name, i) => names.indexOf(name) != i),
      )
      let affected = new Set(
        commands.filter((_, i) => duplicates.has(names[i])).map((c) => c.at),
      )
      return [
        ...commands.filter((c) => !affected.has(c.at)),
        ...all.filter((s) => affected.has(integration(s.id))).map((s) =>
          status(
            s,
            `${s.label}'s tool names collide with another server. Use mcp_connect to give it a distinct name.`,
          )
        ),
      ]
    }
  }
  // One ask on a connection already open, sent as it was asked: the server's
  // tools are listed only for its own status, or to say why a call failed,
  // so a call through a tunnel costs one request on the connection, not two.
  let asked = async (
    s: Reached,
    c: ReturnType<typeof client>,
    { name, args }: Ask,
  ): Promise<Out> => {
    if (name == 'connection_status') {
      let tools = await c.list()
      if (!tools.some((t) => t.name == name)) {
        let commands = described(s, tools)
        return { text: '', value: { commands } }
      }
    }
    let reply: Awaited<ReturnType<typeof c.call>>
    try {
      reply = await c.call(name, args)
    } catch (e) {
      let tools = await c.list().catch(() => null)
      if (tools && !tools.some((t) => t.name == name)) {
        throw refuse('missing', `${s.label} has no command ${name}.`)
      }
      throw e
    }
    // The reply's text blocks are its words; the value keeps the rest of the
    // reply (its structured answer, isError, images) so the words ride once.
    let blocks = reply.content as { type: string; text?: string }[]
    let words = blocks.filter((b) => b.type == 'text')
    let text = words.map((b) => b.text).join('\n') || unsaid(reply) || ''
    let content = blocks.filter((b) => b.type != 'text')
    return { text, value: { ...reply, content } }
  }
  // What an ask that failed answers: a sign-in, a server that is away, or
  // the failure itself.
  let failed = async (s: Reached, name: string, e: unknown): Promise<Out> => {
    if (challenged(s, e)) return await authorization(s, e.challenge)
    if (name != 'connection_status') {
      throw away(s, e) ? refuse('unavailable', `${s.label}: ${e.message}`) : e
    }
    if (!away(s, e)) host.report(e)
    return {
      text: `${s.label} is unavailable; try this command again later.`,
      value: { unavailable: true },
    }
  }
  // Several asks of one server, all at once on one connection, each answered
  // or failed on its own: a page reading three lists from a machine opens
  // the tunnel's connection once, not three times.
  let calls = async (at: string, asks: Ask[]): Promise<Asked[]> => {
    let s = await owned(at.slice('mcp:'.length))
    let settled = await using(
      s,
      (c) => Promise.allSettled(asks.map((ask) => asked(s, c, ask))),
    )
    return Promise.all(
      settled.map((r, i) =>
        r.status == 'fulfilled'
          ? { out: r.value }
          : failed(s, asks[i].name, r.reason).then(
            (out) => ({ out }),
            (error: unknown) => ({ error }),
          )
      ),
    )
  }
  let call = async (
    at: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Out> => {
    let [r] = await calls(at, [{ name, args }])
    if ('error' in r) throw r.error
    return r.out
  }
  // What each server the person reaches says to read before its tools (the
  // protocol's `instructions`). One that cannot be reached says nothing; its
  // tools say why where they are listed.
  let told = async (): Promise<Told[]> =>
    (await Promise.all((await servers()).map(async (s) => {
      try {
        let text = (await using(s, (c) => c.instructions()))?.trim()
        return text
          ? [{
            label: s.label,
            namespace: s.server.namespace!,
            text: cut(text),
          }]
          : []
      } catch (e) {
        if (!challenged(s, e) && !away(s, e)) host.report(e)
        return []
      }
    }))).flat()
  let configure = async (settings: Settings) => {
    if (!person) throw refuse('access', 'Sign in to connect an MCP server.')
    let { machine } = settings
    if (machine && !await host.machine?.(machine)) {
      let owned = (await host.owned?.() ?? []).sort()
      throw refuse(
        'access',
        `Only the owner of a space connects an MCP server on its machine, and ${machine} is not a space you own${
          owned.length
            ? `: name one of ${owned.join(', ')}`
            : '; you own no space'
        }.`,
      )
    }
    if (machine && settings.header) {
      throw refuse(
        'arguments',
        'A server on a machine is reached through its tunnel and takes no key.',
      )
    }
    let url = machine ? settings.url : https(settings.url)
    let all = await rows()
    // The same server again, one in the trash too, which this brings back.
    let same = (await kept()).find((r) => {
      let c = comp(r, 'mcp_server')
      return c.url == url && (c.machine ?? undefined) == machine
    })
    let row = {
      entity: { eid: same?.entity.eid ?? mint() },
      mcp_server: {
        owner: person,
        name: settings.name,
        url,
        ...machine ? { machine } : {},
        enabled: settings.enabled ?? true,
        ...settings.allow ? { allow: JSON.stringify(settings.allow) } : {},
        ...settings.client_id ? { client_id: settings.client_id } : {},
        ...settings.header !== undefined
          ? { header: settings.header?.trim() || null }
          : {},
      },
      ...settings.mentions !== undefined
        ? { mentions: settings.mentions ? { url: settings.mentions } : null }
        : {},
      ...same?.trashed ? { trashed: null } : {},
    }
    let next: GraphServer | undefined
    try {
      next = serverOf(row)
      if (next) nameOf(next.server.namespace!, 'connection_status')
      checkNamespaces([
        ...all.filter((r) => r.entity.eid != row.entity.eid)
          .map(serverOf).filter((s) => s != null).map((s) => s.server),
        ...next ? [next.server] : [],
      ])
    } catch (e) {
      throw refuse('arguments', e instanceof Error ? e.message : String(e))
    }
    // The server's lists, where they were said, are these and no others.
    let lists = settings.lists
      ? [
        ...(await host.graph.read(line`.mcp_list.server=${row.entity.eid}`))
          .map(
            (b): Bundle => ({ entity: b.entity, $delete: true }),
          ),
        ...settings.lists.map((l, ord): Bundle => ({
          entity: { eid: mint() },
          doc: { title: l.title },
          mcp_list: {
            server: row.entity.eid,
            tool: l.tool,
            args: JSON.stringify(l.args),
            waits: l.waits,
            ord,
          },
        })),
      ]
      : []
    await host.graph.apply([row, ...lists])
    // A server said to take a key in a header asks for one now, rather
    // than at its first refusal.
    if (next && row.mcp_server.header) {
      let i = await known(host.graph.read, integration(next.id))
      if (!i || !keyed(i)) await keying(next)
      await holding(next)
    }
    return {
      server: row.entity.eid,
      commands: row.mcp_server.enabled
        ? await list(integration(row.entity.eid))
        : [],
    }
  }
  /** Keep `key` as the credential of the person's server `id`, which it
   * then takes instead of a sign-in. */
  let give = async (id: string, key: string) => {
    let row = (await rows()).find((r) => r.entity.eid == id)
    if (!row) {
      throw refuse('missing', 'This MCP server is not connected for you.')
    }
    let s = serverOf({
      ...row,
      mcp_server: { ...comp(row, 'mcp_server'), enabled: true },
    })!
    if (s.server.machine) {
      throw refuse(
        'arguments',
        'A server on a machine is reached through its tunnel and takes no key.',
      )
    }
    let i = await known(host.graph.read, integration(id))
    if (!i || !keyed(i)) await keying(s)
    let b = await holding(s)
    await connect(host, b!.entity.eid, { key })
  }
  /** Put the person's server `id` in the trash: its tools and lists go with
   * it, and its credential stays, so `restore` brings it all back. */
  let remove = async (id: string) => {
    let row = (await rows()).find((r) => r.entity.eid == id)
    if (!row) {
      throw refuse('missing', 'This MCP server is not connected for you.')
    }
    await host.graph.apply([{ entity: row.entity, trashed: {} }])
  }
  /** Bring the person's server `id` back out of the trash. */
  let restore = async (id: string) => {
    let row = (await kept()).find((r) => r.entity.eid == id && r.trashed)
    if (!row) throw refuse('missing', 'This MCP server is not in your trash.')
    let back = serverOf(row)
    try {
      checkNamespaces([
        ...(await rows()).map(serverOf).filter((s) => s != null),
        ...back ? [back] : [],
      ].map((s) => s.server))
    } catch {
      throw refuse(
        'conflict',
        `Another of your MCP servers has the name ${
          comp(row, 'mcp_server').name
        }; rename one of them first.`,
      )
    }
    await host.graph.apply([{ entity: row.entity, trashed: null }])
  }
  /** Turn the person's server `id` on or off, or say which of its tools are
   * offered: `allow` null offers every one. */
  let set = async (
    id: string,
    patch: { enabled?: boolean; allow?: string[] | null },
  ) => {
    let row = (await rows()).find((r) => r.entity.eid == id)
    if (!row) {
      throw refuse('missing', 'This MCP server is not connected for you.')
    }
    await host.graph.apply([{
      entity: row.entity,
      mcp_server: {
        ...patch.enabled != null ? { enabled: patch.enabled } : {},
        ...patch.allow !== undefined
          ? { allow: patch.allow && JSON.stringify(patch.allow) }
          : {},
      },
    }])
  }
  /** Every tool the person's server `id` offers, those its allow list leaves
   * out too, each with whether it is offered. */
  let tools = async (id: string): Promise<Choice[]> => {
    let s = await owned(id)
    let allow = s.server.allow
    return (await using(s, (c) => c.list(), true)).map((t) => ({
      name: t.name,
      title: t.title ?? t.name,
      description: t.description ?? '',
      allowed: !allow || allow.includes(t.name),
    }))
  }
  /** Each server the person keeps, as their page shows it. */
  let shown = async (): Promise<Shown[]> =>
    await Promise.all((await kept()).map(async (row) => {
      let c = comp(row, 'mcp_server')
      let allow = c.allow == null ? undefined : JSON.parse(String(c.allow))
      let name = integration(row.entity.eid)
      let [held, i] = c.machine ? [] : await Promise.all([
        pick(host.graph.read, person, name),
        known(host.graph.read, name),
      ])
      return {
        id: row.entity.eid,
        name: String(c.name),
        url: String(c.url),
        ...c.machine ? { machine: String(c.machine) } : {},
        enabled: c.enabled !== false,
        ...allow ? { allow } : {},
        ...c.header ? { header: String(c.header) } : {},
        trashed: !!row.trashed,
        status: c.machine
          ? 'machine'
          : (comp(held, 'connection').status as Shown['status']) ?? 'open',
        ...held ? { connection: held.entity.eid } : {},
        ...i ? { keyed: keyed(i) } : {},
      }
    }))
  return {
    set,
    tools,
    shown,
    list,
    call,
    calls,
    told,
    configure,
    give,
    remove,
    restore,
    kept,
  }
}

/** What a form on a person's connections page does to their MCP servers,
 * named by `do` (`mcp-add`, `mcp-key`, `mcp-tools`, `mcp-on`, `mcp-off`,
 * `mcp-remove`, `mcp-restore`), with the server it is about in `server`. It
 * answers what the page says, and null for a form about something else. */
export let acted = async (
  remote: Remote,
  act: string,
  field: (name: string) => string,
  fields: (name: string) => string[],
): Promise<string | null> => {
  let id = field('server')
  if (act == 'mcp-add') {
    let made = await remote.configure({
      name: field('name'),
      url: field('url'),
      ...field('header') ? { header: field('header') } : {},
    })
    if (field('key')) await remote.give(made.server, field('key'))
    return `${field('name')} is connected.`
  }
  if (act == 'mcp-key') {
    if (!field('key')) throw refuse('arguments', 'Paste the key.')
    await remote.give(id, field('key'))
    return 'Saved. The key is kept safe and never shown again.'
  }
  if (act == 'mcp-tools') {
    let every = (await remote.tools(id)).map((t) => t.name)
    let chosen = fields('tool').filter((t) => every.includes(t))
    await remote.set(id, {
      allow: chosen.length == every.length ? null : chosen,
    })
    return chosen.length == every.length
      ? 'Every tool it offers is offered to your agents and apps.'
      : `${chosen.length} of its ${every.length} tools are offered.`
  }
  if (act == 'mcp-on' || act == 'mcp-off') {
    await remote.set(id, { enabled: act == 'mcp-on' })
    return act == 'mcp-on' ? 'Turned on.' : 'Turned off.'
  }
  if (act == 'mcp-remove') {
    await remote.remove(id)
    return 'Moved to the trash. Restore it from the trash below.'
  }
  if (act == 'mcp-restore') {
    await remote.restore(id)
    return 'Restored.'
  }
  return null
}
