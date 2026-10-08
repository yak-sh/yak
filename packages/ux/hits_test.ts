import { equal, test } from '@yaks/testing'
import { FakeTime } from '@std/testing/time'
import { parseHTML } from 'linkedom'
import { h, options, render } from 'preact'
import { parse } from '@yaks/query'
import { pickLine, useHits } from './hits.ts'

// Every line a picker sends must parse: the trap is a presence filter with a
// trailing term ('.person ali'), which the grammar refuses.
test('a picker line always parses', () => {
  for (
    let [q, comp] of [
      ['T-3'],
      [''],
      ['ali', 'person'],
      ['', 'person'],
      ['widget line', 'task'],
      ['.task.status=open', 'task'],
    ]
  ) parse(pickLine(q, comp))
})

// A picker asks once its line rests, and only for the newest line: a line
// changed before `settle` passes is never asked, and an empty one clears.
test('a picker asks find once the line rests, for the newest line only', async () => {
  using time = new FakeTime()
  let asked: string[] = []
  let shown: string[] = []
  let find = (line: string) => (asked.push(line), Promise.resolve([line]))
  let Picker = ({ line }: { line: string }) => {
    shown = useHits(line, 8, find, 150)
    return null
  }
  // preact renders into the document it finds global, and runs effects on
  // the next turn, as a browser's next frame would.
  let { document } = parseHTML('<main></main>')
  let root = document.querySelector('main')!
  let raf = options.requestAnimationFrame
  options.requestAnimationFrame = (f) => setTimeout(f)
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  using _ = {
    [Symbol.dispose]: () => {
      render(null, root)
      delete (globalThis as { document?: unknown }).document
      options.requestAnimationFrame = raf
    },
  }
  let draw = (line: string, ms: number) => {
    render(h(Picker, { line }), root)
    time.tick(ms)
  }
  draw('a *', 100)
  draw('ab *', 149)
  equal(asked, [])
  time.tick(1)
  equal(asked, ['ab *'])
  await time.runMicrotasks()
  equal(shown, ['ab *'])
  draw('', 150)
  await time.runMicrotasks()
  equal([asked, shown], [['ab *'], []])
})
