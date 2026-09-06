/// <reference lib="deno.ns" />
// The builder's workbench (T-34264), on the stand-in: a scripted container
// instead of a Cloudflare one, and everything else the code that runs in
// production — the platform's own tool table, the directory, the bucket, the
// meter, the serving door.
//
// What is proved here is the whole path a compile takes: the four tools run
// as the person, a `.wasm` survives the trip into the app as BYTES, the
// seconds land on the meter, the budget refuses in a sentence, and a runtime
// with no container bound says so rather than half-running.
//
// The container itself is not proved here and cannot be: both `wrangler dev`
// and `wrangler deploy --dry-run` BUILD the image, which needs a container
// engine, and a box may have the Docker CLI and no daemon —
// `--containers-rollout=none` is what gets a dry run past it. So the last test
// here reads the deploy's own config instead (see the gate note in
// wrangler.toml).
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { parse } from '@std/toml'
import { build, fake } from './builder.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import * as apps from './apps.ts'
import { platform, type Ran, sandboxes } from './harness.ts'
import { GRANT, held, ledger } from './grants.ts'
import {
  boxOf,
  BUDGET,
  destroyed,
  HOST,
  LIFE,
  named,
  NO_BOX,
  released,
  seconds,
  spending,
} from './sandbox.ts'
import { type Ctx, TOOLS } from './tools.ts'
import type { Who } from './session.ts'

let SECRET = 'a probe secret'
// A wasm module's first eight bytes, as escapes — the point of the ship path
// is that these survive it, and a raw NUL in a source file makes git call the
// whole file binary (bin/check-bytes.ts).
let WASM = '\0asm\x01\0\0\0'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let owner: Who = { person: ADA, role: 'owner' }

let dirOf = (env: Env) =>
  directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)

// A space with Ada in it and one app of hers — the app a compile ships into.
let seeded = async (vars: Partial<Env> = {}) => {
  let { env } = platform(SECRET, vars)
  let dir = dirOf(env)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  let space = (await dir.space('ada'))!
  return { env, space }
}

let ctxOf = (env: Env, spend = spending()): Ctx => ({
  env,
  dir: dirOf(env),
  person: ADA,
  spend,
})

let tool = (name: string) => {
  let t = TOOLS.find((one) => one.name == name)
  if (!t) throw new Error(`no tool ${name}`)
  return t
}

// A file of this worker's, read from disk — the Dockerfile and the pages that
// have to agree with it.
let at = (name: string) =>
  Deno.readTextFile(new URL(`./${name}`, import.meta.url))

// Every `ARG <NAME>_VERSION=` the image pins, as NAME → version. This is the
// one list; the tool description and the two pages that quote it are checked
// against it rather than against each other.
let VERSIONS = /^ARG (\w+)_VERSION=(\S+)$/gm

let pinned = async () =>
  new Map(
    [...(await at('sandbox/Dockerfile')).matchAll(VERSIONS)]
      .map(([, name, version]) => [name, version] as const),
  )

// The whole workbench, wired: a space, an app, and a scripted container.
let bench = async (answer: (cmd: string) => Ran | void = () => {}) => {
  let box = sandboxes(answer)
  let { env, space } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  let ctx = ctxOf(env)
  await tool('app_new').run(ctx, { slug: 'chess', title: 'Chess' })
  return { env, space, ctx, box }
}

