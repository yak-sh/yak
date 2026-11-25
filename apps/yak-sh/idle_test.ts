// The logo's idle loops: each is found beside the painting the browser chose,
// and they come in an order that plays each before any comes again.
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { loopOf, resting, shuffled } from './idle.ts'
import { IDLE, LOGO, painted } from './site.ts'

test('finishing a loop restores only the painting sources the image had', () => {
  let { document } = parseHTML(`
    <img srcset="yak.webp 320w">
    <img src="yak.webp" srcset="">
    <img src="">
  `)
  let [responsive, fixed, empty] = [...document.querySelectorAll('img')]
  for (let img of [responsive, fixed]) {
    let restore = resting(img)!
    img.removeAttribute('srcset')
    img.setAttribute('src', 'blob:loop')
    restore()
  }
  equal(
    [responsive, fixed].map((img) => [
      img.getAttribute('src'),
      img.getAttribute('srcset'),
    ]),
    [[null, 'yak.webp 320w'], ['yak.webp', null]],
  )
  equal(resting(empty), undefined)
})

test('a loop is fetched at the width of the painting the browser chose', () => {
  let widths = LOGO.split(', ').map((s) => +s.split(' ')[1].slice(0, -1))
  for (let w of widths) {
    for (let loop of Object.keys(IDLE)) {
      equal(
        loopOf(`https://yak.sh/${painted(w)}`, loop),
        `https://yak.sh/${painted(w, loop)}`,
      )
    }
  }
})

test('the loops come in an order that plays each before any repeats, never the last one twice', () => {
  let loops = Object.keys(IDLE)
  for (let seed = 0; seed < 50; seed++) {
    let n = seed
    let random = () => (n = (n * 9301 + 49297) % 233280) / 233280
    let order = shuffled(loops, 'lick', random)
    equal([[...order].sort(), order[0] != 'lick'], [[...loops].sort(), true])
  }
})
