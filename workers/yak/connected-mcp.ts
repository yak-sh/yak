import { ctxOf } from './connections.ts'
import { caught } from './defects.ts'
import { url } from '@yaks/platform/host'
import { type Ask, type Offered, remoteCommands } from './mcp-remote.ts'
import { asCaller, type Ctx, refuse, str } from './tool.ts'
import type { Row } from './tool-words.ts'
import type { Calling } from './tunnel.ts'
import { argsOf, type Tool as GraphTool } from '@yaks/graph'
import { nameOf } from '@yaks/mcp-client'

export type { Calling }

// The tunnel's code is loaded by the first server on a machine, which almost
// nobody has.
let commands = (ctx: Ctx, asking?: Calling) =>
  remoteCommands(ctx.person, {
    ...ctxOf(ctx.env, asCaller(ctx, null)),
    report: (e) => caught(e, { request: 'connected MCP' }),
    signIn: url(ctx.env, '/manage/connections'),
    machine: async (space) =>
      (await import('./tunnel.ts')).machine(ctx.env, space, ctx.person, asking),
    owned: async () =>
      (await ctx.dir.seats(ctx.person, 'owner')).map((s) => s.space.slug),
  })

export let listConnectedCommands = (ctx: Ctx, said = '', asking?: Calling) =>
  commands(ctx, asking).list(said)
export let runConnectedCommand = (
  ctx: Ctx,
  said: string,
  name: string,
  args: Record<string, unknown>,
  asking?: Calling,
) => commands(ctx, asking).call(said, name, args)
/** Several commands of one connected server, asked at once on one
 * connection, each answered or failed on its own. */
export let runConnectedCommands = (
  ctx: Ctx,
  said: string,
  asks: Ask[],
  asking?: Calling,
) => commands(ctx, asking).calls(said, asks)

/** What the servers a person connected say to read before their tools, as
 * the instructions of the Operator `asking` names: each server's own text
 * under its name, and nothing where none said any. A person's servers are
 * listed for that person alone, and one on a machine only for the Operator
 * of the space whose tunnel reaches it. */
export let connectedInstructions = async (
  ctx: Ctx,
  asking?: Calling,
): Promise<string> =>
  (await commands(ctx, asking).told()).map(({ label, namespace, text }) =>
    `## ${label}\n\nThe MCP server ${label}, which the person you work for connected, says this of its tools (named ${namespace}__…):\n\n${text}`
  ).join('\n\n')

/** The same commands as named tools inside an Operator or code execution.
 * `asking` is who they are offered to, an Operator and its conversation or
 * else the person's connector, which a machine is told with each request. */
export let connectedTools = async (
  ctx: Ctx,
  asking?: Calling,
): Promise<GraphTool[]> =>
  (await listConnectedCommands(ctx, '', asking)).map((command) => ({
    name: nameOf(command.namespace, command.name),
    title: command.title,
    description: command.description,
    inputSchema: command.input as Record<string, unknown>,
    readOnly: command.readOnly,
    openWorld: true,
    meta: {
      server: command.at,
      remoteName: command.name,
      namespace: command.namespace,
      ...command.machine ? { machine: command.machine } : {},
    },
    run: async (call) => {
      let out = await runConnectedCommand(
        ctx,
        command.at,
        command.name,
        argsOf(call),
        asking,
      )
      return [{
        entity: { eid: '$said' },
        content: { body: out.text },
        output: { source: call.entity.eid, value: out.value },
        ...out.value?.isError ? { refusal: { code: 'mcp_tool' } } : {},
      }]
    },
  }))

// The lists a server offers the person's Operator page, as mcp_connect takes
// them: none said leaves them, and each said replaces them all.
let offered = (said: unknown): { lists?: Offered[] } => {
  if (!Array.isArray(said)) return {}
  return {
    lists: said.map((l: Record<string, unknown>) => {
      let { title, tool, args, waits } = l ?? {}
      if (!String(title ?? '').trim() || !String(tool ?? '').trim()) {
        throw refuse('arguments', 'Each list says its title and its tool.')
      }
      if (args != null && (typeof args != 'object' || Array.isArray(args))) {
        throw refuse('arguments', 'A list’s args is an object.')
      }
      return {
        title: String(title).trim(),
        tool: String(tool).trim(),
        args: (args ?? {}) as Record<string, unknown>,
        waits: waits === true,
      }
    }),
  }
}

export let mcpConnect: Row = {
  name: 'mcp_connect',
  destructive: false,
  idempotent: true,
  openWorld: true,
  input: {
    type: 'object',
    properties: {
      name: str('A short, distinct name for this MCP server.'),
      url: str(
        'The HTTPS Streamable HTTP MCP endpoint; with machine, its path on that machine, such as /mcp.',
      ),
      machine: str(
        'A space you own whose tunnel goes to the machine this server runs on, by its slug. The server is then reached through the tunnel with no sign-in, and only for you.',
      ),
      client_id: str(
        'An existing public OAuth client id, when the server does not support registration.',
      ),
      enabled: { type: 'boolean', description: 'False disconnects its tools.' },
      allow: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Exact remote tool names to expose; omission keeps the existing selection.',
      },
      lists: {
        type: 'array',
        description:
          "The lists this server offers your Operator's page, drawn beside the conversation in this order with no model turn: each the server's tool called with args, whose rows are shown in its order. They replace the lists set before; [] removes them, and omission keeps them.",
        items: {
          type: 'object',
          properties: {
            title: str('What the list is called, such as What needs you.'),
            tool: str('The tool that answers its rows, such as task_list.'),
            args: {
              type: 'object',
              description:
                "What the tool is called with, in the server's own words, such as { query: '.task.status=open' }.",
            },
            waits: {
              type: 'boolean',
              description:
                'True where its rows wait on you, so the count beside the conversation and on the installed page includes them.',
            },
          },
          required: ['title', 'tool'],
        },
      },
      mentions: str(
        "Where an id this server's rows carry, such as T-123, opens: an address with {id} where the id goes, such as https://tasks.yak.sh/{id}. Each such id in your Operator's replies is then a link there. An empty one links none.",
      ),
    },
    required: ['name', 'url'],
  },
  run: async (ctx, args) => {
    let on = typeof args.machine == 'string'
      ? await ctx.dir.space(args.machine)
      : undefined
    if (on === null) {
      throw refuse('missing', `No space is called ${args.machine}.`)
    }
    // A server on a machine is there for the space's Operator, and the
    // machine may open it to no other caller: its tools are discovered as
    // that Operator sees them.
    let asking: Calling | undefined = on
      ? { caller: 'operator', space: on.eid }
      : undefined
    let value = await commands(ctx, asking).configure({
      name: String(args.name),
      url: String(args.url),
      ...on ? { machine: on.eid } : {},
      ...typeof args.client_id == 'string' ? { client_id: args.client_id } : {},
      ...typeof args.enabled == 'boolean' ? { enabled: args.enabled } : {},
      ...Array.isArray(args.allow) ? { allow: args.allow.map(String) } : {},
      ...offered(args.lists),
      ...typeof args.mentions == 'string'
        ? { mentions: args.mentions.trim() || null }
        : {},
    })
    return { text: '', value }
  },
}
