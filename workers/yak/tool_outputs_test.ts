import { assert, assertEquals } from '@std/assert'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { Ajv } from 'ajv'
import { type Ctx, TOOLS } from './tools.ts'
import { answered, sugared } from './agent.ts'
import { platformOutput, structuredOutput } from './tool_outputs.ts'
import { platform } from './harness.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { connect } from '../../packages/mcp/harness.ts'

Deno.test('every public platform tool declares a nonempty object result schema', async () => {
  const ctx = { env: {} } as Ctx
  const tools = TOOLS.map((tool) => sugared(ctx, tool))
  const client = await connect({ tools })
  try {
    const listed = await client.listTools()
    const ajv = new Ajv({ strict: false })
    for (const listedTool of listed.tools) {
      assert(listedTool.outputSchema, listedTool.name)
      ajv.compile(listedTool.outputSchema)
    }
    for (const tool of TOOLS) {
      const schema = listed.tools.find((
        t: { name: string; outputSchema?: Record<string, unknown> },
      ) => t.name == tool.name)?.outputSchema
      assert(schema, tool.name)
      assertEquals(schema.type, 'object')
      // A platform tool's answer is the structured content itself, and its
      // own words are a field of it (@yaks/mcp `said`).
      assert((schema.required as string[]).includes('text'), tool.name)
      ajv.compile(schema)
    }
    console.log(
      `Output schema coverage: ${TOOLS.length}/${TOOLS.length} platform tools`,
    )
  } finally {
    await client.close()
  }
})

Deno.test('narrative structured result preserves the exact text and existing view fields', async () => {
  const value = await answered({ env: {} } as Ctx, {
    text: 'created app',
    data: { url: 'https://example.test/' },
  })
  assertEquals(value.result, {
    text: 'created app',
    url: 'https://example.test/',
  })
  assertEquals(structuredOutput('', { rows: [] }), { text: '', rows: [] })
  assert(!platformOutput('app_new').safeParse({}).success)
  // domain_attach answers either an attached domain or the free tier's upsell
  // (tools.ts), so what it says about the domain is optional — and still typed.
  assert(
    platformOutput('domain_attach').safeParse({
      text: 'Custom domains require Plus.',
      code: 'plan_required',
    }).success,
  )
  assert(
    !platformOutput('domain_attach').safeParse({
      text: 'attached',
      records: 'CNAME',
    }).success,
  )
})

Deno.test('isolated public MCP calls return structured text for narratives, lists and app commands', async () => {
  const { env } = platform('output-test-secret')
  const dir = directory({ fetch: (r) => dirPart.fetch(r, env) }, true)
  const ctx: Ctx = { env, dir, person: 'a0000000-0000-4000-8000-0000000000ad' }
  const client = await connect({ tools: TOOLS.map((t) => sugared(ctx, t)) })
  try {
    const listed = await client.listTools()
    const ajv = new Ajv({ strict: false })
    const call = async (name: string, args: Record<string, unknown>) => {
      ctx.once = undefined // Each connector call has fresh request-local reads.
      const result = await client.callTool({ name, arguments: args })
      assert(!result.isError, JSON.stringify(result))
      const schema = listed.tools.find((
        t: { name: string; outputSchema?: Record<string, unknown> },
      ) => t.name == name)!.outputSchema!
      const valid = ajv.compile(schema)
      assert(
        valid(result.structuredContent),
        `${name}: ${JSON.stringify(valid.errors)}`,
      )
      const data = result.structuredContent as Record<string, unknown>
      // The text a client without schemas reads is the tool's own words.
      assertEquals((result.content as { text: string }[])[0].text, data.text)
      return data
    }
    await call('space_new', { slug: 'schema-test', title: 'Schema Test' })
    await call('app_new', {
      space: 'schema-test',
      slug: 'notes',
      title: 'Notes',
    })
    const apps = await call('app_list', {})
    assert(Array.isArray(apps.spaces))
    await call('commands', {})
    await call('app_files', {
      space: 'schema-test',
      app: 'notes',
      files: [
        {
          path: 'vocab.json',
          content:
            '{"$defs": {"note": {"properties": {"title": {"type": "string"}}}}}',
        },
      ],
    })
    await call('app_deploy', { space: 'schema-test', app: 'notes' })
    const commands = await call('commands', { app: 'notes' })
    assert(Array.isArray(commands.commands))
    await call('command', {
      app: 'notes',
      name: 'add_note',
      args: { title: 'first' },
    })
    const found = await call('command', {
      app: 'notes',
      name: 'find_note',
      args: {},
    })
    assert(Array.isArray(found.rows))
    await call('domain_status', { space: 'schema-test' })
    const denied = await client.callTool({
      name: 'app_delete',
      arguments: { space: 'schema-test', app: 'missing' },
    })
    assert(denied.isError)
  } finally {
    await client.close()
  }
})

Deno.test('domain metadata retains structured records and provisioning steps', () => {
  const data = structuredOutput('waiting for DNS', {
    hostname: 'example.test',
    serves: 'schema-test/notes',
    url: 'https://example.test/',
    stage: 'pending',
    apex: true,
    records: [{
      type: 'CNAME',
      name: 'example.test',
      value: 'origin.example.test',
    }],
    steps: [{ step: 'dns', state: 'waiting', said: 'Add the record' }],
  })
  for (const name of ['domain_attach', 'domain_status']) {
    const schema = zodToJsonSchema(platformOutput(name), {
      $refStrategy: 'none',
    })
    const valid = new Ajv({ strict: false }).compile(schema)
    assert(
      valid(
        name == 'domain_attach' ? data : { text: 'domains', domains: [data] },
      ),
      JSON.stringify(valid.errors),
    )
  }
})
