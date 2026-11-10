// Person-owned remote commands. The host supplies graph, vault and transport;
// OAuth and invocation remain in the existing connections and MCP packages.
import {
  credential,
  type Ctx,
  integrationEid,
  known,
  need,
  pick,
} from '@yaks/connections'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import {
  checkNamespaces,
  checkToolNames,
  connect,
  MCPAuthorizationRequired,
  nameOf,
  type Options,
  unsaid,
} from '@yaks/mcp-client'
import { discover } from '@yaks/mcp-client/oauth'
import { type GraphServer, serverOf } from '@yaks/mcp-client/servers'
import { type Out, refuse } from './tool.ts'
import type { Command } from './declared.ts'

type Host = Ctx & { report: (e: unknown) => void; signIn: string }
type Settings = {
  name: string
  url: string
  enabled?: boolean
  allow?: string[]
  client_id?: string
}
type RemoteCommand = Command & { namespace: string }
type Listed = Awaited<ReturnType<ReturnType<typeof connect>['list']>>
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
let described = (s: GraphServer, tools: Listed): RemoteCommand[] =>
  tools.map((t) => {
    nameOf(s.server.namespace!, t.name)
    return {
      at: integration(s.id),
      name: t.name,
      namespace: s.server.namespace!,
      title: `${s.label}: ${t.title ?? t.name}`,
      description: `[${s.label}] ${t.description ?? t.name}`,
      readOnly: t.annotations?.readOnlyHint === true,
      input: t.inputSchema,
    }
  })

/** Each operation reads ownership anew; no roster retains authority. */
export let remoteCommands = (
  person: string,
  host: Host,
  options: Options = {},
) => {
  let rows = async () =>
    person ? await host.graph.read(`.mcp_server.owner=${person}&*`) : []
  let servers = async () => {
    let all = (await rows()).map(serverOf).filter((s) => s != null)
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
    if (!i) {
      let found = await discover(s.server.url, challenge, options.fetch)
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
      s.server.oauth?.clientId && i.client_id != s.server.oauth.clientId
    ) {
      await host.graph.apply([{
        entity: { eid: integrationEid(name) },
        integration: { client_id: s.server.oauth.clientId },
      }])
    }
    let held = await pick(host.graph.read, person, name)
    if (!held) {
      await host.graph.apply(
        await need(host.graph.read, {
          owner: person,
          integration: name,
        }),
      )
      held = await pick(host.graph.read, person, name)
    }
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
    return {
      text:
        `Sign in to ${s.label} at ${link}, then ask again. No call was retried.`,
      value: {
        authorization: {
          server: s.id,
          connection: held?.entity.eid,
          url: link,
        },
      },
    }
  }
  let using = async <T>(
    s: GraphServer,
    run: (c: ReturnType<typeof connect>) => Promise<T>,
  ) => {
    let client = connect(s.server, {
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
        if (!held || comp(held, 'connection').status != 'connected') return null
        return await credential(host, held.entity.eid) ?? null
      },
    })
    try {
      return await run(client)
    } finally {
      await client.close().catch(host.report)
    }
  }
  let listing = async (s: GraphServer): Promise<RemoteCommand[]> => {
    try {
      return await using(s, async (c) => described(s, await c.list()))
    } catch (e) {
      let auth = e instanceof MCPAuthorizationRequired
      let description =
        `${s.label} is unavailable. Check the connection to discover its tools again.`
      if (e instanceof MCPAuthorizationRequired) {
        try {
          description = (await authorization(s, e.challenge)).text
        } catch (failure) {
          host.report(failure)
          auth = false
        }
      } else host.report(e)
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
  let call = async (
    at: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Out> => {
    let s = await owned(at.slice('mcp:'.length))
    try {
      return await using(s, async (c) => {
        let tools = await c.list()
        if (name == 'connection_status' && !tools.some((t) => t.name == name)) {
          let commands = described(s, tools)
          return { text: JSON.stringify(commands), value: { commands } }
        }
        if (!tools.some((t) => t.name == name)) {
          throw refuse('missing', `${s.label} has no command ${name}.`)
        }
        let reply = await c.call(name, args)
        let text = reply.content.filter((b) => b.type == 'text')
          .map((b) => b.text).join('\n') || unsaid(reply) || ''
        return { text, value: reply }
      })
    } catch (e) {
      if (e instanceof MCPAuthorizationRequired) {
        return authorization(s, e.challenge)
      }
      if (name != 'connection_status') throw e
      host.report(e)
      return {
        text: `${s.label} is unavailable; try this command again later.`,
        value: { unavailable: true },
      }
    }
  }
  let configure = async (settings: Settings) => {
    if (!person) throw refuse('access', 'Sign in to connect an MCP server.')
    let url: URL
    try {
      url = new URL(settings.url)
    } catch {
      throw refuse('arguments', 'An MCP server needs an HTTPS URL.')
    }
    if (url.protocol != 'https:' || url.username || url.password) {
      throw refuse(
        'arguments',
        'An MCP server needs an HTTPS URL without credentials.',
      )
    }
    let all = await rows()
    let same = all.find((r) => comp(r, 'mcp_server').url == url.href)
    let row = {
      entity: { eid: same?.entity.eid ?? mint() },
      mcp_server: {
        owner: person,
        name: settings.name,
        url: url.href,
        enabled: settings.enabled ?? true,
        ...settings.allow ? { allow: JSON.stringify(settings.allow) } : {},
        ...settings.client_id ? { client_id: settings.client_id } : {},
      },
    }
    try {
      let next = serverOf(row)
      if (next) nameOf(next.server.namespace!, 'connection_status')
      checkNamespaces([
        ...all.filter((r) => r.entity.eid != row.entity.eid)
          .map(serverOf).filter((s) => s != null).map((s) => s.server),
        ...next ? [next.server] : [],
      ])
    } catch (e) {
      throw refuse('arguments', e instanceof Error ? e.message : String(e))
    }
    await host.graph.apply([row])
    return {
      server: row.entity.eid,
      commands: row.mcp_server.enabled
        ? await list(integration(row.entity.eid))
        : [],
    }
  }
  return { list, call, configure }
}
