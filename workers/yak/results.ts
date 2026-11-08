import { snapshot } from '@yaks/context'
import type { Bundle, Graph, Tool } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { structured, texts } from '@yaks/tools/result'
import { imagesIn } from '@yaks/tools/value'
import { refuse } from './tool.ts'
import {
  RESULT_LIMIT,
  RESULT_MAX,
  resultBytes,
  type ResultSummary,
  resultSummary,
} from './result-view.ts'
export {
  RESULT_LIMIT,
  RESULT_MAX,
  RESULT_SCHEMA,
  resultBytes,
} from './result-view.ts'

/** A snapshot names its call and reader; the graph holding it scopes its space. */
export let keepResult = async (
  g: Graph,
  value: unknown,
  source: Bundle,
  person: string,
): Promise<ResultSummary> => {
  let body = JSON.stringify(value) ?? 'null'
  let bytes = new TextEncoder().encode(body).length
  if (bytes > RESULT_MAX) {
    throw refuse('limit', 'Tool result exceeds the 32 MiB system safety bound.')
  }
  let { revision } = await snapshot(body, source.entity.eid)
  let id = derivedEid(
    'tool-result:' + person + ':' + source.entity.eid + ':' + revision,
  )
  await g.apply([{
    entity: { eid: id },
    context_output: {
      source: source.entity.eid,
      reader: person,
      revision,
      body,
    },
  }], { trusted: true })
  return resultSummary(id, value ?? null, bytes)
}

export let readResult = async (
  g: Graph,
  id: string,
  person: string,
): Promise<unknown> => {
  let [row] = await g.get([id], ['context_output'])
  let output = row?.context_output as
    | { reader?: string; body: string }
    | undefined
  if (!output || output.reader != person) {
    throw refuse(
      'missing',
      'That kept result is missing or belongs to another caller.',
    )
  }
  return JSON.parse(output.body)
}

export let retainResult = (
  g: Graph,
  value: unknown,
  source: Bundle,
  person: string,
  limit = RESULT_LIMIT,
): Promise<unknown> =>
  resultBytes(value) > limit
    ? keepResult(g, value, source, person)
    : Promise.resolve(value)

/** Custom values and accompanying content occupy separate fields so neither
 * can replace a property the tool's schema owns. */
export let resultValue = (
  answer: Bundle[],
  tool: Tool,
): Record<string, unknown> => {
  let value = structured(tool, answer)
  if (!tool.outputSchema) return value
  let images = imagesIn(answer)
  return {
    structuredContent: value,
    content: texts(answer, Infinity).map((text) => ({ type: 'text', text })),
    ...images.length ? { images } : {},
  }
}
export let retainAnswer = (
  g: Graph,
  answer: Bundle[],
  tool: Tool,
  call: Bundle,
  person: string,
): Promise<ResultSummary | undefined> => {
  let value = resultValue(answer, tool)
  return resultBytes(value) > RESULT_LIMIT
    ? keepResult(g, value, call, person)
    : Promise.resolve(undefined)
}
