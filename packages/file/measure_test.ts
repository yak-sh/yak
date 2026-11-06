import { equal, test } from '@yaks/testing'
import type { FileInfo } from './io.ts'
import { disksAt, type Filesystem, walk } from './measure.ts'

let tree: Record<string, Partial<FileInfo> & { children?: string[] }> = {
  '/': { ino: 1, isDirectory: true, blocks: 1, children: ['home', 'other'] },
  '/home': {
    ino: 2,
    isDirectory: true,
    blocks: 1,
    children: ['big', 'link', 'sym', 'small', 'private', 'gone'],
  },
  '/home/big': { ino: 3, blocks: 8, size: 1000000 },
  '/home/link': { ino: 3, blocks: 8 },
  '/home/sym': { ino: 4, blocks: 0, isSymlink: true },
  '/home/small': { ino: 5, blocks: 1 },
  '/home/private': { ino: 6, blocks: 1, isDirectory: true },
  '/other': { ino: 1, dev: 2, blocks: 100, isDirectory: true },
  '/other/me': { ino: 2, dev: 2, isDirectory: true },
}
let fs: Filesystem = {
  lstat: (path) => {
    let stat = tree[String(path)]
    if (!stat) {
      return Promise.reject(Object.assign(Error('gone'), { code: 'ENOENT' }))
    }
    return Promise.resolve({ dev: 1, ...stat } as FileInfo)
  },
  readDir: async function* (path) {
    if (String(path).endsWith('/private')) {
      throw Object.assign(Error('private'), { code: 'EACCES' })
    }
    for (let name of tree[String(path)].children ?? []) {
      yield { name, isFile: false, isDirectory: false, isSymlink: false }
    }
  },
  realPath: (path) =>
    Promise.resolve(path == '/me' ? '/other/me' : String(path)),
  space: (path) =>
    Promise.resolve({ size: 1000, used: 600, free: String(path).length }),
}

test('disks are the filesystems holding the places, each once at its mount', async () => {
  equal(await disksAt(['/', '/home', '/me', '/other/me'], fs), [
    { mount: '/', size: 1000, used: 600, free: 1 },
    { mount: '/other', size: 1000, used: 600, free: 6 },
  ])
})

test('walk counts allocated blocks and directories, once per inode on one device', async () => {
  equal(await walk('/', 1000, undefined, fs), {
    counted: 6144,
    paths: { 'home/big': 4096, 'home/': 5632 },
  })
})

test('an aborted walk publishes no partial measurement', async () => {
  equal(await walk('/', 0, AbortSignal.abort(), fs), undefined)
})

test('unexpected filesystem errors propagate', async () => {
  let broken = {
    ...fs,
    readDir: async function* () {
      yield await Promise.reject(Error('I/O failed'))
    },
  }
  let error = await walk('/', 0, undefined, broken).catch((e) => e.message)
  equal(error, 'I/O failed')
})
