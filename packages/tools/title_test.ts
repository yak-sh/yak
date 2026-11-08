import { assertEquals } from '@std/assert'
import { did, doing, stepOf, titleOf } from './title.ts'

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
        'Stop a sandbox command',
        'Stopping a sandbox command…',
        'Stopped a sandbox command',
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

Deno.test('a call reads as its step, filled in from its arguments and the person', () => {
  let files = {
    name: 'app_files',
    title: 'Read or write app files',
    step: {
      doing: 'Working on the files of %{app}…',
      done: 'Worked on the files of %{app}',
      by: {
        op: {
          '': {
            doing: 'Writing the files of %{app}…',
            done: 'Wrote the files of %{app}',
          },
          read: { doing: 'Reading %{path}…', done: 'Read %{path}' },
        },
      },
    },
  }
  let text = {
    name: 'text_send',
    title: 'Send a text',
    step: { doing: 'Texting %{person}…', done: 'Texted %{person}' },
  }
  for (
    let [tool, args, known, running, answered] of [
      [text, {}, { person: 'Jeff' }, 'Texting Jeff…', 'Texted Jeff'],
      // A person the view does not know by name: the title, in the tense.
      [text, {}, {}, 'Sending a text…', 'Sent a text'],
      [
        files,
        { op: 'read', path: 'index.html', app: 'cake' },
        {},
        'Reading index.html…',
        'Read index.html',
      ],
      [
        files,
        { app: 'cake' },
        {},
        'Writing the files of cake…',
        'Wrote the files of cake',
      ],
      // The step its op chose names a path it was not given.
      [
        files,
        { op: 'read', app: 'cake' },
        {},
        'Working on the files of cake…',
        'Worked on the files of cake',
      ],
      [
        files,
        { op: 'read' },
        {},
        'Reading or writing app files…',
        'Read or wrote app files',
      ],
    ] as const
  ) {
    assertEquals(stepOf(tool, args, known as Record<string, string>), {
      doing: running,
      done: answered,
    })
  }
})
