import { clock, equal, test, until } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { createElement as h } from 'react'
import { act } from '@yaks/react/testing'
import { render } from '@yaks/react/draw'
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
  let time = clock()
  let asked: string[] = []
  let shown: string[] = []
  let find = (line: string) => (asked.push(line), Promise.resolve([line]))
  let Picker = ({ line }: { line: string }) => {
    shown = useHits(line, 8, find, 150, time)
    return null
  }
  // preact renders into the document it finds global, and runs effects on
  // the next turn, as a browser's next frame would.
  let { document } = parseHTML('<main></main>')
  let root = document.querySelector('main')!
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  using _ = {
    [Symbol.dispose]: () => {
      render(null, root)
      delete (globalThis as { document?: unknown }).document
    },
  }
  let draw = async (line: string, ms: number) => {
    await act(() => render(h(Picker, { line }), root))
    await act(() => time.advance(ms))
  }
  await draw('a *', 100)
  await draw('ab *', 149)
  equal(asked, [])
  await act(() => time.advance(1))
  equal(asked, ['ab *'])
  await until(() => shown[0] === 'ab *')
  equal(shown, ['ab *'])
  await draw('', 150)
  await until(() => shown.length === 0)
  equal([asked, shown], [['ab *'], []])
})
