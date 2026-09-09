// The repository at an app's address, judged by git: a real `git clone` over a
// real socket against the door the plugin mounts, then `git log` and `git fsck`
// in what it wrote. Everything below the wire is @yaks/git's and is checked
// there (packages/git/http_test.ts); what is pinned here is the MOUNT — which
// app a URL names, who may clone it and how they say so, and that a path which
// is no repository is left for the apps.
import { assert, assertEquals } from '@std/assert'
import { r2Blobs } from '../../src/blobs_r2.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import { gitPlugin } from './git.ts'
import { ledger, mint } from './grants.ts'
import { platform } from './harness.ts'
import type { Who } from './session.ts'
import { pins, record, sha256 } from './versions.ts'

let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let BEN = 'b0000000-0000-4000-8000-0000000000be'
let SECRET = 'a probe secret'
let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
let WHO: Who = { person: ADA, role: 'owner' }
let utf8 = new TextEncoder()
let text = new TextDecoder()

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
        space: { slug: 'ada' },
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
// says the version happened — which is what mints the commit.
let deploy = async (
  env: Env,
  app: App,
  version: number,
  files: Record<string, string>,
) => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  let manifest: Record<string, string> = {}
  for (let [path, body] of Object.entries(files)) {
    let bytes = utf8.encode(body)
    manifest[path] = await sha256(bytes)
    await pins(r2Blobs(env.BLOBS), 'ada/recipes/').put(manifest[path], bytes)
  }
  await record(dir, WHO, app, version, manifest, '')
}

// The door as the router reaches it: through the plugin's own `routes` slot,
// so a route this file passes is a route the Worker actually mounts.
let asked = (env: Env, address: string, headers: HeadersInit = {}) => {
  let url = new URL(`https://ada.yaks.app${address}`)
  let req = new Request(url, { headers })
  // What index.ts hands a door: the PATH, never the query beside it.
  return gitPlugin.routes![0]({ env, req, path: url.pathname, space: 'ada' })
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

let run = async (...args: string[]) => {
  let { code, stdout, stderr } = await new Deno.Command('git', {
    args,
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  return { code, out: text.decode(stdout), err: text.decode(stderr) }
}

let git = async (...args: string[]) => {
  let { code, out, err } = await run(...args)
  assertEquals(code, 0, `git ${args.join(' ')}: ${err}`)
  return out
}

// The door on a socket, so a real `git` speaks to the mount the router mounts.
let serving = (env: Env) =>
  Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    let path = new URL(req.url).pathname
    let at = { env, req, path, space: 'ada' }
    return await gitPlugin.routes![0](at) ?? new Response('no', { status: 404 })
  })

Deno.test('git clones an app at <app>.git, and its history is its deploys', async () => {
  let { env } = platform(SECRET)
  let { app } = await standing(env, 'public')
  await deploy(env, app, 1, { 'index.html': '<h1>hi</h1>\n' })
  await deploy(env, app, 2, {
    'index.html': '<h1>hello</h1>\n',
    'lib/app.js': 'export let go = () => 1\n',
  })

  let server = serving(env)
  let dir = await Deno.makeTempDir({ prefix: 'yaks-app-clone-' })
  try {
    let url = `http://127.0.0.1:${server.addr.port}/recipes.git`
    await git('-c', 'protocol.version=2', 'clone', '--quiet', url, `${dir}/a`)
    assertEquals(
      await git('-C', `${dir}/a`, 'log', '--format=%s'),
      'deploy 2\ndeploy 1\n',
    )
    assertEquals(
      await Deno.readTextFile(`${dir}/a/lib/app.js`),
      'export let go = () => 1\n',
    )
    assertEquals(
      await git('-C', `${dir}/a`, 'log', '--format=%an <%ae>', '-1'),
      `Ada <${ADA}@users.yaks.app>\n`,
    )
    assertEquals(
      await git('-C', `${dir}/a`, 'symbolic-ref', 'HEAD'),
      'refs/heads/main\n',
    )
    await git('-C', `${dir}/a`, 'fsck', '--strict')
  } finally {
    await server.shutdown()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('git clones the browser address, with and without its slash', async () => {
  let { env } = platform(SECRET)
  let { app } = await standing(env, 'public')
  // A file at the very address the door now answers: what proves the app is
  // still the one serving its pages.
  await deploy(env, app, 1, {
    'index.html': '<h1>hi</h1>\n',
    'info/refs': 'a static file\n',
  })

  let server = serving(env)
  let dir = await Deno.makeTempDir({ prefix: 'yaks-app-clone-' })
  try {
    let base = `http://127.0.0.1:${server.addr.port}/recipes`
    // The URL straight from the browser, and the same without its slash: git
    // strips the slash, so both ask for the same advertisement, follow the
    // 301, and post the fetch to the address they landed on.
    for (let [n, url] of [`${base}/`, base].entries()) {
      let into = `${dir}/${n}`
      await git('-c', 'protocol.version=2', 'clone', '--quiet', url, into)
      assertEquals(await git('-C', into, 'log', '--format=%s'), 'deploy 1\n')
      assertEquals(
        await Deno.readTextFile(`${into}/info/refs`),
        'a static file\n',
      )
      await git('-C', into, 'fsck', '--strict')
    }
  } finally {
    await server.shutdown()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('the browser address redirects to the repository, query and all', async () => {
  let { env } = platform(SECRET)
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

Deno.test('a private app asks for a credential, and judges the one it gets', async () => {
  let { env } = platform(SECRET)
  let { app } = await standing(env, 'private')
  await deploy(env, app, 1, { 'index.html': '<h1>hi</h1>\n' })
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

Deno.test('a trashed app is gone to a credential as much as to nobody', async () => {
  let { env } = platform(SECRET)
  let { app } = await standing(env, 'private', true)
  await deploy(env, app, 1, { 'index.html': '<h1>hi</h1>\n' })
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

Deno.test('git clones a private app with the token as the password', async () => {
  let { env } = platform(SECRET)
  let { app } = await standing(env, 'private')
  await deploy(env, app, 1, { 'index.html': '<h1>hi</h1>\n' })
  let hers = await tokenFor(env, ADA)

  let server = serving(env)
  let dir = await Deno.makeTempDir({ prefix: 'yaks-app-clone-' })
  try {
    let at = `127.0.0.1:${server.addr.port}/recipes.git`
    // No credential, and no terminal to ask on: git stops at the challenge.
    let shut = await run(
      '-c',
      'protocol.version=2',
      'clone',
      `http://${at}`,
      `${dir}/a`,
    )
    assert(shut.code != 0, 'a clone with no credential fails')
    assert(
      /terminal prompts disabled|Authentication failed|401/i.test(shut.err),
      `the 401 is what stopped it: ${shut.err}`,
    )
    // The same URL wearing the token, which is what a person is handed.
    await git(
      '-c',
      'protocol.version=2',
      'clone',
      '--quiet',
      `http://x:${hers}@${at}`,
      `${dir}/b`,
    )
    assertEquals(
      await git('-C', `${dir}/b`, 'log', '--format=%s'),
      'deploy 1\n',
    )
    assertEquals(
      await Deno.readTextFile(`${dir}/b/index.html`),
      '<h1>hi</h1>\n',
    )
  } finally {
    await server.shutdown()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('an app that is not there, and a path that is no repository', async () => {
  let { env } = platform(SECRET)
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

Deno.test('the advertisement is served at info/refs on a public app', async () => {
  let { env } = platform(SECRET)
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
