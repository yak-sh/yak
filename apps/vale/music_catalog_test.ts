// Catalogue joins and next-song choices remain stable while outputs rebuild.
import { equal, test } from '@yaks/testing'
import { catalog, type Row, track } from './music_catalog.ts'

let rows = (): Row[] => [
  { entity: { eid: 'land' }, theme_design: { land: 'mossvale' } },
  { entity: { eid: 'song-a' }, song: { land: 'land', theme: 'welcome' } },
  { entity: { eid: 'song-b' }, song: { land: 'land', theme: 'return' } },
  { entity: { eid: 'build-a' }, build: { for: 'song-a', variant: 'main' } },
  { entity: { eid: 'build-b' }, build: { for: 'song-b', variant: 'main' } },
  {
    entity: { eid: 'out-a' },
    built: { build: 'build-a', artifact: 'blob-a', current: true },
  },
  {
    entity: { eid: 'out-b' },
    built: { build: 'build-b', artifact: 'blob-b', current: true },
  },
  {
    entity: { eid: 'blob-a' },
    artifact: { address: 'audio-a', media_type: 'audio/mpeg' },
  },
  {
    entity: { eid: 'blob-b' },
    artifact: { address: 'audio-b', media_type: 'audio/mpeg' },
  },
]

test('songs join qualified riders and keep order through delivery and rebuild', () => {
  let original = rows()
  let songs = catalog(original).mossvale
  equal(songs.map((song) => song.id), ['song-b', 'song-a'])
  equal(catalog(original.toReversed()).mossvale, songs)
  let rebuilt = rows()
  rebuilt.find((row) => row.entity.eid == 'blob-b')!.artifact!.address = 'new-b'
  equal(catalog(rebuilt).mossvale.map((song) => song.id), ['song-b', 'song-a'])
  equal(track(catalog(rebuilt).mossvale, 'song-b', new Set())?.sha, 'new-b')
})

test('only current main audio outputs play; pending current data keeps its turn', () => {
  let input = rows()
  input.push(
    {
      entity: { eid: 'shadow' },
      build: { for: 'song-a', variant: 'shadow:x' },
    },
    {
      entity: { eid: 'out-shadow' },
      built: { build: 'shadow', artifact: 'blob-a', current: true },
    },
  )
  input.find((row) => row.entity.eid == 'out-a')!.built!.current = false
  input.find((row) => row.entity.eid == 'blob-b')!.artifact!.media_type =
    'image/png'
  let songs = catalog(input).mossvale
  equal(songs, [{ id: 'song-b', theme: 'return', sha: undefined }])
  equal(track(songs, null, new Set())?.sha, undefined)
  let pending =
    catalog(rows().filter((row) => row.entity.eid != 'blob-b')).mossvale
  equal(track(pending, 'song-b', new Set())?.id, 'song-b')
  equal(
    track(catalog(rows()).mossvale, 'song-b', new Set(['audio-b']))?.id,
    'song-a',
  )
  equal(
    track(catalog(rows()).mossvale, null, new Set(['audio-a', 'audio-b'])),
    undefined,
  )
})

test('song subscription projects the current main audio and its qualified riders', async () => {
  let { shop } = await import('../../packages/builders/testing.ts')
  let { default: vale } = await import('./vocab.json', {
    with: { type: 'json' },
  })
  let { SONGS } = await import('./music_catalog.ts')
  let { g, failed } = await shop({}, [{
    $defs: {
      song: vale.$defs.song,
      theme_design: vale.$defs.theme_design,
    },
  }])
  await g.apply([
    {
      entity: { eid: 'land' },
      theme_design: { land: 'mossvale', wild: 'meadow' },
    },
    { entity: { eid: 'song' }, song: { land: 'land', theme: 'welcome' } },
    {
      entity: { eid: 'clip' },
      artifact: { address: 'audio', media_type: 'audio/mpeg', size: 3 },
    },
    ...['main', 'shadow', 'stale'].flatMap((variant) => [
      {
        entity: { eid: `${variant}-build` },
        build: {
          for: 'song',
          variant: variant == 'shadow' ? 'shadow:x' : 'main',
          key: 'current',
          stale: variant == 'stale',
        },
      },
      {
        entity: { eid: `${variant}-output` },
        built: {
          build: `${variant}-build`,
          slot: 'main',
          key: 'current',
          artifact: 'clip',
        },
        chosen: {},
      },
    ]),
  ], { trusted: true })
  let rows: Row[] = await g.read(SONGS)
  equal(rows.map((row) => row.entity.eid).toSorted(), [
    'clip',
    'land',
    'main-build',
    'main-output',
    'song',
  ])
  equal(catalog(rows), {
    mossvale: [{ id: 'song', theme: 'welcome', sha: 'audio' }],
  })
  equal(failed, [])
})
