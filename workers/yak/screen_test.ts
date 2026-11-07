import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { handler } from './kernel.ts'
import { ADA, ADA_OWNS, as, SECRET, seeded } from './serving-data-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { operators } from './operator-service-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { LIFE } from './signin.ts'
import {
  code,
  LENGTH,
  LETTERS,
  screens,
  shown,
  standing,
  typed,
} from './screen.ts'

let runtime = platform(SECRET, { BUILDER: operators })
let { env } = { ...runtime, ...lifecycleStores(runtime.env) }
let { dir } = await seeded(env, 'private', runtime.dir)
let BEA = 'b0000000-0000-4000-8000-0000000000be'
await dir.apply({ entities: [{ entity: { eid: BEA }, person: {} }] }, ADA_OWNS)
let ctx: Ctx = { env, dir, person: ADA }
let run = (name: string, args: Record<string, unknown>) =>
  TOOLS.find((t) => t.name == name)!.run(ctx, args)
let draft = (app: string, body: string) =>
  run('app_files', {
    app,
    files: [{
      path: 'index.html',
      content: `<html><head></head><body>${body}</body></html>`,
    }],
  })
await run('app_new', { slug: 'garden', title: 'Garden', access: 'private' })
await run('app_new', { slug: 'chores', title: 'Chores', access: 'private' })

let ada = await as(ADA)
let bea = await as(BEA)

let at = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  handler.fetch(
    new Request(new URL(path, 'https://yaks.app'), {
      redirect: 'manual',
      ...init,
      headers: init.cookie ? { cookie: init.cookie } : {},
    }),
    env,
  )
