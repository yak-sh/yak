// The page graph's door (reach-door.ts): a signed-in tab reads and writes
// across every store its person reaches, as its own session, and a tab drawn
// for someone else writes nothing.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { REACH, TAB_PERSON } from '@yaks/platform/routes'
import { kernel, seed, signIn } from './probe.ts'

let k = await kernel()
let ada = await seed(k, [{ slug: 'adas', apps: ['notes', 'lists'] }])
let bea = await signIn(k)

type Tab = { cookie: string; person: string }
let door = (
  who: Tab,
  path: string,
  init: RequestInit = {},
) =>
  k.at(k.host, `${REACH}${path}`, {
    ...init,
    headers: {
      cookie: who.cookie,
      [TAB_PERSON]: who.person,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
let query = async (who: Tab, q: string) => {
  let res = await door(who, `/query?q=${encodeURIComponent(q)}`)
  equal(res.status, 200, await res.clone().text())
  return (await res.json() as Bundle[]).map((b) => b.doc)
}

test('a tab reads and writes across its person’s stores, and only theirs', async () => {
  let eid = crypto.randomUUID()
  let wrote = await door(ada, '/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid },
      doc: { title: 'Soup' },
      $app: 'adas/notes',
    }]),
  })
  equal(wrote.status, 200, await wrote.clone().text())
  equal(await query(ada, `.entity.eid=${eid}`), [{ title: 'Soup' }])
  equal(await query(bea, `.entity.eid=${eid}`), [])
})

test('a tab drawn for someone else, or nobody signed in, is told to sign in again', async () => {
  let other = await door({ ...ada, person: bea.person }, '/query?q=.doc')
  equal(other.status, 401)
  let nobody = await k.at(k.host, `${REACH}/query?q=.doc`)
  equal(nobody.status, 401)
})

test('an Updates page loads the script that takes its card actions', async () => {
  let page = await k.at(
    k.host,
    `/${await k.dir.own(bea.person).then((s) => s.slug)}/updates`,
    {
      headers: { cookie: bea.cookie },
    },
  )
  let html = await page.text()
  equal(/<script[^>]*_inbox-actions[^>]*>/.test(html), true)
})
