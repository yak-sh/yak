import { mint } from '@yaks/graph'
import { equal, test } from '@yaks/testing'
import { compose } from './host.ts'

test('search finds people by name, related person and hosted account', async () => {
  let host = await compose({
    db: ':memory:',
    plugins: [
      '@yaks/kernel',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/persona',
      '@yaks/platform',
    ],
  }, ['graph'])
  try {
    let owner = mint(), sibling = mint(), friend = mint()
    await host.graph.apply([
      { entity: { eid: owner }, person: {}, doc: { title: 'Cameron' } },
      { entity: { eid: sibling }, person: {}, doc: { title: 'Avery Rao' } },
      { entity: { eid: friend }, person: {}, doc: { title: 'Alex Diaz' } },
      {
        entity: { eid: '$sibling' },
        edge: { from: sibling, to: owner },
        relationship: { role: 'sister' },
      },
      {
        entity: { eid: '$friend' },
        edge: { from: friend, to: sibling },
        relationship: { role: 'friend' },
      },
      {
        entity: { eid: '$account' },
        yaks_account: {
          holder: sibling,
          person: mint(),
          space: mint(),
          handle: 'studio',
          name: 'Craft & Design',
        },
      },
      {
        entity: { eid: mint() },
        doc: { title: 'Avery', body: 'Cameron’s sister runs the studio.' },
      },
    ])
    let search = host.tools.find((tool) => tool.name == 'search')!
    let first = async (words: string) => {
      let [row] = await search.run({
        entity: { eid: mint() },
        call: { args: { words, limit: 1 } },
      }, host.graph)
      return row?.entity.eid
    }
    for (
      let words of [
        'Avery',
        'Avery Rao',
        "Cameron's sister",
        'Avery sister',
        'studio',
        'Craft & Design',
      ]
    ) {
      equal(await first(words), sibling)
    }
    equal(await first('Avery’s friend'), friend)
    await host.graph.apply([{ entity: { eid: sibling }, quarantined: {} }])
    equal(await first("Cameron's sister") == sibling, false)
    equal(await first('studio') == sibling, false)
  } finally {
    await host.close()
  }
})
