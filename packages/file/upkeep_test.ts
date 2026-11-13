import { equal, test } from '@yaks/testing'
import type { FileInfo } from './io.ts'
import { lows, prune, type Pruning, trim } from './upkeep.ts'
import type { Disk } from './occupancy.ts'

let G = 1e9
let disk = (mount: string, free: number): Disk => ({
  mount,
  size: 100 * G,
  used: 100 * G - free * G,
  free: free * G,
})

test('a disk below its floor is told once a spell', () => {
  let told = new Set<string>()
  let said = (free: number, floor?: number) =>
    lows([disk('/', free)], told, floor && floor * G).map((e) => e.message)
  equal(said(50), [])
  equal(said(6.9), [
    '/ has 6.9 GB free of 100.0 GB, below its floor of 10.0 GB',
  ])
  equal(said(5), [])
  equal(said(15), [])
  equal(said(9).length, 1)
  equal(said(25, 30).length, 0)
})

// A computer holding the directories `dirs`, and a mirror holding `mirrored`;
// a name ending .js is a file.
let computer = (dirs: string[], mirrored: string[]) => {
  let removed: string[] = []
  let gone = (path: unknown) =>
    Promise.reject(Object.assign(Error(String(path)), { code: 'ENOENT' }))
  let fs: Pruning = {
    lstat: (path) =>
      dirs.includes(String(path))
        ? Promise.resolve({ isDirectory: true } as FileInfo)
        : gone(path),
    readDir: async function* (path) {
      let at = String(path)
      if (!mirrored.includes(at)) yield await gone(at)
      for (let m of mirrored) {
        let rest = m.slice(at.length + 1)
        if (m.startsWith(at + '/') && !rest.includes('/')) {
          let isDirectory = !m.endsWith('.js')
          yield {
            name: rest,
            isDirectory,
            isFile: !isDirectory,
            isSymlink: false,
          }
        }
      }
    },
    remove: (path) => (removed.push(String(path)), Promise.resolve()),
  }
  return { fs, removed }
}

test('prune removes the mirror of each directory that is gone, and only it', async () => {
  let { fs, removed } = computer(
    ['/a', '/a/b'],
    ['/m', '/m/a', '/m/a/b', '/m/a/b/old', '/m/a/gone', '/m/a/f.js'],
  )
  equal(await prune('/m/', undefined, fs), 2)
  equal(removed, ['/m/a/b/old', '/m/a/gone'])
})

test('a mirror that is not there prunes nothing', async () => {
  equal(await prune('/nowhere', undefined, computer([], []).fs), 0)
})

// A directory holding the files `sizes`, by name.
let cached = (sizes: Record<string, number>) => {
  let removed: string[] = []
  let fs: Pruning = {
    lstat: (path) =>
      Promise.resolve({ size: sizes[String(path).slice(3)] } as FileInfo),
    readDir: async function* () {
      for (let name of Object.keys(sizes)) {
        yield { name, isDirectory: false, isFile: true, isSymlink: false }
      }
    },
    remove: (path) => (removed.push(String(path)), Promise.resolve()),
  }
  return { fs, removed }
}

test('trim removes a cache past its budget, with the files named after it', async () => {
  let sizes = { c: 3 * G, 'c-wal': G, 'c-shm': 1, cc: 9 * G, other: 9 * G }
  let { fs, removed } = cached(sizes)
  equal(await trim('/d/c', 2 * G, fs), 4 * G + 1)
  equal(removed, ['/d/c', '/d/c-wal', '/d/c-shm'])
  equal(await trim('/d/c', 5 * G, cached(sizes).fs), 0)
})
