import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { rows } from './directory-rows-probe.ts'
import { listable } from './shelf.ts'

let { graph, dir } = rows()
let seeded = await graph.apply([
  {
    entity: { eid: '$origin-space' },
    space: { slug: 'original', store: 'original' },
  },
  {
    entity: { eid: '$copy-space' },
    space: { slug: 'copy', store: 'copy' },
  },
  {
    entity: { eid: '$origin' },
    app: { space: '$origin-space', slug: 'box', access: 'public', version: 1 },
    published: {
      name: 'original-box',
      version: 1,
      at: '2026-09-22',
      about: '',
    },
  },
  {
    entity: { eid: '$copy' },
    app: { space: '$copy-space', slug: 'box', access: 'public', version: 1 },
    installed: { of: '$origin', version: 1 },
    published: { name: 'copy-box', version: 1, at: '2026-09-28', about: '' },
  },
], { trusted: true })
let offers = await dir.offers()
let origin = seeded.find((row) => row.$alias == '$origin')!.entity.eid
let before = await dir.offered('original-box')
let listed = await listable(offers, () => Promise.resolve(['owner']))

test('an offer hidden by its owner copy still resolves by its install name', async () => {
  assertEquals(listed.map((o) => o.app.published!.name), ['copy-box'])
  assertEquals(before?.app.eid, origin)
  assertEquals((await dir.offered('original-box'))?.app.eid, origin)
})
