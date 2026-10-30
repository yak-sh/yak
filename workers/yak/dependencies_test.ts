import { test } from '@yaks/testing'
import { createHash } from 'node:crypto'
import { assertEquals, assertRejects } from '@std/assert'
import { dependencies, type Host, type Lock, matching } from './dependencies.ts'

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
let inputLock = JSON.stringify(lock(packages))
let installedLock = JSON.stringify(lock({ 'node_modules/dep': pkg }))

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

// Files and links obey the same boundary as the production filesystem; npm
// writes its hidden lock before an install script can fail.
let notFound = new Deno.errors.NotFound(),
  alreadyExists = new Deno.errors.AlreadyExists()
let memory = () => {
  type Entry = string | null | { target: string }
  let entries = new Map<string, Entry>([['/', null]])
  let links = new Map<string, string>()
  let missing = (_path: string): never => {
    throw notFound
  }
  let resolve = (path: string): string => {
    for (let [link, target] of links) {
      if (path === link || path.startsWith(link + '/')) {
        return resolve(target + path.slice(link.length))
      }
    }
    return path
  }
  let read = (path: string) => {
    let entry = entries.get(resolve(path))
    if (typeof entry !== 'string') return missing(path)
    return entry
  }
  let mkdir = (path: string, recursive = false) => {
    path = resolve(path)
    if (entries.has(path)) {
      if (recursive && entries.get(path) === null) return
      throw alreadyExists
    }
    let parent = path.slice(0, path.lastIndexOf('/')) || '/'
    if (!entries.has(parent)) {
      if (!recursive) return missing(parent)
      mkdir(parent, true)
    }
    entries.set(path, null)
  }
  let write = (path: string, value: string) => {
    path = resolve(path)
    let parent = path.slice(0, path.lastIndexOf('/')) || '/'
    if (entries.get(parent) !== null) return missing(parent)
    entries.set(path, value)
  }
  let remove = (path: string) => {
    // Follow parent links, but unlink the named link without touching its tree.
    let slash = path.lastIndexOf('/')
    path = resolve(path.slice(0, slash) || '/') + path.slice(slash)
    for (let name of entries.keys()) {
      if (name === path || name.startsWith(path + '/')) {
        entries.delete(name)
        links.delete(name)
      }
    }
  }
  let copy = (from: string, to: string) => {
    if (!entries.has(from)) return missing(from)
    for (let [path, entry] of [...entries]) {
      if (path === from || path.startsWith(from + '/')) {
        let destination = to + path.slice(from.length)
        entries.set(destination, entry)
        if (entry && typeof entry === 'object') {
          links.set(destination, entry.target)
        }
      }
    }
  }
  let diagnostics: string[] = [], calls = 0, code = 0, serial = 0
  let host: Host = {
    read,
    write,
    mkdir,
    remove,
    directory: (path) => {
      let entry = entries.get(resolve(path))
      if (entry === undefined) return missing(path)
      return entry === null
    },
    exists: (path) => entries.has(resolve(path)),
    realpath: (path) => {
      path = resolve(path)
      if (!entries.has(path)) return missing(path)
      return path
    },
    copy,
    rename: (from, to) => {
      copy(from, to)
      remove(from)
    },
    symlink: (target, path) => {
      if (entries.has(path)) throw alreadyExists
      entries.set(path, { target })
      links.set(path, target)
    },
    link: (path) => {
      let entry = entries.get(path)
      if (entry === undefined) return missing(path)
      return entry && typeof entry === 'object' ? entry.target : undefined
    },
    now: () => 0,
    wait: () => {
      throw new Error('unexpected lock wait')
    },
    npm: (root) => {
      calls++
      tree(root)
      return Promise.resolve(code)
    },
    report: (message) => diagnostics.push(message),
    nonce: () => String(++serial),
  }
  let inputs = (root: string, source?: string) => {
    mkdir(root, true)
    for (
      let [file, contents] of [
        ['package.json', '{"private":true}'],
        ['package-lock.json', inputLock],
      ]
    ) write(`${root}/${file}`, source ? read(`${source}/${file}`) : contents)
  }
  let tree = (root: string) => {
    mkdir(`${root}/node_modules/dep`, true)
    write(
      `${root}/node_modules/.package-lock.json`,
      installedLock,
    )
  }
  let api = dependencies(host), root = '/checkout', cache = '/cache'
  inputs(root)
  let change = () => {
    let path = `${root}/package-lock.json`, held = JSON.parse(read(path))
    held.packages['node_modules/dep'].license = String(calls)
    write(path, JSON.stringify(held))
  }
  let state = () => {
    assertEquals(diagnostics.length, calls, 'one diagnostic per npm invocation')
    return [calls, api.stale(root)]
  }
  let restore = () => api.restored(cache, root)
  let diagnostic = (reason: string) =>
    assertEquals(
      diagnostics.some((line) => line.includes(reason)),
      true,
      `diagnostic includes ${reason}`,
    )
  return {
    ...api,
    host,
    root,
    cache,
    read,
    write,
    remove,
    inputs,
    tree,
    change,
    state,
    restore,
    diagnostics,
    diagnostic,
    code: (value: number) => {
      code = value
    },
  }
}

