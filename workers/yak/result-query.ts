import { run } from '@gabrielbryk/jq-ts'
import type { Bundle, Graph } from '@yaks/graph'
import { readResult, retainResult } from './results.ts'
import { RESULT_MAX } from './result-view.ts'
import { refuse } from './tool.ts'

/** jq is interpreted by the library, with bounded work even for recursive filters. */
export let queryResult = async (
  g: Graph,
  id: string,
  query: string,
  source: Bundle,
  person: string,
) => {
  let value = await readResult(g, id, person)
  let values
  try {
    values = run(query, value as Parameters<typeof run>[1], {
      limits: { maxSteps: 1_000_000, maxDepth: 128, maxOutputs: RESULT_MAX },
    })
  } catch (error) {
    throw refuse('arguments', 'jq query failed: ' + (error as Error).message)
  }
  return retainResult(g, { values }, source, person)
}
