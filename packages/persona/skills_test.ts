import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Bundle,
  derivedEid,
  type Graph,
  graph,
  identityEid,
  Refused,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { gitDoc } from '@yaks/git'
import { loadVocab } from '@yaks/vocab'
import { personaDoc } from './comp.ts'
import { parseSkill } from './skill-text.ts'
import {
  loadSkill,
  repoSkills,
  skillFiles,
  skillLocation,
  skillsAt,
} from './skills.ts'

let world = (): Graph => {
  let vocab = loadVocab([docDoc, edgeDoc, gitDoc, personaDoc, {
    $defs: {
      content: {
        component: true,
        type: 'object',
        properties: { body: { type: 'string' } },
      },
      references: { component: true, type: 'object', edge: true },
    },
  }], [edgeKeywords])
  return graph({ vocab, storage: ram(vocab, { number: true }) })
}

let file = (repository: string, path: string): Bundle => ({
  entity: { eid: identityEid('file', [path, repository]) },
  file: { repository, path },
})

let skill = (eid: string, title: string, repository = 'repo'): Bundle[] => {
  let location = file(repository, `.claude/skills/${title}/SKILL.md`)
  return [
    {
      entity: { eid },
      skill: {},
      doc: { title, body: `About ${title}` },
      content: { body: `Instructions for ${title}\n` },
    },
    location,
    {
      entity: { eid: derivedEid(`skill-file|${eid}|${location.entity.eid}`) },
      edge: { from: eid, to: location.entity.eid },
      references: {},
    },
  ]
}

let source = (title: string, description: string, body: string): string =>
  `---\nname: ${title}\ndescription: ${description}\n---\n${body}`

let write = async (
  root: string,
  title: string,
  description = `Local ${title}`,
  body = `Local instructions for ${title}\n`,
): Promise<void> => {
  let dir = `${root}/.claude/skills/${title}`
  await Deno.mkdir(dir, { recursive: true })
  await Deno.writeTextFile(`${dir}/SKILL.md`, source(title, description, body))
}

