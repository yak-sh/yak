import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { mount } from './main.js'

let html = await Deno.readTextFile(new URL('./index.html', import.meta.url))
let fixture = () => {
  let { document, window } = parseHTML(html)
  let run, stopped = 0
  let app = mount(document, {
    setInterval: (fn) => {
      run = fn
      return 1
    },
    clearInterval: () => stopped++,
  })
  let get = (selector) => document.querySelector(selector)
  let click = (id) => get('#' + id).click()
  return {
    document,
    window,
    app,
    get,
    click,
    tick: () => run(),
    stopped: () => stopped,
  }
}

test('controls show original action receipts, finish, reset, and switch middleware behavior', () => {
  let { get, click, window } = fixture()
  click('start')
  ok(get('[data-receipt="left"]').textContent.includes('held'))
  ok(get('[data-receipt="right"]').textContent.includes('unchanged'))
  for (let i = 0; i < 5; i++) click('step')
  equal(get('[data-status="right"]').textContent, 'Upload complete')
  ok(get('#step').disabled)
  click('reset')
  equal(get('[data-total="right"]').textContent, '0')
  let select = get('#mode')
  select.querySelector('option[value="observe"]').selected = true
  select.dispatchEvent(new window.Event('change'))
  click('start')
  ok(get('[data-receipt="left"]').textContent.includes('unchanged'))
  equal(
    get('[data-state="left"]').textContent,
    get('[data-state="right"]').textContent,
  )
  ok(get('#store-code').textContent.includes('reduce(state, action)'))
})

test('walkthrough pauses, resumes, and stops at completion', () => {
  let { click, tick, get, stopped, app } = fixture()
  click('play')
  tick()
  equal(get('#clock').textContent, 'Tick 1 / 5')
  click('play')
  equal(stopped(), 1)
  ok(!get('#step').disabled)
  click('play')
  for (let i = 0; i < 4; i++) tick()
  equal(stopped(), 2)
  ok(get('#play').disabled)
  equal(get('[data-status="left"]').textContent, 'Upload complete')
  app.stop()
})
