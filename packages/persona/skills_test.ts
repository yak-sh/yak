import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Bundle,
  derivedEid,
  type Graph,
  graph,
  Refused,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { gitDoc } from '@yaks/git'
import { fileOf } from '@yaks/file'
import { fileDoc } from '@yaks/file/vocab'
import { repositoryEid } from '@yaks/git/host'
import { loadVocab } from '@yaks/vocab'
import { personaDoc } from './comp.ts'
import { parseSkill } from './skill-text.ts'
import {
  graphSkill,
  loadSkill,
  repoSkills,
  skillCatalog,
  skillFiles,
  skillLocation,
  skillLocations,
  skillsAt,
  skillScope,
} from './skills.ts'

let repo = repositoryEid('/repo/.git', 'test-filesystem')
let elsewhere = repositoryEid('/elsewhere/.git', 'test-filesystem')

let vocab = loadVocab([docDoc, edgeDoc, fileDoc, gitDoc, personaDoc, {
  $defs: {
    content: {
      component: true,
      type: 'object',
      properties: { body: { type: 'string' } },
    },
    references: { component: true, type: 'object', edge: true },
  },
}], [edgeKeywords])

let world = (): Graph => graph({ vocab, storage: ram(vocab, { number: true }) })

let file = (repository: string, path: string): Bundle => ({
  entity: { eid: fileOf(repository, path) },
  file: { root: repository, path },
})

