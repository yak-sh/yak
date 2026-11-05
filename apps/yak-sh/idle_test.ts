// The logo's idle loops: each is found beside the painting the browser chose,
// and they come in an order that plays each before any comes again.
import { equal, test } from '@yaks/testing'
import { loopOf, shuffled } from './idle.ts'
import { IDLE, LOGO, painted } from './site.ts'

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
