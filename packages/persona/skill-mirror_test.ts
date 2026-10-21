import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { and, eq, every, present } from '@yaks/query'
import { type Comp, derivedEid, type Graph } from '@yaks/graph'
import { fileOf } from '@yaks/file'
import { run } from '@yaks/git/land'
import { localFilesystem, repositoryEid } from '@yaks/git/host'
import { caught } from '@yaks/tracker/report'
import { syncSkills } from './skill-mirror.ts'
import { repoSkills, skillFiles, skillLocation } from './skills.ts'
import { world } from './testing.ts'
import { template } from '../git/testing.ts'

let text = (name = 'sample', body = 'Instructions\n') =>
  `---\nname: ${name}\ndescription: A useful skill\n---\n${body}`
let git = async (root: string, ...args: string[]) => {
  let r = await run(args, root)
  assert(r.ok, r.err)
  return r.out.trim()
}
// A repository on `main` holding one skill and its companion, built once and
// copied for each test.
let seeded = template(async (dir) => {
  let root = `${dir}/main`
  Deno.mkdirSync(`${root}/.claude/skills/sample`, { recursive: true })
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Test')
  await git(root, 'config', 'user.email', 'test@example.com')
  Deno.writeTextFileSync(`${root}/.claude/skills/sample/SKILL.md`, text())
  Deno.writeTextFileSync(
    `${root}/.claude/skills/sample/dom.ts`,
    'export let dom = 1\n',
  )
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'Initial skill')
})
let setup = async () => {
  let dir = await seeded()
  let root = `${dir}/main`
  let g = world()
  let workspace = (await localFilesystem(g)).entity.eid
  let repository = repositoryEid(`${root}/.git`, workspace)
  await g.apply([{
    entity: { eid: repository },
    repository: { workspace, common: `${root}/.git` },
  }])
  let memory = `${dir}/agreement.json`
  return { dir, root, repository, g, memory }
}
let files = async (g: Graph, repository: string) =>
  await g.read(and(present('file'), eq('file.root', repository), every()))

let master = await (async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await git(root, 'branch', '-m', 'master')
    let imported = await syncSkills(g, root, memory)
    if (imported.failed.length) return imported
    let [skill] = await repoSkills(g, repository)
    await g.apply([{
      entity: skill.entity,
      content: { body: 'Master instructions\n' },
    }])
    let unsafe = await syncSkills(g, root, memory, { worktree: root })
    let exported = await syncSkills(g, root, memory)
    return {
      read: imported.read.length,
      refused: unsafe.failed.length,
      wrote: exported.wrote.length,
      failed: exported.failed,
      landed: !!exported.landed,
      branch: await git(root, 'branch', '--show-current'),
      clean: await git(root, 'status', '--porcelain'),
      body: Deno.readTextFileSync(`${root}/.claude/skills/sample/SKILL.md`),
    }
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})()
test('skills mirror lands from a dedicated worktree onto primary branch master', () => {
  assertEquals(master, {
    read: 2,
    refused: 1,
    wrote: 1,
    failed: [],
    landed: true,
    branch: 'master',
    clean: '',
    body: text('sample', 'Master instructions\n'),
  })
})

