// A fake provider sees descriptions first, asks the single loader, and receives
// exact instructions beside its existing image context. All checkouts are ours.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, derivedEid, Refused } from '@yaks/graph'
import { artifactStore } from '@yaks/blob'
import type { Item, Request } from '@yaks/model'
import { sessionTools, usingBefore } from '@yaks/session'
import { local } from './local.ts'
import { skillCwd, skillItems, skillTools } from './skills.ts'
import { workspace } from './workspace.ts'
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
let instructions = (req: Request) =>
  req.items.filter((i) => i.kind == 'instruction').map((i) => i.text).join('\n')
let text = (req: Request) =>
  req.items.filter((i) => 'text' in i).map((i) => i.text).join('\n')
let answer = (req: Request, items: Item[]) =>
  Promise.resolve({ id: crypto.randomUUID(), model: req.model, items })

let png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
)

test('native descriptions load exact attributed instructions on demand and keep source-bound images', async () => {
  let at = await scratchRepo()
  let h = await harness()
  let body = await write(at.repo)
  let picture = await artifactStore(h.artifacts)(png, 'image/png')
  await h.g.apply([{ entity: { eid: 'picture' }, artifact: picture }])
  let seen: Request[] = []
  let a = local({
    h,
    cwd: at.repo,
    worktrees: at.root,
    name: 'fake',
    model: (req) => {
      seen.push(req)
      if (seen.length == 1) {
        assert(instructions(req).includes('Check observable behavior'))
        assert(!text(req).includes(body))
        assertEquals(req.tools.filter((t) => t.name == 'skill_read').length, 1)
        return answer(req, [{
          kind: 'call',
          id: 'load-skill',
          name: 'skill_read',
          args: '{"skill":"checking"}',
        }, {
          kind: 'call',
          id: 'view-image',
          name: 'image_view',
          args: '{"artifact":"picture"}',
        }])
      }
      let loaded = req.items.find((i) =>
        i.kind == 'result' && i.id == 'load-skill'
      )
      assert(loaded?.kind == 'result')
      assert(loaded.output.includes(body))
      assert(loaded.output.includes(`${at.repo}/.claude/skills/checking`))
      assertEquals(req.items.filter((i) => i.kind == 'image').length, 1)
      assert(instructions(req).includes('Check observable behavior'))
      return answer(req, [{ kind: 'assistant', text: 'checked' }])
    },
  })
  try {
    let session = await a.start('Check the observable behavior')
    await a.idle(session)
    assertEquals(seen.length, 2)
    let entries = await a.transcript(session)
    assertEquals(entries.filter((e) => e.exception).length, 0)
    let asked = entries.find((e) => (e.call as Comp)?.id == 'load-skill')!
    let id = derivedEid(`harness graph tool ${asked.entity.eid}`)
    let [call] = await h.g.get([id])
    assertEquals((call.created as Comp).by, session)
    // Read-only graph answers are not imported. The transcript's result keeps
    // the loaded instructions with its outer call as output.source.
    let outputs = await h.g.read(
      `.output.source=${JSON.stringify(asked.entity.eid)}&*`,
    )
    assert(
      outputs.some((e) => String((e.content as Comp)?.body).includes(body)),
    )
    assertEquals((await h.g.read('.skill')).length, 0)
    await a.send(session, 'Continue checking')
    await a.idle(session)
    assertEquals(seen.length, 3)
    assertEquals(seen[2].items.filter((i) => i.kind == 'image').length, 1)
  } finally {
    await a.close()
    await at.free()
  }
})

test('native catalogue refreshes local edits, additions and deletions before each ask', async () => {
  let at = await scratchRepo()
  let h = await harness()
  await write(at.repo)
  let seen: Request[] = []
  let a = local({
    h,
    cwd: at.repo,
    name: 'fake',
    model: (req) => {
      seen.push(req)
      return answer(req, [{ kind: 'assistant', text: 'ok' }])
    },
  })
  try {
    let session = await a.start('First')
    await a.idle(session)
    await write(at.repo, 'checking', 'Changed description', 'Changed body\n')
    await write(at.repo, 'new-skill', 'A newly available workflow')
    await a.send(session, 'Second')
    await a.idle(session)
    assert(instructions(seen[1]).includes('Changed description'))
    assert(instructions(seen[1]).includes('A newly available workflow'))
    assert(!text(seen[1]).includes('Changed body'))
    await Deno.remove(`${at.repo}/.claude/skills`, { recursive: true })
    await a.send(session, 'Third')
    await a.idle(session)
    assert(!instructions(seen[2]).includes('Repository skills'))
    assertEquals((await h.g.read('.skill')).length, 0)
  } finally {
    await a.close()
    await at.free()
  }
})

