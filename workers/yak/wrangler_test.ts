// The one seam of the wrangler door worth a test: when it decides
// `node_modules` is behind the lockfile. Running `npm ci` is an impure edge —
// `deno task deploy:yak` from a worktree with no node_modules is the proof.
//
// And the two maps that must say the same thing: workers.json is what
// `deno check` reads, and the workspace (wrangler.ts `members`) is what esbuild
// bundles by. A workers.json entry pointing anywhere else type-checks one file
// and bundles another.
import { assert, assertEquals } from '@std/assert'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aliased,
  command,
  members,
  seen,
  SIBLINGS,
  siblings,
  stale,
  superseded,
} from './wrangler.ts'

let read = (path: string) =>
  Deno.readTextFileSync(new URL(path, import.meta.url))

Deno.test('wrangler: staging keeps deploy annotations with either flag position', () => {
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

Deno.test('wrangler: a deploy of the kernel deploys its siblings first, and nothing else does', () => {
  let each = (argv: string[]) =>
    SIBLINGS.map((c) => [...argv, '-c', c, '--containers-rollout=none'])
  for (
    let argv of [['deploy', '--message', 'm'], ['deploy', '--env', 'staging']]
  ) assertEquals(siblings(argv), each(argv))
  for (
    let args of [
      ['dev'],
      ['--env', 'staging', 'dev'],
      ['deploy', '-c', 'other.toml'],
      ['deploy', '--config=other.toml'],
    ]
  ) assertEquals(siblings(args), [])
})

Deno.test('every @yaks/* the checker knows is the file the bundler gets', () => {
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

Deno.test('aliased: every export of a member, relative to the paths file', () => {
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

Deno.test('stale: no stamp, an older stamp, a newer stamp', () => {
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

Deno.test('wrangler: only main’s tip goes live, and never over a version ahead of it', async () => {
  let root = Deno.makeTempDirSync({ prefix: 'yak-live-' })
  try {
    let origin = join(root, 'origin.git')
    let work = join(root, 'work')
    let thin = join(root, 'thin')
    await run(root, 'init', '-q', '--bare', '-b', 'main', origin)
    await run(root, 'clone', '-q', origin, work)
    let push = async () => {
      await run(work, 'commit', '-q', '--allow-empty', '-m', 'c')
      await run(work, 'push', '-q', 'origin', 'HEAD:main')
      return await run(work, 'rev-parse', 'HEAD')
    }
    let a = await push()
    // Cloned the way a build is, before the next push arrives.
    await run(root, 'clone', '-q', '--depth', '1', `file://${origin}`, thin)
    let c = await push()
    // The tip goes live over what is behind it.
    assertEquals(superseded(await seen(work, [a])), null)
    // An older build that finishes last: main has moved past it.
    await run(work, 'checkout', '-q', a)
    assert(superseded(await seen(work, [a])))
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