test('skill mirror imports documents and tracked support without canonical oscillation', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    let unrelated = fileOf(repository, 'src/large.ts')
    await g.apply([{
      entity: { eid: unrelated },
      file: { path: 'src/large.ts', root: repository },
      content: { body: 'Unrelated repository content' },
    }, {
      entity: { eid: 'other-reference' },
      edge: { from: repository, to: unrelated },
      references: {},
    }])
    let read = g.read
    let extras: string[] = []
    g.read = async (...args) => {
      let rows = await read(...args)
      extras.push(
        ...rows.filter((b) =>
          [unrelated, 'other-reference'].includes(b.entity.eid)
        ).map((b) => b.entity.eid),
      )
      return rows
    }
    let first = await syncSkills(g, root, memory)
    assertEquals(first.failed, [])
    assertEquals(first.read.length, 2)
    let skills = await repoSkills(g, repository)
    assertEquals(skills.length, 1)
    assert(
      skills[0].entity.eid !=
        fileOf(repository, '.claude/skills/sample/SKILL.md'),
    )
    assertEquals((await files(g, repository)).length, 3)
    extras = []
    let second = await syncSkills(g, root, memory)
    assertEquals(second, {
      read: [],
      wrote: [],
      removed: [],
      conflicts: [],
      failed: [],
    })
    assertEquals(extras, [])
    assertEquals((await g.get([unrelated], ['content']))[0].content, {
      body: 'Unrelated repository content',
    })
    assertEquals(await git(root, 'status', '--porcelain'), '')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror graph edit lands a skill-only commit and leaves main clean', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'Updated instructions\n' },
    }])
    let result = await syncSkills(g, root, memory)
    assertEquals(result.failed, [])
    assertEquals(result.conflicts, [])
    assert(result.landed)
    assertEquals(await git(root, 'rev-parse', 'HEAD'), result.landed)
    assertEquals(await git(root, 'status', '--porcelain'), '')
    assertEquals(
      await git(
        root,
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        'HEAD',
      ),
      '.claude/skills/sample/SKILL.md',
    )
    assert(
      Deno.readTextFileSync(`${root}/.claude/skills/sample/SKILL.md`).endsWith(
        'Updated instructions\n',
      ),
    )
    assertEquals((await syncSkills(g, root, memory)).wrote, [])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror refuses concurrent divergence and dirty main graph exports', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'Graph edit\n' },
    }])
    let path = `${root}/.claude/skills/sample/SKILL.md`
    Deno.writeTextFileSync(path, text('sample', 'File edit\n'))
    let result = await syncSkills(g, root, memory)
    assertEquals(result.conflicts, [path])
    assertEquals(Deno.readTextFileSync(path), text('sample', 'File edit\n'))
    await git(root, 'checkout', '--', '.claude/skills/sample/SKILL.md')
    Deno.writeTextFileSync(`${root}/unrelated.txt`, 'precious\n')
    let blocked = await syncSkills(g, root, memory)
    assert(blocked.failed.some((s) => s.includes('primary checkout is dirty')))
    assertEquals(blocked.landed, undefined)
    assertEquals(Deno.readTextFileSync(path), text())
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror imports deletions without deleting unrelated entity state', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{ entity: { eid: skill.entity.eid }, persona: {} }])
    await git(
      root,
      'rm',
      '.claude/skills/sample/SKILL.md',
      '.claude/skills/sample/dom.ts',
    )
    await git(root, 'commit', '-m', 'Remove skill')
    let result = await syncSkills(g, root, memory)
    assertEquals(result.failed, [])
    assertEquals(result.read.length, 2)
    let kept =
      (await g.read(and(eq('entity.eid', skill.entity.eid), every())))[0]
    assert(kept.persona)
    assertEquals(kept.skill, undefined)
    assertEquals(kept.doc, undefined)
    assertEquals(kept.content, undefined)
    assertEquals(await files(g, repository), [])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror graph-only skill and companion creation lands safely', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let eid = crypto.randomUUID()
    let path = '.claude/skills/new-skill/SKILL.md'
    let fid = fileOf(repository, path)
    let dom = '.claude/skills/new-skill/dom.ts'
    await g.apply([
      {
        entity: { eid },
        skill: {},
        doc: { title: 'new-skill', body: 'New description' },
        content: { body: 'New instructions\n' },
      },
      { entity: { eid: fid }, file: { path, root: repository } },
      {
        entity: { eid: derivedEid(`skill-file|${eid}|${fid}`) },
        edge: { from: eid, to: fid },
        references: {},
      },
      {
        entity: { eid: fileOf(repository, dom) },
        file: { path: dom, root: repository },
        content: { body: 'export let dom = 2\n' },
      },
    ])
    let result = await syncSkills(g, root, memory)
    assertEquals(result.failed, [])
    assert(result.landed)
    assertEquals(
      Deno.readTextFileSync(`${root}/.claude/skills/new-skill/dom.ts`),
      'export let dom = 2\n',
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror title rename retains UUID and relocates companion identities', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      doc: { title: 'renamed' },
    }])
    let result = await syncSkills(g, root, memory)
    assertEquals(result.failed, [])
    assertEquals(result.conflicts, [])
    assert(result.landed)
    let current = (await repoSkills(g, repository))[0]
    assertEquals(current.entity.eid, skill.entity.eid)
    let locator = await skillLocation(g, current)
    assertEquals(locator?.file, {
      path: '.claude/skills/renamed/SKILL.md',
      root: repository,
    })
    assertEquals(
      (await skillFiles(g, repository)).get('.claude/skills/renamed/dom.ts'),
      'export let dom = 1\n',
    )
    assertEquals((await syncSkills(g, root, memory)).wrote, [])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror refuses binary and symlink tracked support without dropping graph content', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let path = `${root}/.claude/skills/sample/dom.ts`
    Deno.writeFileSync(path, new Uint8Array([0, 1, 2]))
    let binary = await syncSkills(g, root, memory)
    assert(binary.failed.length)
    assertEquals(
      (await skillFiles(g, repository)).get('.claude/skills/sample/dom.ts'),
      'export let dom = 1\n',
    )
    Deno.removeSync(path)
    Deno.symlinkSync('SKILL.md', path)
    await git(root, 'add', '.claude/skills/sample/dom.ts')
    let symlink = await syncSkills(g, root, memory)
    assert(symlink.failed.length)
    assertEquals(symlink.read, [])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror repository lock serializes imports and manual sync', async () => {
  let { dir, root, g, memory } = await setup()
  let marker = `${dir}/locked`
  let holder = new Deno.Command(Deno.execPath(), {
    args: [
      'eval',
      `
      let f = await Deno.open(${
        JSON.stringify(root + '/.git/skill-mirror.lock')
      }, {create:true,write:true})
      await f.lock(true)
      await Deno.writeTextFile(${JSON.stringify(marker)}, 'held')
      await Deno.stdin.read(new Uint8Array(1))
      f.close()
    `,
    ],
    stdin: 'piped',
    stdout: 'null',
    stderr: 'inherit',
  }).spawn()
  while (true) {
    try {
      await Deno.stat(marker)
      break
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  try {
    let finished = false
    let pending = syncSkills(g, root, memory).then((report) => {
      finished = true
      return report
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assertEquals(finished, false)
    await holder.stdin.close()
    assert((await holder.status).success)
    assertEquals((await pending).read.length, 2)
    // Persistent lock inode does not block a subsequent sync.
    assertEquals((await syncSkills(g, root, memory)).read, [])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror unexpected runner failure rejects and releases lock', async () => {
  let { dir, root, g, memory } = await setup()
  let fault = new Error('injected unexpected runner failure')
  try {
    let error = await assertRejects(
      () =>
        syncSkills(g, root, memory, {
          run: (args, cwd) => {
            if (args[0] == 'ls-files') throw fault
            return run(args, cwd)
          },
        }),
      Error,
      fault.message,
    )
    assert(error.message.includes(root))
    assertEquals(error, fault)
    let messages: string[] = []
    await caught(error, {
      sink: (rows) => {
        messages.push(
          ...rows.map((b) => String((b.exception as Comp)?.stack ?? '')),
        )
      },
    })
    assert(messages.some((message) => message.includes(root)))
    await assertRejects(
      () =>
        syncSkills(g, root, memory, {
          run: () =>
            Promise.resolve({
              ok: false,
              code: 128,
              out: '',
              err: 'injected Git I/O failure',
            }),
        }),
      Error,
      `skills at ${root}: injected Git I/O failure`,
    )
    assertEquals((await syncSkills(g, root, memory)).read.length, 2)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror unexpected graph failure rejects without agreement', async () => {
  let { dir, root, g, memory } = await setup()
  let fault = new Error('injected unexpected graph failure')
  let broken = new Proxy(g, {
    get(target, key) {
      if (key == 'apply') {
        return () => {
          throw fault
        }
      }
      let value = Reflect.get(target, key)
      return typeof value == 'function' ? value.bind(target) : value
    },
  })
  try {
    await assertRejects(
      () => syncSkills(broken, root, memory),
      Error,
      fault.message,
    )
    assertEquals((await syncSkills(g, root, memory)).read.length, 2)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror refuses title swaps without touching locators or main', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    Deno.mkdirSync(`${root}/.claude/skills/second`)
    Deno.writeTextFileSync(
      `${root}/.claude/skills/second/SKILL.md`,
      text('second', 'Second instructions\n'),
    )
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'Second skill')
    await syncSkills(g, root, memory)
    let skills = await repoSkills(g, repository)
    let sample = skills.find((b) => (b.doc as Comp)?.title == 'sample')!
    let second = skills.find((b) => (b.doc as Comp)?.title == 'second')!
    let head = await git(root, 'rev-parse', 'HEAD')
    await g.apply([
      { entity: { eid: sample.entity.eid }, doc: { title: 'second' } },
      { entity: { eid: second.entity.eid }, doc: { title: 'sample' } },
    ])
    let result = await syncSkills(g, root, memory)
    assertEquals(result.wrote, [])
    assertEquals(result.failed.length, 1)
    assertEquals(
      ((await skillLocation(g, sample))?.file as Comp)?.path,
      '.claude/skills/sample/SKILL.md',
    )
    assertEquals(
      ((await skillLocation(g, second))?.file as Comp)?.path,
      '.claude/skills/second/SKILL.md',
    )
    assertEquals(await git(root, 'rev-parse', 'HEAD'), head)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror leaves conflicted rename untouched when another skill lands', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    Deno.mkdirSync(`${root}/.claude/skills/other`)
    Deno.writeTextFileSync(
      `${root}/.claude/skills/other/SKILL.md`,
      text('other', 'Other instructions\n'),
    )
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'Other skill')
    await syncSkills(g, root, memory)
    let skills = await repoSkills(g, repository)
    let sample = skills.find((b) => (b.doc as Comp)?.title == 'sample')!
    let other = skills.find((b) => (b.doc as Comp)?.title == 'other')!
    await g.apply([
      { entity: { eid: sample.entity.eid }, doc: { title: 'renamed' } },
      {
        entity: { eid: other.entity.eid },
        content: { body: 'Other graph edit\n' },
      },
    ])
    Deno.mkdirSync(`${root}/.claude/skills/renamed`)
    Deno.writeTextFileSync(
      `${root}/.claude/skills/renamed/SKILL.md`,
      text('renamed', 'Concurrent destination\n'),
    )
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'Concurrent destination')
    let result = await syncSkills(g, root, memory)
    assertEquals(result.conflicts, [`${root}/.claude/skills/renamed/SKILL.md`])
    assert(result.landed)
    assertEquals(
      ((await skillLocation(g, sample))?.file as Comp)?.path,
      '.claude/skills/sample/SKILL.md',
    )
    assertEquals(
      Deno.readTextFileSync(`${root}/.claude/skills/sample/SKILL.md`),
      text(),
    )
    assertEquals(
      Deno.readTextFileSync(`${root}/.claude/skills/renamed/SKILL.md`),
      text('renamed', 'Concurrent destination\n'),
    )
    assert(
      Deno.readTextFileSync(`${root}/.claude/skills/other/SKILL.md`).includes(
        'Other graph edit',
      ),
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror unreadable memo is an unexpected I/O failure, not an empty agreement', async () => {
  let { dir, root, g, memory } = await setup()
  try {
    Deno.mkdirSync(memory)
    await assertRejects(
      () => syncSkills(g, root, memory),
      Deno.errors.IsADirectory,
    )
    Deno.removeSync(memory)
    assertEquals((await syncSkills(g, root, memory)).read.length, 2)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror serializes same-process manual callers', async () => {
  let { dir, root, g, memory } = await setup()
  try {
    let calls = await Promise.all([
      syncSkills(g, root, memory),
      syncSkills(g, root, memory),
    ])
    assertEquals(calls.map((r) => r.read.length), [2, 0])
    assertEquals((await repoSkills(g)).length, 1)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror blocks reads and same agreements across a conflicted rename', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      doc: { title: 'renamed' },
    }])
    let agreed = Deno.readTextFileSync(memory)
    Deno.mkdirSync(`${root}/.claude/skills/renamed`)
    Deno.writeTextFileSync(
      `${root}/.claude/skills/renamed/SKILL.md`,
      text('renamed', 'Conflict\n'),
    )
    Deno.writeTextFileSync(
      `${root}/.claude/skills/renamed/new.ts`,
      'new support\n',
    )
    Deno.removeSync(`${root}/.claude/skills/sample/dom.ts`)
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'Conflicted folder')
    let report = await syncSkills(g, root, memory)
    assertEquals(report.read, [])
    assertEquals(report.wrote, [])
    assertEquals(report.conflicts.length, 1)
    assertEquals(Deno.readTextFileSync(memory), agreed)
    assertEquals((await files(g, repository)).length, 2)
    assertEquals(
      ((await skillLocation(g, skill))?.file as Comp).path,
      '.claude/skills/sample/SKILL.md',
    )
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror advances a clean landed export branch after unrelated main commits', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'First export\n' },
    }])
    let first = await syncSkills(g, root, memory)
    assert(first.landed)
    Deno.writeTextFileSync(`${root}/unrelated`, 'Main advances\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'Unrelated advance')
    await g.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'Second export\n' },
    }])
    let second = await syncSkills(g, root, memory)
    assertEquals(second.failed, [])
    assertEquals(second.conflicts, [])
    assert(second.landed)
    assertEquals(Deno.readTextFileSync(`${root}/unrelated`), 'Main advances\n')
    assert(
      Deno.readTextFileSync(`${root}/.claude/skills/sample/SKILL.md`).endsWith(
        'Second export\n',
      ),
    )
    // A clean but unlanded branch must not be mistaken for an old agreement.
    Deno.writeTextFileSync(`${second.worktree}/unlanded`, 'Private change\n')
    await git(second.worktree!, 'add', '.')
    await git(second.worktree!, 'commit', '-m', 'Unlanded')
    await g.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'Third export\n' },
    }])
    let refused = await syncSkills(g, root, memory)
    assertEquals(refused.landed, undefined)
    assertEquals(refused.failed.length, 1)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror never adopts main or a dirty linked export worktree', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'Proposal\n' },
    }])
    let head = await git(root, 'rev-parse', 'HEAD')
    let refused = await syncSkills(g, root, memory, { worktree: root })
    assertEquals(refused.failed.length, 1)
    assertEquals(await git(root, 'rev-parse', 'HEAD'), head)
    assertEquals(await git(root, 'status', '--porcelain'), '')
    let tree = `${dir}/export`
    await git(root, 'worktree', 'add', '-b', 'dirty-export', tree, 'HEAD')
    Deno.writeTextFileSync(`${tree}/untracked`, 'Keep me\n')
    assertEquals(
      (await syncSkills(g, root, memory, { worktree: tree })).failed.length,
      1,
    )
    assertEquals(Deno.readTextFileSync(`${tree}/untracked`), 'Keep me\n')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror does not acknowledge or relink a landed rename with changed bytes', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      doc: { title: 'renamed' },
    }])
    let agreed = Deno.readTextFileSync(memory)
    let changed = false
    let report = await syncSkills(g, root, memory, {
      run: async (args, cwd) => {
        let result = await run(args, cwd)
        if (!changed && cwd == root && args[0] == 'merge' && result.ok) {
          changed = true
          Deno.writeTextFileSync(
            `${root}/.claude/skills/renamed/dom.ts`,
            'Concurrent post-land edit\n',
          )
        }
        return result
      },
    })
    assert(report.landed)
    assertEquals(report.conflicts.length, 1)
    assertEquals(
      ((await skillLocation(g, skill))?.file as Comp).path,
      '.claude/skills/sample/SKILL.md',
    )
    assertEquals(Deno.readTextFileSync(memory), agreed)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