Deno.test('the four tools write, run, read and ship', async () => {
  // The build leaves a .js and a .wasm in pkg/, and the glob finds both.
  let { ctx, box, env, space } = await bench((cmd) =>
    cmd.startsWith('ls -1d')
      ? { stdout: 'pkg/chess.js\npkg/chess_bg.wasm\n' }
      : { stdout: 'Finished `release` profile', stderr: 'warning: unused' }
  )

  await tool('sandbox_write').run(ctx, {
    path: 'src/lib.rs',
    content: 'pub fn best_move() {}',
  })
  assertEquals(box.files.get('/workspace/src/lib.rs'), 'pub fn best_move() {}')

  let ran = await tool('sandbox_exec').run(ctx, {
    cmd: 'cargo build --release --target wasm32-unknown-unknown',
  })
  assertStringIncludes(ran.text, 'code 0')
  assertStringIncludes(ran.text, 'Finished `release` profile')
  assertStringIncludes(ran.text, 'warning: unused')
  assert(box.ran.some((c) => c.startsWith('cargo build')))

  let read = await tool('sandbox_read').run(ctx, { path: 'src/lib.rs' })
  assertEquals(read.text, 'pub fn best_move() {}')

  // The artifact, shipped: both files land beside index.html under their own
  // names, and the tool says where.
  box.files.set('/workspace/pkg/chess.js', 'export default init')
  box.files.set('/workspace/pkg/chess_bg.wasm', WASM)
  let shipped = await tool('sandbox_ship').run(ctx, {
    app: 'chess',
    paths: ['pkg/*.js', 'pkg/*.wasm'],
  })
  assertStringIncludes(shipped.text, 'shipped 2 files')
  assertStringIncludes(shipped.text, 'chess.js, chess_bg.wasm')

  // And the app serves them — the .wasm as application/wasm, whole (files.ts
  // MIME), which is what makes the ship path a BYTES path.
  let js = await apps.fetch(
    new Request('https://ada.yaks.app/chess/chess.js'),
    env,
  )
  assertEquals(js.status, 200)
  assertEquals(await js.text(), 'export default init')
  let wasm = await apps.fetch(
    new Request('https://ada.yaks.app/chess/chess_bg.wasm'),
    env,
  )
  assertEquals(wasm.headers.get('content-type'), 'application/wasm')
  assertEquals(await wasm.text(), WASM)

  // Every one of those touched the same container, under the space's own id.
  assertEquals([...box.alive], [`build-${space.eid}`])
})

Deno.test('a ship that matches nothing says what to look at', async () => {
  let { ctx } = await bench((cmd) =>
    cmd.startsWith('ls -1d') ? { stdout: '', exitCode: 2 } : {}
  )
  let said = await assertRejects(() =>
    tool('sandbox_ship').run(ctx, { app: 'chess', paths: ['pkg/*.wasm'] })
  )
  assertStringIncludes(String(said), 'nothing in the sandbox matches')
})

Deno.test('a path that is not one is refused before the shell sees it', async () => {
  let { ctx } = await bench()
  for (let path of ['pkg/../../etc/passwd', 'a; rm -rf /', '$(whoami)']) {
    await assertRejects(
      () => tool('sandbox_read').run(ctx, { path }),
      Error,
      'a path inside the sandbox',
    )
  }
})

