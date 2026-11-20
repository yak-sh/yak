/** Narrow snapshots at the harness door; direct tool calls return complete data. */
import type { Comp, Graph } from '@yaks/graph'
import { outputValue } from '@yaks/context'
import { jqOver } from '@yaks/context/result'
import type { Tool } from '@yaks/session'
import { ToolError } from '@yaks/session'

export let resultTool = (g: Graph): Tool => ({
  name: 'result_query',
  description:
    'Run a jq filter against a complete tool result kept by id. Returns {values: [...]} for the jq output stream. Use .result for graph rows; third-party MCP replies retain .structuredContent and .content. Plain text is a jq string.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' }, query: { type: 'string' } },
    required: ['id', 'query'],
  },
  readOnly: true,
  run: async ({ id, query }) => {
    let [row] = await g.get([String(id)], ['context_output'])
    let output = row?.context_output as Comp | undefined
    if (!output || output.reader) {
      throw new ToolError('result', 'Kept result unavailable')
    }
    try {
      let values = jqOver(String(query), outputValue(String(output.body)))
      return JSON.stringify({ values })
    } catch (error) {
      throw new ToolError('query', (error as Error).message)
    }
  },
})
