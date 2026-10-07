// Skills are a machine-file view: local edits are not imported into the graph,
// and a transcript without a machine discovers descriptions without leasing one.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, type Comp, derivedEid } from '@yaks/graph'
import { processProvider } from '@yaks/process/machine'
import { skillItems, type SkillMachines, skillTools } from './skills.ts'
import { harness, scratchRepo } from './testing.ts'

let write = async (
  root: string,
  title = 'checking',
  description = 'Check observable behavior, not implementation details',
  body = 'Secret instruction body\n\nKeep this exact.\n',
  invoke = '',
) => {
  let dir = `${root}/.claude/skills/${title}`
  await Deno.mkdir(dir, { recursive: true })
  await Deno.writeTextFile(
    `${dir}/SKILL.md`,
    `---\nname: ${title}\ndescription: ${description}\n${invoke}---\n${body}`,
  )
  return body
}
let catalogue = async (
  h: Awaited<ReturnType<typeof harness>>,
  machines: SkillMachines,
  session = 'session',
) => {
  let tools = skillTools(h.g, machines)
  let items = await skillItems(h.g, { session, tools }, machines)
  return items.map((item) => 'text' in item ? item.text : '').join('\n')
}
let attached = (
  h: Awaited<ReturnType<typeof harness>>,
  roots: Record<string, string>,
): SkillMachines => {
  let provider = processProvider(h.g, { dir: Object.values(roots)[0] })
  return {
    machine: async (session) => {
      if (!roots[session]) throw new Error('No machine for ' + session)
      return (await provider.attach!({ id: session, address: roots[session] }))
        .machine
    },
    cwd: (session) => Promise.resolve(roots[session]),
  }
}
let load = async (
  h: Awaited<ReturnType<typeof harness>>,
  machines: SkillMachines,
  title: string,
  session = 'session',
) => {
  let call: Bundle = {
    entity: { eid: crypto.randomUUID() },
    call: { id: title },
    entry: { session },
  }
  await h.g.apply([call])
  let result = await skillTools(h.g, machines)[0].run({ skill: title }, {
    session,
    call,
    entries: [call],
  })
  return { call, result }
}

test('machine descriptions load exact attributed instructions without importing files', async () => {
  let at = await scratchRepo()
  let h = await harness()
  await h.g.apply([{
    entity: { eid: 'attached' },
    machine: { provider: 'process', state: 'running' },
  }])
  try {
    let body = await write(at.repo)
    await h.g.apply([{
      entity: { eid: 'session' },
      session: {},
      home: { machine: 'attached', cwd: at.repo },
    }])
    let machines = attached(h, { session: at.repo })
    let discovered = await catalogue(h, machines)
    assert(discovered.includes('Check observable behavior'))
    assert(!discovered.includes(body))
    let { call, result } = await load(h, machines, 'checking')
    assert(result.includes(body))
    assert(result.includes(`${at.repo}/.claude/skills/checking`))
    let id = derivedEid(`harness graph tool ${call.entity.eid}`)
    let [inner] = await h.g.get([id])
    assertEquals((inner.created as Comp).by, 'session')
    assertEquals((await h.g.read('.skill')).length, 0)
  } finally {
    h.close()
    await at.free()
  }
})

test('machine catalogue refreshes dirty edits, untracked additions and deletions', async () => {
  let at = await scratchRepo()
  let h = await harness()
  await h.g.apply([{
    entity: { eid: 'attached' },
    machine: { provider: 'process', state: 'running' },
  }])
  try {
    await write(at.repo)
    await h.g.apply([{
      entity: { eid: 'session' },
      session: {},
      home: { machine: 'attached' },
    }])
    let machines = attached(h, { session: at.repo })
    assert((await catalogue(h, machines)).includes('Check observable behavior'))
    await write(at.repo, 'checking', 'Changed description', 'Changed body\n')
    await write(at.repo, 'new-skill', 'A newly available workflow')
    let discovered = await catalogue(h, machines)
    assert(discovered.includes('Changed description'))
    assert(discovered.includes('A newly available workflow'))
    assert(!discovered.includes('Changed body'))
    await Deno.remove(`${at.repo}/.claude/skills`, { recursive: true })
    assertEquals(await catalogue(h, machines), '')
    assertEquals((await h.g.read('.skill')).length, 0)
  } finally {
    h.close()
    await at.free()
  }
})