let form = (path: string, cookie: string, fields: Record<string, string>) =>
  handler.fetch(
    new Request(new URL(path, 'https://yaks.app'), {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        origin: 'https://yaks.app',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )
let doc = async (res: Response) => parseHTML(await res.text()).document

// A TV as a browser is one: it opens yaks.app/tv, keeps each cookie it is
// given, and asks after it.
let tv = async () => {
  let cookie = ''
  let get = async (path: string) => {
    let res = await at(path, { cookie })
    let set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return res
  }
  let res = await get('/tv')
  equal(res.status, 200)
  let page = await doc(res)
  return {
    code: page.querySelector('.Tv_Code')!.textContent!,
    page,
    now: async () => await (await get('/tv/now')).json(),
    open: () => get('/tv'),
  }
}

test("a code is eight of RFC 8628's letters, typed any way a person types it", () => {
  let c = code()
  equal(c.length, LENGTH)
  ok([...c].every((l) => LETTERS.includes(l)))
  equal(typed(shown(c).toLowerCase()), c)
  equal(typed(` ${c.slice(0, 4)} ${c.slice(4)} `), c)
  equal(typed('BCDF-GHJ'), null)
  equal(typed('ABCD-EFGH'), null)
})

test('a TV shows a code, the same one until it runs out, and writes nothing to show it', async () => {
  let before = (await dir.read('.screen')).length
  let one = await tv()
  ok(/^[A-Z]{4}-[A-Z]{4}$/.test(one.code), one.code)
  let pair = one.page.querySelector('.Tv_Qr')!.getAttribute('href')!
  equal(pair, `https://yaks.app/tv/pair?code=${one.code.replace('-', '')}`)
  ok(one.page.querySelector('.Tv_Qr svg'))
  let again = await doc(await one.open())
  equal(again.querySelector('.Tv_Code')!.textContent, one.code)
  equal(await one.now(), { paired: false, code: one.code })
  equal((await dir.read('.screen')).length, before)
})

test('a code runs out after ten minutes, and a pairing made before the TV showed it is not its own', async () => {
  let held = { code: code(), at: 1_000_000 }
  let waiting = await standing(dir, SECRET, held, held.at + LIFE - 1)
  equal([waiting.paired, waiting.held], [false, held])
  let after = await standing(dir, SECRET, held, held.at + LIFE)
  equal(after.paired, false)
  ok(after.held.code != held.code)
})

test('the person types the code on their phone, and the TV shows the draft their agent last wrote, read-only', async () => {
  let screen = await tv()
  // Signed out, the phone signs in first and comes back with the code.
  let out = await at(`/tv/pair?code=${screen.code}`)
  equal(out.status, 302)
  equal(
    out.headers.get('location'),
    `/login?return=${encodeURIComponent(`/tv/pair?code=${screen.code}`)}`,
  )
  let phone = await doc(
    await at(`/tv/pair?code=${screen.code}`, { cookie: ada }),
  )
  equal(
    phone.querySelector('input[name=code]')!.getAttribute('value'),
    screen.code,
  )

  let paired = await form('/tv/pair', ada, { code: screen.code.toLowerCase() })
  equal(paired.status, 303)
  equal(paired.headers.get('location'), '/tv/pair?paired')
  ok((await doc(await at('/tv/pair?paired', { cookie: ada })))
    .querySelector('.Notice')!.textContent!.startsWith('Paired.'))

  await draft('garden', 'Tomatoes by the fence')
  let now = await screen.now()
  equal(now.paired, true)
  equal(now.showing.title, 'Garden')
  let page = await doc(await screen.open())
  let frame = page.querySelector('.Tv_Frame')!
  equal(frame.getAttribute('src'), now.showing.url)
  let shows = await handler.fetch(new Request(now.showing.url), env)
  equal(shows.status, 200)
  ok((await shows.text()).includes('Tomatoes by the fence'))

  // It can write nothing: not the preview's rows, not what a page keeps.
  for (let path of ['api/apply', 'api/storage']) {
    let res = await handler.fetch(
      new Request(new URL(path, now.showing.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '[]',
      }),
      env,
    )
    equal(res.status, 403, path)
    await res.body?.cancel()
  }

  // The newest draft moves to another app, and the TV follows.
  await draft('chores', 'Sweep the porch')
  let moved = await screen.now()
  equal(moved.showing.title, 'Chores')
  ok(moved.showing.url != now.showing.url)

  // Unpaired from the phone, the TV is back to a code, and its link is dead.
  let list = await doc(await at('/tv/pair', { cookie: ada }))
  let rows = [...list.querySelectorAll('.Rows_Item')]
  let mine = rows.find((r) =>
    r.querySelector('.Rows_Meta')!.textContent!.startsWith('Paired')
  )!
  let eid = mine.querySelector('input[name=screen]')!.getAttribute('value')!
  equal((await form('/tv/unpair', bea, { screen: eid })).status, 303)
  equal((await screen.now()).paired, true, 'only its person unpairs it')
  equal((await form('/tv/unpair', ada, { screen: eid })).status, 303)
  let back = await screen.now()
  equal(back.paired, false)
  ok(back.code != screen.code)
  let dead = await handler.fetch(new Request(moved.showing.url), env)
  equal(dead.status, 404)
  await dead.body?.cancel()
})

test('a code already paired, or none at all, pairs nothing for anyone else', async () => {
  let screen = await tv()
  equal((await form('/tv/pair', ada, { code: screen.code })).status, 303)
  equal((await form('/tv/pair', ada, { code: screen.code })).status, 303)
  for (let said of [screen.code, 'BCDF-GHJ', 'nonsense']) {
    let res = await form('/tv/pair', bea, { code: said })
    equal(res.status, 400, said)
    ok((await doc(res)).querySelector('.Notice-negative'), said)
  }
  equal((await screen.now()).paired, true)
})

test('a paired TV with no draft to show says so', async () => {
  let screen = await tv()
  equal((await form('/tv/pair', bea, { code: screen.code })).status, 303)
  equal(await screen.now(), { paired: true, showing: null })
  let page = await doc(await screen.open())
  ok(
    page.querySelector('.Empty')!.textContent!.includes(
      'Nothing is being built',
    ),
  )
})

test('a code no TV took up waits on the phone for ten minutes, then goes', async () => {
  let CY = 'c0000000-0000-4000-8000-0000000000c1'
  await dir.apply({ entities: [{ entity: { eid: CY }, person: {} }] }, ADA_OWNS)
  let cy = await as(CY)
  equal((await form('/tv/pair', cy, { code: code() })).status, 303)
  let list = await doc(await at('/tv/pair', { cookie: cy }))
  equal(
    list.querySelector('.Rows_Meta')!.textContent,
    'Waiting for the screen to show it',
  )
  equal((await screens(dir, CY, Date.now() + LIFE)).length, 0)
  equal((await screens(dir, CY, Date.now())).length, 0)
})

test('the person reads the code out, and their agent pairs the TV with screen_pair', async () => {
  let screen = await tv()
  let said = await run('screen_pair', { code: screen.code.toLowerCase() })
  ok(said.text!.startsWith('Paired.'))
  equal((await screen.now()).paired, true)
  let wrong = await run('screen_pair', { code: 'nonsense' }).catch((e) => e)
  equal(wrong.code, 'missing')
})
