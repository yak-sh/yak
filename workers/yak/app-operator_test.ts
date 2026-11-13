// An app's own worker tells its space's Operator something, once a key.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { derivedEid } from '@yaks/graph/identity'
import { connector, kernel, seed, unique } from './probe.ts'
import { storeName } from './directory.ts'
import { GRANT, owning } from './dispatch.ts'

let k = await kernel()
let slug = unique('clerk')
let { cookie } = await seed(k, [{ slug, apps: ['township'] }])
let space = (await k.dir.space(slug))!
let app = (await k.dir.app(space, 'township'))!
let itself = { [GRANT]: await owning(k.secret, storeName(space, app), app) }

let tell = (body: unknown, headers: Record<string, string> = itself) =>
  k.at(`${slug}.yaks.app`, '/township/api/operator/tell', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
let said = async (r: Response) => [r.status, await r.json()]
let MINUTES = {
  say: 'Proposed minutes of the November 9 meeting are due Friday, Nov 20.',
  key: 'proposed|nov-9',
}

test("an app's worker tells its Operator, and a key told again is one request", async () => {
  let request = derivedEid(`operator-app|${app.eid}|${MINUTES.key}`)
  assertEquals(await said(await tell(MINUTES)), [202, { request }])
  assertEquals(await said(await tell(MINUTES)), [200, { request }])
  // The words are in the owner's conversation, said by the space.
  let read = async (args: Record<string, unknown>) =>
    JSON.parse(
      String((await connector(k, cookie).answer('operator_read', args)).text),
    )
  let [conversation] = (await read({ space: slug })).conversations
  assertEquals(conversation.updated.by, space.eid)
  let transcript = JSON.stringify(
    await read({ space: slug, task: conversation.entity.eid }),
  )
  assertEquals(
    transcript.split(`The app township says: ${MINUTES.say}`).length,
    2,
  )
})

test('a page or a person cannot tell the Operator, and a tell says something by a key', async () => {
  let codes = async (...rs: Response[]) =>
    await Promise.all(
      rs.map(async (r) => [r.status, (await r.json()).error.code]),
    )
  assertEquals(
    await codes(
      await tell(MINUTES, { cookie, 'sec-fetch-site': 'same-origin' }),
      await tell(MINUTES, {}),
      await tell({ say: ' ', key: 'k' }),
      await tell({ say: 'hi' }),
      await tell({ say: 'x'.repeat(4001), key: 'k' }),
    ),
    [
      [403, 'not_the_app'],
      [403, 'not_the_app'],
      [400, 'arguments'],
      [400, 'arguments'],
      [400, 'arguments'],
    ],
  )
})