let skill = (eid: string, title: string, repository = repo): Bundle[] => {
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

let graphOnly = world()
await graphOnly.apply([
  ...skill('graph-one', 'same'),
  ...skill('graph-two', 'same', elsewhere),
  ...skill('graph-missing', 'missing'),
  { entity: { eid: 'graph-missing' }, content: null },
])

test('graph skill discovery returns scoped metadata without instruction bodies', async () => {
  let rows = await skillCatalog(graphOnly, repo)
  assertEquals(rows.map((b) => b.entity.eid), ['graph-one'])
  assertEquals(rows[0].doc, { title: 'same', body: 'About same' })
  assertEquals(rows[0].content, undefined)
})

test('graph skill loading selects the requested repository among matching titles', async () => {
  assertEquals(
    (await graphSkill(graphOnly, 'same', elsewhere)).entity.eid,
    'graph-two',
  )
})

test('graph skills are complete, sorted and repository-scoped', async () => {
  let g = world()
  await g.apply([
    ...skill('z', 'zebra'),
    ...skill('a', 'apple'),
    ...skill('other', 'other', elsewhere),
    ...skill('no-body', 'incomplete'),
    { entity: { eid: 'no-body' }, content: null },
    ...skill('no-description', 'empty'),
    { entity: { eid: 'no-description' }, doc: { body: '' } },
    ...skill('wrong-path', 'wrong').slice(0, 1),
    file(repo, '../SKILL.md'),
    {
      entity: { eid: 'unsafe-location' },
      edge: { from: 'wrong-path', to: file(repo, '../SKILL.md').entity.eid },
      references: {},
    },
  ])
  assertEquals((await repoSkills(g, repo)).map((b) => b.entity.eid), [
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

let safeFiles = world()
let support = (path: string, body: string, repository = repo): Bundle => ({
  ...file(repository, path),
  content: { body },
})
await safeFiles.apply([
  ...skill('a', 'review'),
  support('.claude/skills/review/scripts/check.ts', 'check()\n'),
  support('.claude/skills/missing/notes.txt', 'orphan'),
  support('.claude/skills/review/../../escape', 'escape'),
  support('.claude/skills/review/a\\b', 'escape'),
  support('.claude/skills/review/other.txt', 'other', elsewhere),
  file(repo, '.claude/skills/review/image.png'),
])

test('skillFiles renders documents and only safe text under owned directories', async () => {
  let files = await skillFiles(safeFiles, repo)
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
    fileOf(repo, '.claude/skills/review/SKILL.md'),
  )
  assertEquals(await skillLocation(g, 'held'), location)
  assertEquals(location?.content, undefined)
  assertEquals(await skillLocation(g, 'absent'), undefined)
  await assertRejects(() => loadSkill(g, 'absent'), Refused, 'No skill')
  let second = file(repo, '.claude/skills/second/SKILL.md')
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

let located = world()
let many = Array.from({ length: 12 }, (_, i) => `bulk-${i}`)
await located.apply(many.flatMap((id) => skill(id, id)))

test('bulk skill locations keep identity and scope within bounded reads', async () => {
  let reads = 0
  let g: Graph = {
    ...located,
    read: (...args) => (reads++, located.read(...args)),
    get: (...args) => (reads++, located.get(...args)),
  }
  let locations = await skillLocations(g, [...many, 'absent'])
  assertEquals([...locations.keys()], many)
  for (let id of many) {
    assertEquals(
      locations.get(id)?.file,
      file(repo, `.claude/skills/${id}/SKILL.md`).file,
    )
  }
  assert(reads <= 2, `Location reads grew with skills: ${reads}`)
})

test('bulk skill locations respect hidden edges and masked file aspects', async () => {
  let g: Graph = {
    ...located,
    read: async (...args) =>
      (await located.read(...args)).filter((b) =>
        (b.edge as { from?: string })?.from != many[0]
      ),
    get: async (...args) =>
      (await located.get(...args)).map((b) =>
        b.entity.eid ==
            file(repo, `.claude/skills/${many[1]}/SKILL.md`).entity.eid
          ? { entity: b.entity }
          : b
      ),
  }
  let locations = await skillLocations(g, many)
  assertEquals([...locations.keys()], many.slice(2))
})

test('a masked source property keeps the matching skill locator', async () => {
  let g: Graph = {
    ...located,
    read: async (...args) =>
      (await located.read(...args)).map((b) => ({
        ...b,
        edge: { to: (b.edge as { to: string }).to },
      })),
  }
  let locations = await skillLocations(g, many.slice(0, 2))
  assertEquals([...locations.keys()], many.slice(0, 2))
})

let renamedGraph = world()
await renamedGraph.apply([
  ...skill('held', 'old-name'),
  {
    ...file(repo, '.claude/skills/old-name/scripts/dom.ts'),
    content: { body: 'dom()\n' },
  },
  {
    ...file(repo, '.claude/skills/old-name/notes/readme.md'),
    content: { body: 'notes' },
  },
  { entity: { eid: 'held' }, doc: { title: 'new-name' } },
])

test('graph title renames move companion suffixes before the locator changes', async () => {
  let g = renamedGraph
  let files = await skillFiles(g, repo)
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
    root: repo,
    path: '.claude/skills/old-name/SKILL.md',
  })
  assertEquals((await repoSkills(g, repo))[0].entity.eid, 'held')
})

let duplicateTitles = world()
await duplicateTitles.apply([
  ...skill('one', 'old'),
  ...skill('two', 'new'),
  { entity: { eid: 'one' }, doc: { title: 'new' } },
])
let companionCollision = world()
await companionCollision.apply([
  ...skill('one', 'old'),
  { entity: { eid: 'one' }, doc: { title: 'new' } },
  {
    ...file(repo, '.claude/skills/old/scripts/check.ts'),
    content: { body: 'old' },
  },
  {
    ...file(repo, '.claude/skills/new/scripts/check.ts'),
    content: { body: 'new' },
  },
])

test('skillFiles refuses duplicate titles and renamed companion destinations', async () => {
  await assertRejects(
    () => skillFiles(duplicateTitles, repo),
    Refused,
    'targets',
  )
})

test('skillFiles refuses a renamed companion overwriting its destination', async () => {
  await assertRejects(
    () => skillFiles(companionCollision, repo),
    Refused,
    '.claude/skills/new/scripts/check.ts',
  )
})

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

let scoped = world()
await scoped.apply([
  ...skill('scoped', 'scoped'),
  ...skill('outside', 'outside', elsewhere),
  file(repo, 'notes.md'),
  {
    entity: { eid: 'support-reference' },
    edge: {
      from: 'scoped',
      to: file(repo, 'notes.md').entity.eid,
    },
    references: {},
  },
])

test('a skill scope keeps all reference evidence for only its selected skills', async () => {
  let { skills, places, edges } = await skillScope(scoped, repo)
  assertEquals(skills.map((b) => b.entity.eid), ['scoped'])
  assertEquals(
    places.get('scoped')?.file,
    file(repo, '.claude/skills/scoped/SKILL.md').file,
  )
  assertEquals(
    new Set(edges.map((b) => b.entity.eid)),
    new Set([
      skill('scoped', 'scoped')[2].entity.eid,
      'support-reference',
    ]),
  )
  assert(edges.every((b) => (b.edge as { from: string }).from == 'scoped'))
  assert(edges.every((b) => b.references != undefined))
})

test('a skill scope preserves masked reference evidence without leaking sources', async () => {
  let g: Graph = {
    ...scoped,
    read: async (...args) =>
      (await scoped.read(...args)).map((b) =>
        b.edge
          ? {
            ...b,
            edge: { to: (b.edge as { to: string }).to },
          }
          : b
      ),
  }
  let { skills, edges } = await skillScope(g, repo)
  assertEquals(skills.map((b) => b.entity.eid), ['scoped'])
  assertEquals(edges.length, 2)
  assert(edges.every((b) => (b.edge as { from?: string }).from == undefined))
})

let inventoried = world()
let companion = file(repo, '.claude/skills/visible/helper.ts')
let hidden = file(repo, '.claude/skills/hidden/SKILL.md')
await inventoried.apply([
  ...skill('visible', 'visible'),
  ...skill('hidden', 'hidden'),
  { ...companion, content: { body: 'Visible support\n' } },
  ...skill('foreign', 'foreign', elsewhere),
])
let restricted: Graph = {
  ...inventoried,
  read: async (...args) =>
    (await inventoried.read(...args)).filter((b) =>
      b.entity.eid != hidden.entity.eid
    ).map((b) =>
      b.entity.eid == companion.entity.eid
        ? { entity: b.entity, file: b.file }
        : b
    ),
  get: async (...args) =>
    (await inventoried.get(...args)).filter((b) =>
      b.entity.eid != hidden.entity.eid
    ),
}

test('a skill scope respects hidden locators and masked companion bodies', async () => {
  let { skills, files } = await skillScope(restricted, repo, true)
  assertEquals(skills.map((b) => b.entity.eid), ['visible'])
  assertEquals(
    files.find((b) => b.entity.eid == companion.entity.eid)?.content,
    undefined,
  )
  assert(
    files.every((b) => (b.file as { root: string }).root == repo),
  )
  let rendered = await skillFiles(restricted, repo)
  assertEquals([...rendered.keys()], ['.claude/skills/visible/SKILL.md'])
})

let ambiguous = world()
let otherLocation = file(elsewhere, '.claude/skills/visible/SKILL.md')
await ambiguous.apply([
  ...skill('ambiguous', 'visible'),
  otherLocation,
  {
    entity: { eid: derivedEid('other-locator') },
    edge: { from: 'ambiguous', to: otherLocation.entity.eid },
    references: {},
  },
])

test('repository selection still refuses a second locator in another repository', async () => {
  await assertRejects(
    () => skillScope(ambiguous, repo, true),
    Refused,
    'references more than one SKILL.md',
  )
})
