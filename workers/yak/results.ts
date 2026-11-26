import { snapshot } from '@yaks/context'
import type { Bundle, Graph, Tool } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { structured, texts } from '@yaks/tools/result'
import { imagesIn, valueIn } from '@yaks/tools/value'
import { refuse } from './tool.ts'
import {
  RESULT_MAX,
  type ResultSummary,
  resultSummary,
} from '@yaks/context/result'
export { RESULT_MAX, RESULT_SCHEMA } from '@yaks/context/result'

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
  // A public result scope cannot discover results kept for another reader.
  if (
    !output?.reader || person.startsWith('public:') && output.reader != person
  ) {
    throw refuse(
      'missing',
      'That kept result is missing from this scope. Use the space, app, or ' +
        'catalogue scope from its summary. If the scope is already correct, ' +
        'run the original query again.',
    )
  }
  if (output.reader != person) {
    throw refuse(
      'access',
      'That kept result belongs to another caller. Retry from the session ' +
        'that made it, using the same account.',
    )
  }
  return JSON.parse(output.body)
}

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

/**
 * A kept result's answer as data again, as `resultValue` kept it: the value a
 * tool declares its answer by, or the one among the bundles it answered
 * (`output{value}`), or the value itself where the result was kept bare.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { keptValue, resultValue } from './results.ts'
 * let said = { entity: { eid: '$said' }, output: { value: { version: 2 } } }
 * let schema = { outputSchema: { type: 'object' } }
 * for (let tool of [{}, schema]) {
 *   assertEquals(keptValue(resultValue([said], tool as never)), { version: 2 })
 * }
 * assertEquals(keptValue({ version: 2 }), { version: 2 })
 * ```
 */
export let keptValue = (kept: unknown): Record<string, unknown> | undefined => {
  let v = kept as Record<string, unknown> | null | undefined
  let held = (v?.structuredContent ?? v) as Record<string, unknown> | null
  if (Array.isArray(held?.result)) return valueIn(held.result as Bundle[])
  return held && typeof held == 'object' ? held : undefined
}
