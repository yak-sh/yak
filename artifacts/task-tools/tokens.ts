// Count the exact compact tools/list payload with one named tokenizer.
import { encode } from 'npm:gpt-tokenizer@3.4.0/encoding/o200k_base'

let names = /^(task_|decision_|comment_|memory_|topic_|design_|graph_apply$)/
let measured = async (label: string) => {
  let snapshot =
    (await Deno.readTextFile(`artifacts/task-tools/roster-${label}.jsonl`))
      .trim()
  let tools = JSON.parse(snapshot) as { name: string }[]
  let text = JSON.stringify(tools)
  let subset = JSON.stringify(tools.filter((tool) => names.test(tool.name)))
  return {
    tools: tools.length,
    tokens: encode(text).length,
    bytes: new TextEncoder().encode(text).length,
    subsetTools: tools.filter((tool) => names.test(tool.name)).length,
    subsetTokens: encode(subset).length,
    subsetBytes: new TextEncoder().encode(subset).length,
    perTool: Object.fromEntries(
      tools.map((tool) => [tool.name, encode(JSON.stringify(tool)).length]),
    ),
  }
}
let before = await measured('before')
let after = await measured('after')
let report = {
  encoding: 'o200k_base',
  tokenizer: 'gpt-tokenizer@3.4.0',
  serialized: 'JSON.stringify(tools), no trailing newline',
  before,
  after,
  delta: {
    tools: after.tools - before.tools,
    tokens: after.tokens - before.tokens,
    subsetTokens: after.subsetTokens - before.subsetTokens,
    perTool: Object.fromEntries(
      Object.keys(after.perTool).map((
        name,
      ) => [name, after.perTool[name] - (before.perTool[name] ?? 0)]).filter((
        [, delta],
      ) => delta),
    ),
  },
}
await Deno.writeTextFile(
  'artifacts/task-tools/roster-tokens.json',
  JSON.stringify(report, null, 2) + '\n',
)
console.log(JSON.stringify(report.delta))
