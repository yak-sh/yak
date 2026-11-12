import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Host, spares } from './spare.ts'

// The filesystem and Git registration are separate: prune runs after every
// rename, before Git updates the registration (or an explicit repair does).
let fixture = () => {
  let paths = new Set<string>()
  let trees = new Map<string, { path: string; locked: boolean }>()
  let renamed: string[] = []
  let pruned: string[] = []
  let gates = new Map<string, Promise<unknown>>()
  let cut = 0
  let failCheckout = false
  let failMove = false
  let prune = () => {
    for (let [id, tree] of trees) {
      if (!tree.locked && !paths.has(tree.path)) {
        trees.delete(id)
        pruned.push(id)
      }
    }
  }
  let find = (path: string) =>
    [...trees.values()].find((tree) => tree.path == path)
  let host: Host = {
    exists: (path) => Promise.resolve(paths.has(path)),
    entries: async function* () {
      for (let path of paths) yield { name: path.split('/').at(-1)! }
    },
    remove: (path) => {
      paths.delete(path)
      return Promise.resolve()
    },
    lock: async (_source, path, change) => {
      let before = gates.get(path) ?? Promise.resolve()
      let run = before.catch(() => {}).then(change)
      gates.set(path, run)
      try {
        return await run
      } finally {
        if (gates.get(path) == run) gates.delete(path)
      }
    },
    git: (cwd, args) =>
      Promise.resolve().then(() => {
        if (args[0] == 'checkout') {
          if (failCheckout) throw new Error('checkout failed')
          if (!find(cwd)) throw new Error('not a git repository')
          return ''
        }
        let [_, action, ...rest] = args
        let path = rest.at(-1)!
        if (action == 'list') {
          return [...trees.values()].map((tree) =>
            `worktree ${tree.path}\nHEAD abc\ndetached\n${
              tree.locked ? 'locked\n' : ''
            }`
          ).join('\n')
        }
        if (action == 'add') {
          path = rest.at(-2)!
          if (paths.has(path)) throw new Error('path exists')
          paths.add(path)
          trees.set(String(++cut), { path, locked: rest.includes('--lock') })
        } else if (action == 'move') {
          if (failMove) throw new Error('move failed')
          let from = rest.at(-2)!
          let tree = find(from)
          if (!tree) throw new Error('not a git repository')
          if (paths.has(path)) throw new Error('path exists')
          if (tree.locked && rest.filter((s) => s == '--force').length < 2) {
            throw new Error('worktree is locked')
          }
          paths.delete(from)
          paths.add(path)
          renamed.push(path)
          prune()
          tree.path = path
        } else if (action == 'lock' || action == 'unlock') {
          let tree = find(path)
          if (!tree) throw new Error('not a git repository')
          if (action == 'lock' && tree.locked) throw new Error('already locked')
          tree.locked = action == 'lock'
        } else if (action == 'remove') {
          let tree = find(path)
          if (tree?.locked && rest.filter((s) => s == '--force').length < 2) {
            throw new Error('worktree is locked')
          }
          paths.delete(path)
          for (let [id, tree] of trees) if (tree.path == path) trees.delete(id)
        } else throw new Error(`unexpected git ${args.join(' ')}`)
        return ''
      }),
  }
  return {
    ...spares(host),
    paths,
    trees,
    renamed,
    pruned,
    host,
    failCheckout: () => failCheckout = true,
    failMove: () => failMove = true,
  }
}

let source = '/repo'
let path = '/runs/session'
let spare = '/runs/.spare'

let published = fixture()
await published.keep(source, path, 'main')
let ready = structuredClone([...published.trees.values()])
await published.add(source, path, ['-b', 'session'], 'abc', true)

test('a spare survives prune between rename and registration at publication and claim', () => {
  assertEquals(ready, [{ path: spare, locked: true }])
  assertEquals(published.renamed, [spare, path])
  assertEquals(published.pruned, [])
  assertEquals([...published.trees.values()], [{ path, locked: false }])
})

test('a spare left unlocked by an older process is protected before claim', async () => {
  let f = fixture()
  await f.host.git(source, ['worktree', 'add', '--detach', spare, 'abc'])
  await f.add(source, path, ['--detach'], 'abc', true)
  assertEquals(f.pruned, [])
  assertEquals([...f.trees.values()], [{ path, locked: false }])
})

test('claims wait for a complete spare and only one takes it', async () => {
  let f = fixture()
  await Promise.all([
    f.keep(source, path, 'main'),
    f.add(source, path, ['--detach'], 'abc', true),
    f.add(source, path + '2', ['--detach'], 'abc', true),
  ])
  assertEquals(f.renamed, [spare, path])
  assertEquals([...f.paths].sort(), [path, path + '2'])
  assertEquals(f.pruned, [])
})

test('a failed cut is removed even while its Git registration is locked', async () => {
  let f = fixture()
  f.paths.add('/runs/.spare-incomplete')
  await f.host.git(source, [
    'worktree',
    'add',
    '--lock',
    '/runs/.spare-cut',
    'abc',
  ])
  await f.keep(source, path, 'main')
  assertEquals([...f.paths], [spare])
  assertEquals([...f.trees.values()], [{ path: spare, locked: true }])
})

test('a failed move is reported and leaves the spare registered', async () => {
  let f = fixture()
  await f.keep(source, path, 'main')
  f.failMove()
  await assertRejects(
    () => f.add(source, path, ['--detach'], 'abc', true),
    Error,
    'move failed',
  )
  assertEquals([...f.paths], [spare])
  assertEquals([...f.trees.values()], [{ path: spare, locked: true }])
})

test('a failed checkout removes the claimed worktree', async () => {
  let f = fixture()
  await f.keep(source, path, 'main')
  f.failCheckout()
  await assertRejects(
    () => f.add(source, path, ['--detach'], 'abc', true),
    Error,
    'checkout failed',
  )
  assertEquals([...f.paths], [])
  assertEquals([...f.trees.values()], [])
})
