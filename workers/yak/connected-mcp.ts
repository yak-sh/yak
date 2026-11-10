import { ctxOf } from './connections.ts'
import { caught } from './defects.ts'
import { url } from './host.ts'
import { remoteCommands } from './mcp-remote.ts'
import { asCaller, type Ctx, refuse, str } from './tool.ts'
import type { Row } from './tool-words.ts'
import type { machine } from './tunnel.ts'
import { argsOf, type Tool as GraphTool } from '@yaks/graph'
import { nameOf } from '@yaks/mcp-client'

/** The conversation commands are asked in, read when a call to a machine
 * needs it: an Operator's conversation, by its session's id. */
export type Via = Parameters<typeof machine>[3]

// The tunnel's code is loaded by the first server on a machine, which almost
// nobody has.
let commands = (ctx: Ctx, via?: Via) =>
  remoteCommands(ctx.person, {
    ...ctxOf(ctx.env, asCaller(ctx, null)),
    report: (e) => caught(e, { request: 'connected MCP' }),
    signIn: url(ctx.env, '/manage/connections'),
    machine: async (space) =>
      (await import('./tunnel.ts')).machine(ctx.env, space, ctx.person, via),
  })

export let listConnectedCommands = (ctx: Ctx, said = '', via?: Via) =>
  commands(ctx, via).list(said)
export let runConnectedCommand = (
  ctx: Ctx,
  said: string,
  name: string,
  args: Record<string, unknown>,
  via?: Via,
) => commands(ctx, via).call(said, name, args)

/** The same commands as named tools inside an Operator or code execution.
 * `via` is the conversation they are offered in, which a machine is told with
 * each request made there. */
export let connectedTools = async (
  ctx: Ctx,
  via?: Via,
): Promise<GraphTool[]> =>
  (await listConnectedCommands(ctx, '', via)).map((command) => ({
    name: nameOf(command.namespace, command.name),
    title: command.title,
    description: command.description,
    inputSchema: command.input as Record<string, unknown>,
    readOnly: command.readOnly,
    openWorld: true,
    meta: { server: command.at, remoteName: command.name },
    run: async (call) => {
      let out = await runConnectedCommand(
        ctx,
        command.at,
        command.name,
        argsOf(call),
        via,
      )
      return [{
        entity: { eid: '$said' },
        content: { body: out.text },
        output: { source: call.entity.eid, value: out.value },
        ...out.value?.isError ? { refusal: { code: 'mcp_tool' } } : {},
      }]
    },
  }))

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
    let value = await commands(ctx).configure({
      name: String(args.name),
      url: String(args.url),
      ...on ? { machine: on.eid } : {},
      ...typeof args.client_id == 'string' ? { client_id: args.client_id } : {},
      ...typeof args.enabled == 'boolean' ? { enabled: args.enabled } : {},
      ...Array.isArray(args.allow) ? { allow: args.allow.map(String) } : {},
    })
    return { text: JSON.stringify(value), value }
  },
}