test('skill mirror only acknowledges exact non-rename export bytes after landing', async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let skill = (await repoSkills(g, repository))[0]
    await g.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'Proposal\n' },
    }])
    let agreed = Deno.readTextFileSync(memory)
    let changed = false
    let report = await syncSkills(g, root, memory, {
      run: async (args, cwd) => {
        let result = await run(args, cwd)
        if (!changed && cwd == root && args[0] == 'merge' && result.ok) {
          changed = true
          Deno.writeTextFileSync(
            `${root}/.claude/skills/sample/SKILL.md`,
            text('sample', 'Concurrent\n'),
          )
        }
        return result
      },
    })
    assert(report.landed)
    assertEquals(report.conflicts.length, 1)
    assertEquals(Deno.readTextFileSync(memory), agreed)
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

let checkoutKinds = await (async () => {
  let { dir, root, g, memory } = await setup()
  try {
    await git(root, 'checkout', '--detach')
    let detached = await syncSkills(g, root, memory)
    await git(root, 'checkout', 'main')
    let linked = `${dir}/linked`
    await git(root, 'worktree', 'add', '-b', 'linked', linked)
    let child = await syncSkills(g, linked, memory)
    await git(root, 'symbolic-ref', 'HEAD', 'refs/heads/unborn')
    let unborn = await syncSkills(g, root, memory)
    let bareRoot = `${dir}/bare`
    await git(root, 'init', '--bare', bareRoot)
    let bare = await syncSkills(g, bareRoot, memory)
    return { detached, child, unborn, bare }
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})()

test('skills mirror refuses detached, linked and bare roots before importing', () => {
  for (
    let result of [
      checkoutKinds.detached,
      checkoutKinds.child,
      checkoutKinds.bare,
    ]
  ) {
    assertEquals(result.read, [])
    assertEquals(result.wrote, [])
    assertEquals(result.failed, [
      'skills: root must be a primary checkout on a branch',
    ])
  }
})

test('skills mirror imports tracked files on an unborn primary branch', () => {
  assertEquals(checkoutKinds.unborn.failed, [])
  assertEquals(checkoutKinds.unborn.read.length, 2)
})

let movedReference = await (async () => {
  let { dir, root, repository, g, memory } = await setup()
  try {
    await syncSkills(g, root, memory)
    let [skill] = await repoSkills(g, repository)
    let [edge] = await g.read(and(
      present('references'),
      eq('edge.from', skill.entity.eid),
      every(),
    ))
    let companion = fileOf(repository, '.claude/skills/sample/dom.ts')
    await git(root, 'rm', '.claude/skills/sample/SKILL.md')
    let apply = g.apply
    g.apply = async (...args) => {
      g.apply = apply
      await apply([{
        entity: edge.entity,
        edge: { to: companion },
      }])
      return apply(...args)
    }
    let result = await syncSkills(g, root, memory)
    let kept = (await g.get([skill.entity.eid]))[0]
    let reference = (await g.get([edge.entity.eid]))[0]
    return {
      conflicts: result.conflicts.length,
      read: result.read,
      kept: kept.content,
      to: (reference.edge as Comp).to,
      companion,
    }
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})()

test('skill deletion refuses a reference retargeted after its scope was read', () => {
  assertEquals(movedReference.conflicts, 1)
  assertEquals(movedReference.read, [])
  assertEquals(movedReference.kept, { body: 'Instructions\n' })
  assertEquals(movedReference.to, movedReference.companion)
})
