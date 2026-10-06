import { equal, ok, test } from '@yaks/testing'
import { fixture } from './fixture_test.ts'
import { group } from './group.ts'
import { notify } from './effects.ts'
import { capture } from './report.ts'
import { comp } from './model.ts'

let options = {
  to: crypto.randomUUID(),
  from: 'tracker@example.test',
  store: 'box',
}
let opened = async (g: ReturnType<typeof fixture>, id: string) => {
  await g.apply(
    capture(`broken ${id}`, {
      sink: () => {},
      eid: id,
      fault: id,
      at: '2026-10-02T00:00:10Z',
    }),
    { trusted: true },
  )
  await group(g, id)
  return (await g.read(`.bug.fault=${id} *`))[0]
}

test('minute batching waits on wake, retries one letter, marks only on delivery', async () => {
  let g = fixture()
  let a = await opened(g, 'a')
  let b = await opened(g, 'b')
  await notify(g, a.entity.eid, options)
  equal((await g.read('.mail')).length, 0)
  equal(
    comp((await g.get([a.entity.eid]))[0], 'wake').at,
    '2026-10-02T00:01:00.000Z',
  )
  await g.apply([{ entity: a.entity, fired: {} }], { trusted: true })
  await notify(g, a.entity.eid, options)
  await notify(g, b.entity.eid, options)
  let [letter] = await g.read('.mail *')
  ok(String(comp(letter, 'doc').body).includes(a.entity.eid))
  ok(String(comp(letter, 'doc').body).includes(b.entity.eid))
  await notify(g, a.entity.eid, options)
  equal((await g.read('.mail')).length, 1)
  equal((await g.read('.bug .notified')).length, 0)
  await g.apply([{ entity: letter.entity, delivered: {} }], { trusted: true })
  await notify(g, letter.entity.eid, options)
  equal((await g.read('.bug .notified')).length, 2)
})

test('archived bugs never notify, repeats do not create another letter', async () => {
  let g = fixture()
  let a = await opened(g, 'a')
  await g.apply([{ entity: a.entity, archived: {} }], { trusted: true })
  let pushed = 0
  await notify(g, a.entity.eid, {
    notify: () => {
      pushed++
    },
  })
  equal(pushed, 0)
})
