// Entry renderer tests hold specialization, truncation, and the expanded
// view picker without a server or session transcript.
import { h, render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
import { resolve } from '../Entity.tsx'
import {
  CommandFull,
  CommandSummary,
  EntryLens,
  ResultFull,
  ResultSummary,
} from './Entry.tsx'

let withDom = (run: (root: HTMLElement) => void) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main') as HTMLElement
  try {
    run(root)
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
}

let rows = () => {
  let session = '00000000-0000-4000-8000-000000000001'
  let call = '00000000-0000-4000-8000-000000000002'
  let answer = '00000000-0000-4000-8000-000000000003'
  cache.value = {
    [call]: {
      entity: { eid: call, num: 1 },
      entry: { eid: call, session, seq: 1 },
      call: { eid: call, key: 'call' },
      bash: { eid: call, command: 'printf one\nprintf two' },
    },
    [answer]: {
      entity: { eid: answer, num: 2 },
      entry: { eid: answer, session, seq: 2 },
      result: { eid: answer, call },
      content: { eid: answer, body: 'one\ntwo' },
      stderr: { eid: answer, text: 'warning\nmore' },
      exit: { eid: answer, code: 0 },
    },
  }
}

Deno.test('entry registry specializes command and result faces', () => {
  rows()
  let [call, answer] = Object.keys(cache.value)
  assertEquals(resolve(ent(call), 'Entry.Summary').Render, CommandSummary)
  assertEquals(resolve(ent(call), 'Entry.Full').Render, CommandFull)
  assertEquals(resolve(ent(answer), 'Entry.Summary').Render, ResultSummary)
  assertEquals(resolve(ent(answer), 'Entry.Full').Render, ResultFull)
  assertEquals(resolve(ent(answer), 'Entry.Debug').view, 'Entry.Debug')
  cache.value = {}
})

Deno.test('command and output summaries show one line and a more control', () =>
  withDom((root) => {
    rows()
    let [call, answer] = Object.keys(cache.value)
    let command = ent(call)
    render(resolve(command, 'Entry.Summary').Render({ e: command }), root)
    assertEquals(
      [...root.querySelectorAll('.Entry_Line')].map((x) => x.textContent),
      ['printf one', 'one'],
    )
    assertEquals(root.querySelector('.Entry_More')?.textContent, '…')

    let result = ent(answer)
    render(resolve(result, 'Entry.Summary').Render({ e: result }), root)
    assertEquals(root.querySelector('.Entry_Line')?.textContent, 'one')
    assertEquals(root.querySelector('.Entry-fail'), null)
  }))

Deno.test('expanded entries offer full, MD, JSON, and Debug faces', () =>
  withDom((root) => {
    rows()
    let [, answer] = Object.keys(cache.value)
    render(h(EntryLens, { eid: answer }), root)
    let tabs = [...root.querySelectorAll<HTMLButtonElement>('.Entry_Tabs .Tab')]
    assertEquals(tabs.map((tab) => tab.getAttribute('aria-label')), [
      'Full',
      'MD',
      'JSON',
      'Debug',
    ])
    assertEquals(root.querySelector('.Entry_Output')?.textContent, 'one\ntwo')
    assertEquals(root.querySelector('.Entry_Err-fail'), null)
    let result = ent(answer)
    render(resolve(result, 'Entry.JSON').Render({ e: result }), root)
    assertEquals(
      root.querySelector('.Json')?.textContent.includes('warning'),
      true,
    )
    render(resolve(result, 'Entry.Debug').Render({ e: result }), root)
    assertEquals(root.querySelector('.Debug_Props') != null, true)
  }))
