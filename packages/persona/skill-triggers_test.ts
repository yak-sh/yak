// The declaration owes work for skill inputs, including their disappearance,
// and leaves the fleet's unrelated content and links alone.
import { equal, test } from '@yaks/testing'
import { graph, identityEid } from '@yaks/graph'
import { effectDoc, effects } from '@yaks/effects'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { said } from './testing.ts'

let fixture = () => {
  let vocab = loadVocab([...said.docs, effectDoc])
  let fx = effects(vocab, { owes: 'declared' })
  let g = graph({ vocab, storage: ram(vocab), plugins: [fx] })
  let queued = () => g.read('.effect.handler=skill_files')
  let clear = async () => {
    await g.apply(
      (await g.read('.effect')).map((b) => ({
        entity: b.entity,
        $delete: true,
      })),
      { trusted: true },
    )
  }
  return { g, fx, queued, clear }
}

test('tool content owes no skill reconciliation; skill text and companion files do', async () => {
  let { g, queued, clear } = fixture()
  await g.apply([{
    entity: { eid: 'result' },
    content: { body: 'tool output' },
  }])
  equal(await queued(), [])
  await g.apply([{
    entity: { eid: 'result' },
    content: { body: 'more output' },
  }])
  equal(await queued(), [])
  await g.apply([{
    entity: { eid: 'skill' },
    skill: {},
    content: { body: 'instructions' },
  }])
  equal((await queued()).length > 0, true)
  await clear()
  await g.apply([{
    entity: { eid: 'skill' },
    content: { body: 'new instructions' },
  }])
  equal((await queued()).length, 1)
  await clear()
  await g.apply([{
    entity: { eid: 'repository' },
    repository: { common: '/repo/.git' },
  }])
  let eid = identityEid('file', [
    '.claude/skills/example/helper.ts',
    'repository',
  ])
  await g.apply([{
    entity: { eid },
    file: {
      path: '.claude/skills/example/helper.ts',
      repository: 'repository',
    },
    content: { body: 'helper' },
  }])
  await clear()
  await g.apply([{ entity: { eid }, content: { body: 'changed helper' } }])
  equal((await queued()).length, 1)
  await clear()
  await g.apply([{ entity: { eid }, $delete: true }])
  equal((await queued()).length > 0, true)
})

test('scope includes metadata, skill locators and root changes but excludes other files and links', async () => {
  let { g, queued, clear } = fixture()
  await g.apply([
    { entity: { eid: 'repository' }, repository: { common: '/repo/.git' } },
    { entity: { eid: 'skill' }, skill: {} },
    { entity: { eid: 'other' }, doc: { title: 'Other' } },
  ])
  let file = identityEid('file', ['README.md', 'repository'])
  await clear()
  await g.apply([{
    entity: { eid: file },
    file: { path: 'README.md', repository: 'repository' },
    content: { body: 'readme' },
  }])
  equal(await queued(), [])
  await g.apply([{ entity: { eid: file }, $delete: true }])
  equal(await queued(), [])
  await g.apply([{
    entity: { eid: 'unrelated' },
    edge: { from: 'other', to: 'repository' },
    references: {},
  }])
  equal(await queued(), [])
  await g.apply([{
    entity: { eid: 'locator' },
    edge: { from: 'skill', to: 'repository' },
    references: {},
  }])
  equal((await queued()).length > 0, true)
  await clear()
  await g.apply([{ entity: { eid: 'locator' }, references: null, edge: null }])
  equal((await queued()).length > 0, true)
  await clear()
  await g.apply([{
    entity: { eid: 'skill' },
    doc: { title: 'renamed', body: 'description' },
  }])
  equal((await queued()).length > 0, true)
  await clear()
  await g.apply([{
    entity: { eid: 'repository' },
    repository: { common: '/moved/.git' },
  }])
  equal((await queued()).length, 1)
})

test('settlement retires obsolete content runs and preserves owed, claimed and failed runs', async () => {
  let { g, fx, clear } = fixture()
  await g.apply([
    { entity: { eid: 'result' }, content: { body: 'output' } },
    { entity: { eid: 'skill' }, skill: {}, content: { body: 'instructions' } },
  ])
  await clear()
  let run = (eid: string, target: string, extra = {}) => ({
    entity: { eid },
    effect: {
      handler: 'skill_files',
      comp: 'content',
      kind: 'created',
      target,
      state: 'pending',
      ...extra,
    },
  })
  await g.apply([
    run('obsolete', 'result'),
    run('owed', 'skill'),
    run('claimed', 'result', { lease_owner: 'skill' }),
    run('failed', 'result', { state: 'failed', error: 'keep' }),
  ], { trusted: true })
  equal(await fx.settle(g, 'skill_files'), 1)
  equal(await fx.settle(g, 'skill_files'), 0)
  equal((await g.read('.effect')).map((b) => b.entity.eid).sort(), [
    'claimed',
    'failed',
    'owed',
  ])
  equal((await g.get(['result']))[0].content, { body: 'output' })
})

test('a bare edge touching a skill owes nothing; adding endpoints to its reference locator does', async () => {
  let { g, queued, clear } = fixture()
  await g.apply([
    { entity: { eid: 'skill' }, skill: {} },
    { entity: { eid: 'document' }, doc: { title: 'Other' } },
  ])
  await clear()
  await g.apply([{
    entity: { eid: 'plain' },
    edge: { from: 'skill', to: 'document' },
  }])
  equal(await queued(), [])
  await g.apply([{ entity: { eid: 'locator' }, references: {} }])
  equal(await queued(), [])
  await g.apply([{
    entity: { eid: 'locator' },
    edge: { from: 'skill', to: 'document' },
  }])
  equal((await queued()).length, 1)
})
