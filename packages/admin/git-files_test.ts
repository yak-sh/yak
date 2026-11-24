import { equal, test } from '@yaks/testing'
import { carrying, fileHistory, filesAt, objects } from './git-files.ts'
import { fileOf } from './push.ts'

let encode = (text: string) => new TextEncoder().encode(text)

test('Git batch lengths preserve binary bytes and missing paths', () => {
  let reply = encode(
    'a blob 3\0a\0\n\0head:path with\na newline missing\0b tree 0\0\0c blob 0\0\0',
  )
  equal(objects(reply, 4), [encode('a\0\n'), undefined, undefined, encode('')])
})

test('app history reads the platform hash already carried for this file', async () => {
  let sha = '1'.repeat(64)
  let path = 'file with spaces.js'
  let message = carrying({ app: 'sound' }, [
    { path, content: 'merged', from: sha },
    { path: 'other.js', content: 'other', from: '2'.repeat(64) },
  ], 'deploy catch-up')
  let records = message.split('\n').flatMap((line) =>
    line.startsWith('Platform-File: ') ? [line.slice(15)] : []
  )
  let history = fileHistory(
    (args) => {
      let out = args[0] == 'show'
        ? 'merged'
        : ['hash', ...records].join('\0') + '\x01\n'
      return Promise.resolve({ ok: true, code: 0, out, err: '' })
    },
    path,
    `apps/sound/${path}`,
    'head',
  )
  equal(await Array.fromAsync(history), [{ sha }, 'merged'])
})

test('app release batches files and resolves only file links at the commit', async () => {
  let reads: string[][] = []
  let listed = [
    '100644 blob a\tapps/demo/z.bin',
    '100644 blob b\tapps/demo/.hidden',
    '120000 blob c\tapps/demo/a.txt',
    '120000 blob d\tapps/demo/missing.txt',
  ].join('\0') + '\0'
  let data: Record<string, Uint8Array> = {
    a: encode('binary\0'),
    c: encode('../../shared/file.txt'),
    d: encode('gone'),
    'head:shared/file.txt': encode('linked'),
  }
  let found = await filesAt(
    () => Promise.resolve(listed),
    (specs) => {
      reads.push(specs)
      return Promise.resolve(specs.map((spec) => data[spec]))
    },
    'head',
    'apps/demo',
  )
  equal(found, [
    fileOf('a.txt', encode('linked')),
    fileOf('z.bin', encode('binary\0')),
  ])
  equal(reads, [['a', 'c', 'd'], [
    'head:shared/file.txt',
    'head:apps/demo/gone',
  ]])
})
