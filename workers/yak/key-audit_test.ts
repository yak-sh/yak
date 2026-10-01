import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle } from '@yaks/graph'
import { keyed } from '@yaks/key'
import { buildOf, outputOf } from '@yaks/builders'
import { auditRows, keys, pages } from './key-audit.ts'
import { KERNEL } from './meta.ts'

test('the audit checks keys without changing complete or malformed evidence', () => {
  let rows: Bundle[] = [
    {
      entity: { eid: 'build' },
      build: { builder: 'builder', match: '["input"]', variant: 'main' },
    },
    { entity: { eid: 'output' }, built: { build: 'build', slot: 'main' } },
    keyed('build_of', 'build', buildOf('builder', '["input"]')),
    keyed('output_of', 'output', outputOf('build')),
  ]
  let before = JSON.stringify(rows)
  assertEquals(keys(rows).counts, {
    build: 1,
    built: 1,
    build_of: 1,
    output_of: 1,
  })
  assertEquals(keys(rows).issues, [])
  assertEquals(JSON.stringify(rows), before)
  let malformed: Bundle[] = [
    {
      entity: { eid: '9ebb31ac-46ee-8458-85e6-a1725bfdcb9f' },
      build: { builder: 'builder' },
      doc: { body: 'evidence' },
      created: { via: 'call' },
    },
    {
      entity: { eid: '8693d7a4-4d42-8fa1-b662-c36c0ac30b06' },
      built: { slot: 'main' },
      created: { via: 'other' },
    },
    keyed('build_of', 'absent', 'orphan'),
  ]
  let audit = keys(malformed)
  assertEquals(audit.issues.map((issue) => issue.code), [
    'malformed_build',
    'malformed_built',
    'orphan_key',
    'unexpected_key',
  ])
  assertEquals(audit.issues[0].row, malformed[0])
  assertEquals(audit.issues[1].row, malformed[1])
  let wrong = rows.map((row) =>
    row.build_of ? { ...row, key: { of: 'output', value: 'wrong' } } : row
  )
  assertEquals(keys(wrong).issues.map((issue) => issue.code), [
    'wrong_key',
    'wrong_key_eid',
    'orphan_key',
    'unexpected_key',
  ])
})

test('the audit walks past 1000 and short pages with the graph cursor and kernel', async () => {
  let rows: Bundle[] = Array.from(
    { length: 1207 },
    (_, n) => ({
      entity: { eid: `row-${n}` },
      build: { builder: 'builder', match: '[]' },
    }),
  )
  let calls = 0
  let door = {
    consume: async <T>(
      path: string,
      read: (response: Response) => T | Promise<T>,
      init?: RequestInit | Request,
      headers?: Record<string, string>,
    ): Promise<T> => {
      calls++
      assertEquals(init?.method, 'GET')
      assertEquals(headers, KERNEL)
      let q = new URL(`https://store${path}`).searchParams.get('q')!
      let after = /\.after=(row-\d+)/.exec(q)?.[1]
      let at = after ? rows.findIndex((row) => row.entity.eid == after) + 1 : 0
      // Even a short page is not proof of exhaustion.
      return await read(Response.json(rows.slice(at, at + 73)))
    },
  }
  assertEquals(await pages(door), rows)
  assertEquals(calls, 18)
})

test('audit scans only its four components and deduplicates owners', async () => {
  let calls: string[] = []
  let same: Bundle = {
    entity: { eid: 'same' },
    build: { builder: 'builder', match: '[]' },
    built: { build: 'same', slot: 'main' },
  }
  let door = {
    consume: async <T>(
      path: string,
      read: (r: Response) => T | Promise<T>,
    ): Promise<T> => {
      let q = new URL(`https://store${path}`).searchParams.get('q')!
      calls.push(q)
      return await read(
        Response.json(
          q.includes('.after=')
            ? []
            : q.startsWith('.build&') || q.startsWith('.built&')
            ? [same]
            : [],
        ),
      )
    },
  }
  assertEquals(await auditRows(door), [same])
  assertEquals(calls.some((q) => q.startsWith('.entity')), false)
  assertEquals(
    calls.filter((q) => !q.includes('.after=')).map((q) => q.split('&')[0]),
    ['.build', '.built', '.build_of', '.output_of'],
  )
})
