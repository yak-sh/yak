import { equal, test } from '@yaks/testing'
import { routedWrite, routesOf } from './route-memory.ts'

let now = () => 0
let keep = () => {}

// A memory holding the route to `space`, and whether it still answers after
// `req` is sent through `routedWrite`.
let kept = async (space: string, req: Request) => {
  let binding = {}
  let routes = routesOf<string>(binding)
  let ask = (value: string) =>
    routes.read('k', now, () => Promise.resolve(value), () => space, keep)
  await ask('before')
  await routedWrite(binding, req, () => Promise.resolve())
  return (await ask('after')).value == 'before'
}

let apply = (bundles: unknown) =>
  new Request('http://store/apply', {
    method: 'POST',
    body: JSON.stringify(bundles),
  })

test('a write to the directory forgets the routes it may move', async () => {
  equal(await kept('s', new Request('http://store/query?q=.app')), true)
  equal(await kept('s', apply([{ entity: { eid: 't' }, space: {} }])), true)
  equal(await kept('s', apply([{ entity: { eid: 's' }, space: {} }])), false)
  equal(await kept('s', apply([{ entity: { eid: 'a' }, app: {} }])), false)
  equal(
    await kept(
      's',
      new Request('http://store/trash/purge', { method: 'POST' }),
    ),
    false,
  )
})
