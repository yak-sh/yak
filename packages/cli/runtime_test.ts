// Source paths follow a private runtime; data and other checkouts do not.
import { equal, test } from '@yaks/testing'
import { runtimePath, runtimeStack } from './runtime.ts'

test('a runtime remaps source paths without moving neighboring checkouts or data', () => {
  let path = (spec: string) =>
    runtimePath(spec, 'file:///src', 'file:///private')
  equal(
    path('file:///src/packages/tool/tools.ts'),
    'file:///private/packages/tool/tools.ts',
  )
  equal(path('file:///src-other/tool.ts'), 'file:///src-other/tool.ts')
  equal(path('file:///data/yak.db'), 'file:///data/yak.db')
  equal(path('@yaks/task'), '@yaks/task')
  equal(path('/src/node_modules/a/b.node'), '/private/node_modules/a/b.node')
  equal(path('/data/yak.db'), '/data/yak.db')
  equal(
    runtimeStack(
      'Error\n at file:///private/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
      'file:///src',
      'file:///private',
    ),
    'Error\n at file:///src/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
  )
  equal(
    runtimePath('file:///src/tool.ts', undefined, undefined),
    'file:///src/tool.ts',
  )
})

test('worker inspector launch binds only a local numeric port', async () => {
  let { inspector } = await import('./runtime.ts')
  equal(inspector('19285'), 19285)
  equal(inspector('0'), 0)
  for (let value of ['-1', '65536', '0.0.0.0:9229', '9229 --allow-all']) {
    let error = false
    try {
      inspector(value)
    } catch {
      error = true
    }
    equal(error, true)
  }
})

test('a slot follows its checkout: a landing rewrites only what landed, edits ride on top and leave with it', async () => {
  let { snapshot } = await import('./runtime.ts')
  let { command } = await import('@yaks/process/command')
  let disk = await import('@yaks/file/io')
  let root = await disk.makeTempDir()
  let cache = await disk.makeTempDir()
  let was = Deno.env.get('YAK_RUNTIME_CACHE')
  Deno.env.set('YAK_RUNTIME_CACHE', cache)
  let git = (...args: string[]) =>
    command('git', { args: ['-C', root, ...args], stdout: 'null' }).output()
  let write = (files: Record<string, string>) =>
    Promise.all(
      Object.entries(files).map(([name, text]) =>
        disk.writeTextFile(`${root}/${name}`, text)
      ),
    )
  let commit = async (files: Record<string, string>, gone: string[] = []) => {
    await write(files)
    for (let name of gone) await disk.remove(`${root}/${name}`)
    await git('add', '-A')
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', '.')
  }
  // What a slot holds, named by path, apart from its own marks.
  let tree = async () => {
    let { root: dir, release } = await snapshot(root)
    release()
    let found: Record<string, string> = {}
    for await (let { name } of disk.readDir(dir)) {
      if (!name.startsWith('.')) {
        found[name] = await disk.readTextFile(`${dir}/${name}`)
      }
    }
    return { dir, found }
  }
  try {
    await git('init', '-q')
    await commit({ 'a.ts': 'a1', 'b.ts': 'b1', 'kept.ts': 'k' })
    let first = await tree()
    equal(first.found, { 'a.ts': 'a1', 'b.ts': 'b1', 'kept.ts': 'k' })
    let kept = (await disk.stat(`${first.dir}/kept.ts`)).mtime
    await new Promise((r) => setTimeout(r, 20))
    await commit({ 'a.ts': 'a2', 'c.ts': 'c1' }, ['b.ts'])
    let landed = await tree()
    equal(landed.dir, first.dir)
    equal(landed.found, { 'a.ts': 'a2', 'c.ts': 'c1', 'kept.ts': 'k' })
    equal((await disk.stat(`${landed.dir}/kept.ts`)).mtime, kept)
    await write({ 'a.ts': 'edited', 'new.ts': 'n' })
    equal((await tree()).found, {
      'a.ts': 'edited',
      'c.ts': 'c1',
      'kept.ts': 'k',
      'new.ts': 'n',
    })
    await git('checkout', '-q', '.')
    await disk.remove(`${root}/new.ts`)
    await commit({ 'c.ts': 'c2' })
    let held = await tree()
    equal(held.found, { 'a.ts': 'a2', 'c.ts': 'c2', 'kept.ts': 'k' })
    // A launch holds its slot's `.live` lock as long as it runs from it.
    let live = await disk.open(`${held.dir}/.live`, {
      create: true,
      write: true,
    })
    await live.lock(false)
    await commit({ 'c.ts': 'c3' })
    let beside = await tree()
    equal(beside.dir == held.dir, false)
    equal(beside.found.c, undefined)
    equal(await disk.readTextFile(`${held.dir}/c.ts`), 'c2')
    live.close()
    await commit({ 'c.ts': 'c4' })
    equal((await tree()).dir, held.dir)
  } finally {
    if (was) Deno.env.set('YAK_RUNTIME_CACHE', was)
    else Deno.env.delete('YAK_RUNTIME_CACHE')
    await disk.remove(root, { recursive: true })
    await disk.remove(cache, { recursive: true })
  }
})
