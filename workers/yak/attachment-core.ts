import { argsOf, type Bundle, type Tool } from '@yaks/graph'
import { core, type CoreOpts, inputSchemaOf } from '@yaks/mcp'
import { operatorDoor } from './build-door.ts'
import { type Ctx, inSpace, SPACE } from './tool.ts'

/** The connector's ordinary graph tools, with a read of one's Operator
 * attachments available explicitly on graph_query. */
export let attachmentCore = (ctx: Ctx, opts: CoreOpts): Tool[] =>
  core(opts).map((tool) => {
    if (tool.name != 'graph_query') return tool
    let schema = inputSchemaOf(tool)
    return {
      ...tool,
      inputSchema: {
        ...schema,
        properties: {
          ...schema.properties as Record<string, unknown>,
          space: SPACE,
          self: {
            type: 'boolean',
            description:
              'Query your Operator attachment and artifact metadata in this space.',
          },
        },
      },
      run: async (call, graph) => {
        let { self, ...args } = argsOf(call)
        if (!self) return tool.run(call, graph)
        let { space, who } = await inSpace(ctx, args)
        return await operatorDoor(
          ctx.env,
          space,
          who,
          'attachments',
          { ...args, queryCall: call.entity.eid },
        ) as Bundle[]
      },
    }
  })
