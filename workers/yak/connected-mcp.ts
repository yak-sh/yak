import { ctxOf } from './connections.ts'
import { caught } from './defects.ts'
import { url } from './host.ts'
import { remoteCommands } from './mcp-remote.ts'
import { asCaller, type Ctx, str } from './tool.ts'
import type { Row } from './tool-words.ts'
import { argsOf, type Tool as GraphTool } from '@yaks/graph'
import { nameOf } from '@yaks/mcp-client'

let commands = (ctx: Ctx) =>
  remoteCommands(ctx.person, {
    ...ctxOf(ctx.env, asCaller(ctx, null)),
    report: (e) => caught(e, { request: 'connected MCP' }),
    signIn: url(ctx.env, '/manage/connections'),
  })

export let listConnectedCommands = (ctx: Ctx, said = '') =>
  commands(ctx).list(said)
export let runConnectedCommand = (
  ctx: Ctx,
  said: string,
  name: string,
  args: Record<string, unknown>,
) => commands(ctx).call(said, name, args)

/** The same commands as named tools inside an Operator or code execution. */
export let connectedTools = async (ctx: Ctx): Promise<GraphTool[]> =>
  (await listConnectedCommands(ctx)).map((command) => ({
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
      url: str('The HTTPS Streamable HTTP MCP endpoint.'),
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
    let value = await commands(ctx).configure({
      name: String(args.name),
      url: String(args.url),
      ...typeof args.client_id == 'string' ? { client_id: args.client_id } : {},
      ...typeof args.enabled == 'boolean' ? { enabled: args.enabled } : {},
      ...Array.isArray(args.allow) ? { allow: args.allow.map(String) } : {},
    })
    return { text: JSON.stringify(value), value }
  },
}
