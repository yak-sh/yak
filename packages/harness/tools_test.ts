import { assert, assertEquals } from '@std/assert'
import { graphTools, harnessTools, parametersOf } from './tools.ts'
import { core } from '@yaks/mcp'
import { open } from './store.ts'

let schemas = () => {
  let h = open(':memory:')
  let table = core({ vocab: h.vocab, depth: 'names' })
    .map((t) => [t.name, parametersOf(t)] as const)
  h.close()
  return new Map(table)
}

Deno.test('every graph tool says its arguments as JSON Schema', () => {
  for (let [name, schema] of schemas()) {
    assertEquals(schema.type, 'object', name)
    assert(!('$schema' in schema), `${name} carries a $schema`)
    assert(!JSON.stringify(schema).includes('"$ref"'), `${name} carries a $ref`)
  }
})

Deno.test('a required argument is required and an optional one is not', () => {
  let query = schemas().get('graph_query')!
  assertEquals(query.required, ['q'])
  let props = query.properties as Record<string, Record<string, unknown>>
  assertEquals(props.q.type, 'string')
  assertEquals(props.limit.type, 'number')
})

Deno.test('the harness gives an agent the shell and the graph', () => {
  let h = open(':memory:')
  let names = harnessTools(h.g).map((t) => t.name)
  assertEquals(names.slice(0, 3), ['shell', 'wait', 'stop'])
  assertEquals(new Set(names).size, names.length)
  assert(names.includes('fork'))
  assert(names.includes('spawn'))
  assert(names.includes('graph_apply'))
  assert(names.includes('graph_query'))
  h.close()
})

Deno.test('a graph tool writes and reads the harness graph', async () => {
  let h = open(':memory:')
  let tools = graphTools(h.g)
  let by = (name: string) => tools.find((t) => t.name == name)!
  await by('graph_apply').run({
    change: [{ entity: { eid: 't1' }, doc: { title: 'a task' }, task: {} }],
  })
  let out = await by('graph_query').run({ q: '.task' })
  assert(out.includes('a task'), out)
  h.close()
})
