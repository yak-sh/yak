// The one seam of the wrangler door worth a test: when it decides
// `node_modules` is behind the lockfile. Running `npm ci` is an impure edge —
// `deno task deploy:yak` from a worktree with no node_modules is the proof.
//
// And the two maps that must say the same thing: workers.json is what
// `deno check` reads, and the workspace (wrangler.ts `members`) is what esbuild
// bundles by. A workers.json entry pointing anywhere else type-checks one file
// and bundles another.
import { test, tick } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aliased,
  bundled,
  command,
  images,
  members,
  preflight,
  prepareSibling,
  readiness,
  runWrangler,
  sameSibling,
  seen,
  siblingDigest,
  siblingImages,
  SIBLINGS,
  siblings,
  superseded,
  uploadSibling,
} from './wrangler.ts'

let read = (path: string) =>
  Deno.readTextFileSync(new URL(path, import.meta.url))

test('deploy prerequisites generate while npm is pending and settle before writes', async () => {
  let dependencies = Promise.withResolvers<boolean>()
  let web = Promise.withResolvers<void>()
  let catalog = Promise.withResolvers<void>()
  let started: string[] = [], settled = false
  let made = readiness({
    dependencies: () => {
      started.push('npm')
      return dependencies.promise
    },
    web: () => {
      started.push('web')
      return web.promise
    },
    catalog: () => {
      started.push('catalog')
      return catalog.promise
    },
  })
  let failure = Error('catalog failed')
  let outcome = made.all.then(() => null, (error) => error).then((error) => {
    settled = true
    return error
  })
  try {
    await Promise.resolve()
    assertEquals(started, ['npm', 'web', 'catalog'])
    dependencies.resolve(false)
    assertEquals(await made.dependencies, false)
    catalog.reject(failure)
    await Promise.resolve()
    assertEquals(settled, false)
    web.resolve()
    assertEquals(await outcome, failure)
  } finally {
    dependencies.resolve(false)
    web.resolve()
    catalog.resolve()
    await outcome
  }
})

for (let failed of ['web', 'catalog'] as const) {
  test(`failed ${failed} generation settles prepared Workers without uploading`, async () => {
    let web = Promise.withResolvers<void>()
    let catalog = Promise.withResolvers<void>()
    let lanes = { web, catalog }
    let failure = Error(`${failed} failed`)
    let made = readiness({
      dependencies: () => Promise.resolve(false),
      web: () => web.promise,
      catalog: () => catalog.promise,
    })
    let prepared = Promise.withResolvers<void>()
    let removed = false, uploaded = false
    let deploy = preflight(
      () => made.dependencies,
      () => Promise.resolve(true),
      () => {
        prepared.resolve()
        return Promise.resolve({ remove: () => removed = true })
      },
      () => {
        uploaded = true
        return Promise.resolve(0)
      },
      () => made.all,
    ).then((code) => ({ code }), (error) => ({ error }))
    try {
      await prepared.promise
      assertEquals(uploaded, false)
      lanes[failed].reject(failure)
      lanes[failed == 'web' ? 'catalog' : 'web'].resolve()
      assertEquals(await deploy, { error: failure })
      assertEquals(uploaded, false)
      assert(removed)
    } finally {
      web.resolve()
      catalog.resolve()
      await deploy
    }
  })
}

test('wrangler: staging keeps deploy annotations with either flag position', () => {
  for (
    let args of [
      ['deploy'],
      ['deploy', '--env', 'staging'],
      ['--env', 'staging', 'deploy'],
      ['--env=staging', 'deploy'],
      ['-e', 'staging', 'deploy'],
    ]
  ) assertEquals(command(args), 'deploy')
  assertEquals(command(['--env', 'staging', 'dev']), 'dev')
  assertEquals(command(['secret', 'put', 'deploy']), 'secret')
})

