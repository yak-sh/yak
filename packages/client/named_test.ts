/// <reference lib="deno.ns" />
// How a named client says trouble nobody else hears: what the page tracker
// captures (console.error) and what it leaves be (console.warn).
import { equal, test } from '@yaks/testing'
import { said } from './named.ts'

let level = (trouble: Parameters<typeof said>[0]) => {
  let { error, warn } = console
  let heard: string[] = []
  console.error = () => void heard.push('error')
  console.warn = () => void heard.push('warn')
  try {
    said(trouble)
  } finally {
    Object.assign(console, { error, warn })
  }
  return heard
}

let sent = [{ entity: { eid: 'a' } }]

test('a refused write is an error, an unknown outcome a warning', () => {
  let refused = { error: 'Refused', message: 'no' }
  equal(level({ sent, refused, reverted: true }), ['error'])
  equal(level({ sent, error: new Error('offline'), reverted: false }), ['warn'])
  equal(level({ sent: [], error: new Error('bad line'), reverted: false }), [
    'error',
  ])
  equal(level({ sent, reverted: false }), [])
})
