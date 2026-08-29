// Redaction's pure content transform and published-backup range calculation.
// Tests keep removed values out of process execution entirely.
import { docColumns, published, scrubBatch } from './redaction.ts'
import { assertEquals } from '@std/assert'

let E = 'aaaaaaaa-0000-4000-8000-000000000001'

Deno.test('scrubBatch replaces content but preserves structural values', () => {
  let secret = 'open-secret'
  let changes = [
    {
      eid: E,
      name: 'doc',
      comp: { title: secret, body: `two ${secret} values ${secret}` },
    },
    { eid: E, name: 'task', comp: { domain: secret } },
    { eid: E, name: 'comment', comp: { target: secret } },
    { eid: E, name: 'redaction', comp: { column: secret, hash: secret } },
    { eid: E, name: 'retired', comp: { target: secret } },
  ]
  let out = scrubBatch(changes, secret)
  assertEquals(out.count, 4)
  assertEquals(out.batch, [
    {
      eid: E,
      name: 'doc',
      comp: { title: '[redacted]', body: 'two [redacted] values [redacted]' },
    },
    { eid: E, name: 'task', comp: { domain: '[redacted]' } },
    { eid: E, name: 'comment', comp: { target: secret } },
    { eid: E, name: 'redaction', comp: { column: secret, hash: secret } },
    { eid: E, name: 'retired', comp: { target: secret } },
  ])
  assertEquals(docColumns(changes, E, secret), ['title', 'body'])
})

Deno.test('published finds the exact upstream range without the value', async () => {
  let calls: string[][] = []
  let run = (_root: string, args: string[]) => {
    calls.push(args)
    let out = args[0] == 'rev-parse'
      ? 'origin/main'
      : args[0] == 'rev-list'
      ? '1'
      : args.includes('--reverse')
      ? 'b\t2026-08-24T10:00:00Z'
      : 'c\t2026-08-24T11:00:00Z'
    return Promise.resolve({ success: true, stdout: out, stderr: '' })
  }
  assertEquals(await published('/data', '2026-08-24T10:00:00Z', run), {
    ref: 'origin/main',
    count: 2,
    first: { sha: 'b', at: '2026-08-24T10:00:00Z' },
    last: { sha: 'c', at: '2026-08-24T11:00:00Z' },
  })
  assertEquals(calls[1], [
    'log',
    '--format=%H%x09%cI',
    '--reverse',
    '--since=2026-08-24T09:59:59.000Z',
    "-SINSERT INTO journal VALUES('2026-08-24T10:00:00Z',",
    'origin/main',
    '--',
    ':(glob)snap/journal.sql.part.*',
  ])
  assertEquals(calls.some((args) => args.join(' ').includes('secret')), false)
})

Deno.test('published distinguishes not-yet-backed from an uncertain boundary', async () => {
  let run = (tip: string) => (_root: string, args: string[]) => {
    let out = args[0] == 'rev-parse'
      ? 'origin/main'
      : args.includes('--reverse')
      ? ''
      : tip
    return Promise.resolve({ success: true, stdout: out, stderr: '' })
  }
  assertEquals(
    await published(
      '/data',
      '2026-08-24T10:00:00Z',
      run('a\t2026-08-24T09:00:00Z'),
    ),
    { ref: 'origin/main', count: 0 },
  )
  assertEquals(
    await published(
      '/data',
      '2026-08-24T10:00:00Z',
      run('b\t2026-08-24T11:00:00Z'),
    ),
    { ref: 'origin/main' },
  )
})
