import { assertEquals, assertThrows } from '@std/assert'
import {
  LEGACY,
  repackage,
  soundVocab,
  type Version,
} from './vale-sfx-releases.ts'

let sha = (digit: string) => digit.repeat(64)
let files = {
  ...LEGACY,
  'data/sfx/README.md': sha('a'),
  'samples.ts': sha('b'),
  'samples_test.ts': sha('c'),
  'vocab.json': sha('d'),
  'index.html': sha('e'),
}
let version: Version = {
  eid: 'release-1',
  app: 'vale',
  version: 181,
  source: 'yourname/.releases/vale/release-1',
  files,
}
let changes = Object.fromEntries(
  Object.keys(files).filter((path) =>
    path != 'index.html' && path != 'vocab.json'
  ).map((path) => [
    path,
    sha('f'),
  ]),
)
let vocabs = { [sha('d')]: sha('f') }

Deno.test('repackage keeps complete prior manifests and changes only sound files', () => {
  let [made] = repackage(
    [version, {
      ...version,
      eid: 'release-2',
      files: { 'index.html': sha('e') },
    }],
    changes,
    vocabs,
  )
  assertEquals(made.version.files, files)
  assertEquals(made.files['index.html'], files['index.html'])
  assertEquals(made.files['samples.ts'], sha('f'))
  assertEquals(made.changed.length, Object.keys(changes).length + 1)
  assertEquals(files['samples.ts'], sha('b'))
})

Deno.test('repackage refuses a partial legacy release', () => {
  let partial = {
    ...version,
    files: { ...files, 'data/sfx/09.json': sha('a') },
  }
  assertThrows(() => repackage([partial], changes, vocabs))
})

Deno.test('sound vocabulary repackage leaves the other declarations in place', () => {
  let before = {
    $defs: {
      sfx: {
        description:
          'The description of one sound Vale needs. Its own builder reads this row and cites it in the generated recording.',
      },
      region: { properties: { name: { type: 'string' } } },
    },
  }
  let after = JSON.parse(new TextDecoder().decode(
    soundVocab(new TextEncoder().encode(JSON.stringify(before))),
  ))
  assertEquals(after.$defs.region, before.$defs.region)
  assertEquals(after.$defs.sfx.description.includes('shared sound builder'), true)
})
