// Every tool reference takes an id or a name through the same input boundary.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import {
  type Comp,
  graph,
  mint,
  type NamedTool,
  referenced,
  Refused,
} from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { kernelDoc } from '@yaks/kernel'
import { aliasDoc, aliases } from '@yaks/alias'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { CallError, resolved } from './args.ts'

let vocab = loadVocab([kernelDoc, docDoc, keyDoc, aliasDoc, {
  $defs: {
    person: { component: true, properties: {} },
    filed: {
      component: true,
      properties: { assignee: { type: 'string', ref: 'entity' } },
    },
  },
}], [keyKeywords])

let named = async (
  count: number,
  shell = 'absent',
  alias = false,
  kind = 'person',
) => {
  let storage = ram(vocab)
  let g = graph({ vocab, storage, plugins: [keys(vocab), aliases()] })
  await g.apply([
    ...Array.from({ length: count }, (_, i) => ({
      entity: { eid: `person-${i + 1}` },
      person: {},
      doc: { title: 'Ada' },
    })),
    ...count ? [{ entity: { eid: 'other' }, doc: { title: 'Ada' } }] : [],
  ])
  if (alias) {
    await g.apply([{ entity: { eid: 'person-1' }, alias: { name: 'Ada' } }])
  }
  if (shell != 'absent') {
    await storage.tx((tx) => {
      tx.patch([{
        entity: { eid: 'Ada' },
        ...shell == 'live' ? { person: {} } : {},
      }])
      if (shell == 'deleted') tx.remove([{ eid: 'Ada' }])
    })
  }
  let tool: NamedTool = {
    name: 'person_read',
    description: 'Read a person by id or name',
    readOnly: true,
    inputSchema: { properties: { who: { type: 'string', ref: kind } } },
    run: () => [],
  }
  let ask = (who: string | string[], readOnly = true) =>
    resolved({ ...tool, readOnly }, { who }, g)
  return Object.assign(ask, { g })
}

for (
  let [outcome, count, refusal] of [
    ['one match', 1, ''],
    ['none', 0, 'Ada names no person'],
    ['several', 2, 'person-1'],
  ] as const
) {
  test(`tool name resolution: ${outcome}`, async () => {
    let ask = await named(count)
    for (let readOnly of [true, false]) {
      for (let who of ['Ada', ['Ada']]) {
        if (!refusal) {
          equal(await ask(who, readOnly), {
            who: Array.isArray(who) ? ['person-1'] : 'person-1',
          })
        } else {
          let error = await assertRejects(
            () => ask(who, readOnly),
            CallError,
            refusal,
          )
          if (count > 1) {
            equal(error.message.includes('person-2'), true)
            equal(error.message.includes('other'), false)
          }
        }
      }
    }
  })
}

for (let shell of ['empty', 'deleted']) {
  for (let alias of [false, true]) {
    test(`name resolution ignores ${shell} word eid before ${alias ? 'alias' : 'title'}`, async () => {
      let ask = await named(1, shell, alias)
      for (let readOnly of [true, false]) {
        equal(await ask('Ada', readOnly), { who: 'person-1' })
      }
      equal(await referenced(ask.g, ['Ada'], 'person'), ['person-1'])
      await ask.g.apply([{ entity: { eid: 'other' }, doc: { title: 'Other' } }])
      await ask.g.apply([{
        entity: { eid: '$task' },
        filed: { assignee: 'Ada' },
      }])
      equal((await ask.g.read('.filed'))[0].filed, { assignee: 'person-1' })
      // A live word identity still takes precedence; a deleted minted eid is
      // still readable by identity.
      let live = await named(1, 'live', alias)
      equal(await live('Ada'), { who: 'Ada' })
      let eid = mint()
      await ask.g.apply([{ entity: { eid }, person: {} }])
      await ask.g.apply([{ entity: { eid }, $delete: true }])
      equal(await ask(eid), { who: eid })
    })
  }
}

for (let shell of ['absent', 'empty', 'deleted']) {
  test(`a write refuses unresolved word refs with ${shell} identity`, async () => {
    let ask = await named(0, shell, false, 'entity')
    let word = shell == 'absent' ? 'Nobodyhere' : 'Ada'
    let error = await assertRejects(() => ask(word), CallError)
    let failure = await assertRejects(
      async () =>
        await ask.g.apply([{
          entity: { eid: '$task' },
          filed: { assignee: word },
        }]),
      Refused,
      `${word} names nothing`,
    )
    equal(failure.message, error.message)
    equal(await ask.g.get(['Nobodyhere']), [])
    let applied = await ask.g.apply([
      { entity: { eid: '$person' }, person: {} },
      { entity: { eid: '$task' }, filed: { assignee: '$person' } },
    ])
    equal(
      (applied.find((b) => b.$alias == '$task')?.filed as Comp)?.assignee,
      applied.find((b) => b.$alias == '$person')?.entity.eid,
    )
  })
}
