import { test } from '@yaks/testing'
import { createHash } from 'node:crypto'
import { assertEquals } from '@std/assert'
import { type Lock, matching, restored, stale } from './dependencies.ts'

let pkg = {
  version: '1',
  resolved: 'https://npm.test/dep.tgz',
  integrity: 'sha512-one',
}
let packages = {
  '': { name: 'yak' },
  'node_modules/dep': { ...pkg, libc: ['glibc'], engines: { node: '>=18' } },
  'node_modules/other-platform': { version: '1', optional: true },
}
let lock = (packages: unknown): Lock =>
  ({ lockfileVersion: 3, packages }) as Lock

test('npm cache reuse follows package contents, including omitted optional packages', () => {
  let wanted = lock(packages)
  for (
    let [held, want] of [
      [{ 'node_modules/dep': pkg }, true],
      [
        { 'node_modules/dep': { ...pkg, license: 'MIT' } },
        true,
      ],
      [{ 'node_modules/dep': { ...pkg, version: '2' } }, false],
      [{ 'node_modules/dep': { ...pkg, integrity: 'sha512-two' } }, false],
      [{
        'node_modules/dep': { ...pkg, resolved: 'https://npm.test/other.tgz' },
      }, false],
      [{ 'node_modules/dep': { ...pkg, link: true } }, false],
      [{}, false],
      [{ 'node_modules/dep': pkg, 'node_modules/extra': pkg }, false],
    ] as [unknown, boolean][]
  ) assertEquals(matching(wanted, lock(held)), want)
})

