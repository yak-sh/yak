// The one seam of the wrangler door worth a test: when it decides
// `node_modules` is behind the lockfile. Running `npm ci` is an impure edge —
// `deno task deploy:yak` from a worktree with no node_modules is the proof.
//
// And the two maps that must say the same thing: workers.json is what
// `deno check` reads, and the workspace (wrangler.ts `members`) is what esbuild
// bundles by. A workers.json entry pointing anywhere else type-checks one file
// and bundles another.
import { assertEquals } from '@std/assert'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aliased, command, members, outbound, stale } from './wrangler.ts'

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

Deno.test('wrangler: a deploy of the kernel deploys yak-out first, and nothing else does', () => {
  let out = ['-c', 'outbound/wrangler.toml', '--containers-rollout=none']
  assertEquals(outbound(['deploy', '--message', 'm']), [
    'deploy',
    '--message',
    'm',
    ...out,
  ])
  assertEquals(outbound(['deploy', '--env', 'staging']), [
    'deploy',
    '--env',
    'staging',
    ...out,
  ])
  for (
    let args of [
      ['dev'],
      ['--env', 'staging', 'dev'],
      ['deploy', '-c', 'other.toml'],
      ['deploy', '--config=other.toml'],
    ]
  ) assertEquals(outbound(args), undefined)
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