let git = async (cwd: string, ...args: string[]): Promise<string> => {
  let result = await new Deno.Command('git', {
    cwd,
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

let fixture = async (
  run: (g: Graph, root: string, repository: string) => Promise<void>,
): Promise<void> => {
  let root = await Deno.makeTempDir()
  try {
    await git(root, 'init', '-q')
    let common = await Deno.realPath(`${root}/.git`)
    let g = world()
    let repository = identityEid('repository', [common])
    await g.apply([{ entity: { eid: repository }, repository: { common } }])
    await run(g, root, repository)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
}

test('graph skills are complete, sorted and repository-scoped', async () => {
  let g = world()
  await g.apply([
    ...skill('z', 'zebra'),
    ...skill('a', 'apple'),
    ...skill('other', 'other', 'elsewhere'),
    ...skill('no-body', 'incomplete'),
    { entity: { eid: 'no-body' }, content: null },
    ...skill('no-description', 'empty'),
    { entity: { eid: 'no-description' }, doc: { body: '' } },
    ...skill('wrong-path', 'wrong').slice(0, 1),
    file('repo', '../SKILL.md'),
    {
      entity: { eid: 'unsafe-location' },
      edge: { from: 'wrong-path', to: file('repo', '../SKILL.md').entity.eid },
      references: {},
    },
  ])
  assertEquals((await repoSkills(g, 'repo')).map((b) => b.entity.eid), [
    'a',
    'z',
  ])
  assertEquals((await skillsAt(g)).map((b) => b.entity.eid), [
    'a',
    'other',
    'wrong-path',
    'z',
  ])
})

test('skillFiles renders documents and only safe text under owned directories', async () => {
  let g = world()
  let support = (path: string, body: string, repository = 'repo'): Bundle => ({
    ...file(repository, path),
    content: { body },
  })
  await g.apply([
    ...skill('a', 'review'),
    support('.claude/skills/review/scripts/check.ts', 'check()\n'),
    support('.claude/skills/missing/notes.txt', 'orphan'),
    support('.claude/skills/review/../../escape', 'escape'),
    support('.claude/skills/review/a\\b', 'escape'),
    support('.claude/skills/review/other.txt', 'other', 'elsewhere'),
    file('repo', '.claude/skills/review/image.png'),
  ])
  let files = await skillFiles(g, 'repo')
  assertEquals([...files.keys()], [
    '.claude/skills/review/SKILL.md',
    '.claude/skills/review/scripts/check.ts',
  ])
  let parsed = parseSkill(
    files.get('.claude/skills/review/SKILL.md')!,
    'review',
  )
  assertEquals(parsed.doc, { title: 'review', body: 'About review' })
  assertEquals(parsed.content.body, 'Instructions for review\n')
  assertEquals(files.get('.claude/skills/review/scripts/check.ts'), 'check()\n')
})

test('skill locations accept identity or bundle and never put file on the skill', async () => {
  let g = world()
  await g.apply(skill('held', 'review'))
  let held = await loadSkill(g, 'review')
  assertEquals(held.file, undefined)
  let location = await skillLocation(g, held)
  assertEquals(
    location?.entity.eid,
    identityEid('file', ['.claude/skills/review/SKILL.md', 'repo']),
  )
  assertEquals(await skillLocation(g, 'held'), location)
  assertEquals(location?.content, undefined)
  assertEquals(await skillLocation(g, 'absent'), undefined)
  await assertRejects(() => loadSkill(g, 'absent'), Refused, 'No skill')
  let second = file('repo', '.claude/skills/second/SKILL.md')
  await g.apply([second, {
    entity: { eid: derivedEid(`skill-file|held|${second.entity.eid}`) },
    edge: { from: 'held', to: second.entity.eid },
    references: {},
  }])
  await assertRejects(
    () => skillLocation(g, 'held'),
    Refused,
    'more than one SKILL.md',
  )
})

test('graph title renames move companion suffixes before the locator changes', async () => {
  let g = world()
  await g.apply([
    ...skill('held', 'old-name'),
    {
      ...file('repo', '.claude/skills/old-name/scripts/dom.ts'),
      content: { body: 'dom()\n' },
    },
    {
      ...file('repo', '.claude/skills/old-name/notes/readme.md'),
      content: { body: 'notes' },
    },
    { entity: { eid: 'held' }, doc: { title: 'new-name' } },
  ])
  let files = await skillFiles(g, 'repo')
  assertEquals([...files.keys()], [
    '.claude/skills/new-name/SKILL.md',
    '.claude/skills/new-name/notes/readme.md',
    '.claude/skills/new-name/scripts/dom.ts',
  ])
  assertEquals(files.get('.claude/skills/new-name/scripts/dom.ts'), 'dom()\n')
  assertEquals(
    parseSkill(files.get('.claude/skills/new-name/SKILL.md')!, 'new-name').doc
      .title,
    'new-name',
  )
  assertEquals((await skillLocation(g, 'held'))?.file, {
    repository: 'repo',
    path: '.claude/skills/old-name/SKILL.md',
  })
  assertEquals((await repoSkills(g, 'repo'))[0].entity.eid, 'held')
})

test('skillFiles refuses duplicate titles and renamed companion destinations', async () => {
  let g = world()
  await g.apply([
    ...skill('one', 'old'),
    ...skill('two', 'new'),
    { entity: { eid: 'one' }, doc: { title: 'new' } },
  ])
  await assertRejects(() => skillFiles(g, 'repo'), Refused, 'targets')
  await g.apply([{ entity: { eid: 'two' }, $delete: true }])
  await g.apply([
    {
      ...file('repo', '.claude/skills/old/scripts/check.ts'),
      content: { body: 'old' },
    },
    {
      ...file('repo', '.claude/skills/new/scripts/check.ts'),
      content: { body: 'new' },
    },
  ])
  await assertRejects(
    () => skillFiles(g, 'repo'),
    Refused,
    '.claude/skills/new/scripts/check.ts',
  )
})

test('local description and body edits preserve graph identity without import', () =>
  fixture(async (g, root, repository) => {
    await g.apply([...skill('held', 'review', repository)])
    await write(
      root,
      'review',
      'Revised description',
      '# Revised instructions\n',
    )
    await Deno.mkdir(`${root}/nested`)
    let local = await loadSkill(g, 'review', `${root}/nested`)
    assertEquals(local.entity.eid, 'held')
    assertEquals(local.doc, { title: 'review', body: 'Revised description' })
    assertEquals(local.content, { body: '# Revised instructions\n' })
    assertEquals((await loadSkill(g, 'review')).doc, {
      title: 'review',
      body: 'About review',
    })
    assertEquals((await loadSkill(g, 'review')).content, {
      body: 'Instructions for review\n',
    })
    await write(root, 'review', 'Second edit', 'Second body')
    assertEquals((await loadSkill(g, 'review', root)).content, {
      body: 'Second body',
    })
  }))

test('untracked additions, folder renames and deletions replace the graph view', () =>
  fixture(async (g, root, repository) => {
    await g.apply([
      ...skill('held', 'old', repository),
      ...skill('deleted', 'deleted', repository),
    ])
    await write(root, 'old')
    await write(root, 'fresh')
    await Deno.rename(
      `${root}/.claude/skills/old`,
      `${root}/.claude/skills/renamed`,
    )
    await write(root, 'renamed', 'Renamed description', 'Renamed instructions')
    let local = await skillsAt(g, root)
    assertEquals(local.map((b) => b.doc), [
      { title: 'fresh', body: 'Local fresh' },
      { title: 'renamed', body: 'Renamed description' },
    ])
    assert(
      local.every((b) => b.entity.eid != 'held' && b.entity.eid != 'deleted'),
    )
    assertEquals(
      (await loadSkill(g, 'fresh', root)).entity.eid,
      local[0].entity.eid,
    )
    await assertRejects(() => loadSkill(g, 'old', root), Refused, 'No skill')
    assertEquals((await repoSkills(g, repository)).length, 2)
    await Deno.remove(`${root}/.claude`, { recursive: true })
    assertEquals(await skillsAt(g, root), [])
  }))

test('checkout overlays never borrow a matching title from another repository', () =>
  fixture(async (g, root, repository) => {
    await g.apply([
      ...skill('here', 'review', repository),
      ...skill('there', 'review', 'elsewhere'),
    ])
    await write(root, 'review')
    assertEquals((await loadSkill(g, 'review', root)).entity.eid, 'here')
    await assertRejects(() => loadSkill(g, 'review'), Refused, 'more than one')
    await Deno.remove(`${root}/.claude`, { recursive: true })
    assertEquals(await skillsAt(g, root), [])
    assertEquals((await repoSkills(g, 'elsewhere')).map((b) => b.entity.eid), [
      'there',
    ])
  }))

test('local skill directories and documents never follow symlinks', () =>
  fixture(async (g, root) => {
    await write(root, 'real')
    await Deno.symlink(
      `${root}/.claude/skills/real`,
      `${root}/.claude/skills/link`,
    )
    await Deno.mkdir(`${root}/.claude/skills/file-link`)
    await Deno.symlink(
      `${root}/.claude/skills/real/SKILL.md`,
      `${root}/.claude/skills/file-link/SKILL.md`,
    )
    assertEquals((await skillsAt(g, root)).map((b) => b.doc), [
      { title: 'real', body: 'Local real' },
    ])
    await Deno.rename(`${root}/.claude/skills`, `${root}/outside`)
    await Deno.symlink(`${root}/outside`, `${root}/.claude/skills`)
    assertEquals(await skillsAt(g, root), [])
  }))

test('malformed local frontmatter is refused, not replaced with stale graph text', () =>
  fixture(async (g, root, repository) => {
    await g.apply([...skill('held', 'review', repository)])
    await write(root, 'review')
    await Deno.writeTextFile(
      `${root}/.claude/skills/review/SKILL.md`,
      'not a skill',
    )
    await assertRejects(() => skillsAt(g, root), Refused, 'Cannot load')
  }))

test('linked checkouts scope graph identities by their shared git common directory', () =>
  fixture(async (g, root, repository) => {
    await g.apply(skill('held', 'review', repository))
    await write(root, 'review')
    await git(root, 'add', '.')
    await git(
      root,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'skill',
    )
    let linked = await Deno.makeTempDir()
    try {
      await git(root, 'worktree', 'add', '-q', '--detach', linked)
      await write(linked, 'review', 'Linked edit', 'Linked instructions')
      assertEquals((await loadSkill(g, 'review', linked)).entity.eid, 'held')
      assertEquals((await loadSkill(g, 'review', linked)).content, {
        body: 'Linked instructions',
      })
      assertEquals((await loadSkill(g, 'review', root)).content, {
        body: 'Local instructions for review\n',
      })
      assertEquals((await loadSkill(g, 'review')).content, {
        body: 'Instructions for review\n',
      })
    } finally {
      await git(root, 'worktree', 'remove', '--force', linked)
    }
  }))

test('unregistered repositories get temporary views rather than borrowing graph names', () =>
  fixture(async (g, root, repository) => {
    await g.apply([{ entity: { eid: repository }, $delete: true }])
    await g.apply(skill('elsewhere', 'review', 'another-repository'))
    await write(root, 'review')
    let before = await repoSkills(g)
    let local = await loadSkill(g, 'review', root)
    assert(local.entity.eid.startsWith('view:skill:'))
    assertEquals(await repoSkills(g), before)
  }))

test('skill catalogue filters authored refusals but propagates unexpected metadata errors', async () => {
  let unexpected = new Error('unexpected skill metadata access')
  let b = skill('broken', 'broken')[0]
  b.skill = {
    get invoke(): string {
      throw unexpected
    },
  }
  // Read boundary fixture: a driver failure must not look like an empty catalogue.
  let g = world()
  g.read = () => Promise.resolve([b])
  let caught: unknown
  try {
    await repoSkills(g)
  } catch (error) {
    caught = error
  }
  assertEquals(caught, unexpected)
  b.skill = { invoke: 'neither' }
  assertEquals(await repoSkills(g), [])
})
