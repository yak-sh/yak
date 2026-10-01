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
import {
  type Bundle,
  derivedEid,
  type Graph,
  identityEid,
  Refused,
} from '@yaks/graph'
import { world } from '../persona/testing.ts'
import { attachSkills, type SkillOptions } from './skills.ts'

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
  let fid = identityEid('file', [path, repository])
  let eid = `skill-${repository}-${title}`
  return [
    {
      entity: { eid },
      skill: { options: { author: 'A person' } },
      doc: { title, body: 'Check a system’s behavior' },
      content: { body: 'Use this only when behavior needs checking.\n' },
    },
    { entity: { eid: fid }, file: { path, repository } },
    {
      entity: { eid: derivedEid(`skill-file|${eid}|${fid}`) },
      references: {},
      edge: { from: eid, to: fid },
    },
    {
      entity: {
        eid: identityEid('file', [
          `.claude/skills/${title}/scripts/dom.ts`,
          repository,
        ]),
      },
      file: { path: `.claude/skills/${title}/scripts/dom.ts`, repository },
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
  let c = new Client({ name: 'skills-client', version: '1' }, {
    versionNegotiation: { mode: { pin: '2026-07-28' } },
  })
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

let local = async (run: (g: Graph, root: string) => Promise<void>) => {
  let root = await Deno.makeTempDir({ prefix: 'mcp-skills-' })
  try {
    let result = await new Deno.Command('git', {
      cwd: root,
      args: ['init', '-q'],
      stdout: 'null',
      stderr: 'piped',
    }).output()
    assert(result.success)
    await Deno.mkdir(`${root}/.claude/skills/testing/scripts`, {
      recursive: true,
    })
    await Deno.writeTextFile(
      `${root}/.claude/skills/testing/SKILL.md`,
      '---\nname: testing\ndescription: Local testing\nauthor: Exact raw YAML\n---\nLocal instructions\n',
    )
    await Deno.writeTextFile(
      `${root}/.claude/skills/testing/scripts/dom.ts`,
      'export let dom = "✓"\n',
    )
    await run(world(), root)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

test('cwd overlay serves raw YAML, binary companions and nested skills without importing graph', async () => {
  await local(async (g, root) => {
    await Deno.writeFile(
      `${root}/.claude/skills/testing/scripts/data.bin`,
      new Uint8Array([0, 255, 3, 200]),
    )
    await Deno.mkdir(`${root}/.claude/skills/testing/nested`, {
      recursive: true,
    })
    await Deno.writeTextFile(
      `${root}/.claude/skills/testing/nested/SKILL.md`,
      '---\nname: nested\ndescription: Nested checks\n---\nNested instructions\n',
    )
    let { c } = await client({ graph: g, cwd: root })
    try {
      let skills = (await list(c)).skills as Manifest[]
      assertEquals(skills.length, 2)
      let parent = skills.find((s) => s.frontmatter.name == 'testing')!
      assertEquals(parent.resources.length, 4)
      assertEquals(parent.frontmatter.author, 'Exact raw YAML')
      let binary = parent.resources.find((r) => r.uri.endsWith('/data.bin'))!
      let read = await c.readResource({ uri: binary.uri })
      assert('blob' in read.contents[0])
      assertEquals(read.contents[0].blob, 'AP8DyA==')
      assertEquals(binary.size, 4)
      assertEquals(binary.digest, await hash(new Uint8Array([0, 255, 3, 200])))
      await Deno.remove(`${root}/.claude/skills/testing/scripts/dom.ts`)
      assertEquals(
        ((await list(c)).skills as Manifest[]).find((s) =>
          s.frontmatter.name == 'testing'
        )!.resources.length,
        3,
      )
      assertEquals(await g.get(['skill-repo-testing']), [])
    } finally {
      await c.close()
    }
  })
})

test('Skills attachment refuses unsafe, nonconforming and oversized snapshots before discovery', async () => {
  await local(async (g, root) => {
    let built = () => new McpServer({ name: 'refusal-test', version: '1' })
    await Deno.symlink(
      '/etc/passwd',
      `${root}/.claude/skills/testing/scripts/link`,
    )
    await assertRejects(
      () => attachSkills(built(), { graph: g, cwd: root }),
      Refused,
    )
    await Deno.remove(`${root}/.claude/skills/testing/scripts/link`)
    await Deno.writeTextFile(
      `${root}/.claude/skills/testing/SKILL.md`,
      '---\nname: Testing\ndescription: Invalid name\n---\nText\n',
    )
    await assertRejects(
      () => attachSkills(built(), { graph: g, cwd: root }),
      Refused,
    )
    await Deno.writeTextFile(
      `${root}/.claude/skills/testing/SKILL.md`,
      '---\nname: testing\ndescription: Valid name\n---\nText\n',
    )
    await Deno.writeFile(
      `${root}/.claude/skills/testing/scripts/huge`,
      new Uint8Array(16 * 1024 * 1024 + 1),
    )
    await assertRejects(
      () => attachSkills(built(), { graph: g, cwd: root }),
      Refused,
    )
  })
})
