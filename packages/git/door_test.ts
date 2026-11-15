// A repository's door over a host that keeps one repository, `recipes`,
// read by whoever's password is `ada`, and by everyone once it is public.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { door, type Found } from './door.ts'
import { objects } from './objects.ts'
import { FLUSH, mark, pkt } from './pkt.ts'
import { fixture } from './testing.ts'

let V2 = { 'git-protocol': 'version=2' }
let basic = (word: string) => ({ authorization: `Basic ${btoa(`x:${word}`)}` })

let host = (open: boolean) => {
  let { g, bytes } = fixture()
  let asked: (string | null)[] = []
  let knock = door({
    realm: 'box',
    find: (name, _req, password) => {
      asked.push(password)
      if (name != 'recipes') return Promise.resolve(null)
      let found: Found = {
        reads: open || password == 'ada',
        proven: password == 'ada' || password == 'ben',
        refs: { list: () => Promise.resolve([]) },
        objects: objects(g, bytes),
      }
      return Promise.resolve(found)
    },
  })
  let at = (path: string, init: RequestInit = {}) =>
    knock(new Request(`https://box${path}`, init))
  return { at, asked }
}

let REFS = '/recipes.git/info/refs?service=git-upload-pack'

test('the browser address redirects to the repository, query and all', async () => {
  let { at, asked } = host(true)
  let res = await at('/recipes/info/refs?service=git-upload-pack')
  assertEquals(res!.status, 301)
  assertEquals(res!.headers.get('location'), `https://box${REFS}`)
  // Neither a browser's `info/refs` nor a fetch under the name is a clone,
  // and neither asks the host anything.
  assertEquals(await at('/recipes/info/refs'), null)
  assertEquals(await at('/recipes/git-upload-pack'), null)
  assertEquals(asked, [])
})

test('a path that is no repository is the host’s', async () => {
  let { at } = host(true)
  for (let path of ['/recipes/', '/recipes.git', '/recipes.git/objects/info']) {
    assertEquals(await at(path), null, path)
  }
  let res = await at('/nothing.git/info/refs', { headers: V2 })
  assertEquals(res!.status, 404)
  assertEquals(await res!.text(), 'git: no such repository\n')
})

test('a repository it may not read asks once, then refuses for good', async () => {
  let { at, asked } = host(false)
  let status = async (headers: HeadersInit) => {
    let res = (await at(REFS, { headers: { ...V2, ...headers } }))!
    return [res.status, res.headers.get('www-authenticate')]
  }
  assertEquals(await status({}), [401, 'Basic realm="box"'])
  assertEquals(await status(basic('nonsense')), [401, 'Basic realm="box"'])
  assertEquals(await status(basic('ben')), [403, null])
  assertEquals(await status(basic('ada')), [200, null])
  assertEquals(asked, [null, 'nonsense', 'ben', 'ada'])
})

test('a readable repository advertises and answers its fetch', async () => {
  let { at } = host(true)
  let ad = (await at(REFS, { headers: V2 }))!
  assertEquals(
    ad.headers.get('content-type'),
    'application/x-git-upload-pack-advertisement',
  )
  assertEquals((await ad.text()).includes('000eversion 2\n'), true)
  let refs = (await at('/recipes.git/git-upload-pack', {
    method: 'POST',
    headers: V2,
    body: new Uint8Array([...pkt('command=ls-refs\n'), ...mark(FLUSH)]),
  }))!
  assertEquals(await refs.text(), '0000')
})
