import { argsOf, type Bundle, type Graph, type Tool } from '@yaks/graph'
import { valued } from '@yaks/tools/value'
import { CallError } from '@yaks/tools/errors'
import { resultDoor } from './build-door.ts'
import { opened } from './anon.ts'
import { queryResult } from './result-query.ts'
import { keepResult, readResult } from './results.ts'
import { APP, type Args, type Ctx, inSpace, SPACE } from './tool.ts'

/** A running Operator already stands inside the space's durable graph. */
export type ResultHost = { graph: Graph; person: string; space: string }

export let resultStore = (ctx: Ctx, args: Args = {}, local?: ResultHost) => {
  let publicly = async (path: string, body: Record<string, unknown>) => {
    let [{ space, app }] = await opened(ctx, args)
    let value = await resultDoor(
      ctx.env,
      space,
      'public:' + app.eid,
      path,
      body,
    )
    return value && typeof value == 'object' && 'id' in value
      ? { ...value, space: space.slug, app: app.slug }
      : value
  }
  let door = async (path: string, body: Record<string, unknown>) => {
    // Public directory tools have no app or person's space. Their snapshots
    // share one system graph, separate from every person's private results.
    if (
      !args.space && !args.app && (!ctx.person || args.scope == 'catalogue')
    ) {
      let value = await resultDoor(
        ctx.env,
        { eid: 'public-results' },
        'public:catalogue',
        path,
        body,
      )
      return value && typeof value == 'object' && 'id' in value
        ? {
          ...value,
          scope: 'catalogue',
          message:
            'The complete public result is kept in the catalogue graph. ' +
            'Use result_query({scope:"catalogue", id, query}) with jq syntax to narrow it. The preview is abbreviated.',
        }
        : value
    }
    if (!ctx.person) return publicly(path, body)
    let slug = args.space ?? ctx.entered?.space.slug ??
      (await ctx.dir.narrowedTo())?.slug ?? (await ctx.dir.own(ctx.person)).slug
    let admitted
    try {
      admitted = await inSpace(ctx, { ...args, space: slug }, false, true)
    } catch (error) {
      if (
        error instanceof CallError && error.code == 'access' && args.space &&
        args.app
      ) {
        return publicly(path, body)
      }
      throw error
    }
    let { space } = admitted
    let value = await resultDoor(ctx.env, space, ctx.person, path, body)
    return value && typeof value == 'object' && 'id' in value
      ? { ...value, space: space.slug }
      : value
  }
  return {
    keep: async (value: unknown, source: Bundle) =>
      local
        ? await keepResult(local.graph, value, source, local.person)
        : await door('keep', { value, source: source.entity.eid }),
    read: async (id: string) =>
      local
        ? await readResult(local.graph, id, local.person)
        : await door('read', { id }),
    query: async (id: string, query: string, source: Bundle) =>
      local
        ? await queryResult(local.graph, id, query, source, local.person)
        : await door('query', { id, query, source: source.entity.eid }),
  }
}

export let resultTools = (ctx: Ctx, local?: ResultHost): Tool[] => [{
  name: 'result_query',
  title: 'Query kept result',
  description: 'Run a jq filter against a complete tool result kept by id in ' +
    'this space. Returns {values: [...]} for the jq output stream. Use .result ' +
    'for ordinary graph answers; custom tool answers keep their exact data under ' +
    '.structuredContent, with text in .content. Use .values for a previous query and the shape.path ' +
    'in the saved result summary. Supports select, map, slices, projections, ' +
    'sort_by, group_by, length and other jq filters. Large query outputs are ' +
    'kept again with an id and preview. code_mode can also await results.read(id).',
  inputSchema: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      scope: {
        type: 'string',
        enum: ['catalogue'],
        description:
          'Use catalogue for a kept result from an anonymous public directory tool, as its summary indicates.',
      },
      id: { type: 'string', description: 'The kept result entity id.' },
      query: {
        type: 'string',
        description: 'A jq filter, for example .result[:3] | map(.entity.eid)',
      },
    },
    required: ['id', 'query'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object' },
  readOnly: true,
  run: async (call) => {
    let args = argsOf(call)
    return [valued(
      call,
      await resultStore(ctx, args, local).query(
        String(args.id),
        String(args.query),
        call,
      ),
    )]
  },
}]
