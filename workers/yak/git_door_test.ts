// Which app a repository is and who is cloning it, through the in-memory
// door. Its addresses, refusals and protocol are covered through @yaks/git's
// own interface (door_test.ts, http_test.ts).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { r2Objects } from './lib/objects.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import { answer } from './git_door.ts'
import { ledger, mint } from './grants.ts'
import { platform } from './testing.ts'
import type { Who } from './session.ts'
import { record } from './versions.ts'
import { pins } from '@yaks/platform/versions'
import { digest } from '@yaks/graph/sha256'
import { concat, DELIM, FLUSH, mark, pkt } from '@yaks/git'
import { held, refAt } from './gitobj.ts'
import { meta } from './meta.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let BEN = 'b0000000-0000-4000-8000-0000000000be'
let SECRET = 'a probe secret'
let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
let WHO: Who = { person: ADA, role: 'owner' }
let utf8 = new TextEncoder()

// A space with one app in it, at the access mode this test is about. Ada owns
// the space, which is what a credential of hers has to find to reach a private
// app; Ben is a person of the platform with no seat here at all.
let dirOf = (env: Env) =>
  directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
let standing = async (env: Env, access: string, trashed = false) => {
  let dir = dirOf(env)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {}, doc: { title: 'Ada' } },
      { entity: { eid: BEN }, person: {}, doc: { title: 'Ben' } },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada', store: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
      {
        entity: { eid: '$app' },
        doc: { title: 'Recipes' },
        app: {
          slug: 'recipes',
          space: '$space',
          version: 0,
          access,
          store: 'ada/recipes.aaa111',
        },
        ...(trashed
          ? { trashed: { at: '2026-09-09T00:00:00Z', by: ADA } }
          : {}),
      },
    ],
  }, by)
  let space = (await dir.space('ada'))! as Space
  return { dir, space, app: (await dir.app(space, 'recipes'))! as App }
}

// One release, the way a deploy makes one: the bytes pinned, then the row that
// says the version happened — which owes the commit, minted once the write has
// answered.
let deploy = async (
  { env, settled }: ReturnType<typeof platform>,
  app: App,
  version: number,
  files: Record<string, string>,
) => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
  let manifest: Record<string, string> = {}
  for (let [path, body] of Object.entries(files)) {
    let bytes = utf8.encode(body)
    manifest[path] = await digest(bytes)
    await pins(r2Objects(env.BLOBS)).put(manifest[path], bytes)
  }
  let space = (await dir.space('ada'))!
  let current = (await dir.app(space, app.slug))!
  await record(dir, WHO, current, version, manifest, '')
  await settled()
}

// The Git door receives the whole hostname path, without its query.
let asked = (env: Env, address: string, headers: HeadersInit = {}) => {
  let url = new URL(`https://ada.yaks.app${address}`)
  let req = new Request(url, { headers })
  // What index.ts hands a door: the path, never the query beside it.
  return answer({ env, req, path: url.pathname, space: 'ada' })
}

// A grant of this person's, as `yak login` writes one down: the token the door
// takes as a Basic password, and the credential a `git clone` URL carries.
let tokenFor = async (env: Env, person: string) =>
  (await mint(SECRET, ledger(env.OAUTH_KV, dirOf(env))!, { person })).token

// The credential git sends once it has been challenged. The username is
// decoration — the door reads the password.
let basic = (token: string) => ({
  authorization: `Basic ${btoa(`x:${token}`)}`,
})

