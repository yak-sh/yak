// The one seam of the wrangler door worth a test: when it decides
// `node_modules` is behind the lockfile. Running `npm ci` is an impure edge —
// `deno task deploy:yak` from a worktree with no node_modules is the proof.
//
// And the two maps that must say the same thing: workers.json is what
// `deno check` reads, and the workspace (wrangler.ts `members`) is what esbuild
// bundles by. A workers.json entry pointing anywhere else type-checks one file
// and bundles another.
import { clock, test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { parse } from '@std/toml'
import {
  aliased,
  bundled,
  command,
  images,
  members,
  modelBound,
  preflight,
  prepareSibling,
  readiness,
  runStep,
  runWrangler,
  sameServing,
  sameSibling,
  seen,
  siblingDigest,
  siblingImages,
  siblingMessage,
  SIBLINGS,
  siblings,
  superseded,
  uploadSibling,
} from './wrangler.ts'

let apiFailure =
  'A request to the Cloudflare API (/accounts/a/workers/scripts/yak) failed.'
let malformed = (status: number) =>
  `Received a malformed response from the API\n<!DOCTYPE html>\nGET /accounts/a/workers/scripts/yak/subdomain -> ${status} Gateway Timeout`
let responseLog = (status: number) =>
  `--- 2026-10-12T10:00:00.000Z debug\n-- START CF API RESPONSE: Server response ${status}\n---`

test('a Wrangler step retries a Cloudflare gateway failure with the same upload arguments', async () => {
  let args = ['deploy', '-c', '.bundle.toml', '--message', 'commit']
  let calls: string[][] = [], waits: number[] = []
  let code = await runStep(args, (argv) => {
    calls.push(argv)
    return Promise.resolve({
      code: calls.length == 1 ? 1 : 0,
      output: malformed(504),
    })
  }, {
    wait: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
  })
  assertEquals({ code, calls: calls.length }, { code: 0, calls: 2 })
  assertEquals(calls, [args, args])
  assert(waits.length == 1 && waits[0] > 0)
})

for (let status of [500, 502, 503, 504, 524, 599]) {
  test(`a Wrangler deploy retries a JSON API ${status} with no HTTP status on the console`, async () => {
    let calls = 0
    let code = await runStep(['deploy'], () =>
      Promise.resolve({
        code: ++calls == 1 ? 1 : 0,
        output: apiFailure,
        log: `${responseLog(200)}\n${responseLog(status)}\n${apiFailure}`,
      }), { wait: () => Promise.resolve() })
    assertEquals({ code, calls }, { code: 0, calls: 2 })
  })
}

test('a container deployment retries the SDK API failure that omits the resource name', async () => {
  let output = 'A request to the Cloudflare API failed.', calls = 0
  let code = await runStep(['deploy'], () =>
    Promise.resolve({
      code: ++calls == 1 ? 1 : 0,
      output,
      log: `${responseLog(503)}\n${output}`,
    }), { wait: () => Promise.resolve() })
  assertEquals({ code, calls }, { code: 0, calls: 2 })
})

test('a consumed asset completion token starts a fresh Wrangler upload', async () => {
  let args = ['deploy', '--env', 'staging', '-c', '.bundle.toml']
  let calls: string[][] = []
  let code = await runStep(args, (argv) => {
    calls.push(argv)
    return Promise.resolve({
      code: calls.length == 1 ? 1 : 0,
      output:
        `[ERROR] ${apiFailure}\nCompletion token has already been consumed [code: 100312]`,
      log: responseLog(400),
    })
  }, { wait: () => Promise.resolve() })
  assertEquals({ code, calls }, { code: 0, calls: [args, args] })
})

for (
  let [name, output, log] of [
    [
      'authentication',
      `${apiFailure}\nAuthentication error [code: 10000]`,
      responseLog(401),
    ],
    [
      'validation',
      `${apiFailure}\nInvalid binding [code: 10021]`,
      responseLog(400),
    ],
    [
      'SDK authentication',
      'A request to the Cloudflare API failed.',
      responseLog(401),
    ],
    ['HTML denial', malformed(403), responseLog(504)],
    [
      'WAF block',
      'The Cloudflare API responded with a WAF block page instead of the expected JSON response',
      responseLog(403),
    ],
    [
      'recovered gateway followed by denial',
      apiFailure,
      `${responseLog(504)}\n${responseLog(403)}\n${apiFailure}`,
    ],
    [
      'local build',
      'Build failed with 1 error: Could not resolve import',
      responseLog(503),
    ],
    [
      'local failure after an API warning',
      `[ERROR] ${apiFailure}\n[ERROR] Invalid configuration`,
      responseLog(503),
    ],
    [
      'denial after a consumed token warning',
      `[ERROR] ${apiFailure}\nCompletion token has already been consumed [code: 100312]\n[ERROR] ${apiFailure}\nAuthentication error [code: 10000]`,
      responseLog(401),
    ],
    ['unknown API failure', apiFailure, ''],
  ]
) {
  test(`a Wrangler ${name} failure exits immediately`, async () => {
    let calls = 0
    let code = await runStep(['deploy'], () => {
      calls++
      return Promise.resolve({ code: 7, output, log })
    }, {
      wait: () => {
        throw Error('permanent failure must not wait')
      },
    })
    assertEquals({ code, calls }, { code: 7, calls: 1 })
  })
}

test('a malformed API response without an HTTP status retries a sibling activation', async () => {
  let calls = 0
  let code = await runStep(
    ['versions', 'deploy', 'v1@100%', '--yes'],
    () =>
      Promise.resolve({
        code: ++calls == 1 ? 1 : 0,
        output: 'Received a malformed response from the API\n<html>',
      }),
    { wait: () => Promise.resolve() },
  )
  assertEquals({ code, calls }, { code: 0, calls: 2 })
})

test('an HTML response with a successful HTTP status still retries the malformed API step', async () => {
  let calls = 0
  let code = await runStep(['deploy'], () =>
    Promise.resolve({
      code: ++calls == 1 ? 1 : 0,
      output: malformed(200),
    }), { wait: () => Promise.resolve() })
  assertEquals({ code, calls }, { code: 0, calls: 2 })
})

test('persistent API failure stops after bounded waits and returns the final exit code', async () => {
  let calls = 0, waits: number[] = []
  let code = await runStep(['deploy'], () =>
    Promise.resolve({
      code: 7 + calls++,
      output: malformed(504),
    }), {
    wait: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
  })
  assertEquals({ code, calls }, { code: 9, calls: 3 })
  assertEquals(waits.length, 2)
  assert(waits.every((ms) => ms > 0) && waits[1] > waits[0])
})

test('each retry uses only its own diagnostics and a permanent second failure stops the step', async () => {
  let calls = 0
  let code = await runStep(['deploy'], () =>
    Promise.resolve({
      code: ++calls == 1 ? 1 : 7,
      output: calls == 1 ? malformed(504) : apiFailure,
      log: calls == 1 ? responseLog(504) : responseLog(403),
    }), { wait: () => Promise.resolve() })
  assertEquals({ code, calls }, { code: 7, calls: 2 })
})

test('interrupting the retry wait prevents another Wrangler process', async () => {
  let time = clock(), stopped = new AbortController(), calls = 0
  let waiting = Promise.withResolvers<void>()
  let code = runStep(['deploy'], () => {
    calls++
    return Promise.resolve({ code: 1, output: malformed(504) })
  }, {
    signal: stopped.signal,
    wait: (ms) =>
      new Promise<void>((resolve) => {
        time.after(ms, resolve)
        waiting.resolve()
      }),
  })
  await waiting.promise
  await time.advance(999)
  assertEquals(calls, 1)
  stopped.abort()
  await time.advance(1)
  assertEquals({ code: await code, calls }, { code: 130, calls: 1 })
})

for (let args of [['tail'], ['dev'], ['delete'], ['versions', 'view', 'v1']]) {
  test(`a Wrangler ${args.join(' ')} command is never restarted after an API failure`, async () => {
    let calls = 0
    let code = await runStep(args, () => {
      calls++
      return Promise.resolve({ code: 1, output: malformed(504) })
    })
    assertEquals({ code, calls }, { code: 1, calls: 1 })
  })
}

for (let code of [0, 130, 143]) {
  test(`a Wrangler exit ${code} is preserved despite earlier API diagnostics`, async () => {
    let calls = 0
    let result = await runStep(['deploy'], () => {
      calls++
      return Promise.resolve({ code, output: malformed(504) })
    }, {
      wait: () => {
        throw Error('no retry is owed')
      },
    })
    assertEquals({ code: result, calls }, { code, calls: 1 })
  })
}

test('a step cancelled before it starts spawns no Wrangler process', async () => {
  let stopped = new AbortController()
  stopped.abort()
  assertEquals(
    await runStep(['deploy'], () => {
      throw Error('cancelled step must not execute')
    }, { signal: stopped.signal }),
    130,
  )
})

let read = (path: string) =>
  Deno.readTextFileSync(new URL(path, import.meta.url))

let modelOutput = (
  deployments: unknown,
  success = true,
): Deno.CommandOutput => ({
  success,
  code: success ? 0 : 1,
  signal: null,
  stdout: new TextEncoder().encode(JSON.stringify(deployments)),
  stderr: new TextEncoder().encode('unavailable'),
})
let modelDeployment = (
  versions: { version_id: string; percentage: number }[],
) => [{
  created_on: '2026-10-12T00:00:00Z',
  versions,
}]
let withModelConfig = async (check: (kernel: string) => Promise<void>) => {
  let root = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(join(root, 'yak'))
    Deno.mkdirSync(join(root, 'model'))
    Deno.writeTextFileSync(join(root, 'model/wrangler.toml'), 'name="model-v1"')
    let kernel = join(root, 'yak')
    Deno.writeTextFileSync(
      join(kernel, 'wrangler.toml'),
      'main="index.ts"\n[[services]]\nbinding="FILES"\nservice="yak"\nentrypoint="Files"',
    )
    await check(kernel)
    assertEquals([...Deno.readDirSync(kernel)].map((file) => file.name), [
      'wrangler.toml',
    ])
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
}
for (
  let [name, result, available] of [
    ['unpublished', modelOutput([]), false],
    [
      'fully serving',
      modelOutput(modelDeployment([{ version_id: 'v1', percentage: 100 }])),
      true,
    ],
    [
      'split',
      modelOutput(modelDeployment([
        { version_id: 'v1', percentage: 50 },
        { version_id: 'v2', percentage: 50 },
      ])),
      false,
    ],
    ['malformed', modelOutput(null), false],
    ['refused', modelOutput([], false), false],
    ['unreadable', Error('inspection failed'), false],
  ] as const
) {
  test(`a ${name} executor deployment ${available ? 'enables' : 'leaves absent'} the kernel binding`, () =>
    withModelConfig(async (kernel) => {
      let args = ['deploy', '--message', 'commit']
      let bound = await modelBound(args, (query) => {
        assertEquals(query, [
          'deployments',
          'list',
          '-c',
          '../model/wrangler.toml',
          '--json',
        ])
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result)
      }, kernel)
      try {
        let config = parse(Deno.readTextFileSync(
          join(
            kernel,
            bound.args.includes('-c') ? bound.args.at(-1)! : 'wrangler.toml',
          ),
        ))
        assertEquals(config.services, [
          { binding: 'FILES', service: 'yak', entrypoint: 'Files' },
          ...(available ? [{ binding: 'MODEL', service: 'model-v1' }] : []),
        ])
        assertEquals(bound.args.slice(0, args.length), args)
      } finally {
        bound.remove()
      }
    }))
}

