/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  ProtocolError,
} from '@modelcontextprotocol/server'
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { type Bundle, derivedEid, Refused } from '@yaks/graph'
import { fileOf } from '@yaks/file'
import { world } from '../persona/testing.ts'
import { pinned } from './testing.ts'
import { attachSkills, type SkillOptions } from './skills.ts'
import { prepared } from './server.ts'

let values = fromJsonSchema<Record<string, unknown>>({
  type: 'object',
  additionalProperties: true,
})
type Manifest = {
  uri: string
  frontmatter: Record<string, unknown>
  resources: { uri: string; digest: string; size: number }[]
}
let seed = (repository = 'repo', title = 'testing'): Bundle[] => {
  let path = `.claude/skills/${title}/SKILL.md`
  let fid = fileOf(repository, path)
  let dom = `.claude/skills/${title}/scripts/dom.ts`
  let eid = `skill-${repository}-${title}`
  return [
    {
      entity: { eid: repository },
      repository: { common: `/skills/${repository}/.git` },
    },
    {
      entity: { eid },
      skill: { options: { author: 'A person' } },
      doc: { title, body: 'Check a system’s behavior' },
      content: { body: 'Use this only when behavior needs checking.\n' },
    },
    { entity: { eid: fid }, file: { path, root: repository } },
    {
      entity: { eid: derivedEid(`skill-file|${eid}|${fid}`) },
      references: {},
      edge: { from: eid, to: fid },
    },
    {
      entity: { eid: fileOf(repository, dom) },
      file: { path: dom, root: repository },
      content: { body: 'export let dom = "✓"\n' },
    },
  ]
}
let client = async (
  options: SkillOptions,
  extend?: (built: McpServer) => void,
) => {
  let requests: string[] = []
  let handler = createMcpHandler(async (ctx) => {
    assertEquals(ctx.era, 'modern')
    let built = new McpServer({ name: 'skills-test', version: '1' })
    extend?.(built)
    await attachSkills(built, options)
    return built
  }, { legacy: 'reject' })
  let c = new Client({ name: 'skills-client', version: '1' }, pinned)
  let transport = new StreamableHTTPClientTransport(
    new URL('http://skills.test/mcp'),
    {
      fetch: (url: string | URL | Request, init?: RequestInit) => {
        requests.push(String(init?.body))
        return handler.fetch(new Request(url, init))
      },
    },
  )
  await c.connect(transport)
  return { c, handler, requests }
}
let list = async (c: Client, cursor?: string) =>
  await c.request({
    method: 'skills/list',
    params: { ...cursor ? { cursor } : {}, _meta: { trace: 'test' } },
  }, values)
let get = async (c: Client, uri: string) =>
  await c.request({ method: 'skills/get', params: { uri } }, values)
