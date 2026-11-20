import type { Bundle, Graph } from '@yaks/graph'
import { readResult } from './results.ts'
import { jqOver } from '@yaks/context/result'
import { refuse } from './tool.ts'

/** A jq filter over a kept result (@yaks/context/result `jqOver`). */
export let queryResult = async (
  g: Graph,
  id: string,
  query: string,
  _source: Bundle,
  person: string,
) => {
  let value = await readResult(g, id, person)
  try {
    return { values: jqOver(query, value) }
  } catch (error) {
    throw refuse('arguments', (error as Error).message)
  }
}