test('graph discovery and tool allowlists never provision a machine', async () => {
  let h = await harness()
  await h.g.apply([{
    entity: { eid: 'attached' },
    machine: { provider: 'process', state: 'running' },
  }])
  try {
    await h.g.apply([{
      entity: { eid: 'graph-skill' },
      skill: {
        invoke: 'both',
        arguments: [],
        paths: [],
        fork: false,
        options: {},
      },
      doc: { title: 'checking', body: 'Description from the graph' },
      content: { body: 'Instructions stay hidden' },
    }, { entity: { eid: 'session' }, session: {} }])
    let calls = 0
    let machines: SkillMachines = {
      machine: () => {
        calls++
        throw new Error('Discovery must not provision')
      },
      cwd: () => Promise.resolve(undefined),
    }
    let discovered = await catalogue(h, machines)
    assert(discovered.includes('Description from the graph'))
    assert(!discovered.includes('Instructions stay hidden'))
    assertEquals(
      await skillItems(h.g, { session: 'session', tools: [] }, machines),
      [],
    )
    assertEquals(calls, 0)
  } finally {
    h.close()
  }
})

test('user-only skills are undiscoverable and the machine loader refuses them', async () => {
  let at = await scratchRepo()
  let h = await harness()
  await h.g.apply([{
    entity: { eid: 'attached' },
    machine: { provider: 'process', state: 'running' },
  }])
  try {
    await write(
      at.repo,
      'manual',
      'Only a person asks',
      'Manual\n',
      'disable-model-invocation: true\n',
    )
    await h.g.apply([{
      entity: { eid: 'session' },
      session: {},
      home: { machine: 'attached' },
    }])
    let machines = attached(h, { session: at.repo })
    assertEquals(await catalogue(h, machines), '')
    let { result } = await load(h, machines, 'manual')
    assert(result.includes('user invocation only'))
    assert(!result.includes('Manual\n'))
  } finally {
    h.close()
    await at.free()
  }
})

test('resumed sessions use their own machines and never borrow parent files', async () => {
  let first = await scratchRepo()
  let second = await scratchRepo()
  let h = await harness()
  await h.g.apply([{
    entity: { eid: 'attached' },
    machine: { provider: 'process', state: 'running' },
  }])
  try {
    await write(first.repo, 'first-skill', 'First machine description')
    await write(second.repo, 'second-skill', 'Second machine description')
    await h.g.apply(
      ['parent', 'child'].map((session) => ({
        entity: { eid: session + '-machine' },
        machine: { provider: 'process', state: 'running' },
      })),
    )
    await h.g.apply(['parent', 'child'].map((session) => ({
      entity: { eid: session },
      session: {},
      home: { machine: session + '-machine' },
    })))
    let machines = attached(h, { parent: first.repo, child: second.repo })
    assert((await catalogue(h, machines, 'parent')).includes('First machine'))
    let discovered = await catalogue(h, machines, 'child')
    assert(discovered.includes('Second machine'))
    assert(!discovered.includes('First machine'))
    await write(second.repo, 'second-skill', 'Resumed child description')
    assert((await catalogue(h, machines, 'child')).includes('Resumed child'))
  } finally {
    h.close()
    await first.free()
    await second.free()
  }
})

test('command subdirectories load from the machine repository root without changing home', async () => {
  let at = await scratchRepo()
  let h = await harness()
  await h.g.apply([{
    entity: { eid: 'attached' },
    machine: { provider: 'process', state: 'running' },
  }])
  try {
    let body = await write(at.repo)
    await Deno.mkdir(`${at.repo}/commands`)
    await h.g.apply([{
      entity: { eid: 'session' },
      session: {},
      home: { machine: 'attached', cwd: `${at.repo}/commands` },
    }])
    let [before] = await h.g.get(['session'])
    let machines = attached(h, { session: `${at.repo}/commands` })
    let { result } = await load(h, machines, 'checking')
    assert(
      result.includes(`supporting files: ${at.repo}/.claude/skills/checking`),
    )
    assert(result.includes(body))
    assertEquals((await h.g.get(['session']))[0].home, before.home)
  } finally {
    h.close()
    await at.free()
  }
})

test('skill discovery ignores links and reports malformed authored metadata', async () => {
  let at = await scratchRepo()
  let other = await scratchRepo()
  let h = await harness()
  await h.g.apply([{
    entity: { eid: 'attached' },
    machine: { provider: 'process', state: 'running' },
  }])
  try {
    await write(other.repo, 'borrowed', 'Files belonging to another machine')
    await Deno.mkdir(`${at.repo}/.claude/skills`, { recursive: true })
    await Deno.symlink(
      `${other.repo}/.claude/skills/borrowed`,
      `${at.repo}/.claude/skills/borrowed`,
    )
    await h.g.apply([{
      entity: { eid: 'session' },
      session: {},
      home: { machine: 'attached' },
    }])
    let machines = attached(h, { session: at.repo })
    assertEquals(await catalogue(h, machines), '')
    await write(at.repo, 'bad', 'bad', 'body')
    await Deno.writeTextFile(
      `${at.repo}/.claude/skills/bad/SKILL.md`,
      'not frontmatter',
    )
    let { result } = await load(h, machines, 'bad')
    assert(result.includes('Cannot load'))
    assert(!result.includes('Files belonging to another machine'))
  } finally {
    h.close()
    await at.free()
    await other.free()
  }
})