test('executor activation preserves the prepared upload and removes its disposable binding config', () =>
  withModelConfig(async (kernel) => {
    let source = join(kernel, '.bundle.toml')
    Deno.writeTextFileSync(
      source,
      'main="entry.js"\nno_bundle=true\nbase_dir="bundle"',
    )
    let args = ['deploy', '--message', 'commit', '-c', source]
    let bound = await modelBound(args, () =>
      Promise.resolve(
        modelOutput(modelDeployment([{ version_id: 'v1', percentage: 100 }])),
      ), kernel)
    try {
      let config = parse(
        Deno.readTextFileSync(join(kernel, bound.args.at(-1)!)),
      )
      assertEquals(config.main, 'entry.js')
      assertEquals(config.no_bundle, true)
      assertEquals(config.base_dir, 'bundle')
      assertEquals(config.services, [{ binding: 'MODEL', service: 'model-v1' }])
      assertEquals(bound.args.slice(0, -1), args.slice(0, -1))
    } finally {
      bound.remove()
      Deno.removeSync(source)
    }
  }))

test('local and staging commands leave executor activation to production builds', async () => {
  for (
    let args of [['dev'], ['deploy', '--dry-run'], [
      'deploy',
      '--env',
      'staging',
    ]]
  ) {
    let bound = await modelBound(args, () => {
      throw Error('local and staging must not inspect the production executor')
    })
    assertEquals(bound.args, args)
    bound.remove()
  }
})

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

