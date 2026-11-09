import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { project } from './project.ts'

for (let source of [undefined, 'ask']) {
  for (let anchor of [undefined, 'ask']) {
    test(`replay calls and results (source: ${source}, anchor: ${anchor})`, () => {
      let entries = [
        {
          entity: { eid: 'call' },
          call: {
            to: 'echo',
            id: 'item_0',
            args: {},
            ...source ? { source } : {},
          },
        },
        {
          entity: { eid: 'result' },
          result: { call: 'call' },
          content: { body: 'done' },
        },
      ]
      let items = project(entries, entries, new Map(), { anchor })
      assertEquals(items, [
        ...anchor && source == anchor ? [] : [{
          kind: 'call' as const,
          id: 'item_0',
          name: 'tool',
          args: '{}',
        }],
        { kind: 'result', id: 'item_0', output: 'From the tool:\ndone' },
      ])
    })
  }
}
