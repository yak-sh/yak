/// <reference lib="deno.ns" />
// Claude Code and Codex give a model a reply's structuredContent alone, so
// whatever the text says that the data does not hold rides in it too, as
// `said`. Each case is a call and the `said` its data carries; the client
// checks every answer against the schema the tool is listed with.

import { equal, test } from '@yaks/testing'
import { assert, assertStringIncludes } from '@std/assert'
import { connect, result, text } from './testing.ts'

let saidBy = async (
  name: string,
  args: Record<string, unknown>,
  opts: Parameters<typeof connect>[0] = {},
) => {
  let client = await connect(opts)
  try {
    await client.listTools()
    let out = await client.callTool({ name, arguments: args })
    let data = out.structuredContent as Record<string, unknown> | undefined
    return { out, data, said: data?.said as string | undefined }
  } finally {
    await client.close()
  }
}

let news = { roster: () => ({ line: 'Tool list changed.' }) }

test('an answer of entities says only the news beside its result', async () => {
  let { out, said } = await saidBy('graph_query', { q: '.book' }, news)
  equal(said, 'Tool list changed.')
  equal(result(out), [])
  let { said: quiet } = await saidBy('graph_query', { q: '.book' })
  equal(quiet, undefined)
})

test('graph_schema says its prose beside the vocabulary', async () => {
  let { out, data, said } = await saidBy(
    'graph_schema',
    { component: 'book' },
    news,
  )
  assert(data?.$defs, 'the vocabulary is still the answer')
  assertStringIncludes(text(out), '# book')
  equal(said, `${text(out)}\nTool list changed.`)
})

test('a refusal says where the current answer is', async () => {
  let { out, said } = await saidBy('graph_apply', {
    bundles: [{ entity: { eid: 'b1' }, book: { colour: 'red' } }],
  })
  assert(out.isError)
  equal(said, 'graph_schema reports what this graph declares.')
  assert(text(out).endsWith(`. ${said}`), text(out))
  // A name no component declares points there too, in the text of a tool
  // whose own output schema leaves a refusal no structured content.
  let read = text((await saidBy('graph_query', { q: '.bok.colour=red' })).out)
  assertStringIncludes(read, '(closest declared: .book)')
  assert(read.endsWith(`. ${said}`), read)
})