test('a legacy npm cache with omitted metadata supplies a fresh checkout without installing', async () => {
  let root = Deno.makeTempDirSync(), cache = `${root}/cache`
  let files = [
    ['package.json', '{"private":true}'],
    ['package-lock.json', JSON.stringify(lock(packages))],
  ]
  let key = createHash('sha256').update(
    JSON.stringify([Deno.build.os, Deno.build.arch, files]),
  ).digest('hex')
  let project = `${cache}/yak-installed/${key}`
  try {
    Deno.mkdirSync(`${project}/node_modules/dep`, { recursive: true })
    Deno.writeTextFileSync(
      `${project}/node_modules/.package-lock.json`,
      JSON.stringify(lock({ 'node_modules/dep': pkg })),
    )
    Deno.utimeSync(`${project}/node_modules/.package-lock.json`, 0, 0)
    for (let [name, contents] of files) {
      Deno.writeTextFileSync(`${root}/${name}`, contents)
      Deno.writeTextFileSync(`${project}/${name}`, contents)
    }
    assertEquals(await restored(cache, root), false)
    assertEquals(stale(root), false)
    Deno.removeSync(`${root}/node_modules/dep`)
    assertEquals(stale(root), true, 'hidden lock outlived a missing package')
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})

test('npm installs cold and changed inputs, reuses successful trees, and retries failed installs', async () => {
  let dir = Deno.makeTempDirSync()
  try {
    Deno.mkdirSync(`${dir}/bin`)
    Deno.mkdirSync(`${dir}/checkout`)
    Deno.writeTextFileSync(`${dir}/code`, '0')
    Deno.writeTextFileSync(`${dir}/calls`, '')
    Deno.writeTextFileSync(
      `${dir}/held`,
      JSON.stringify(lock({ 'node_modules/dep': pkg })),
    )
    Deno.writeTextFileSync(`${dir}/checkout/package.json`, '{"private":true}')
    Deno.writeTextFileSync(
      `${dir}/checkout/package-lock.json`,
      JSON.stringify(lock(packages)),
    )
    // npm 10's hidden lock omits metadata, and may exist before a script fails.
    Deno.writeTextFileSync(
      `${dir}/bin/npm`,
      `#!/bin/sh
echo install >> "$YAK_NPM_DIR/calls"
mkdir -p node_modules/dep
cp "$YAK_NPM_DIR/held" node_modules/.package-lock.json
if [ -f "$YAK_NPM_DIR/hold" ]; then
  touch "$YAK_NPM_DIR/entered"
  while [ -f "$YAK_NPM_DIR/hold" ]; do sleep 0.005; done
fi
exit "$(cat "$YAK_NPM_DIR/code")"
`,
      { mode: 0o755 },
    )
    Deno.writeTextFileSync(
      `${dir}/exercise.ts`,
      `
import { installed, restored, stale } from ${
        JSON.stringify(new URL('./dependencies.ts', import.meta.url).href)
      }
import { existsSync } from 'node:fs'
let dir = Deno.args[0], root = dir + '/checkout', cache = dir + '/cache'
let results = []
let count = () => Deno.readTextFileSync(dir + '/calls').trim().split('\\n').filter(Boolean).length
let restore = async (name) => results.push([name, await restored(cache, root), count(), stale(root)])
let change = () => {
  let path = root + '/package-lock.json', lock = JSON.parse(Deno.readTextFileSync(path))
  lock.packages['node_modules/dep'].license = String(count())
  Deno.writeTextFileSync(path, JSON.stringify(lock))
}
await restore('cold')
Deno.removeSync(root + '/node_modules')
await restore('fresh checkout')
results.push(['deploy readiness', await installed(root), count(), stale(root)])
change()
await restore('lock metadata changed')
Deno.writeTextFileSync(root + '/package.json', '{"private":true,"name":"changed"}')
await restore('manifest changed')
Deno.removeSync(root + '/node_modules/dep')
results.push(['missing package', await installed(root), count(), stale(root)])
let seed = dir + '/seed'
Deno.mkdirSync(seed)
for (let file of ['package.json', 'package-lock.json']) Deno.copyFileSync(root + '/' + file, seed + '/' + file)
results.push(['matching seed', await installed(seed, { seed: root }), count(), stale(seed)])
change()
results.push(['different seed', await installed(root, { seed }), count(), stale(root)])
Deno.writeTextFileSync(root + '/node_modules/.package-lock.json', '{')
results.push(['broken hidden lock', await installed(root), count(), stale(root)])
change()
Deno.writeTextFileSync(dir + '/code', '13')
try { await restored(cache, root) } catch (error) {
  results.push(['failed install', error.message.includes('exited 13'), count(), stale(root)])
}
Deno.writeTextFileSync(dir + '/code', '0')
await restore('retry failed cache')
await restore('retry stays ready')
Deno.removeSync(root + '/node_modules/.yak-install')
Deno.writeTextFileSync(root + '/node_modules/.package-lock.json', '{')
await restore('malformed legacy cache')
change()
Deno.writeTextFileSync(dir + '/code', '13')
Deno.writeTextFileSync(dir + '/hold', '')
let first = restored(cache, root), due = Date.now() + 5000
while (!existsSync(dir + '/entered')) {
  if (Date.now() > due) throw new Error('npm did not enter its install script')
  await new Promise(ok => setTimeout(ok, 0))
}
let second = restored(cache, root)
Deno.removeSync(dir + '/hold')
try { await first } catch (error) {
  results.push(['concurrent failed install', error.message.includes('exited 13'), count(), stale(root)])
}
Deno.writeTextFileSync(dir + '/code', '0')
results.push(['concurrent retry', await second, count(), stale(root)])
// Exercise mismatch fields and a same-key stale seed after the reuse checks.
for (let field of ['version', 'resolved', 'integrity', 'link']) {
  let path = root + '/node_modules/.package-lock.json'
  let held = JSON.parse(Deno.readTextFileSync(path))
  held.packages['node_modules/dep'][field] = field === 'link' ? true : 'changed'
  Deno.writeTextFileSync(path, JSON.stringify(held))
  await installed(root)
}
for (let file of ['package.json', 'package-lock.json']) Deno.copyFileSync(root + '/' + file, seed + '/' + file)
Deno.removeSync(root + '/node_modules/dep')
await installed(root, { seed })
console.log(JSON.stringify(results))
`,
    )
    let out = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', `${dir}/exercise.ts`, dir],
      env: { PATH: `${dir}/bin:${Deno.env.get('PATH')}`, YAK_NPM_DIR: dir },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr))
    let diagnostics = new TextDecoder().decode(out.stderr).trim().split('\n')
    assertEquals(diagnostics.length, 16, 'one diagnostic per npm invocation')
    for (
      let reason of [
        'receipt missing:',
        'receipt different key:',
        'seed missing',
        'seed different key:',
        'seed stale:',
        `tree incomplete: "${dir}/checkout/node_modules/dep"`,
        'lockfile unreadable:',
        ...['version', 'resolved', 'integrity', 'link'].map((field) =>
          `lockfile mismatch: "node_modules/dep" ${field}`
        ),
      ]
    ) {
      assertEquals(
        diagnostics.some((line) => line.includes(reason)),
        true,
        `diagnostic includes ${reason}`,
      )
    }

    assertEquals(JSON.parse(new TextDecoder().decode(out.stdout)), [
      ['cold', true, 1, false],
      ['fresh checkout', false, 1, false],
      ['deploy readiness', false, 1, false],
      ['lock metadata changed', true, 2, false],
      ['manifest changed', true, 3, false],
      ['missing package', true, 4, false],
      ['matching seed', false, 4, false],
      ['different seed', true, 5, false],
      ['broken hidden lock', true, 6, false],
      ['failed install', true, 7, true],
      ['retry failed cache', true, 8, false],
      ['retry stays ready', false, 8, false],
      ['malformed legacy cache', true, 9, false],
      ['concurrent failed install', true, 10, true],
      ['concurrent retry', true, 11, false],
    ])
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
