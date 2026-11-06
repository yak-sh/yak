import { equal, test, throws } from '@yaks/testing'
import type { FileInfo } from './io.ts'
import { type Filesystem, walk } from './measure.ts'
import { disks, type Mounted } from './occupancy.ts'

let volume = (mountpoint: string, fs = 'apfs', device = 'disk1'): Mounted => ({
  mountpoint,
  fs,
  device,
  type: 'fixed',
  ok: true,
  usage: { total: 1000, free: 400, available: 300 },
})

test('local volumes include APFS and HFS, deduplicate devices and preserve reserved space', () => {
  equal(
    disks([
      volume('/bind'),
      volume('/'),
      volume('/Volumes/My Data', 'hfs', 'disk2'),
      volume('/run', 'tmpfs', 'ram'),
      { ...volume('/network'), type: 'network' },
    ]),
    [
      { mount: '/', size: 1000, used: 600, free: 300 },
      { mount: '/Volumes/My Data', size: 1000, used: 600, free: 300 },
    ],
  )
  equal(disks('/dev/sda ext4 1000 600 300 /'), [
    { mount: '/', size: 1000, used: 600, free: 300 },
  ])
  throws(() => disks([{ ...volume('/'), ok: false, error: 'unreadable' }]))
})

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
}

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
