import { assertEquals } from '@std/assert'
import { did, doing, titleOf } from './title.ts'

Deno.test('a title is said in the tense of the call', () => {
  for (
    let [title, running, answered] of [
      ['List app versions', 'Listing app versions…', 'Listed app versions'],
      [
        'Read or write app files',
        'Reading or writing app files…',
        'Read or wrote app files',
      ],
      [
        'Rename, move or reshare an app',
        'Renaming, moving or resharing an app…',
        'Renamed, moved or reshared an app',
      ],
      [
        'Stop a build command',
        'Stopping a build command…',
        'Stopped a build command',
      ],
      ['Retry a write', 'Retrying a write…', 'Retried a write'],
      ['Run code', 'Running code…', 'Ran code'],
      ['Graph schema', 'Graph schema…', 'Graph schema'],
    ]
  ) {
    assertEquals([doing(title), did(title)], [running, answered])
  }
})

Deno.test('a tool without a title is its name in words', () => {
  assertEquals(titleOf({ name: 'graph_schema' }), 'Graph schema')
  assertEquals(
    titleOf({ name: 'app_files', title: 'Read or write app files' }),
    'Read or write app files',
  )
})
