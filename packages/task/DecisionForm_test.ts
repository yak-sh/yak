import { test, tick, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { signal } from '@preact/signals'
import { parseHTML } from 'linkedom'
import { type Bundle, type Comp, graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernel, kernelDoc, kernelKeywords } from '@yaks/kernel'
import { desk, draftDoc, drafts } from '@yaks/draft'
import { docDoc } from '@yaks/doc'
import { taskDoc } from './comp.ts'
import { tasks } from './plugin.ts'
import { answerPlace, DecisionForm } from './DecisionForm.ts'

let question: Bundle = {
  entity: { eid: 'ask' },
  task: {},
  decision: {
    question: 'Which route?',
    choices: [
      { label: 'Train', description: 'Arrive earlier' },
      { label: 'Bus', description: 'Spend less' },
    ],
    recommended: 'Train',
  },
}

let form = async () => {
  let vocab = loadVocab([kernelDoc, taskDoc, draftDoc, docDoc], [
    kernelKeywords,
  ])
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [kernel(), tasks(), drafts()],
  })
  await g.apply([question, {
    entity: { eid: 'reader' },
    doc: { title: 'Reader' },
  }])
  let words = desk({
    mutate: (b) => g.apply(signed(b, { by: 'reader' })),
    watch: () => signal([]),
  }, { by: () => 'reader', pace: 0 })
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let mount = (e = question) =>
    render(
      h(DecisionForm, {
        e,
        drafts: words,
        apply: (b) => g.apply(signed(b, { by: 'reader' })),
        name: () => 'Reader',
        blocking: true,
      }),
      root,
    )
  let row = () => (g.get(['ask']) as Bundle[])[0]
  let type = (text: string) => {
    let field = root.querySelector('input')!
    field.value = text
    field.dispatchEvent(
      new document.defaultView!.Event('input', { bubbles: true }),
    )
  }
  let free = () => {
    render(null, root)
    words.close()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
  mount()
  return { root, words, mount, row, type, free }
}

test('the decision form shows recommendations, answers as its reader, and keeps unused drafts', async () => {
  let f = await form()
  try {
    assertEquals(f.root.textContent?.includes('Trainrecommended'), true)
    assertEquals(f.root.textContent?.includes('Arrive earlier'), true)
    f.type('Walk together')
    render(null, f.root)
    f.mount()
    assertEquals(f.root.querySelector('input')!.value, 'Walk together')
    f.root.querySelectorAll('button')[1].click()
    await until(() => !!f.row().decided)
    assertEquals((f.row().decided as Comp).choice, 'Bus')
    assertEquals((f.row().decided as Comp).by, 'reader')
    assertEquals(f.words.text(answerPlace('ask')), 'Walk together')
    f.mount(f.row())
    assertEquals(
      f.root.textContent?.includes('Answered: Bus · by Reader'),
      true,
    )
  } finally {
    f.free()
  }
})

test('a custom answer spends its draft with the answer, while a refused answer keeps it', async () => {
  let f = await form()
  try {
    f.type('Walk together')
    await tick()
    f.mount()
    f.root.querySelector('form')!.dispatchEvent(
      new document.defaultView!.Event('submit', {
        bubbles: true,
        cancelable: true,
      }),
    )
    await until(() => !!f.row().decided)
    assertEquals((f.row().decided as Comp).choice, 'Walk together')
    assertEquals((f.row().completed as Comp).by, 'reader')
    await until(() => f.words.text(answerPlace('ask')) == '')
    f.type('Another answer')
    await tick()
    f.mount()
    f.root.querySelectorAll('button')[2].click()
    await until(() => f.words.text(answerPlace('ask')) == 'Another answer')
    assertEquals((f.row().decided as Comp).choice, 'Walk together')
  } finally {
    f.free()
  }
})