test('a private app asks for a credential, and judges the one it gets', async () => {
  let p = platform(SECRET)
  let { env } = p
  let { app } = await standing(env, 'private')
  await deploy(p, app, 1, { 'index.html': '<h1>hi</h1>\n' })
  let hers = await tokenFor(env, ADA)
  let his = await tokenFor(env, BEN)
  for (let path of ['/recipes.git/info/refs', '/recipes.git/git-upload-pack']) {
    let v2 = { 'git-protocol': 'version=2' }
    // Nothing offered: the challenge, which is the only way git learns to
    // send anything at all.
    let none = await asked(env, path, v2)
    assertEquals(none!.status, 401, path)
    assertEquals(
      none!.headers.get('www-authenticate'),
      'Basic realm="yaks.app"',
      path,
    )
    // Offered and worthless — a token under nobody's secret — is the same
    // answer, because nobody has proved anything yet.
    let junk = await asked(env, path, { ...v2, ...basic('yaks_nonsense') })
    assertEquals(junk!.status, 401, path)
    // Ben proved who he is and holds no seat in Ada's space: told for good.
    let ben = await asked(env, path, { ...v2, ...basic(his) })
    assertEquals(ben!.status, 403, path)
    assertEquals(await ben!.text(), 'git: not your repository\n')
  }
  // And Ada's own grant reaches her own app: the advertisement itself, at the
  // address a clone asks for it at.
  let ada = await asked(env, '/recipes.git/info/refs?service=git-upload-pack', {
    'git-protocol': 'version=2',
    ...basic(hers),
  })
  assertEquals(ada!.status, 200)
  assertEquals(
    ada!.headers.get('content-type'),
    'application/x-git-upload-pack-advertisement',
  )
})

for (let access of ['public', 'open', 'private']) {
  let p = platform(SECRET)
  let { env } = p
  let { dir, space, app } = await standing(env, access)
  let hers = await tokenFor(env, ADA)
  let his = await tokenFor(env, BEN)
  await deploy(p, app, 1, {
    'index.html': '<h1>hi</h1>\n',
    'seed/people.yml': '- name: a private fixture\n',
  })
  await deploy(p, app, 2, { 'index.html': '<h1>hi</h1>\n' })
  let head = (await refAt(held(meta(env)), app.eid))!
  let body = concat([
    pkt('command=fetch\n'),
    mark(DELIM),
    pkt(`want ${head}\n`),
    pkt('done\n'),
    mark(FLUSH),
  ])
  let fetch = (headers: HeadersInit) => {
    let req = new Request('https://ada.yaks.app/recipes.git/git-upload-pack', {
      method: 'POST',
      headers: { 'git-protocol': 'version=2', ...headers },
      body,
    })
    return answer({ env, req, path: new URL(req.url).pathname, space: 'ada' })
  }

  test(`${access} repositories require a writer seat for advertisement and history`, async () => {
    for (let [headers, status] of [[{}, 401], [basic(his), 403]] as const) {
      let refs = await asked(
        env,
        '/recipes.git/info/refs?service=git-upload-pack',
        {
          'git-protocol': 'version=2',
          ...headers,
        },
      )
      assertEquals(refs!.status, status)
      assertEquals((await fetch(headers))!.status, status)
    }
    for (let role of ['viewer', 'editor'] as const) {
      await dir.apply({
        entities: [{
          entity: { eid: '$ben' },
          member: { space: space.eid, person: BEN, role },
        }],
      }, by)
      let res = await fetch(basic(his))
      assertEquals(res!.status, role == 'viewer' ? 403 : 200)
      await res!.arrayBuffer()
      let seat = (await dir.member(space, BEN))!
      await dir.apply({
        entities: [{ entity: { eid: seat.eid }, member: null }],
      }, by)
    }
    let res = await fetch(basic(hers))
    assertEquals(res!.status, 200)
    let pack = new Uint8Array(await res!.arrayBuffer())
    assertEquals(new TextDecoder().decode(pack).includes('\x01PACK'), true)
  })
}

test('a trashed app is gone to a credential as much as to nobody', async () => {
  let p = platform(SECRET)
  let { env } = p
  let { app } = await standing(env, 'private', true)
  await deploy(p, app, 1, { 'index.html': '<h1>hi</h1>\n' })
  let hers = await tokenFor(env, ADA)
  let cases: [string, HeadersInit][] = [
    ['/recipes.git/info/refs', {}],
    ['/recipes.git/info/refs', basic(hers)],
    ['/nothing.git/info/refs', basic(hers)],
  ]
  for (let [path, head] of cases) {
    let res = await asked(env, path, { 'git-protocol': 'version=2', ...head })
    assertEquals(res!.status, 404)
    // Not a challenge: there is nothing here to sign in to.
    assertEquals(res!.headers.get('www-authenticate'), null)
    assertEquals(await res!.text(), 'git: no such repository\n')
  }
})
