import { parseHTML } from 'linkedom'
import { equal, test } from '@yaks/testing'
import { sending } from './sending.ts'

// A page of forms; `send` submits one by its button and draws the next frame,
// answering which elements wait.
let page = () => {
  let { window, document } = parseHTML(`<html><body>
    <form id="post" method="post"><button id="go">Go</button></form>
    <form id="tab" target="_blank"><button id="away">Away</button></form>
    <form id="close" method="dialog"><button id="shut">Close</button></form>
    <form id="own"><button id="mine">Mine</button></form>
  </body></html>`)
  let frames: (() => void)[] = []
  let win = Object.assign(window, {
    requestAnimationFrame: (run: () => void) => frames.push(run),
  })
  document.getElementById('own')!.addEventListener(
    'submit',
    (e: Event) => e.preventDefault(),
  )
  sending(win as unknown as typeof globalThis)
  let busy = () =>
    [...document.querySelectorAll('[aria-busy]')].map((e: Element) => e.id)
  let send = (button: string) => {
    let by = document.getElementById(button)!
    let e = new window.Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'submitter', { value: by })
    by.closest('form')!.dispatchEvent(e)
    for (let run of frames.splice(0)) run()
    return busy()
  }
  let back = (persisted: boolean) => {
    let e = new window.Event('pageshow')
    Object.defineProperty(e, 'persisted', { value: persisted })
    window.dispatchEvent(e)
    return busy()
  }
  return { send, back }
}

test('a form the browser sends shows its button waiting in the next frame', () => {
  let p = page()
  equal(
    ['away', 'shut', 'mine', 'go'].map(p.send),
    [[], [], [], ['go']],
  )
  equal([p.back(false), p.back(true)], [['go'], []])
})
