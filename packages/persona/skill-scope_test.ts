// Repository consumers read their own instructions. Locator ambiguity stays
// local to each selected skill, including its references across repositories.
import { equal, ok, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import {
  type Bundle,
  type Comp,
  derivedEid,
  type Graph,
  identityEid,
  Refused,
  type Visibility,
} from '@yaks/graph'
import { and, ne } from '@yaks/query'
import { repoSkills, skillScope } from './skills.ts'
import { world } from './testing.ts'

let repo = derivedEid('scope repository')
let other = derivedEid('other scope repository')
let id = (name: string) => derivedEid(`scope skill ${name}`)
let file = (name: string, repository: string): Bundle => {
  let path = `.claude/skills/${name}/SKILL.md`
  return {
    entity: { eid: identityEid('file', [path, repository]) },
    file: { path, repository },
  }
}
let link = (name: string, target: Bundle): Bundle => ({
  entity: { eid: derivedEid(`scope edge ${name} ${target.entity.eid}`) },
  edge: { from: id(name), to: target.entity.eid },
  references: {},
})
let skill = (name: string, repository: string, body = name): Bundle[] => {
  let target = file(name, repository)
  return [
    {
      entity: { eid: id(name) },
      doc: { title: name, body: `About ${name}` },
      skill: {},
      content: { body },
      proposed: {},
    },
    target,
    link(name, target),
  ]
}
let fixture = async (bundles: Bundle[]) => {
  let g = world()
  await g.apply([
    { entity: { eid: repo }, repository: { common: '/repo/.git' } },
    { entity: { eid: other }, repository: { common: '/other/.git' } },
    ...bundles,
  ])
  return g
}
let large = 'unrelated instructions\n'.repeat(4000)
let ordinary = await fixture([
  ...skill('own', repo),
  ...skill('other', other, large),
])
let duplicate = file('duplicate', other)
let isolated = await fixture([
  ...skill('own', repo),
  ...skill('other', other),
  duplicate,
  link('other', duplicate),
])
let cross = file('cross', other)
let ambiguous = await fixture([
  ...skill('own', repo),
  cross,
  link('own', cross),
])
let malformed = await fixture(skill('own', repo))
await malformed.storage.tx((tx) =>
  tx.patch([{ entity: { eid: id('own') }, skill: { invoke: 'neither' } }])
)

test('repository skills isolate unrelated locator failures and keep full global reads', async () => {
  equal((await repoSkills(isolated, repo)).map((b) => b.entity.eid), [
    id('own'),
  ])
  equal((await repoSkills(isolated)).map((b) => b.entity.eid), [
    id('other'),
    id('own'),
  ])
})

test('a selected skill refuses duplicate locators across repositories', async () => {
  await assertRejects(
    () => skillScope(ambiguous, repo),
    Refused,
    'more than one SKILL.md',
  )
})

test('repository skills still omit malformed selected metadata', async () => {
  equal(await repoSkills(malformed, repo), [])
})

test('repository selection reads no unrelated instruction bodies', async () => {
  let bytes = 0
  let count = (rows: Bundle[]) => {
    for (let b of rows) {
      let body = (b.content as Comp | undefined)?.body
      if (typeof body == 'string') bytes += body.length
    }
    return rows
  }
  let g: Graph = {
    ...ordinary,
    read: async (...args) => count(await ordinary.read(...args)),
    get: async (...args) => count(await ordinary.get(...args)),
  }
  let { skills } = await skillScope(g, repo)
  equal(skills.map((b) => b.entity.eid), [id('own')])
  equal(bytes, 'own'.length)
  ok(skills[0].proposed)
})

let hidden = (eid: string) => and(ne('entity.eid', eid))
let target = file('own', repo)
let edge = link('own', target)
for (
  let [name, visibility] of [
    ['file entity', { entity: hidden(target.entity.eid) }],
    ['file component', { components: { file: hidden(target.entity.eid) } }],
    ['reference relation', {
      components: { references: hidden(edge.entity.eid) },
    }],
    ['edge component', { components: { edge: hidden(edge.entity.eid) } }],
    ['skill component', { components: { skill: hidden(id('own')) } }],
    ['description component', { components: { doc: hidden(id('own')) } }],
    ['instructions component', { components: { content: hidden(id('own')) } }],
  ] as [string, Visibility][]
) {
  test(`repository skills exclude a hidden ${name}`, async () => {
    let g: Graph = {
      ...ordinary,
      read: (q, opts) => ordinary.read(q, { ...opts, visibility }),
      get: (ids, comps, opts) =>
        ordinary.get(ids, comps, { ...opts, visibility }),
    }
    equal(await repoSkills(g, repo), [])
  })
}

test('repository selection keeps selected guards and handles a masked reference source', async () => {
  let g: Graph = {
    ...ordinary,
    read: async (...args) =>
      (await ordinary.read(...args)).map((b) => {
        if (b.entity.eid == id('own')) {
          return { ...b, $was: { content: { body: 'held' } } }
        }
        return b.edge ? { ...b, edge: { to: (b.edge as Comp).to } } : b
      }),
  }
  let { skills } = await skillScope(g, repo)
  equal(skills.map((b) => b.entity.eid), [id('own')])
  equal(skills[0].$was, { content: { body: 'held' } })
  ok(skills[0].proposed)
})

for (let name of ['own', 'other']) {
  test(`repository metadata faults ${name == 'own' ? 'propagate locally' : 'stay isolated'}`, async () => {
    let fault = new Error('unexpected metadata access')
    let g: Graph = {
      ...ordinary,
      read: async (...args) =>
        (await ordinary.read(...args)).map((b) =>
          b.entity.eid == id(name) && b.content
            ? {
              ...b,
              skill: {
                get invoke(): string {
                  throw fault
                },
              },
            }
            : b
        ),
    }
    if (name == 'other') {
      equal((await repoSkills(g, repo)).map((b) => b.entity.eid), [id('own')])
    } else {
      let caught: unknown
      try {
        await repoSkills(g, repo)
      } catch (error) {
        caught = error
      }
      equal(caught, fault)
    }
  })
}
