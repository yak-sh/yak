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
  command,
  images,
  members,
  runWrangler,
  sameSibling,
  seen,
  siblingDigest,
  siblingImages,
  SIBLINGS,
  siblings,
  stale,
  superseded,
} from './wrangler.ts'

let read = (path: string) =>
  Deno.readTextFileSync(new URL(path, import.meta.url))

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

test("a sibling's images are its Dockerfiles and their build contexts", () => {
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

test('stale: no stamp, an older stamp, a newer stamp', () => {
  let root = Deno.makeTempDirSync({ prefix: 'yak-npm-' })
  let lock = `${root}/package-lock.json`
  let stamp = `${root}/node_modules/.package-lock.json`
  Deno.writeTextFileSync(lock, '{}')
  assertEquals(stale(root), true, 'no node_modules at all')

  Deno.mkdirSync(`${root}/node_modules`)
  Deno.writeTextFileSync(stamp, '{}')
  Deno.utimeSync(stamp, 0, 0)
  assertEquals(stale(root), true, 'installed before the lock last moved')

  Deno.utimeSync(lock, 0, 0)
  Deno.utimeSync(stamp, 1, 1)
  assertEquals(stale(root), false, 'installed since')

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
})

test('compiler Worker changes reuse its image; compiler input changes build a new image', async () => {
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
    let ensure = async (
      options: Parameters<typeof import('./sandbox/base.ts').imaged>[0],
    ) => {
      names.push(options.name!)
      return 'registry.cloudflare.com/account/' + options.name
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
})
