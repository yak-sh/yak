// Explicit decision attribution through MCP leaves write authority with the caller.
import { assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { kernel, kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { projectDoc } from '@yaks/project'
import { toolsDoc } from '@yaks/tools'
import { taskDoc, tasks } from '@yaks/task'
import { runs as taskRuns } from '../../packages/task/tools.ts'
import { argsFor } from '../../packages/cli/args.ts'
import { type Listed, spelling } from '../../packages/cli/tool.ts'
import { connect } from '../../packages/mcp/testing.ts'
import { designDoc } from '../../packages/design/vocab.ts'
import { runs } from '../../packages/design/tools.ts'

let caller = { by: 'agent', via: 'session' }
let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  edgeDoc,
  projectDoc,
  taskDoc,
  designDoc,
  toolsDoc,
], [edgeKeywords])

let world = async () => {
  let authorized: Bundle[] = []
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [kernel(), edges(vocab), tasks(), {
      name: 'authority',
      authorize: (bundles) => {
        authorized.push(...bundles.filter((b) => b.decided))
        return bundles
      },
    }],
  })
  await g.apply([
    { entity: { eid: 'owner' }, doc: { title: 'Owner' } },
    { entity: { eid: 'agent' }, doc: { title: 'Agent' } },
    { entity: { eid: 'session' }, doc: { title: 'Session' } },
    { entity: { eid: 'proposal' }, design: {}, proposed: {} },
    {
      entity: { eid: 'question' },
      task: {},
      decision: {
        question: 'Which route?',
        choices: [
          { label: 'Train', description: 'Earlier' },
          { label: 'Bus', description: 'Cheaper' },
        ],
        recommended: 'Train',
      },
    },
  ])
  let client = await connect({
    graph: g,
    actor: caller,
    tools: [
      ...loadTools(designDoc, runs()),
      ...loadTools(taskDoc, taskRuns()),
    ],
  })
  let listed = (await client.listTools()).tools as Listed[]
  let line = async (name: string, argv: string[]) => {
    let tool = listed.find((t) => t.name == name)!
    let args = await argsFor({ ...tool, ...spelling(tool) }, argv)
    let out = await client.callTool({ name, arguments: args })
    assertEquals(out.isError, undefined, JSON.stringify(out))
  }
  return { g, client, authorized, line }
}

for (
  let [name, id, value] of [
    ['decision_answer', 'question', 'Train'],
    ['design_decide', 'proposal', 'approved'],
  ]
) {
  let { g, client, authorized, line } = await world()
  await line(name, [id, value, '--by', 'Owner'])
  let [row] = await g.get([id])
  assertEquals((row.decided as Comp).by, 'owner')
  assertEquals((row.decided as Comp).via, 'session')
  assertEquals((row.updated as Comp).by, 'agent')
  assertEquals(authorized.length > 0, true)
  assertEquals(authorized.every((b) => b.$actor?.by == 'agent'), true)
  if (name == 'decision_answer') {
    assertEquals((row.completed as Comp).by, 'agent')
  }
  await client.close()
  console.log(`${name}: explicit decider recorded, caller authority retained`)
}

let unsigned = await world()
let out = await unsigned.client.callTool({
  name: 'graph_apply',
  arguments: {
    bundles: [{
      entity: { eid: 'proposal' },
      decided: { verdict: 'approved' },
      $actor: { by: 'owner' },
    }],
  },
})
assertEquals(out.isError, undefined, JSON.stringify(out))
let [row] = await unsigned.g.get(['proposal'])
assertEquals((row.decided as Comp).by, 'agent')
assertEquals(unsigned.authorized.every((b) => b.$actor?.by == 'agent'), true)
await unsigned.client.close()
console.log('graph_apply: bundle actor ignored, caller authority retained')