for (let failed of ['web', 'catalog', 'cli', 'draft', 'outbox'] as const) {
  test(`failed ${failed} generation settles prepared Workers without uploading`, async () => {
    let web = Promise.withResolvers<void>()
    let catalog = Promise.withResolvers<void>()
    let cli = Promise.withResolvers<void>()
    let draft = Promise.withResolvers<void>()
    let outbox = Promise.withResolvers<void>()
    let lanes = { web, catalog, cli, draft, outbox }
    let failure = Error(`${failed} failed`)
    let made = readiness({
      dependencies: () => Promise.resolve(false),
      web: () => web.promise,
      catalog: () => catalog.promise,
      cli: () => cli.promise,
      draft: () => draft.promise,
      outbox: () => outbox.promise,
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
      for (let [name, lane] of Object.entries(lanes)) {
        if (name != failed) lane.resolve()
      }
      assertEquals(await deploy, { error: failure })
      assertEquals(uploaded, false)
      assert(removed)
    } finally {
      web.resolve()
      catalog.resolve()
      cli.resolve()
      draft.resolve()
      outbox.resolve()
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

test('independent sibling deploys overlap and the kernel waits for every success', async () => {
  let started: { args: string[]; unpinned?: boolean }[] = []
  let waits = SIBLINGS.map(() => Promise.withResolvers<number>())
  let deploy = runWrangler(['deploy', '--env', 'staging'], (args, unpinned) => {
    started.push({ args, unpinned })
    return unpinned ? waits[started.length - 1].promise : Promise.resolve(0)
  })
  try {
    await Promise.resolve()
    assertEquals(
      started.map((call) => call.args),
      siblings(['deploy', '--env', 'staging']),
    )
    assertEquals(started.map((call) => call.unpinned), SIBLINGS.map(() => true))
    for (let wait of waits.slice(0, -1)) wait.resolve(0)
    await Promise.resolve()
    assertEquals(started.length, SIBLINGS.length)
    waits.at(-1)!.resolve(0)
    assertEquals(await deploy, 0)
    assertEquals(started[SIBLINGS.length], {
      args: ['deploy', '--env', 'staging'],
      unpinned: undefined,
    })
  } finally {
    for (let wait of waits) wait.resolve(0)
    await deploy
  }
})

for (let failure of [7, Error('process wait failed')]) {
  test(`a sibling ${typeof failure == 'number' ? 'exit' : 'rejection'} waits for the other siblings and never deploys the kernel`, async () => {
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
      await Promise.resolve()
      assertEquals(starts, SIBLINGS.length)
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
    await Deno.writeTextFile(
      join(origin, 'config'),
      '\n[uploadpack]\nallowFilter = true\n',
      { append: true },
    )
    let body = ''
    for (
      let [index, paths] of [
        ['workers/yak/site.ts'],
        ['apps/vale/main.ts'],
        ['workers/yak/site.ts', 'packages/graph/mod.ts'],
      ].entries()
    ) {
      body += `commit refs/heads/main\nmark :${
        index + 1
      }\ncommitter t <t@t> 1 +0000\ndata 1\nc\n`
      if (index) body += `from :${index}\n`
      for (let path of paths) {
        let content = crypto.randomUUID()
        body += `M 100644 inline ${path}\ndata ${content.length}\n${content}\n`
      }
      body += '\n'
    }
    // Import the history once; moving main still makes each push visible
    // independently, and shallow clones receive only what main can reach.
    body += 'reset refs/heads/main\nfrom :1\n\n'
    let marks = join(root, 'marks')
    let child = new Deno.Command('git', {
      args: ['fast-import', '--quiet', `--export-marks=${marks}`],
      cwd: origin,
      stdin: 'piped',
      stdout: 'null',
      stderr: 'piped',
    }).spawn()
    let writer = child.stdin.getWriter()
    await writer.write(new TextEncoder().encode(body))
    await writer.close()
    assertEquals((await child.output()).code, 0)
    let commits = Object.fromEntries(
      (await Deno.readTextFile(marks)).trim().split('\n')
        .map((line) => line.split(' ')),
    )
    let [a, b, c] = [':1', ':2', ':3'].map((mark) => commits[mark])
    // Cloned the way a build is, before the next push arrives.
    await run(
      root,
      'clone',
      '-q',
      '--no-checkout',
      '--depth',
      '1',
      `file://${origin}`,
      thin,
    )
    await run(origin, 'update-ref', 'refs/heads/main', b)
    // An app-only push starts no replacement build; the last one may land.
    let app = await seen(thin, [a])
    assertEquals(app.tip, b)
    assertEquals(app.changed, false)
    assertEquals(superseded(app), null)
    await run(origin, 'update-ref', 'refs/heads/main', c)
    let latest = join(root, 'latest')
    await Promise.all([
      run(root, 'clone', '-q', '--no-checkout', origin, work),
      run(
        root,
        'clone',
        '-q',
        '--no-checkout',
        '--depth',
        '1',
        `file://${origin}`,
        latest,
      ),
    ])
    let [current, old] = await Promise.all([seen(work, [a]), seen(thin, [a])])
    // The latest build goes live over what is behind it.
    assertEquals(superseded(current), null)
    // An older build that finishes last must leave newer source to its build.
    assertEquals(old.changed, true)
    assert(superseded(old))
    let [, older] = await Promise.all([
      run(work, 'checkout', '-q', a),
      seen(latest, [a]),
    ])
    assertEquals(older, {
      head: c,
      tip: c,
      changed: false,
      live: [{ sha: a, ahead: false }],
    })
    assertEquals(superseded(older), null)
    // Ancestry reads retain the old commits, without downloading their files.
    let oldBlob = await run(work, 'rev-parse', `${a}:workers/yak/site.ts`)
    let objects = await run(
      latest,
      'cat-file',
      '--batch-all-objects',
      '--batch-check=%(objectname)',
    )
    assert(!objects.split('\n').includes(oldBlob))
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

test('sibling identity reads are optional and an unreadable version means upload', async () => {
  let digest = 'a'.repeat(64)
  let message = 'commit\ninputs:' + digest
  let live = {
    created_on: '2026-10-10T16:00:00Z',
    versions: [{ version_id: 'v', percentage: 100 }],
    annotations: { 'workers/message': message.slice(0, 20) },
  }
  for (
    let version of [
      { id: 'v', annotations: { 'workers/message': message } },
      {
        id: 'v',
        annotations: { 'workers/message': 'commit\ninputs:' + 'b'.repeat(64) },
      },
      { id: 'other', annotations: { 'workers/message': message } },
      { id: 'v' },
      null,
      Error('read failed'),
    ]
  ) {
    let reads = 0
    assertEquals(
      await sameServing(digest, [live], (id) => {
        reads++
        assertEquals(id, 'v')
        return version instanceof Error
          ? Promise.reject(version)
          : Promise.resolve(version)
      }),
      !(version instanceof Error) &&
        version?.annotations?.['workers/message'] == message &&
        version?.id == 'v',
    )
    assertEquals(reads, 1)
  }
  for (
    let [deployments, expected] of [
      [[{ ...live, annotations: { 'workers/message': message } }], true],
      [[{
        ...live,
        annotations: { 'workers/message': 'commit\ninputs:' + 'b'.repeat(64) },
      }], false],
      [[{
        ...live,
        versions: [{ version_id: 'v', percentage: 50 }, {
          version_id: 'v2',
          percentage: 50,
        }],
      }], false],
      [null, false],
      [[], false],
    ] as const
  ) {
    assertEquals(
      await sameServing(digest, deployments, () => {
        throw Error('complete or unavailable deployments need no version read')
      }),
      expected,
    )
  }
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
  await Promise.resolve()
  assert(prepared)
  sibling.resolve(0)
  await Promise.resolve()
  assertEquals(kernel, false)
  base.resolve(['deploy'])
  assertEquals(await deploy, 0)
  assert(kernel)
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
      'main="worker.ts"\nupload_source_maps=true\ncompatibility_flags=["nodejs_compat"]\n[[containers]]\nimage="./Dockerfile"\n[env.staging.vars]\nLABEL="stage"',
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
    let version: Deno.CommandOutput | Error | undefined
    let versionReads = 0
    let query = (argv: string[]) => {
      if (argv.includes('--dry-run')) {
        assert(argv.includes('--containers-rollout=none'))
        let to = argv[argv.indexOf('--outdir') + 1]
        for (
          let name of ['worker.js', 'worker.js.map', 'extra.wasm', 'README.md']
        ) {
          Deno.writeTextFileSync(join(to, name), name)
        }
        Deno.writeTextFileSync(
          argv[argv.indexOf('--metafile') + 1],
          JSON.stringify({
            outputs: {
              [relative(join(root, 'outbound'), join(to, 'worker.js'))]: {
                entryPoint: 'worker.ts',
              },
            },
          }),
        )
        return Promise.resolve(result())
      }
      if (argv[0] == 'versions') {
        assertEquals(argv, [
          'versions',
          'view',
          'v',
          '-c',
          'outbound/wrangler.toml',
          '--env',
          'staging',
          '--json',
        ])
        versionReads++
        if (version instanceof Error) return Promise.reject(version)
        assert(
          version,
          'full deployment annotations need no extra version read',
        )
        return Promise.resolve(version)
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
      assertEquals(message.split('\n')[1], 'a'.repeat(40))
      digest = Buffer.from(message.split('\n')[0].slice(7), 'base64url')
        .toString('hex')
      let finish = Promise.withResolvers<number>()
      let artifact = ''
      let sent = uploadSibling(prepared, (argv, unpinned) => {
        called = true
        assert(unpinned)
        artifact = argv[argv.indexOf('-c') + 1]
        assertEquals(
          argv.filter((_, i) => i != argv.indexOf('-c') + 1),
          prepared.args.filter((_, i) => i != prepared.args.indexOf('-c') + 1),
        )
        let config = parse(Deno.readTextFileSync(artifact))
        assertEquals(config.no_bundle, true)
        assertEquals(config.minify, false)
        assertEquals(config.find_additional_modules, true)
        assertEquals(config.upload_source_maps, true)
        assertEquals(config.compatibility_flags, ['nodejs_compat'])
        assertEquals(config.env, { staging: { vars: { LABEL: 'stage' } } })
        assertEquals(Deno.readTextFileSync(config.main as string), 'worker.js')
        assertEquals(
          Deno.readTextFileSync(
            join(config.base_dir as string, 'worker.js.map'),
          ),
          'worker.js.map',
        )
        assertEquals(
          Deno.readTextFileSync(join(config.base_dir as string, 'extra.wasm')),
          'extra.wasm',
        )
        return finish.promise
      }).then((code) => ({ code }), (error) => ({ error }))
      try {
        assert(
          Deno.statSync(artifact).isFile,
          'upload retains its config while pending',
        )
        assert(
          Deno.statSync(join(prepared.bundle!.output, 'worker.js.map')).isFile,
          'upload retains its source maps while pending',
        )
      } finally {
        finish.resolve(3)
      }
      assertEquals(await sent, { code: 3 })
      assertEquals(
        [...Deno.readDirSync(join(root, 'outbound'))].map((file) => file.name)
          .toSorted(),
        ['Dockerfile', 'wrangler.toml'],
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
          assert(config.startsWith(join(root, 'outbound/.bundle-')))
          assert(
            Deno.readTextFileSync(config).includes(
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
      annotations: {
        'workers/message': siblingMessage(digest, 'commit').slice(0, 50),
      },
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
    assertEquals(versionReads, 0)
    live = JSON.stringify([{
      created_on: '2026-10-10T16:00:00Z',
      annotations: {
        'workers/message': ('a'.repeat(40) + '\ninputs:' + digest).slice(0, 50),
      },
      versions: [{ version_id: 'v', percentage: 100 }],
    }])
    version = result(JSON.stringify({
      id: 'v',
      annotations: { 'workers/message': 'commit\ninputs:' + digest },
    }))
    prepared = await prepareSibling(args, [], root, query)
    try {
      let uploads = 0
      assertEquals(
        await uploadSibling(prepared, (argv, unpinned) => {
          uploads++
          assert(unpinned)
          assertEquals(argv, [
            'versions',
            'deploy',
            'v@100%',
            '--yes',
            '-c',
            'outbound/wrangler.toml',
            '--env',
            'staging',
            '--message',
            siblingMessage(digest),
          ])
          return Promise.resolve(0)
        }),
        0,
      )
      assertEquals(uploads, 1)
      assertEquals(versionReads, 1)
      assertEquals(await uploadSibling(prepared, () => Promise.resolve(7)), 7)
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

// Prepare the disposable kernel artifact once, then check what its upload sees.
let kernelRoot = Deno.makeTempDirSync()
Deno.mkdirSync(join(kernelRoot, '.wrangler'))
Deno.writeTextFileSync(
  join(kernelRoot, 'wrangler.toml'),
  'main="index.ts"\ncompatibility_flags=["nodejs_compat"]\nupload_source_maps=true\n[assets]\ndirectory="public"',
)
let kernelArgs = ['deploy', '--env', 'staging', '--message', 'commit']
let kernelBuild: string[] = []
let kernelBundle = await bundled(kernelArgs, (build) => {
  kernelBuild = build
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
}, kernelRoot)

test('a kernel upload uses its prepared bundle and retains source maps and modules', () => {
  try {
    assert(kernelBuild.includes('--dry-run'))
    assert(kernelBuild.includes('--containers-rollout=none'))
    let config = parse(Deno.readTextFileSync(kernelBundle.args.at(-1)!))
    assertEquals(kernelBundle.args.slice(0, -2), kernelArgs)
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
    kernelBundle.remove()
  }
})

test('a failed kernel bundle prevents uploading and removes its output', async () => {
  let failed = false, uploaded = false
  try {
    try {
      await runWrangler(
        kernelArgs,
        (_args, sibling) => {
          if (!sibling) uploaded = true
          return Promise.resolve(0)
        },
        async () =>
          (await bundled(kernelArgs, () => Promise.resolve(7), kernelRoot))
            .args,
      )
    } catch {
      failed = true
    }
    assert(failed)
    assertEquals(uploaded, false)
    assertEquals([...Deno.readDirSync(join(kernelRoot, '.wrangler'))], [])
  } finally {
    Deno.removeSync(kernelRoot, { recursive: true })
  }
})
