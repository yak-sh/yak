import { equal, test } from '@yaks/testing'
import {
  carrying,
  commitCarried,
  fileHistory,
  filesAt,
  objects,
} from './git-files.ts'
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

test('app release keeps the Git source path of each served file', async () => {
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
  let { files, source } = await filesAt(
    () => Promise.resolve(listed),
    (specs) => {
      reads.push(specs)
      return Promise.resolve(specs.map((spec) => data[spec]))
    },
    'head',
    'apps/demo',
  )
  equal(files, [
    fileOf('a.txt', encode('linked')),
    fileOf('z.bin', encode('binary\0')),
  ])
  equal(reads, [['a', 'c', 'd'], [
    'head:shared/file.txt',
    'head:apps/demo/gone',
  ]])
  equal(source('a.txt'), 'shared/file.txt')
  equal(source('z.bin'), 'apps/demo/z.bin')
  let prior = await Array.fromAsync(fileHistory(
    (args) =>
      Promise.resolve({
        out: args[0] == 'show'
          ? args[1] == 'old:shared/file.txt' ? 'prior linked text' : ''
          : args.at(-1) == 'shared/file.txt'
          ? 'old\x00\x01'
          : '',
        ok: true,
        code: 0,
        err: '',
      }),
    'a.txt',
    source('a.txt'),
    'head',
  ))
  equal(prior, ['prior linked text'])
})

test('carrying a file that leaves the index clean needs no commit', async () => {
  let committed = false
  await commitCarried(
    '/tree',
    (_cwd, args) => {
      if (args[0] == 'commit') committed = true
      return Promise.resolve('')
    },
    ['shared/file.txt'],
    'Carry platform edit',
  )
  equal(committed, false)
})