let hash = async (bytes: Uint8Array): Promise<string> => {
  let digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
  )
  return 'sha256:' +
    [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

test('modern Skills discover/list/get/read share complete scoped manifests and exact UTF8 bytes', async () => {
  let g = world()
  await g.apply([...seed(), ...seed('other', 'other')])
  let { c, requests } = await client({ graph: g, repository: 'repo' })
  try {
    assertEquals(c.getNegotiatedProtocolVersion(), '2026-07-28')
    assert(
      c.getServerCapabilities()?.extensions?.['io.modelcontextprotocol/skills'],
    )
    assert(c.getServerCapabilities()?.resources)
    let result = await list(c)
    let skills = result.skills as Manifest[]
    assertEquals(skills.length, 1)
    assertEquals(skills[0].frontmatter.name, 'testing')
    assertEquals(skills[0].frontmatter.author, 'A person')
    assert(skills[0].uri.endsWith('/testing/SKILL.md'))
    assertEquals(skills[0].resources.length, 2)
    assertEquals((await get(c, skills[0].uri)).skill, skills[0])
    for (let resource of skills[0].resources) {
      let read = await c.readResource({ uri: resource.uri })
      let content = read.contents[0]
      assert('text' in content)
      let bytes = new TextEncoder().encode(content.text)
      assertEquals(resource.size, bytes.length)
      assertEquals(resource.digest, await hash(bytes))
    }
    let prompts = await c.listPrompts()
    assertEquals(prompts.prompts[0].name, 'skill:testing')
    let prompt = await c.getPrompt({ name: 'skill:testing' })
    assertEquals(prompt.messages[0].content.type, 'text')
    assertEquals(
      (prompt.messages[0].content as { text: string }).text,
      ((await c.readResource({ uri: skills[0].uri })).contents[0] as {
        text: string
      }).text,
    )
    let all = await c.listResources()
    assertEquals(all.resources.length, 2)
    assert(requests.some((s) => s.includes('server/discover')))
    assert(requests.some((s) => s.includes('2026-07-28')))
    await assertRejects(
      () => get(c, 'skill://skills/repo/missing/SKILL.md'),
      ProtocolError,
    )
    await assertRejects(
      () => c.readResource({ uri: 'skill://skills/repo/testing/../secret' }),
      ProtocolError,
    )
  } finally {
    await c.close()
  }
})

test('no scope is empty; fresh request snapshots see graph edits and preserve extension resources/prompts', async () => {
  let g = world()
  await g.apply(seed())
  let empty = await client({ graph: g })
  try {
    assertEquals((await list(empty.c)).skills, [])
  } finally {
    await empty.c.close()
  }
  let { c } = await client({ graph: g, repository: 'repo' }, (built) => {
    built.registerResource(
      'other',
      'example://other',
      {},
      () => ({ contents: [{ uri: 'example://other', text: 'Unrelated' }] }),
    )
    built.registerPrompt(
      'other',
      {},
      () => ({
        messages: [{
          role: 'user',
          content: { type: 'text', text: 'Other prompt' },
        }],
      }),
    )
  })
  try {
    let before = (await list(c)).skills as Manifest[]
    await g.apply([{
      entity: { eid: 'skill-repo-testing' },
      doc: { body: 'New description' },
    }])
    let after = (await list(c)).skills as Manifest[]
    assertEquals(after[0].frontmatter.description, 'New description')
    assert(after[0].resources[0].digest != before[0].resources[0].digest)
    assertEquals(
      ((await c.readResource({ uri: 'example://other' })).contents[0] as {
        text: string
      }).text,
      'Unrelated',
    )
    assert((await c.listPrompts()).prompts.some((p) => p.name == 'other'))
  } finally {
    await c.close()
  }
})

// The registration boundary records the same contributed resources/prompts
// both HTTP factories prepare, without constructing a transport or a graph.
let catalogue = () => {
  let resources = new Map<string, unknown>()
  let prompts = new Map<string, { description?: string }>()
  let capabilities: Record<string, unknown> = {}
  let built = {
    server: {
      registerCapabilities: (value: Record<string, unknown>) => {
        Object.assign(capabilities, value)
      },
      setRequestHandler: () => {},
    },
    registerResource: (_name: string, uri: string) => resources.set(uri, {}),
    registerPrompt: (name: string, config: { description?: string }) =>
      prompts.set(name, config),
  } as unknown as McpServer
  return { built, resources, prompts, capabilities }
}

let httpSkills = (() => {
  let path = '.claude/skills/testing/SKILL.md'
  let encoder = new TextEncoder()
  let files = new Map<string, Uint8Array>()
  let reads = 0
  let source = () => {
    reads++
    return { scope: 'repo', files }
  }
  let options = {
    skills: (built: McpServer, exchange?: { method: string }) =>
      attachSkills(built, source, exchange),
    extend: (built: McpServer) => {
      built.registerResource('other', 'example://other', {}, () => ({
        contents: [{ uri: 'example://other', text: 'Other' }],
      }))
      built.registerPrompt('other', {}, () => ({ messages: [] }))
    },
  }
  let views = Array.from({ length: 10 }, catalogue)
  let request = async (method: string) => {
    let view = views.shift()!
    await prepared(view.built, options, { method })
    return view
  }
  return { files, request, reads: () => reads, path, encoder }
})()

// Each era uses this preparation boundary before dispatching its request.
for (let opening of ['initialize', 'server/discover']) {
  test(`HTTP tool exchanges do not read skills, while discovery stays fresh in the ${opening} era`, async () => {
    let { files, request, reads, path, encoder } = httpSkills
    files.clear()
    let initial = await request(opening)
    assert(initial.capabilities.resources)
    assert(initial.prompts.has('other'))
    files.set(
      path,
      encoder.encode(
        '---\nname: Invalid\ndescription: Broken\n---\nText\n',
      ),
    )
    let before = reads()
    await request('tools/list')
    await request('tools/call')
    assertEquals(reads(), before)
    await assertRejects(() => request('resources/list'), Refused)
    files.set(
      path,
      encoder.encode(
        '---\nname: testing\ndescription: Fresh description\n---\nFresh instructions\n',
      ),
    )
    let fresh = await request(
      opening == 'initialize' ? 'prompts/list' : 'resources/list',
    )
    assertEquals(
      fresh.prompts.get('skill:testing')?.description,
      'Fresh description',
    )
    assert(fresh.prompts.has('other'))
    assert(fresh.resources.has('example://other'))
    assert(fresh.resources.has('skill://skills/repo/testing/SKILL.md'))
    // New files appear on the next exchange, not in an earlier snapshot.
    assert(!initial.prompts.has('skill:testing'))
  })
}
