/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { argsOf, type Tool } from '@yaks/graph'
import { argsFor } from '@yaks/cli/grammar'
import { registry } from '@yaks/tools'
import { connect, text } from './testing.ts'
import { FILES } from './files.ts'

let schema = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    nested: { type: 'array', items: { $ref: '#/$defs/item' } },
  },
  additionalProperties: false,
  required: ['body'],
  $defs: {
    item: {
      type: 'object',
      properties: { body: { type: ['string', 'null'] } },
    },
  },
}
let echo: Tool = {
  name: 'echo_body',
  description: 'Read a body',
  inputSchema: schema,
  readOnly: true,
  run: (call) => [{
    entity: { eid: '$out' },
    content: { body: JSON.stringify(argsOf(call)) },
    output: { source: call.entity.eid },
  }],
}
let body = 'A long body\n'.repeat(200)
let reads: string[] = []
let readFile = (path: string) => {
  reads.push(path)
  if (path == '/body.md') return body
  throw new Error('File does not exist')
}
let local = await connect({ tools: [echo], readFile })
let remote = await connect({ tools: [echo] })
let catalog = registry([{ name: 'bodies', tools: [echo] }])
let opened = Promise.withResolvers<void>()
let loaded = Promise.withResolvers<string>()
let swapping = await connect({
  registry: catalog,
  core: false,
  readFile: () => {
    opened.resolve()
    return loaded.promise
  },
})
let call = (args: Record<string, unknown>, client = local) =>
  client.callTool({ name: 'echo_body', arguments: args })

test('MCP file input preserves existing literal @ arguments', async () => {
  equal(JSON.parse(text(await call({ body: '@yaks/fp' }))), {
    body: '@yaks/fp',
  })
  equal(JSON.parse(text(await call({ body: '@/body.md', $files: false }))), {
    body: '@/body.md',
  })
  equal(reads.length, 0)
})

test('MCP file input expands long and nested declared strings once', async () => {
  let out = await call({
    $files: true,
    body: '@/body.md',
    nested: [{ body: '@/body.md' }, { body: null }],
  })
  equal(out.isError, undefined)
  equal(JSON.parse(text(out)), {
    body,
    nested: [{ body }, { body: null }],
  })
  let cli = await argsFor(echo, ['--body', '@/body.md'], {
    file: readFile,
    stdin: () => '',
  })
  equal(cli.body, body)
})

test('an unreadable MCP file answers the caller without running the tool', async () => {
  let out = await call({ body: '@/missing.md', $files: true })
  equal(out.isError, true)
  equal(text(out).includes('Cannot read @/missing.md'), true)
})

test('MCP file reads retain the admitted schema and implementation during provider replacement', async () => {
  let pending = call({ body: '@/body.md', $files: true }, swapping)
  await opened.promise
  catalog.replace('bodies', [{
    ...echo,
    inputSchema: {
      type: 'object',
      properties: { body: { type: 'number' } },
      required: ['body'],
      additionalProperties: false,
    },
    run: (call) => [{
      entity: { eid: '$out' },
      content: { body: `replacement ${argsOf(call).body}` },
      output: { source: call.entity.eid },
    }],
  }])
  loaded.resolve(body)
  try {
    equal(JSON.parse(text(await pending)), { body })
    let current = (await swapping.listTools()).tools[0]
    equal(current.inputSchema.properties.body, { type: 'number' })
    equal(current.inputSchema.properties.$files, { type: 'boolean' })
    equal(text(await call({ body: 7 }, swapping)), 'replacement 7')
  } finally {
    await swapping.close()
  }
})

test('only a file-capable MCP door advertises file input', async () => {
  let tools = (await local.listTools()).tools
  let tool = tools.find((t: { name: string }) => t.name == 'echo_body')!
  equal((tool.inputSchema.properties as Record<string, unknown>).$files, {
    type: 'boolean',
  })
  equal(local.getInstructions()?.includes(FILES), true)
  equal(
    (await remote.listTools()).tools.find((t: { name: string }) =>
      t.name == 'echo_body'
    )!
      .inputSchema,
    schema,
  )
  equal(JSON.parse(text(await call({ body: '@/body.md' }, remote))), {
    body: '@/body.md',
  })
  await Promise.all([local.close(), remote.close()])
})
