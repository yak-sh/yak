import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { PATH, type Posted, routes } from './routes.ts'
import type { Options } from './options.ts'
import { clubhouse } from './harness.ts'

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
// options, the token, the body — is an argument, so a case is one line.
let door =
  (graph: Graph, options: Options = {}) =>
  (letter: Partial<Posted> | string, token?: string) =>
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

Deno.test('the door records a letter and answers with its id', async () => {
  let { g } = await seeded()
  let post = door(g, { domain: 'books.example' })
  let answer = await post({})
  assertEquals(answer.status, 200)
  let { eid } = await answer.json() as { eid: string }
  let letter = ((await g.read(`.eid=${eid}`)) as Bundle[])[0]
  assertEquals(comp(letter, 'doc').title, 'Is there soup?')
  assertEquals(comp(letter, 'mail').from, 'ana@books.example')
  assertEquals(comp(letter, 'mail').target, ana)
})

Deno.test('the same letter posted twice is recorded once', async () => {
  let { g } = await seeded()
  let post = door(g, { domain: 'books.example' })
  let sent = { headers: { 'Message-ID': '<a1@x.example>', Subject: 'twice' } }
  let first = await (await post(sent)).json() as { eid: string }
  assertEquals(typeof first.eid, 'string')
  assertEquals(await (await post(sent)).json(), { eid: null })
})

Deno.test('a secret is what the door asks for, when one is named', async () => {
  let { g } = await seeded()
  let post = door(g, { door: { secret: 'shh' } })
  assertEquals((await post({}, 'shh')).status, 200)
  assertEquals((await post({}, 'sh')).status, 401)
  assertEquals((await post({}, 'no!')).status, 401)
  assertEquals((await post({})).status, 401)
})

Deno.test('no secret leaves the door as open as the /apply beside it', async () => {
  let { g } = await seeded()
  assertEquals((await door(g)({})).status, 200)
})

Deno.test('a body that is not a letter is refused, and says so', async () => {
  let { g } = await seeded()
  let post = door(g)
  assertEquals((await post('not json')).status, 400)
  let answer = await post({ to: undefined })
  assertEquals(answer.status, 400)
  assertEquals((await answer.json() as { error: string }).error, 'Refused')
})

Deno.test('the path is the door option, and the default is one word', async () => {
  let { g } = await seeded()
  assertEquals(routes({ graph: g }, {})[0].path, PATH)
  let said = routes({ graph: g }, { door: { path: '/letters' } })
  assertEquals(said[0].path, '/letters')
  assertEquals(said[0].method, 'POST')
})
