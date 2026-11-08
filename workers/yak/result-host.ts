import type { Graph } from '@yaks/graph'
import { keepResult, readResult } from './results.ts'

/** Result storage is bookkeeping after the kernel has authorized its reader. */
export let resultRequest = async (
  g: Graph,
  path: string,
  args: Record<string, unknown>,
  reader: string,
): Promise<Response | null> => {
  let source = { entity: { eid: String(args.source ?? crypto.randomUUID()) } }
  if (path == 'keep') {
    return Response.json(await keepResult(g, args.value, source, reader))
  }
  if (path == 'read') {
    return Response.json(await readResult(g, String(args.id), reader))
  }
  if (path == 'query') {
    let { queryResult } = await import('./result-query.ts')
    return Response.json(
      await queryResult(g, String(args.id), String(args.query), source, reader),
    )
  }
  return null
}