test('explicit tool registries and transcript allowlists suppress loader and catalogue', async () => {
  let at = await scratchRepo()
  let h = await harness()
  await write(at.repo)
  let seen: Request[] = []
  let a = local({
    h,
    cwd: at.repo,
    name: 'fake',
    tools: [],
    model: (req) => {
      seen.push(req)
      return answer(req, [{ kind: 'assistant', text: 'ok' }])
    },
  })
  try {
    let session = await a.start('First')
    await a.idle(session)
    assertEquals(seen[0].tools, [])
    assert(!instructions(seen[0]).includes('Repository skills'))
  } finally {
    await a.close()
  }
  h = await harness()
  a = local({
    h,
    cwd: at.repo,
    name: 'fake',
    model: (req) => {
      seen.push(req)
      return answer(req, [{ kind: 'assistant', text: 'ok' }])
    },
  })
  try {
    let session = await a.start('First default')
    await a.idle(session)
    assert(instructions(seen[1]).includes('Repository skills'))
    await h.g.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session },
      notice: {},
      using: { ...usingBefore(await a.transcript(session)), tools: ['read'] },
    }])
    await a.send(session, 'Restricted')
    await a.idle(session)
    assertEquals(seen[2].tools.map((t) => t.name), ['read'])
    assert(!instructions(seen[2]).includes('Repository skills'))
  } finally {
    await a.close()
    await at.free()
  }
})

test('user-only skills are absent from model discovery and refused by the loader', async () => {
  let at = await scratchRepo()
  let h = await harness()
  try {
    await write(
      at.repo,
      'manual',
      'Only a person asks for this',
      'Manual\n',
      'disable-model-invocation: true\n',
    )
    await h.g.apply([{
      entity: { eid: 'session' },
      session: {},
      home: { cwd: at.repo },
    }])
    let tools = skillTools(h.g, at.repo)
    assertEquals(await skillItems(h.g, { session: 'session', tools }), [])
    let call: Bundle = {
      entity: { eid: 'outer' },
      call: { id: 'manual' },
      entry: { session: 'session' },
    }
    await h.g.apply([call])
    let result = await tools[0].run({ skill: 'manual' }, {
      session: 'session',
      call,
      entries: [call],
    })
    assert(result.includes('user invocation only'))
    assert(!result.includes('Manual\n'))
    assertEquals((await h.g.get(['session']))[0].home, {
      cwd: at.repo,
      worktree: null,
    })
    await h.g.apply([{
      entity: { eid: 'session' },
      home: { worktree: 'missing' },
    }])
    await assertRejects(() => skillCwd(h.g, 'session', at.repo), Refused)
  } finally {
    h.close()
    await at.free()
  }
})

test('fork and resumed sessions read their own home checkout without borrowing parent skills', async () => {
  let first = await scratchRepo()
  let second = await scratchRepo()
  let h = await harness()
  await write(first.repo, 'first-skill', 'First repository description')
  await write(second.repo, 'second-skill', 'Second repository description')
  let seen = new Map<string, Request>()
  let a = local({
    h,
    cwd: first.repo,
    name: 'fake',
    model: (req) => {
      seen.set(req.conversation!, req)
      return answer(req, [{ kind: 'assistant', text: 'ok' }])
    },
  })
  try {
    let parent = await a.start('Parent')
    await a.idle(parent)
    let entries = await a.transcript(parent)
    let call: Bundle = {
      entity: { eid: crypto.randomUUID() },
      call: {},
      entry: { session: parent },
      notice: {},
    }
    await h.g.apply([call])
    let fork = sessionTools(h.g, workspace(h.g, first.repo, first.root))
      .find((tool) => tool.name == 'fork')!
    let child = String(
      await fork.run({ prompt: 'Child', home: second.repo }, {
        session: parent,
        entries,
        call,
      }),
    )
    await a.idle(child)
    assert(instructions(seen.get(child)!).includes('Second repository'))
    assert(!instructions(seen.get(child)!).includes('First repository'))
    assert(instructions(seen.get(parent)!).includes('First repository'))
    await write(second.repo, 'second-skill', 'Resumed child description')
    await a.send(child, 'Continue')
    await a.idle(child)
    assert(instructions(seen.get(child)!).includes('Resumed child description'))
    assert(!instructions(seen.get(child)!).includes('First repository'))
  } finally {
    await a.close()
    await first.free()
    await second.free()
  }
})

test('a session command subdirectory loads from the repository root without changing home', async () => {
  let at = await scratchRepo()
  let h = await harness()
  try {
    let body = await write(at.repo)
    await Deno.mkdir(`${at.repo}/commands`)
    await h.g.apply([{
      entity: { eid: 'subdirectory' },
      session: {},
      home: { cwd: `${at.repo}/commands` },
    }])
    let [before] = await h.g.get(['subdirectory'])
    let call: Bundle = {
      entity: { eid: 'load-from-command-directory' },
      call: { id: 'load' },
      entry: { session: 'subdirectory' },
    }
    await h.g.apply([call])
    let tools = skillTools(h.g)
    let result = await tools[0].run({ skill: 'checking' }, {
      session: 'subdirectory',
      call,
      entries: [call],
    })
    assert(
      result.includes(`supporting files: ${at.repo}/.claude/skills/checking`),
    )
    assert(!result.includes(`${at.repo}/commands/.claude/skills/checking`))
    assert(result.includes(body))
    let [after] = await h.g.get(['subdirectory'])
    assertEquals(after.home, before.home)
  } finally {
    h.close()
    await at.free()
  }
})
