import { assertEquals } from '@std/assert'
import { safe, toolHelp, toolLines } from './show.ts'
import type { Tool } from './tool.ts'

Deno.test('content off the wire cannot speak to the terminal', () => {
  // The escape and the bell go; the printable bytes after them stay, a tab
  // becomes spaces chosen here, and a newline still means one.
  assertEquals(safe('a\x1b[31mred\x07\nb\tc'), 'a[31mred\nb  c')
  assertEquals(safe('plain'), 'plain')
})

let tools: Tool[] = [
  { name: 'app_list', title: 'Your apps' },
  { name: 'graph_query', description: 'Read this store. Filters and all.' },
]

Deno.test('a listing is a name and the one word that says what it is', () => {
  assertEquals(
    toolLines(tools),
    '  app_list     Your apps\n  graph_query  Read this store.',
  )
})

Deno.test('a tool help is its own schema, read out', () => {
  assertEquals(
    toolHelp({
      name: 'graph_query',
      description: 'Read this store.',
      inputSchema: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', description: 'the query line' },
          limit: { type: 'number', default: 50 },
          deep: { type: 'boolean' },
        },
      },
    }),
    [
      'yaks graph_query --q <string> [--limit <number>] [--deep]',
      '',
      '  Read this store.',
      '',
      '  --q      string   required  the query line',
      '  --limit  number             default 50',
      '  --deep   boolean',
    ].join('\n'),
  )
  assertEquals(
    toolHelp({ name: 'app_list' }),
    'yaks app_list\n\n  (no arguments)',
  )
})
