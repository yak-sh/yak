import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { fitList } from './fit-list.ts'

test('a fitted list leaves room for the rest of the sidebar and reveals overflow on request', () => {
  let apps = Array.from(
    { length: 8 },
    (_, i) => `<a href="/app-${i + 1}">App ${i + 1}</a>`,
  ).join('')
  let { document, window } = parseHTML(
    `<aside data-fit-scroll><nav data-fit-list>${apps}
      <button data-fit-more hidden aria-expanded="false"><span data-fit-label>More</span></button>
    </nav><footer>Settings</footer></aside>`,
  )
  let view = document.querySelector<HTMLElement>('aside')!
  let list = document.querySelector<HTMLElement>('nav')!
  let footer = document.querySelector<HTMLElement>('footer')!
  let more = list.querySelector<HTMLButtonElement>('button')!
  let rows = [...list.querySelectorAll('a')]
  let height = 380
  let changed = () => {}
  let win = {
    getComputedStyle: () => ({ paddingBottom: '10px' }),
    ResizeObserver: class {
      constructor(fit: () => void) {
        changed = fit
      }
      observe() {}
      disconnect() {}
    },
  } as unknown as Parameters<typeof fitList>[1]
  let visible = () => [...rows, more].filter((row) => !row.hidden)
  let box = (bottom: number) => ({ top: 0, bottom }) as DOMRect
  Object.defineProperties(view, {
    clientHeight: { get: () => height },
    clientTop: { value: 0 },
    scrollTop: { value: 0 },
    getBoundingClientRect: { value: () => box(height) },
  })
  for (let row of [...rows, more]) {
    row.getBoundingClientRect = () => box(130 + visible().indexOf(row) * 32)
  }
  footer.getBoundingClientRect = () => box(148 + visible().length * 32)
  let stop = fitList(list, win)
  let said = () => visible().map((row) => row.textContent)
  let press = () => more.dispatchEvent(new window.Event('click'))
  assertEquals(said(), ['App 1', 'App 2', 'App 3', 'App 4', 'App 5', 'More'])
  press()
  assertEquals(said(), [...rows.map((row) => row.textContent), 'Less'])
  assertEquals(more.getAttribute('aria-expanded'), 'true')
  height = 280
  changed()
  press()
  assertEquals(said(), ['App 1', 'App 2', 'More'])
  assertEquals(more.getAttribute('aria-expanded'), 'false')
  height = 445
  changed()
  assertEquals(said(), rows.map((row) => row.textContent))
  stop()
})