test('wrangler: a deploy of the kernel deploys its siblings first, and nothing else does', () => {
  for (
    let argv of [
      ['deploy', '--message', 'm'],
      ['deploy', '--env', 'staging'],
      ['--env', 'staging', 'deploy', '--containers-rollout=none'],
      ['deploy', '--containers-rollout', 'immediate', '--message', 'm'],
    ]
  ) {
    assertEquals(siblings(argv), SIBLINGS.map((c) => [...argv, '-c', c]))
  }
  for (
    let args of [
      ['dev'],
      ['--env', 'staging', 'dev'],
      ['deploy', '-c', 'other.toml'],
      ['deploy', '--config=other.toml'],
    ]
  ) assertEquals(siblings(args), [])
})

test("a sibling's images are its Dockerfiles and their build contexts", async () => {
  let root = Deno.makeTempDirSync()
  try {
    let write = (path: string, text = path) => {
      Deno.mkdirSync(dirname(join(root, path)), { recursive: true })
      Deno.writeTextFileSync(join(root, path), text)
    }
    write(
      'w/wrangler.toml',
      '[[containers]]\nimage = "./Dockerfile"\nimage_build_context = "../ctx"\n' +
        '[[env.staging.containers]]\nimage = "registry.example/x:1"\n' +
        '[[env.lab.containers]]\nimage = "../box"\n',
    )
    for (let path of ['w/Dockerfile', 'ctx/a.ts', 'ctx/lib/b.ts']) write(path)
    for (let path of ['box/Dockerfile', 'box/run.sh']) write(path)
    assertEquals(Object.keys(images('w/wrangler.toml', root)).sort(), [
      'box/Dockerfile',
      'box/run.sh',
      'ctx/a.ts',
      'ctx/lib/b.ts',
      'w/Dockerfile',
    ])
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
  assert('../../packages/esbuild/compile.ts' in images('esbuild/wrangler.toml'))
  await checkCompilerImages()
  await checkSiblingPreparation()
})

test('independent sibling deploys overlap and the kernel waits for both successes', async () => {
  let started: { args: string[]; unpinned?: boolean }[] = []
  let waits = [Promise.withResolvers<number>(), Promise.withResolvers<number>()]
  let deploy = runWrangler(['deploy', '--env', 'staging'], (args, unpinned) => {
    started.push({ args, unpinned })
    return unpinned ? waits[started.length - 1].promise : Promise.resolve(0)
  })
  try {
    await tick()
    assertEquals(
      started.map((call) => call.args),
      siblings(['deploy', '--env', 'staging']),
    )
    assertEquals(started.map((call) => call.unpinned), [true, true])
    waits[0].resolve(0)
    await tick()
    assertEquals(started.length, 2)
    waits[1].resolve(0)
    assertEquals(await deploy, 0)
    assertEquals(started[2], {
      args: ['deploy', '--env', 'staging'],
      unpinned: undefined,
    })
  } finally {
    for (let wait of waits) wait.resolve(0)
    await deploy
  }
})

for (let failure of [7, Error('process wait failed')]) {
  test(`a sibling ${typeof failure == 'number' ? 'exit' : 'rejection'} waits for the other sibling and never deploys the kernel`, async () => {
    let other = Promise.withResolvers<number>()
    let starts = 0, ended = false
    let deploy = runWrangler(['deploy'], (_args, unpinned) => {
      assert(unpinned, 'kernel must not start')
      return ++starts == 1
        ? typeof failure == 'number'
          ? Promise.resolve(failure)
          : Promise.reject(failure)
        : other.promise
    })
    let outcome = deploy.then((code) => ({ code }), (error) => ({ error }))
    void outcome.then(() => {
      ended = true
    })
    try {
      await tick()
      assertEquals(starts, 2)
      assertEquals(ended, false)
      other.resolve(0)
      assertEquals(
        await outcome,
        typeof failure == 'number' ? { code: failure } : { error: failure },
      )
    } finally {
      other.resolve(0)
      await outcome
    }
  })
}

test('a wrangler command with no sibling deploy runs once with its own pinned identity', async () => {
  let called: unknown[] = []
  let code = await runWrangler(['tail'], (args, unpinned) => {
    called.push({ args, unpinned })
    return Promise.resolve(3)
  })
  assertEquals(code, 3)
  assertEquals(called, [{ args: ['tail'], unpinned: undefined }])
})

test('every @yaks/* the checker knows is the file the bundler gets', () => {
  let checked = (JSON.parse(read('./workers.json')) as {
    imports: Record<string, string>
  }).imports
  let bundled = members()
  let here = fileURLToPath(new URL('./', import.meta.url))
  for (let [name, path] of Object.entries(checked)) {
    if (!name.startsWith('@yaks/')) continue
    assertEquals(bundled[name], join(here, path), `${name} in workers.json`)
  }
})

test('aliased: every export of a member, relative to the paths file', () => {
  let root = Deno.makeTempDirSync({ prefix: 'yak-paths-' })
  let write = (at: string, json: unknown) => {
    Deno.mkdirSync(`${root}/${at}`, { recursive: true })
    Deno.writeTextFileSync(`${root}/${at}/deno.json`, JSON.stringify(json))
  }
  write('.', { workspace: ['./app', './packages/one', './packages/two'] })
  write('app', {})
  write('packages/one', { name: '@yaks/one', exports: './mod.ts' })
  write('packages/two', {
    name: '@yaks/two',
    exports: { '.': './mod.ts', './tools': './tools.ts' },
  })
  let to = `${root}/app/.wrangler/paths.json`
  aliased(root, to)
  assertEquals(JSON.parse(Deno.readTextFileSync(to)).compilerOptions.paths, {
    '@yaks/one': ['../../packages/one/mod.ts'],
    '@yaks/two': ['../../packages/two/mod.ts'],
    '@yaks/two/tools': ['../../packages/two/tools.ts'],
  })
  Deno.removeSync(root, { recursive: true })
})

// A repository and the remote its pushes land on, driven the way pushes to
// main drive the one Workers Builds clones.
let run = async (cwd: string, ...args: string[]) => {
  let r = await new Deno.Command('git', {
    args: ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
    cwd,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return new TextDecoder().decode(r.stdout).trim()
}

test('wrangler: app-only pushes do not supersede a build, but Worker source and newer live versions do', async () => {
  let root = Deno.makeTempDirSync({ prefix: 'yak-live-' })
  try {
    let origin = join(root, 'origin.git')
    let work = join(root, 'work')
    let thin = join(root, 'thin')
    await run(root, 'init', '-q', '--bare', '-b', 'main', origin)
    await run(root, 'clone', '-q', origin, work)
    let push = async (path: string) => {
      let file = join(work, path)
      Deno.mkdirSync(dirname(file), { recursive: true })
      Deno.writeTextFileSync(file, crypto.randomUUID())
      await run(work, 'add', path)
      await run(work, 'commit', '-q', '-m', 'c')
      await run(work, 'push', '-q', 'origin', 'HEAD:main')
      return await run(work, 'rev-parse', 'HEAD')
    }
    let a = await push('workers/yak/site.ts')
    // Cloned the way a build is, before the next push arrives.
    await run(root, 'clone', '-q', '--depth', '1', `file://${origin}`, thin)
    let b = await push('apps/vale/main.ts')
    // An app-only push starts no replacement build; the last one may land.
    let app = await seen(thin, [a])
    assertEquals(app.tip, b)
    assertEquals(app.changed, false)
    assertEquals(superseded(app), null)
    let c = await push('packages/graph/mod.ts')
    // The latest build goes live over what is behind it.
    assertEquals(superseded(await seen(work, [a])), null)
    // An older build that finishes last must leave newer source to its build.
    let old = await seen(thin, [a])
    assertEquals(old.changed, true)
    assert(superseded(old))
    await run(work, 'checkout', '-q', a)
    // With no remote to ask, a live version ahead of it still stops it.
    await run(work, 'remote', 'remove', 'origin')
    let blind = await seen(work, [c])
    assertEquals(blind.tip, null)
    assert(superseded(blind))
    // A shallow clone fetches the live commit it lacks before it answers.
    assertEquals((await seen(thin, [c])).live, [{ sha: c, ahead: true }])
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})

test('sibling uploads use all bundled modules and configuration, not file order', () => {
  let bytes = (s: string) => new TextEncoder().encode(s)
  let first = siblingDigest('prod', {
    'index.js': bytes('code'),
    'compiler.wasm': bytes('wasm'),
  })
  assertEquals(
    first,
    '78e269c07d9160015f4c535ac9e35fa92a746e16e6ec0b33c75b55597366fed4',
  )
  assertEquals(
    siblingDigest('prod', {
      'compiler.wasm': bytes('wasm'),
      'index.js': bytes('code'),
    }),
    first,
  )
  assert(
    siblingDigest('staging', {
      'index.js': bytes('code'),
      'compiler.wasm': bytes('wasm'),
    }) != first,
  )
  assert(
    siblingDigest('prod', {
      'index.js': bytes('code'),
      'compiler.wasm': bytes('new wasm'),
    }) != first,
  )
  assert(
    siblingDigest('prod', {
      'index.js': bytes('new catalog'),
      'compiler.wasm': bytes('wasm'),
    }) != first,
  )
  assert(
    siblingDigest('prod', {
      'renamed.js': bytes('code'),
      'compiler.wasm': bytes('wasm'),
    }) != first,
  )
})

test('only the fully serving sibling with matching upload inputs is reusable', () => {
  let deployment = (digest: string, created_on: string) => ({
    created_on,
    versions: [{ version_id: 'v', percentage: 100 }],
    annotations: { 'workers/message': `commit\ninputs:${digest}` },
  })
  let old = deployment('old', '2026-10-07T07:00:00Z')
  let now = deployment('new', '2026-10-07T08:00:00Z')
  assertEquals(sameSibling('new', [now, old]), true)
  assertEquals(sameSibling('new', [old, now]), true)
  assertEquals(sameSibling('old', [old, now]), false)
  assertEquals(sameSibling('new', null), false)
  assertEquals(sameSibling('new', [null]), false)
  assertEquals(
    sameSibling('new', [{ ...now, created_on: 'not a date' }]),
    false,
  )
  assertEquals(sameSibling('new', []), false)
  assertEquals(sameSibling('new', [{ ...now, annotations: {} }]), false)
  assertEquals(
    sameSibling('new', [{
      ...now,
      versions: [{ version_id: 'v', percentage: 50 }, {
        version_id: 'v2',
        percentage: 50,
      }],
    }]),
    false,
  )
})

test('base preparation overlaps sibling uploads and gates the kernel', async () => {
  let base = Promise.withResolvers<string[]>(),
    sibling = Promise.withResolvers<number>()
  let prepared = false, kernel = false
  let deploy = runWrangler(['deploy'], async (_args, unpinned) => {
    if (unpinned) return await sibling.promise
    kernel = true
    return 0
  }, () => {
    prepared = true
    return base.promise
  })
  await tick()
  assert(prepared)
  sibling.resolve(0)
  await tick()
  assertEquals(kernel, false)
  base.resolve(['deploy'])
  assertEquals(await deploy, 0)
  assert(kernel)
  await checkKernelBundle()
})

let checkCompilerImages = async () => {
  let root = Deno.makeTempDirSync()
  try {
    let write = (path: string, body: string) => {
      Deno.mkdirSync(dirname(join(root, path)), { recursive: true })
      Deno.writeTextFileSync(join(root, path), body)
    }
    write(
      'esbuild/wrangler.toml',
      'main = "index.ts"\n[[containers]]\nimage = "./Dockerfile"\nimage_build_context = "../compiler"\n[[env.staging.containers]]\nimage = "./Dockerfile"\nimage_build_context = "../compiler"\n',
    )
    write('esbuild/Dockerfile', 'FROM deno\nCOPY . .')
    write('compiler/compile.ts', 'compiler')
    write('esbuild/index.ts', 'catalog v1')
    let names: string[] = []
    let ensure = (
      options: Parameters<typeof import('./sandbox/base.ts').imaged>[0],
    ) => {
      names.push(options.name!)
      return Promise.resolve('registry.cloudflare.com/account/' + options.name)
    }
    let compile = async () => {
      let image = await siblingImages('esbuild/wrangler.toml', ensure, root)
      try {
        let text = Deno.readTextFileSync(join(root, image.config))
        assert(text.includes('registry.cloudflare.com/account/'))
        assert(!text.includes('image_build_context'))
        assert(text.includes('index.ts'))
        assertEquals(dirname(image.config), 'esbuild')
      } finally {
        image.remove()
      }
    }
    await compile()
    write('esbuild/index.ts', 'catalog v2')
    await compile()
    assertEquals(names[0], names[1])
    write('compiler/compile.ts', 'compiler v2')
    await compile()
    assert(names[2] != names[1])
    write('esbuild/Dockerfile', 'FROM new-deno\nCOPY . .')
    await compile()
    assert(names[3] != names[2])
    let config = join(root, 'esbuild/wrangler.toml')
    Deno.writeTextFileSync(
      config,
      Deno.readTextFileSync(config).replace(
        '[[env.staging.containers]]\nimage = "./Dockerfile"\nimage_build_context = "../compiler"',
        '[[env.staging.containers]]\nimage = "./Dockerfile"\nimage_build_context = "../other"',
      ),
    )
    write('other/compile.ts', 'other compiler')
    await compile()
    assertEquals(names.length, 6)
    assert(
      names[4] != names[5],
      'each Dockerfile/context pair has its own image',
    )
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
}

test('deploy preflight starts Git reads while the serving version is pending', async () => {
  let live = Promise.withResolvers<string[]>()
  let calls: string[][] = []
  let head = 'a'.repeat(40)
  let inspection = seen('/checkout', live.promise, (_root, ...args) => {
    calls.push(args)
    return Promise.resolve({ code: 0, out: head })
  })
  assertEquals(calls, [
    ['rev-parse', 'HEAD'],
    ['ls-remote', 'origin', 'refs/heads/main'],
  ])
  live.resolve([head])
  assertEquals(await inspection, {
    head,
    tip: head,
    changed: false,
    live: [{ sha: head, ahead: false }],
  })
})

test('kernel bundling overlaps the guard and uploads overlap the pending bundle', async () => {
  let ready = Promise.withResolvers<void>()
  let allowed = Promise.withResolvers<boolean>()
  let bundled = Promise.withResolvers<{ remove: () => void }>()
  let preparing = Promise.withResolvers<void>()
  let uploading = Promise.withResolvers<void>()
  let finish = Promise.withResolvers<number>()
  let started = false, removed = false
  let deploy = preflight(
    () => ready.promise,
    () => allowed.promise,
    () => {
      preparing.resolve()
      return bundled.promise
    },
    async (bundle) => {
      started = true
      uploading.resolve()
      await bundle
      return await finish.promise
    },
  )
  ready.resolve()
  await preparing.promise
  assertEquals(started, false)
  allowed.resolve(true)
  await uploading.promise
  bundled.resolve({ remove: () => removed = true })
  assertEquals(removed, false)
  finish.resolve(3)
  assertEquals(await deploy, 3)
  assert(removed)
})

for (let refusal of [false, Error('guard failed')]) {
  test(`a ${typeof refusal == 'boolean' ? 'refused' : 'failed'} guard settles the bundle and removes its artifact without uploading`, async () => {
    let allowed = Promise.withResolvers<boolean>()
    let bundle = Promise.withResolvers<{ remove: () => void }>()
    let preparing = Promise.withResolvers<void>()
    let removed = false, uploaded = false
    let deploy = preflight(
      () => Promise.resolve(),
      () => allowed.promise,
      () => {
        preparing.resolve()
        return bundle.promise
      },
      () => {
        uploaded = true
        return Promise.resolve(0)
      },
    ).then((code) => ({ code }), (error) => ({ error }))
    await preparing.promise
    if (refusal === false) allowed.resolve(false)
    else allowed.reject(refusal)
    bundle.resolve({ remove: () => removed = true })
    assertEquals(
      await deploy,
      refusal === false ? { code: 0 } : { error: refusal },
    )
    assertEquals(uploaded, false)
    assert(removed)
  })
}

test('a failed bundle settles uploads and a failed upload removes the bundle', async () => {
  for (let stage of ['bundle', 'upload']) {
    let failure = Error(stage)
    let other = Promise.withResolvers<void>()
    let started = Promise.withResolvers<void>()
    let removed = false, finished = false
    let deploy = preflight(
      () => Promise.resolve(),
      () => Promise.resolve(true),
      () =>
        stage == 'bundle'
          ? Promise.reject(failure)
          : Promise.resolve({ remove: () => removed = true }),
      async (bundle) => {
        // A sibling may still be uploading after the kernel bundle fails.
        let settled = Promise.allSettled([bundle, other.promise])
        started.resolve()
        await settled
        finished = true
        if (stage == 'upload') throw failure
        return 0
      },
    ).then((code) => ({ code }), (error) => ({ error }))
    await started.promise
    assertEquals(removed, false)
    other.resolve()
    assertEquals(await deploy, { error: failure })
    assert(finished)
    assertEquals(removed, stage == 'upload')
  }
})

test('failed readiness settles the guard and starts neither bundle nor upload', async () => {
  let allowed = Promise.withResolvers<boolean>()
  let inspecting = Promise.withResolvers<void>()
  let failure = Error('ready failed')
  let prepared = false, uploaded = false, inspected = false
  let deploy = preflight(
    () => Promise.reject(failure),
    async () => {
      inspecting.resolve()
      await allowed.promise
      inspected = true
      return true
    },
    () => {
      prepared = true
      return Promise.resolve({ remove: () => {} })
    },
    () => {
      uploaded = true
      return Promise.resolve(0)
    },
  ).then((code) => ({ code }), (error) => ({ error }))
  await inspecting.promise
  allowed.resolve(true)
  assertEquals(await deploy, { error: failure })
  assert(inspected)
  assertEquals(prepared, false)
  assertEquals(uploaded, false)
})

test('each sibling prepares beside the kernel and uploads as soon as its own preparation and guard permit', async () => {
  let ready = Promise.withResolvers<void>()
  let allowed = Promise.withResolvers<boolean>()
  let lanes = ['outbound', 'compiler', 'kernel'].map((name) => ({
    name,
    prepared: Promise.withResolvers<{ remove: () => void }>(),
    uploading: Promise.withResolvers<void>(),
  }))
  let preparing: string[] = [], uploaded: string[] = [], removed: string[] = []
  let deploys = lanes.map((lane) =>
    preflight(
      () => ready.promise,
      () => allowed.promise,
      () => {
        preparing.push(lane.name)
        return lane.prepared.promise
      },
      async (prepared) => {
        await prepared
        uploaded.push(lane.name)
        lane.uploading.resolve()
        return 0
      },
    )
  )
  try {
    ready.resolve()
    for (let i = 0; i < 8; i++) await Promise.resolve()
    assertEquals(preparing, lanes.map((lane) => lane.name))
    assertEquals(uploaded, [])
    allowed.resolve(true)
    for (let lane of lanes) {
      lane.prepared.resolve({ remove: () => removed.push(lane.name) })
      await lane.uploading.promise
      assertEquals(uploaded.at(-1), lane.name)
      assertEquals(uploaded.length, lanes.indexOf(lane) + 1)
    }
    assertEquals(await Promise.all(deploys), [0, 0, 0])
    assertEquals(removed.toSorted(), lanes.map((lane) => lane.name).toSorted())
  } finally {
    allowed.resolve(true)
    for (let lane of lanes) lane.prepared.resolve({ remove: () => {} })
    await Promise.allSettled(deploys)
  }
})

let checkSiblingPreparation = async () => {
  let root = Deno.makeTempDirSync()
  let encoder = new TextEncoder()
  let result = (stdout = '', code = 0): Deno.CommandOutput => ({
    success: code == 0,
    code,
    signal: null,
    stdout: encoder.encode(stdout),
    stderr: encoder.encode(''),
  })
  try {
    Deno.mkdirSync(join(root, '.wrangler'))
    Deno.mkdirSync(join(root, 'outbound'))
    Deno.writeTextFileSync(
      join(root, 'outbound/wrangler.toml'),
      'main="worker.ts"\n[[containers]]\nimage="./Dockerfile"',
    )
    Deno.writeTextFileSync(join(root, 'outbound/Dockerfile'), 'FROM deno')
    let args = [
      'deploy',
      '--env',
      'staging',
      '--message',
      'a'.repeat(40) + ' subject',
      '--containers-rollout=none',
      '-c',
      'outbound/wrangler.toml',
    ]
    let live = '[]', digest = '', called = false
    let query = (argv: string[]) => {
      if (argv.includes('--dry-run')) {
        assert(argv.includes('--containers-rollout=none'))
        let to = argv[argv.indexOf('--outdir') + 1]
        for (let name of ['worker.js', 'worker.js.map', 'README.md']) {
          Deno.writeTextFileSync(join(to, name), name)
        }
        return Promise.resolve(result())
      }
      assertEquals(argv, [
        'deployments',
        'list',
        '-c',
        'outbound/wrangler.toml',
        '--env',
        'staging',
        '--json',
      ])
      return Promise.resolve(result(live))
    }
    let prepared = await prepareSibling(args, [], root, query)
    try {
      let message = prepared.args[prepared.args.indexOf('--message') + 1]
      assert(message.startsWith('a'.repeat(40) + '\ninputs:'))
      digest = message.split('\ninputs:')[1]
      assertEquals(
        await uploadSibling(prepared, (argv, unpinned) => {
          called = true
          assert(unpinned)
          assertEquals(argv, prepared.args)
          return Promise.resolve(3)
        }),
        3,
      )
      assert(called)
      let ensured = false
      await uploadSibling(
        {
          ...prepared,
          args: prepared.args.filter((arg) =>
            arg != '--containers-rollout=none'
          ),
        },
        (argv) => {
          let config = argv[argv.indexOf('-c') + 1]
          assert(config.startsWith('outbound/.images-'))
          assert(
            Deno.readTextFileSync(join(root, config)).includes(
              'registry.cloudflare.com/account/compiler:held',
            ),
          )
          return Promise.resolve(0)
        },
        [],
        (options) => {
          ensured = true
          assertEquals(options.dockerfile, join(root, 'outbound/Dockerfile'))
          return Promise.resolve(
            'registry.cloudflare.com/account/compiler:held',
          )
        },
      )
      assert(ensured)
      assertEquals(
        [...Deno.readDirSync(join(root, 'outbound'))].map((file) => file.name)
          .toSorted(),
        ['Dockerfile', 'wrangler.toml'],
      )
    } finally {
      prepared.remove()
    }
    live = JSON.stringify([{
      created_on: '2026-10-10T16:00:00Z',
      annotations: { 'workers/message': 'commit\ninputs:' + digest },
      versions: [{ version_id: 'v', percentage: 100 }],
    }])
    prepared = await prepareSibling(args, [], root, query)
    try {
      called = false
      assertEquals(
        await uploadSibling(prepared, () => {
          called = true
          return Promise.resolve(3)
        }),
        0,
      )
      assertEquals(called, false)
    } finally {
      prepared.remove()
    }
    let failure = Error('bundle read failed')
    let finish = Promise.withResolvers<Deno.CommandOutput>()
    let reading = Promise.withResolvers<void>()
    let output = ''
    let failed = prepareSibling(args, [], root, (argv) => {
      if (argv.includes('--dry-run')) {
        output = argv[argv.indexOf('--outdir') + 1]
        return Promise.reject(failure)
      }
      reading.resolve()
      return finish.promise.then((result) => {
        assert(Deno.statSync(output).isDirectory, 'reads finish before cleanup')
        return result
      })
    }).then((value) => ({ value }), (error) => ({ error }))
    try {
      await reading.promise
      for (let i = 0; i < 4; i++) await Promise.resolve()
      assert(Deno.statSync(output).isDirectory, 'pending read retains output')
      finish.resolve(result())
      assertEquals(await failed, { error: failure })
      assertEquals([...Deno.readDirSync(join(root, '.wrangler'))], [])
    } finally {
      finish.resolve(result())
      await failed
    }
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
}

let checkKernelBundle = async () => {
  let root = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(join(root, '.wrangler'))
    Deno.writeTextFileSync(
      join(root, 'wrangler.toml'),
      'main="index.ts"\ncompatibility_flags=["nodejs_compat"]\nupload_source_maps=true\n[assets]\ndirectory="public"',
    )
    let args = ['deploy', '--env', 'staging', '--message', 'commit']
    let compiled = await bundled(args, (build) => {
      assert(build.includes('--dry-run'))
      assert(build.includes('--containers-rollout=none'))
      let output = build[build.indexOf('--outdir') + 1]
      Deno.writeTextFileSync(
        join(output, 'entry.js'),
        'export default {};\n//# sourceMappingURL=entry.js.map',
      )
      Deno.writeTextFileSync(
        join(output, 'entry.js.map'),
        '{"sources":["index.ts"]}',
      )
      Deno.writeTextFileSync(join(output, 'compiler.wasm'), 'wasm')
      Deno.writeTextFileSync(
        build[build.indexOf('--metafile') + 1],
        JSON.stringify({
          outputs: { [join(output, 'entry.js')]: { entryPoint: 'index.ts' } },
        }),
      )
      return Promise.resolve(0)
    }, root)
    try {
      let text = Deno.readTextFileSync(compiled.args.at(-1)!)
      let config = (await import('@std/toml')).parse(text)
      assertEquals(compiled.args.slice(0, -2), args)
      assertEquals(config.no_bundle, true)
      assertEquals(config.find_additional_modules, true)
      assertEquals(config.compatibility_flags, ['nodejs_compat'])
      assertEquals(config.upload_source_maps, true)
      assertEquals(config.assets, { directory: 'public' })
      assertEquals(
        Deno.readTextFileSync(config.main as string),
        'export default {};\n//# sourceMappingURL=entry.js.map',
      )
      assertEquals(
        [...Deno.readDirSync(config.base_dir as string)].map((f) => f.name)
          .sort(),
        ['compiler.wasm', 'entry.js', 'entry.js.map'],
      )
    } finally {
      compiled.remove()
    }
    let failed = false, uploaded = false
    try {
      await runWrangler(args, (_args, sibling) => {
        if (!sibling) uploaded = true
        return Promise.resolve(0)
      }, async () => (await bundled(args, () => Promise.resolve(7), root)).args)
    } catch {
      failed = true
    }
    assert(failed)
    assertEquals(uploaded, false)
    assertEquals([...Deno.readDirSync(join(root, '.wrangler'))], [])
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
}
