// The app client's QR helper draws the encoded modules, including the quiet
// zone, and keeps a page's accessible label as text inside the SVG.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { encode } from 'uqr'
import { qr } from './public/client.js'

let label = 'Scan "Join" <today> & bring a friend'
let drawn = (text: string) => {
  let { document } = parseHTML(qr(text, label))
  let svg = document.querySelector('svg')!
  let size = Number(svg.getAttribute('viewBox')!.split(' ')[2])
  let data = Array.from({ length: size }, () => Array(size).fill(false))
  let path = svg.querySelector('path')!
  for (
    let run of path.getAttribute('d')!.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)
  ) {
    let [x, y, n] = run.slice(1).map(Number)
    data[y].fill(true, x, x + n)
  }
  return { svg, data }
}

for (
  let text of [
    'https://club.yaks.app/signup/?form=welcome&from=print#join',
    'sms:+18885550100?&body=JOIN%20WELCOME',
  ]
) {
  test(`the app client renders a scannable QR code for ${text}`, () => {
    let { svg, data } = drawn(text)
    equal(data, encode(text, { ecc: 'M', border: 3 }).data)
    let background = svg.querySelector('rect')!
    equal(background.getAttribute('fill'), '#fff')
    equal(background.getAttribute('width'), String(data.length))
    equal(background.getAttribute('height'), String(data.length))
    equal(svg.querySelector('path')!.getAttribute('fill'), '#000')
  })
}

test('a QR label is its accessible name without adding markup', () => {
  let { svg } = drawn('https://club.yaks.app/')
  equal(svg.getAttribute('role'), 'img')
  equal(svg.getAttribute('aria-label'), label)
  equal(svg.children.length, 2)
  ok(!svg.querySelector('today'))
})