Deno.test('a member who cannot write is not given the workbench', async () => {
  let box = sandboxes()
  let { env } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  let BOB = 'b0000000-0000-4000-8000-0000000000b0'
  await dirOf(env).apply({
    entities: [
      { entity: { eid: BOB }, person: {} },
      {
        entity: { eid: '$seat' },
        member: {
          space: (await dirOf(env).space('ada'))!.eid,
          person: BOB,
          role: 'viewer',
        },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })

  let ctx: Ctx = { env, dir: dirOf(env), person: BOB, spend: spending() }
  await assertRejects(
    () => tool('sandbox_exec').run(ctx, { space: 'ada', cmd: 'whoami' }),
    Error,
    'not a writer of ada',
  )
  assertEquals(box.ran, [])
})

Deno.test('no container bound is a sentence, not a stack trace', async () => {
  let { env } = await seeded()
  let ctx = ctxOf(env)
  await assertRejects(
    () => tool('sandbox_exec').run(ctx, { cmd: 'whoami' }),
    Error,
    NO_BOX,
  )
  // And nothing was counted for a container that never existed.
  assertEquals((await dirOf(env).space('ada'))!.meter?.seconds, undefined)
  assertEquals(seconds(ctx.spend!), 0)
})

Deno.test('the budget refuses in a sentence, and only after it is spent', async () => {
  let box = sandboxes()
  let { env, space } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  let clock = 0
  let now = () => clock

  // The first call starts the clock; a call one second past the budget is the
  // one that is refused, and the container is never asked for.
  let spend = spending()
  boxOf(env, space, ADA, spend, now)
  assertEquals(spend.since, 0)
  clock = BUDGET * 1000 + 1
  let said = ((): Error => {
    try {
      boxOf(env, space, ADA, spend, now)
      throw new Error('not refused')
    } catch (e) {
      return e as Error
    }
  })()
  assertStringIncludes(said.message, `one build gets ${BUDGET}`)
  assertStringIncludes(said.message, 'already shipped into the app is shipped')
})

Deno.test('a release answers the seconds held, and the container goes', async () => {
  let box = sandboxes()
  let { env, space } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  let clock = 0
  let spend = spending()
  await boxOf(env, space, ADA, spend, () => clock).exec('sleep 42')
  assertEquals([...box.alive], [`build-${space.eid}`])
  clock = 42_300
  let spent = await released(env, space, spend, () => clock)

  // Rounded up, the clock started over, and the container gone.
  assertEquals(spent, 43)
  assertEquals(spend.since, null)
  assertEquals([...box.alive], [])
  // A release of a build that never woke one answers nothing and kills
  // nothing — which is what makes it safe on every end of the loop.
  assertEquals(await released(env, space, spending()), 0)
})

// The sandbox's sign-in (T-34387): every command runs with a grant of the
// caller's in its environment, one grant for the whole container, and the
// grant dies with the container.
Deno.test('every command is signed in as the caller, with one grant', async () => {
  let { box, env } = await bench(() => ({ stdout: 'ok' }))
  // No `spend` on the Ctx, so each of these is its own build as far as the
  // tools are concerned: what makes the two say one grant is the ledger row
  // the container wears, not a memory inside one call.
  let lone: Ctx = { env, dir: dirOf(env), person: ADA }
  await tool('sandbox_exec').run(lone, { cmd: 'rustc --version' })
  await tool('sandbox_exec').run(lone, { cmd: 'cargo build' })

  let [first, second] = box.env
  assertEquals(first.YAKS_HOST, HOST)
  assert(first.YAKS_TOKEN?.startsWith(GRANT), 'a grant token, said as one')
  assertEquals(second.YAKS_TOKEN, first.YAKS_TOKEN)
  // A writeFile is not a command, and asks for no grant.
  assertEquals(box.env.length, 2)

  // And it opens the door as Ada, narrowed to her space, for about as long as
  // the container can live.
  let book = ledger(env.OAUTH_KV)!
  let grant = await held(first.YAKS_TOKEN, SECRET, book)
  assertEquals(grant?.person, ADA)
  assertEquals(grant?.space, 'ada')
  let hours = (grant!.exp - Math.floor(Date.now() / 1000)) / 3600
  assert(Math.abs(hours - LIFE) < 0.01, `${hours} hours is about ${LIFE}`)
})

Deno.test('destroying the container revokes what it was wearing', async () => {
  let { box, env, space } = await bench(() => ({ stdout: 'ok' }))
  let lone: Ctx = { env, dir: dirOf(env), person: ADA }
  await tool('sandbox_exec').run(lone, { cmd: 'ls' })
  let token = box.env[0].YAKS_TOKEN
  let book = ledger(env.OAUTH_KV)!
  assert(await held(token, SECRET, book), 'live while the container is')

  // Destroy is the one door — a build's own end (`released`) and a space
  // being erased (erase.ts) both come through it, and neither has to be
  // holding the grant to end it.
  assertEquals(await destroyed(env, space), true)
  assertEquals(await held(token, SECRET, book), null)
  assertEquals(await book.wearing(named(space)), null)

  // The next wake mints a fresh one rather than saying the dead one again.
  await tool('sandbox_exec').run(lone, { cmd: 'ls' })
  assert(box.env[1].YAKS_TOKEN != token, 'a new grant for a new container')
  assert(await held(box.env[1].YAKS_TOKEN, SECRET, book))
})

Deno.test('the token is in the environment and never in the transcript', async () => {
  let box = sandboxes(() => ({ stdout: 'ok' }))
  let { env, space } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  let model = fake([
    {
      calls: [{
        id: 'c1',
        name: 'sandbox_exec',
        args: JSON.stringify({ cmd: 'yaks app_list' }),
      }],
    },
    { text: 'listed' },
  ])
  let beats: string[] = []
  await build(env, owner, space, [{ said: 'person', text: 'list them' }], {
    model,
    on: (b) => beats.push(JSON.stringify(b)),
  })

  let token = box.env[0].YAKS_TOKEN
  assert(token?.startsWith(GRANT), 'the command was signed in')
  // Not in a frame the person's page draws, not in what the model reads back,
  // and not in the command line the tool was called with.
  for (let said of [...beats, ...box.ran]) {
    assert(!said.includes(token), `the token is not in ${said.slice(0, 60)}`)
  }
})

Deno.test('a build pays for its workbench and leaves none running', async () => {
  let box = sandboxes(() => ({ stdout: 'ok' }))
  let { env, space } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  let model = fake([
    {
      calls: [{
        id: 'c1',
        name: 'sandbox_exec',
        args: JSON.stringify({ cmd: 'rustc --version' }),
      }],
    },
    { text: 'compiled' },
  ])
  let out = await build(env, owner, space, [{
    said: 'person',
    text: 'a chess engine',
  }], { model })

  assertEquals(out.refused, undefined)
  assertEquals(box.ran, ['rustc --version'])
  // The loop destroyed what it woke...
  assertEquals([...box.alive], [])
  // ...and the seconds are on the space's month. This conversation shipped
  // nothing, so it is the container alone: no build, no tokens.
  let after = (await dirOf(env).space('ada'))!
  assert((after.meter?.seconds ?? 0) >= 1, 'the container was paid for')
  assertEquals(after.meter?.built, 0)
})

Deno.test('a build that ships pays for both in one write', async () => {
  let box = sandboxes(() => ({ stdout: 'ok' }))
  let { env, space } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  let call = (id: string, name: string, args: unknown) => ({
    id,
    name,
    args: JSON.stringify(args),
  })
  let model = fake([
    { calls: [call('c1', 'sandbox_exec', { cmd: 'cargo build' })] },
    { calls: [call('c2', 'app_new', { slug: 'chess', title: 'Chess' })] },
    {
      calls: [call('c3', 'app_files', {
        app: 'chess',
        files: [{ path: 'index.html', content: '<h1>Chess</h1>' }],
      })],
    },
    {
      calls: [call('c4', 'app_deploy', { app: 'chess' })],
      usage: { input: 900, output: 40, cached: 0 },
    },
    { text: 'it is at https://ada.yaks.app/chess/' },
  ])
  await build(env, owner, space, [{ said: 'person', text: 'chess' }], { model })

  // The month with no row before this: one build, its tokens, and the
  // container seconds — none of them zeroed by the other.
  let after = (await dirOf(env).space('ada'))!
  assertEquals(after.meter?.builds, 1)
  assertEquals(after.meter?.built, 1)
  assertEquals(after.meter?.tokens, 940)
  assert((after.meter?.seconds ?? 0) >= 1, 'and the container it compiled in')
})

Deno.test('the workbench is offered to the builder, and says what it is for', () => {
  let names = TOOLS.map((t) => t.name)
  for (
    let want of [
      'sandbox_exec',
      'sandbox_write',
      'sandbox_read',
      'sandbox_ship',
    ]
  ) {
    assert(names.includes(want), `${want} is offered`)
    let t = tool(want)
    // Each says it is metered, so a model choosing between tools knows the
    // cheap ones from the expensive one.
    assertStringIncludes(t.description, 'metered')
    assertEquals(t.input.type, 'object')
  }
  assertStringIncludes(tool('sandbox_exec').description, 'Rust')
  assertStringIncludes(tool('sandbox_ship').description, 'served')
})

// The deploy's own half, which no test on this box can run: `wrangler deploy`
// builds the container image and needs an engine to do it, and this machine
// has the Docker CLI and no daemon. A dry-run here gets as far as bundling the
// Worker and then refuses at the CLI — so what is held instead is the CONFIG,
// and above all the one thing that rots silently: the image tag and the SDK
// version are two halves of one release, and the SDK warns at startup rather
// than failing when they disagree.
Deno.test('the deploy names the container, and the image is the SDK version', async () => {
  let conf = parse(await at('wrangler.toml')) as {
    containers: {
      class_name: string
      image: string
      image_build_context: string
      instance_type: string
    }[]
    durable_objects: { bindings: { name: string; class_name: string }[] }
    migrations: { tag: string; new_sqlite_classes?: string[] }[]
  }

  assertEquals(conf.containers.length, 1)
  let [box] = conf.containers
  assertEquals(box.class_name, 'Sandbox')
  assertEquals(box.image, './sandbox/Dockerfile')
  // rustc on a sixteenth of a core would spend the whole budget on one crate,
  // and the image does not fit in `lite`'s disk.
  assertEquals(box.instance_type, 'standard-2')

  // The binding the tools reach it through, and the migration that creates it.
  assert(
    conf.durable_objects.bindings.some((b) =>
      b.name == 'SANDBOX' && b.class_name == 'Sandbox'
    ),
    'SANDBOX is bound to the Sandbox class',
  )
  assert(
    conf.migrations.some((m) => m.new_sqlite_classes?.includes('Sandbox')),
    'a migration declares the Sandbox object',
  )

  let pinned = JSON.parse(await at('package.json')) as {
    dependencies: Record<string, string>
  }
  let file = await at('sandbox/Dockerfile')
  let tag = /^FROM docker\.io\/cloudflare\/sandbox:(\S+)$/m.exec(file)
  assert(tag, 'the Dockerfile is FROM the sandbox image')
  assertEquals(tag[1], pinned.dependencies['@cloudflare/sandbox'])

  // The CLI in the image (T-34387). It is installed from the repo copy until
  // @yaks/cli is on JSR, which is why the build context is that package and
  // not this directory — the two have to agree or the COPY finds nothing.
  assertEquals(box.image_build_context, '../../packages/cli')
  assertStringIncludes(file, 'COPY . /opt/yaks/cli')
  assertStringIncludes(file, 'deno install -gf')
  assertStringIncludes(file, '/opt/yaks/cli/yaks.ts')
  // Pinned and checksummed like everything else it downloads.
  assert(/^ARG DENO_VERSION=\d+\.\d+\.\d+$/m.test(file), 'deno is pinned')
  assert(/^ARG DENO_SHA256=[0-9a-f]{64}$/m.test(file), 'and checksummed')
})

// The image is not Rust-specific (T-34516). What holds that is this list plus
// the rule under it: nothing is fetched into the image without a sha256 to
// check it against, because a floating toolchain is a build that worked
// yesterday and there is nobody here to debug it.
Deno.test('a toolchain apiece, pinned, and every download checksummed', async () => {
  let file = await at('sandbox/Dockerfile')
  let versions = await pinned()
  for (
    let want of [
      'RUST',
      'PYTHON',
      'GO',
      'ZIG',
      'DENO',
      'WASM_BINDGEN',
      'BINARYEN',
    ]
  ) {
    assert(versions.has(want), `${want} is pinned`)
  }
  for (let [, sha] of file.matchAll(/^ARG \w+_SHA256=(\S+)$/gm)) {
    assert(/^[0-9a-f]{64}$/.test(sha), `${sha} is a sha256`)
  }

  // One `sha256sum -c` per downloaded file. rustup is the exception and is
  // written as a `curl | sh` for exactly that reason: it verifies its own
  // manifests and there is no file on disk to hash.
  let got = [...file.matchAll(/curl -fsSL -o /g)].length
  let checked = [...file.matchAll(/\| sha256sum -c -/g)].length
  assertEquals(got, checked, 'every download is hashed before it is used')
  assert(got >= 6, `${got} downloads, one per pinned artifact`)

  // Zig is also the C and C++ path to wasm — the smallest that can be, at 396
  // MB unpacked against wasi-sdk 34's 635 MB and Emscripten 6.0.9's 1.5 GB —
  // so no second clang is carried for it.
  assertStringIncludes(file, 'wasm32-freestanding')
})

Deno.test('sandbox_exec names what is in the image, and where the rest comes from', async () => {
  let said = tool('sandbox_exec').description
  for (let [name, version] of await pinned()) {
    assert(said.includes(version), `${name} ${version} is named`)
  }
  for (
    let want of ['Rust', 'Python', 'pip', 'Go', 'Zig', 'zig cc', 'Deno', 'Node']
  ) {
    assertStringIncludes(said, want)
  }
  // And the other half of the promise: the image is a floor, not a ceiling,
  // and nothing a build adds outlives it.
  assertStringIncludes(said, 'apt-get install')
  assertStringIncludes(said, 'destroyed when the build ends')
})

Deno.test('the guide and the limits page say the same image', async () => {
  let [guide, tech] = await Promise.all([
    at('public/guide/code.md'),
    at('public/technical.html'),
  ])
  for (let [name, version] of await pinned()) {
    assert(guide.includes(version), `code.md names ${name} ${version}`)
    assert(tech.includes(version), `technical.html names ${name} ${version}`)
  }
  for (let page of [guide, tech]) {
    assertStringIncludes(page, 'apt')
    assertStringIncludes(page, 'destroyed when the build ends')
  }
})

Deno.test('a lone connector call pays for itself and leaves the container', async () => {
  let box = sandboxes(() => ({ stdout: 'ok' }))
  let { env, space } = await seeded({ SANDBOX: box.SANDBOX } as Partial<Env>)
  // No `spend` on the Ctx: this is somebody's own agent over the connector,
  // not a build we are running.
  let ctx: Ctx = { env, dir: dirOf(env), person: ADA }
  await tool('sandbox_exec').run(ctx, { cmd: 'ls' })

  // It is counted — a second at least, since the call rounds up — and the
  // container is still there for the next call.
  assert(((await dirOf(env).space('ada'))!.meter?.seconds ?? 0) >= 1)
  assertEquals([...box.alive], [`build-${space.eid}`])
})