// Each mutating case owns its filesystem; only setup precedes its timed act.
let legacyCache = memory()
{
  let m = legacyCache
  let files = ['package.json', 'package-lock.json'].map(
    (file) => [file, m.read(`${m.root}/${file}`)],
  )
  let key = createHash('sha256').update(
    JSON.stringify([Deno.build.os, Deno.build.arch, files]),
  ).digest('hex')
  let project = `${m.cache}/yak-installed/${key}`
  m.inputs(project, m.root)
  m.tree(project)
}
let coldCache = memory(),
  seedCache = memory(),
  failedCache = memory(),
  retryCache = memory(),
  mismatchCache = memory()
await seedCache.installed(seedCache.root)
await mismatchCache.installed(mismatchCache.root)
retryCache.code(13)
try {
  await retryCache.restore()
} catch { /* A failed install is the successful retry's starting state. */ }
retryCache.code(0)

test('a legacy npm cache with omitted metadata supplies a fresh checkout without installing', async () => {
  let m = legacyCache
  assertEquals(await m.restore(), false)
  assertEquals(m.state(), [0, false])
  m.remove(`${m.root}/node_modules/dep`)
  assertEquals(m.stale(m.root), true, 'hidden lock outlived a missing package')
})

test('npm installs cold and reuses the tree for a fresh checkout and deploy', async () => {
  let m = coldCache
  assertEquals(await m.restore(), true)
  assertEquals(m.state(), [1, false])
  m.remove(`${m.root}/node_modules`)
  assertEquals(await m.restore(), false)
  assertEquals(await m.installed(m.root), false)
  assertEquals(m.state(), [1, false])
  m.diagnostic('receipt missing:')
})

for (let changed of ['lock metadata', 'manifest']) {
  test(`npm reinstalls when ${changed} changes`, async () => {
    let m = memory()
    await m.restore()
    if (changed === 'manifest') {
      m.write(`${m.root}/package.json`, '{"private":true,"name":"changed"}')
    } else m.change()
    assertEquals(await m.restore(), true)
    assertEquals(m.state(), [2, false])
    m.diagnostic('receipt different key:')
  })
}

test('npm reuses a matching seed and installs when inputs or a package differ', async () => {
  let m = seedCache, seed = '/seed'
  m.diagnostic('seed missing')
  m.inputs(seed, m.root)
  assertEquals(await m.installed(seed, { seed: m.root }), false)
  assertEquals(m.stale(seed), false)
  assertEquals(m.state(), [1, false])
  m.change()
  assertEquals(await m.installed(m.root, { seed }), true)
  assertEquals(m.state(), [2, false])
  m.inputs(seed, m.root)
  m.remove(`${m.root}/node_modules/dep`)
  assertEquals(await m.installed(m.root, { seed }), true)
  assertEquals(m.state(), [3, false])
  m.diagnostic('seed different key:')
  m.diagnostic('seed stale:')
  m.diagnostic('tree incomplete: "/checkout/node_modules/dep"')
})

