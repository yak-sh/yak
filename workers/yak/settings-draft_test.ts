import { assertEquals } from '@std/assert'
import { draftEid } from '@yaks/draft'
import { test } from '@yaks/testing'
import { kernel, signIn } from './probe.ts'

let k = await kernel()
let jo = await signIn(k), al = await signIn(k)
let scope = '/manage/a/settings'
let at = '/manage/account/profile?settings-draft=1&scope=' +
  encodeURIComponent(scope)
let place = `settings:${scope}:title`
let read = async (person = jo, path = at) => {
  let response = await k.at('yaks.app', path, {
    headers: { cookie: person.cookie },
  })
  return { status: response.status, ...await response.json() }
}
let write = (
  text: string,
  over = '',
  origin = 'https://yaks.app',
  extra = {},
  key = place,
) =>
  k.at('yaks.app', at, {
    method: 'POST',
    headers: {
      cookie: jo.cookie,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      bundles: [{
        entity: { eid: al.person },
        draft: { by: al.person, place: key, text },
        typed: { over },
        ...extra,
      }],
    }),
  })

let kept = await (await write('A new title')).json()
let spending = place + ':spending'
await write('An unsaved edit', '', 'https://yaks.app', {}, spending)

test('settings drafts survive another load and belong to the signed-in person', async () => {
  let result = await read()
  assertEquals(result.status, 200)
  assertEquals(result.person, jo.person)
  result.bundles = result.bundles.filter((b: { draft: { place: string } }) =>
    b.draft.place == place
  )
  assertEquals(result.bundles[0].entity.eid, draftEid(jo.person, place))
  assertEquals(result.bundles[0].draft.by.eid, jo.person)
  assertEquals(result.bundles[0].draft.place, place)
  assertEquals(result.bundles[0].draft.text, 'A new title')
  assertEquals(result.bundles[0].draft.rev, 1)
  assertEquals(kept.bundles[0].draft.text, 'A new title')
  assertEquals((await read(al)).bundles, [])
  assertEquals(
    (await read(
      jo,
      at.replace(
        encodeURIComponent(scope),
        encodeURIComponent('/manage/b/settings'),
      ),
    )).bundles,
    [],
  )
})

test('settings drafts refuse another origin and never apply unrelated components', async () => {
  assertEquals(
    (await write('Cross origin', '', 'https://other.test')).status,
    403,
  )
  let answer = await write(
    'A new title, edited',
    '',
    'https://yaks.app',
    { doc: { title: 'Overwrite person' } },
    place + ':unrelated',
  )
  assertEquals(answer.status, 200)
  let bundles = (await answer.json()).bundles
  assertEquals(bundles[0].doc, undefined)
  assertEquals(bundles[0].draft.text, 'A new title, edited')
})

test('spending a settings draft empties it and retains its revision', async () => {
  let answer = await write(
    '',
    'An unsaved edit',
    'https://yaks.app',
    {},
    spending,
  )
  assertEquals(answer.status, 200)
  assertEquals((await answer.json()).bundles[0].draft.text, '')
  let rows = (await read()).bundles
  assertEquals(
    rows.find((b: { draft: { place: string } }) => b.draft.place == spending)
      .draft.text,
    '',
  )
})
