import { equal, test } from './mod.ts'
import { reads } from './reads.ts'

// An audit's lines, as a runtime writes them under -A.
let log = (...checks: [string, string | null][]) =>
  checks.map(([permission, value]) =>
    JSON.stringify({ v: 1, datetime: '', permission, value })
  )

test('each read after a file is marked is that file’s, until the next mark, but the file itself', () => {
  equal(
    reads(
      log(
        ['read', '/r/planned.json'],
        ['env', '@yaks/testing a_test.ts'],
        ['read', 'file:///r/a_test.ts'],
        ['read', '/r/data.json'],
        ['write', '/r/data.json'],
        ['env', 'HOME'],
        ['env', '@yaks/testing b_test.ts'],
        ['read', '/r/pkg/'],
        ['read', 'file:///r/plugin.ts'],
        ['read', 'pkg/vocab.json'],
      ),
      '/r',
    ),
    new Map([
      ['a_test.ts', ['data.json']],
      ['b_test.ts', ['pkg', 'pkg/vocab.json', 'plugin.ts']],
    ]),
  )
})

test('a read outside the checkout, or of an example the runner wrote, is no source', () => {
  equal(
    reads(
      log(
        ['env', '@yaks/testing a.md'],
        ['read', '/tmp/x'],
        ['read', '/proc/self/stat'],
        ['read', 'file:///r/.a.md.3.99.example.ts'],
        ['read', '/r'],
      ),
      '/r',
    ),
    new Map([['a.md', ['.']]]),
  )
})

test('a file marked again read what both passes did; a check of no path, or a torn line, names nothing', () => {
  equal(
    reads(
      [
        ...log(
          ['env', '@yaks/testing a_test.ts'],
          ['read', '/r/x'],
          ['read', null],
          ['env', '@yaks/testing a_test.ts'],
          ['read', '/r/y'],
        ),
        '{"v":1,"permission":"read","val',
      ],
      '/r',
    ),
    new Map([['a_test.ts', ['x', 'y']]]),
  )
})
