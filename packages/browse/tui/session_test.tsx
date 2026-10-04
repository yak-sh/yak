import { domainBundle } from '../domain-host.tsx'
import '../domain-host.tsx'
// A graph-native Session's durable bodies must PAINT in the terminal. The fake
// DOM drops the shared Markdown door's dangerouslySetInnerHTML, so without the
// terminal painter an agent's say body renders blank — the ordered rows show,
// the words don't. This mounts the shared entry renderer through the fake DOM
// (the very seam the web and TUI share) and asserts the bodies paint, while the
// control-char boundary still neutralizes anything a body tries to speak.
import { test } from '@yaks/testing'
import '../testing.ts' // learns the vocabulary
import './doc.ts' // installs the fake document — before anything renders
import { render } from 'preact'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { ansi, TElement } from '@yaks/tui'
import { Md } from './md.tsx'
import { onMarkdown } from '../components/Markdown.tsx'
// Entity.tsx before Entry.tsx: the two form the registry's render cycle, and
// entering it from Entity's side lets Entry finish initializing first (the same
// order Session_test.tsx relies on).
import '../components/Entity.tsx'
import { EntryBody, type EntryLine } from '../components/views/Entry.tsx'
import { pane } from './paint.ts'
import { Branches } from '@yaks/kernel/Comments'
import { cache, ent } from '../live.ts'

// The same injection tui/main.tsx makes at boot: the one markdown door paints
// through Md instead of the HTML the fake DOM can't honor.
onMarkdown((text, repo, inline) => (
  <Md text={text} repo={repo ?? undefined} inline={inline} />
))

// The whole tree as the terminal would receive it — every line, status
// included, so a body sitting on the last line is never mistaken for chrome.
let paintedLines = (...entries: EntryLine[]) => {
  let root = new TElement('root')
  render(
    <div>{entries.map((x) => <EntryBody key={x.seq} x={x} />)}</div>,
    root as unknown as Parameters<typeof render>[1],
  )
  let { lines, status } = pane(root)
  return [...lines, status]
}

let painted = (...entries: EntryLine[]) =>
  paintedLines(...entries).map(ansi).join('\n')

let say = (role: 'agent' | 'user', text: string): EntryLine => ({
  seq: 1,
  line: '{}',
  row: { kind: 'say', role, text },
})

test('the shared Session partition paints its bodies in the terminal', () => {
  let out = painted(
    say('user', 'run the tests'),
    {
      seq: 2,
      line: '{}',
      row: { kind: 'exec', command: 'deno task test', exit: 0 },
    },
    say('agent', 'done — **all** green'),
  )
  // the user ask, the command, and — the bug — the durable agent body
  assertStringIncludes(out, 'run the tests')
  assertStringIncludes(out, 'deno task test')
  assertStringIncludes(out, 'done —')
  assertStringIncludes(out, 'all') // the **bold** word, dressed not dropped
  assertStringIncludes(out, 'green')
})

test('a Session body cannot speak ANSI to the terminal', () => {
  // A body carrying an OSC 52 clipboard write must reach the terminal defanged:
  // the escape stripped, only the inert text left.
  let out = painted(say('agent', 'oops \x1b]52;c;QQ==\x07 done'))
  assertEquals(out.includes('\x1b]52'), false)
  assertStringIncludes(out, ']52;c;QQ==')
  assertStringIncludes(out, 'done')
})

test('terminal prose says which words are a person and which are a model', () => {
  let plain = paintedLines(
    say('user', 'human words'),
    say('agent', 'model words'),
  )
    .map((line) => line.map((span) => span.text).join(''))
    .join('\n')
  assertStringIncludes(plain, 'person\n')
  assertStringIncludes(plain, 'model\n')
  assertEquals(plain.indexOf('person') < plain.indexOf('human words'), true)
  assertEquals(plain.indexOf('model\n') < plain.indexOf('model words'), true)
})

test('comment replies paint as nested branches in the terminal', () => {
  cache.value = {
    ask: {
      entity: { eid: 'ask', num: 1 },
      comment: { eid: 'ask', target: 'task' },
      doc: { eid: 'ask', title: '', body: 'Choose one' },
    },
    other: {
      entity: { eid: 'other', num: 2 },
      comment: { eid: 'other', target: 'task' },
      doc: { eid: 'other', title: '', body: 'Separate update' },
    },
    answer: {
      entity: { eid: 'answer', num: 3 },
      comment: { eid: 'answer', target: 'task', reply_to: 'ask' },
      doc: { eid: 'answer', title: '', body: 'First one' },
    },
  }
  let root = new TElement('root')
  try {
    render(
      <Branches rows={['ask', 'other', 'answer'].map(ent).map(domainBundle)} />,
      root as unknown as Parameters<typeof render>[1],
    )
    let { lines, status } = pane(root)
    let plain = [...lines, status].map((line) =>
      line.map((s) => s.text).join('')
    )
    assertEquals(plain.some((line) => line.startsWith('  First one')), true)
    let out = plain.join('\n')
    assertEquals(
      out.indexOf('First one') < out.indexOf('Separate update'),
      true,
    )
  } finally {
    render(null, root as unknown as Parameters<typeof render>[1])
    cache.value = {}
  }
})
