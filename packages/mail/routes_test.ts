import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { PATH, type Posted, routes } from './routes.ts'
import type { Options } from './options.ts'
import { clubhouse } from './testing.ts'

let ana = 'p-ana'

let seeded = async () => {
  let club = clubhouse()
  await club.g.apply([{
    entity: { eid: ana },
    person: { name: 'Ana' },
    email: { address: 'ana@books.example' },
  }])
  return club
}

// The door, and one letter posted through it. Everything a case varies — the
// options, the token, the body — is an argument, so a case is one line. The
// edge's token is `edge` unless a case says otherwise.
let EDGE = { door: { secret: 'edge' } }
let door =
  (graph: Graph, options: Options = EDGE) =>
  (letter: Partial<Posted> | string, token = 'edge') =>
    routes({ graph }, options)[0].handle(
      new Request(`http://box${options.door?.path ?? PATH}`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: typeof letter == 'string' ? letter : JSON.stringify({
          from: 'bounces@relay.example',
          to: 'ana@books.example',
          headers: {
            From: 'Ana <ana@books.example>',
            Subject: 'Is there soup?',
          },
          text: 'asking',
          ...letter,
        }),
      }),
    )

let comp = (b: Bundle | undefined, name: string) => b?.[name] as Comp

let recorded = await seeded()
test('the door records a letter and answers with its id', async () => {
  let { g } = recorded
  let post = door(g, { ...EDGE, domain: 'books.example' })
  let answer = await post({})
  assertEquals(answer.status, 200)
  let { eid } = await answer.json() as { eid: string }
  let letter = ((await g.read(line`.entity.eid=${eid}`)) as Bundle[])[0]
  assertEquals(comp(letter, 'doc').title, 'Is there soup?')
  assertEquals(comp(letter, 'mail').from, 'ana@books.example')
  assertEquals(comp(letter, 'mail').target, ana)
})

let authored = await seeded()
test('a letter is its author’s only where the edge vouched for its From', async () => {
  let { g } = authored
  let post = door(g, { ...EDGE, domain: 'books.example' })
  let by = async (letter: Partial<Posted>) => {
    let { eid } = await (await post(letter)).json() as { eid: string }
    let [row] = await g.get([eid], ['created'])
    return comp(row, 'created').by
  }
  assertEquals(await by({ vouched: true }), ana)
  assertEquals(await by({ verified: true }), undefined)
})

let duplicateAnswers = await (async () => {
  let { g } = await seeded()
  let post = door(g, { ...EDGE, domain: 'books.example' })
  let sent = { headers: { 'Message-ID': '<a1@x.example>', Subject: 'twice' } }
  let first = await (await post(sent)).json() as { eid: string }
  let second = await (await post(sent)).json()
  return { first, second }
})()
test('the same letter posted twice is recorded once', () => {
  assertEquals(typeof duplicateAnswers.first.eid, 'string')
  assertEquals(duplicateAnswers.second, { eid: null })
})

let credentialed = await seeded()
test('a secret is what the door asks for, when one is named', async () => {
  let { g } = credentialed
  let post = door(g, { door: { secret: 'shh' } })
  assertEquals((await post({}, 'shh')).status, 200)
  assertEquals((await post({}, 'sh')).status, 401)
  assertEquals((await post({}, 'no!')).status, 401)
  assertEquals((await post({}, '')).status, 401)
})

let unset = await seeded()
test('a door with no secret takes no letter, whatever its caller says', async () => {
  let { g } = unset
  for (let options of [{}, { door: {} }, { door: { secret: '' } }]) {
    let answer = await door(g, options)({ vouched: true }, '')
    assertEquals(answer.status, 401)
  }
  assertEquals(await g.read('.mail'), [])
})

let malformed = await seeded()
test('a body that is not a letter is refused, and says so', async () => {
  let { g } = malformed
  let post = door(g)
  assertEquals((await post('not json')).status, 400)
  let answer = await post({ to: undefined })
  assertEquals(answer.status, 400)
  assertEquals((await answer.json() as { error: string }).error, 'Refused')
})

let pathFixture = await seeded()
test('the path is the door option, and the default is one word', () => {
  let { g } = pathFixture
  assertEquals(routes({ graph: g }, {})[0].path, PATH)
  let said = routes({ graph: g }, { door: { path: '/letters' } })
  assertEquals(said[0].path, '/letters')
  assertEquals(said[0].method, 'POST')
})
