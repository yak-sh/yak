// A graph-native Session's durable bodies must PAINT in the terminal. The fake
// DOM drops the shared Markdown door's dangerouslySetInnerHTML, so without the
// terminal painter an agent's say body renders blank — the ordered rows show,
// the words don't. This mounts the shared entry renderer through the fake DOM
// (the very seam the web and TUI share) and asserts the bodies paint, while the
// control-char boundary still neutralizes anything a body tries to speak.
import './dom.ts' // installs the fake document — before anything renders
import { render } from 'preact'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { TElement } from './dom.ts'
import { Md } from './md.tsx'
import { onMarkdown } from '../components/Markdown.tsx'
// Entity.tsx before Entry.tsx: the two form the registry's render cycle, and
// entering it from Entity's side lets Entry finish initializing first (the same
// order Session_test.tsx relies on).
import '../components/Entity.tsx'
import { EntryBody, type EntryLine } from '../components/views/Entry.tsx'
import { ansi, pane } from './paint.ts'

// The same injection tui/main.tsx makes at boot: the one markdown door paints
// through Md instead of the HTML the fake DOM can't honor.
onMarkdown((text, repo, inline) => (
  <Md text={text} repo={repo ?? undefined} inline={inline} />
))

// The whole tree as the terminal would receive it — every line, status
// included, so a body sitting on the last line is never mistaken for chrome.
let painted = (...entries: EntryLine[]) => {
  let root = new TElement('root')
  render(
    <div>{entries.map((x) => <EntryBody key={x.seq} x={x} />)}</div>,
    root as unknown as Parameters<typeof render>[1],
  )
  let { lines, status } = pane(root)
  return [...lines, status].map(ansi).join('\n')
}

let say = (role: 'agent' | 'user', text: string): EntryLine => ({
  seq: 1,
  line: '{}',
  row: { kind: 'say', role, text },
})

Deno.test('the shared Session partition paints its bodies in the terminal', () => {
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

Deno.test('a Session body cannot speak ANSI to the terminal', () => {
  // A body carrying an OSC 52 clipboard write must reach the terminal defanged:
  // the escape stripped, only the inert text left.
  let out = painted(say('agent', 'oops \x1b]52;c;QQ==\x07 done'))
  assertEquals(out.includes('\x1b]52'), false)
  assertStringIncludes(out, ']52;c;QQ==')
  assertStringIncludes(out, 'done')
})