test('a failed npm install leaves its tree stale', async () => {
  let m = failedCache
  m.code(13)
  await assertRejects(m.restore, Error, 'exited 13')
  assertEquals(m.state(), [1, true])
})

test('npm retries failed installs and keeps the successful retry ready', async () => {
  let m = retryCache
  m.code(0)
  assertEquals(await m.restore(), true)
  assertEquals(await m.restore(), false)
  assertEquals(m.state(), [2, false])
})

for (let legacy of [false, true]) {
  test(`npm refuses ${legacy ? 'a malformed legacy cache' : 'an unreadable hidden lock'}`, async () => {
    let m = memory()
    await m.restore()
    if (legacy) m.remove(`${m.root}/node_modules/.yak-install`)
    m.write(`${m.root}/node_modules/.package-lock.json`, '{')
    assertEquals(await (legacy ? m.restore() : m.installed(m.root)), true)
    assertEquals(m.state(), [2, false])
    m.diagnostic('lockfile unreadable:')
  })
}

test('a concurrent npm caller retries after the first installer fails', async () => {
  let m = memory(),
    running = Promise.withResolvers<number>(),
    waiting = Promise.withResolvers<void>()
  let npm = m.host.npm
  m.host.npm = (root) => {
    npm(root)
    return running.promise
  }
  m.host.wait = () => waiting.promise
  let first = m.restore()
  let second = m.restore()
  running.resolve(13)
  await assertRejects(() => first, Error, 'exited 13')
  assertEquals(m.state(), [1, true])
  m.host.npm = npm
  waiting.resolve()
  assertEquals(await second, true)
  assertEquals(m.state(), [2, false])
})

test('npm diagnoses each mismatching package identity before replacing the tree', async () => {
  let m = mismatchCache
  for (let field of ['version', 'resolved', 'integrity', 'link']) {
    let path = `${m.root}/node_modules/.package-lock.json`,
      held = JSON.parse(m.read(path))
    held.packages['node_modules/dep'][field] = field === 'link'
      ? true
      : 'changed'
    m.write(path, JSON.stringify(held))
    assertEquals(await m.installed(m.root), true)
    m.diagnostic(`lockfile mismatch: "node_modules/dep" ${field}`)
  }
  assertEquals(m.state(), [5, false])
})

test('a restored install keeps the caller’s lock timeout', async () => {
  let m = memory(), running = Promise.withResolvers<number>()
  let npm = m.host.npm
  m.host.npm = (root) => {
    npm(root)
    return running.promise
  }
  let first = m.restore()
  await assertRejects(
    () => m.restored(m.cache, m.root, { timeout: -1 }),
    Error,
    'never finished',
  )
  running.resolve(0)
  assertEquals(await first, true)
  assertEquals(m.state(), [1, false])
})

test('a copied cache keeps module paths local and remains independent across checkouts', async () => {
  let m = memory(), copy = m.host.copy
  await m.restore()
  assertEquals(
    m.host.realpath(`${m.root}/node_modules`).startsWith(m.cache),
    true,
  )
  await m.restored(m.cache, m.root, { mode: 'copy' })
  assertEquals(
    m.host.realpath(`${m.root}/node_modules`),
    `${m.root}/node_modules`,
  )
  assertEquals(m.host.link(`${m.root}/node_modules`), undefined)
  m.host.copy = () => {
    throw Error('an unchanged local tree is not copied again')
  }
  await m.restored(m.cache, m.root, { mode: 'copy' })
  m.host.copy = copy
  m.remove(`${m.root}/node_modules/dep`)
  assertEquals(m.stale(m.root), true)
  let second = '/second'
  m.inputs(second, m.root)
  await m.restored(m.cache, second, { mode: 'copy' })
  assertEquals(
    m.host.realpath(`${second}/node_modules`),
    `${second}/node_modules`,
  )
  assertEquals(m.stale(second), false)
  await m.restored(m.cache, m.root, { mode: 'copy' })
  assertEquals(m.state(), [1, false])
})
