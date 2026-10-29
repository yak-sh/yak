// Repository routes, visibility and credentials through the in-memory door.
// The git protocol and history are covered through @yaks/git's own interface.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { r2Objects } from './lib/objects.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import { answer } from './git_door.ts'
import { ledger, mint } from './grants.ts'
import { platform } from './testing.ts'
import type { Who } from './session.ts'
import { pins, record, sha256 } from './versions.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let BEN = 'b0000000-0000-4000-8000-0000000000be'
let SECRET = 'a probe secret'
let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
let WHO: Who = { person: ADA, role: 'owner' }
let utf8 = new TextEncoder()

// A space with one app in it, at the access mode this test is about. Ada owns
// the space, which is what a credential of hers has to find to reach a private
// app; Ben is a person of the platform with no seat here at all.
let standing = async (env: Env, access: string, trashed = false) => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
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
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  let manifest: Record<string, string> = {}
  for (let [path, body] of Object.entries(files)) {
    let bytes = utf8.encode(body)
    manifest[path] = await sha256(bytes)
    await pins(r2Objects(env.BLOBS)).put(manifest[path], bytes)
  }
  await record(dir, WHO, app, version, manifest, '')
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
  (await mint(SECRET, ledger(env.OAUTH_KV)!, { person })).token

// The credential git sends once it has been challenged. The username is
// decoration — the door reads the password.
let basic = (token: string) => ({
  authorization: `Basic ${btoa(`x:${token}`)}`,
})

test('the browser address redirects to the repository, query and all', async () => {
  let p = platform(SECRET)
  let { env } = p
  await standing(env, 'public')
  let res = await asked(env, '/recipes/info/refs?service=git-upload-pack', {
    'git-protocol': 'version=2',
  })
  assertEquals(res!.status, 301)
  assertEquals(
    res!.headers.get('location'),
    'https://ada.yaks.app/recipes.git/info/refs?service=git-upload-pack',
  )
  // A browser asking for the app's own `info/refs`, and the fetch endpoint
  // under the app: both are the app's to answer, which is what `null` says.
  assertEquals(await asked(env, '/recipes/info/refs'), null)
  assertEquals(await asked(env, '/recipes/git-upload-pack'), null)
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

test('a trashed app is gone to a credential as much as to nobody', async () => {
  let p = platform(SECRET)
  let { env } = p
  let { app } = await standing(env, 'private', true)
  await deploy(p, app, 1, { 'index.html': '<h1>hi</h1>\n' })
  let hers = await tokenFor(env, ADA)
  for (let head of [{}, basic(hers)]) {
    let res = await asked(env, '/recipes.git/info/refs', {
      'git-protocol': 'version=2',
      ...head,
    })
    assertEquals(res!.status, 404)
    // Not a challenge: there is nothing here to sign in to.
    assertEquals(res!.headers.get('www-authenticate'), null)
    assertEquals(await res!.text(), 'git: no such repository\n')
  }
})

test('an app that is not there, and a path that is no repository', async () => {
  let p = platform(SECRET)
  let { env } = p
  await standing(env, 'public')
  let gone = await asked(env, '/nothing.git/info/refs', {
    'git-protocol': 'version=2',
  })
  assertEquals(gone!.status, 404)
  // Everything else falls through to the apps, which is what `null` says.
  for (let path of ['/recipes/', '/recipes.git', '/recipes.git/objects/info']) {
    assertEquals(await asked(env, path), null, path)
  }
})

test('the advertisement is served at info/refs on a public app', async () => {
  let p = platform(SECRET)
  let { env } = p
  await standing(env, 'public')
  let res = await asked(env, '/recipes.git/info/refs?service=git-upload-pack', {
    'git-protocol': 'version=2',
  })
  assert(res, 'the door answers')
  assertEquals(
    res.headers.get('content-type'),
    'application/x-git-upload-pack-advertisement',
  )
  assertEquals((await res.text()).includes('000eversion 2\n'), true)
})
