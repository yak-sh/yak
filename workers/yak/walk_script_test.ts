import { equal, test } from '@yaks/testing'
import { plan, reading } from '@yaks/web/assets'
import { parseHTML } from 'linkedom'
import { createContext, Script } from 'node:vm'
import { ASSETS } from './assets.ts'

let names = ['carousel.js', 'walk.js']
let built = plan(
  ASSETS.filter(({ name }) => names.includes(name)),
  reading(new URL('./public/', import.meta.url).pathname),
)
let scripts = names.map((name) =>
  new Script(new TextDecoder().decode(built.files.get(built.names[name])!), {
    filename: built.names[name],
  })
)
let card = (name: string) =>
  `<article><h3 class="Card_Title">${name}</h3></article>`
let app = (name: string) =>
  `<article class="Walk_App" data-walk="${name}"><div class="Walk_Step"></div></article>`

let { document } = parseHTML(`<!doctype html><html><body>
  <section data-carousel>
    <div class="Demo_Slides">${card('Menu')}${card('Chores')}</div>
    <div class="Demo_Controls" hidden>
      <div class="Demo_Dots"></div><button class="Demo_Pause"></button>
    </div>
  </section>
  <section class="Walk">
    <nav class="Walk_Names" hidden>
      <button data-walk-name="menu"></button><button data-walk-name="chores"></button>
    </nav>
    ${app('menu')}${app('chores')}
  </section>
</body></html>`)
let waits: number[] = []
let kept = new Map<string, string>()
let context = createContext({
  document,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  addEventListener: () => {},
  setTimeout: (_fn: () => void, ms: number) => waits.push(ms),
  clearTimeout: () => {},
  localStorage: {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value),
  },
})

test('the built walk script parses and loads beside the carousel in one page', () => {
  for (let script of scripts) script.runInContext(context)
  equal(document.querySelector('.Demo_Controls')!.hasAttribute('hidden'), false)
  equal(document.querySelector('.Walk_Names')!.hasAttribute('hidden'), false)
  equal(kept.get('yak-walk'), 'menu')
  equal(waits, [6000, 9000])
})
