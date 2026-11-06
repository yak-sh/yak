// The parts below the story: a body read as a heading's words and the pieces
// it holds, and the parts drawn from the site's graph.
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { start } from './page.ts'
import { partOf } from './parts.ts'
import { ANCHORS, SECTIONS } from './site.ts'

test('a part body is its heading words, then prose, commands, files and items', () => {
  let body = [
    'What it is.',
    '---',
    'Before.',
    '```sh\nyak init Ada\nyak task list\n```',
    '### Install',
    '```ts main.ts\nlet a = 1\n```',
    'After.',
  ].join('\n\n')
  equal(partOf(body), {
    head: 'What it is.',
    pieces: [
      { kind: 'md', text: 'Before.' },
      { kind: 'sh', lines: ['yak init Ada', 'yak task list'] },
      { kind: 'item', title: 'Install' },
      { kind: 'file', name: 'main.ts', text: 'let a = 1' },
      { kind: 'md', text: 'After.' },
    ],
  })
})

test('the page draws its parts from the graph: numbered steps, package tables, the title block', async () => {
  let dir = new URL('./', import.meta.url)
  let { document } = parseHTML(
    await Deno.readTextFile(new URL('index.html', dir)),
  )
  Object.defineProperty(document, 'baseURI', { value: dir.href })
  Object.assign(globalThis, { document })
  let root = document.querySelector('#page')!
  let page = await start(root, {
    fetch: (path) => fetch(new URL(path, dir)),
    load: () => import('./views.ts'),
    pace: { key: 0, pause: 0 },
    retry: 0,
  })
  let all = (s: string) => [...root.querySelectorAll(s)]
  equal(all('.Part .Bubble').map((b) => b.textContent), ['1', '2', '3', '4'])
  equal(
    all('#yaks-app h2')[0].textContent,
    'yaks.app hosts web apps on the same packages',
  )
  let install = SECTIONS.find((s) => ANCHORS[s.eid] == 'install')!
  equal(
    all('#install .Part_List > li h3').map((h) => h.textContent),
    [...install.body.matchAll(/^### (.+)$/gm)].map((m) => m[1]),
  )
  equal(
    all('#install .Copy code')[0].textContent?.includes('jsr:@yaks/cli'),
    true,
  )
  equal(all('#packages table').length, 4)
  equal(all('#packages .File_Bar').map((b) => b.textContent), ['main.ts'])
  equal(all('.Block dt').map((d) => d.textContent)[0], 'runs on')
  page.page.close()
})
