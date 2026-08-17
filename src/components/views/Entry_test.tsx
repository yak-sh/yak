// Entry renderer tests hold specialization, truncation, and the expanded
// view picker without a server or session transcript.
import { h, render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { type Ent } from '../../types.ts'
import { cache, ent } from '../../live.ts'
import { resolve } from '../Entity.tsx'
import {
  CommandFull,
  CommandSummary,
  EntryBody,
  EntryLens,
  EntrySummary,
  mergeTools,
  MessageSummary,
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
    render(h(resolve(command, 'Entry.Summary').Render, { e: command }), root)
    assertEquals(
      [...root.querySelectorAll('.Entry_Line')].map((x) => x.textContent),
      ['printf one', 'one'],
    )
    assertEquals(
      root.querySelector('.Entry_Line-command')?.textContent,
      'printf one',
    )
    assertEquals(root.querySelector('.Entry_More')?.textContent, '…')

    let result = ent(answer)
    render(h(resolve(result, 'Entry.Summary').Render, { e: result }), root)
    assertEquals(root.querySelector('.Entry_Line')?.textContent, 'one')
    assertEquals(root.querySelector('.Entry-fail'), null)
  }))

Deno.test('generic entry summaries are metadata variants', () =>
  withDom((root) => {
    let e = {
      eid: '00000000-0000-4000-8000-000000000004',
      entry: { session: '00000000-0000-4000-8000-000000000001', seq: 3 },
      attention: {},
    } as Ent
    render(<EntrySummary e={e} />, root)
    assertEquals(root.querySelector('.Entry-meta')?.textContent, 'attention')
    assertEquals(root.querySelector('.Entry_Meta'), null)
  }))

Deno.test('message summaries preserve who spoke', () =>
  withDom((root) => {
    let e = {
      eid: '00000000-0000-4000-8000-000000000004',
      message: { role: 'user' },
      content: { body: 'hello' },
    } as Ent
    render(<MessageSummary e={e} />, root)
    assertEquals(root.querySelector('.Entry-user')?.textContent.trim(), 'hello')
  }))

Deno.test('normalized tools and shell calls share compact entry rows', () =>
  withDom((root) => {
    render(
      <EntryBody
        x={{
          seq: 1,
          line: '',
          row: { kind: 'tool', name: 'Read', detail: 'src/query.ts' },
        }}
      />,
      root,
    )
    assertEquals(root.querySelector('.Entry_Name')?.textContent, 'Read')
    assertEquals(root.querySelector('.Entry_Line')?.textContent, 'src/query.ts')
    assertEquals(root.querySelector('.Entry-pending') != null, true)

    render(
      <EntryBody
        x={{
          seq: 2,
          line: '',
          row: { kind: 'exec', command: 'deno task check', desc: 'Command' },
        }}
      />,
      root,
    )
    assertEquals(root.querySelector('.Entry_Name')?.textContent, '$')
    assertEquals(
      root.querySelector('.Entry_Line-command')?.textContent,
      'deno task check',
    )
    assertEquals(root.querySelector('.Entry-pending') != null, true)
  }))

Deno.test('tool results settle their call row instead of adding a row', () => {
  rows()
  let [call, answer] = Object.keys(cache.value)
  let merged = mergeTools([
    {
      eid: call,
      seq: 1,
      line: '{}',
      row: { kind: 'exec', command: 'printf one' },
    },
    {
      eid: answer,
      call,
      seq: 2,
      line: '{}',
      row: { kind: 'tool', name: '↳ shell', ok: true },
    },
  ])
  assertEquals(merged, [{
    eid: call,
    result: answer,
    seq: 1,
    line: '{}',
    row: { kind: 'exec', command: 'printf one', exit: 0 },
  }])
  cache.value = {}
})

Deno.test('normalized user messages render as entry markdown', () =>
  withDom((root) => {
    render(
      <EntryBody
        x={{
          seq: 1,
          line: '',
          row: { kind: 'say', role: 'user', text: '**hello**' },
        }}
      />,
      root,
    )
    assertEquals(root.querySelector('.Entry-user strong')?.textContent, 'hello')
  }))

Deno.test('expanded entries offer only specifically rendered faces', () =>
  withDom((root) => {
    rows()
    let [, answer] = Object.keys(cache.value)
    render(h(EntryLens, { eid: answer }), root)
    let tabs = [...root.querySelectorAll<HTMLButtonElement>('.Entry_Tabs .Tab')]
    assertEquals(tabs.map((tab) => tab.getAttribute('aria-label')), [
      'Full',
      'JSON',
      'Debug',
    ])
    assertEquals(root.querySelector('.Entry_Output')?.textContent, 'one\ntwo')
    assertEquals(
      [...root.querySelectorAll('.Entry_PartName')].map((x) => x.textContent),
      ['call', 'result'],
    )
    assertEquals(root.querySelector('.Entry_Err-fail'), null)
    let result = ent(answer)
    render(h(resolve(result, 'Entry.JSON').Render, { e: result }), root)
    assertEquals(
      root.querySelector('.Json')?.textContent.includes('warning'),
      true,
    )
    render(h(resolve(result, 'Entry.Debug').Render, { e: result }), root)
    assertEquals(root.querySelector('.Debug_Props') != null, true)
  }))
