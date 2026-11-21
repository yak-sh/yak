import { equal, test } from '@yaks/testing'
import { browserName, placeOf } from './signed-in.ts'

let named: [string, string][] = [
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36',
    'Headless Chrome on Linux',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.0.0 Mobile/15E148 Safari/604.1',
    'Chrome on iPhone',
  ],
  [
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Safari on iPad',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
    'Edge on Windows',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Chrome on Pixel 8',
  ],
  ['yak-revoke', 'yak-revoke'],
  ['', 'A browser'],
]

test('a browser is named by what it is and the device it runs on', () => {
  for (let [agent, name] of named) equal(browserName(agent), name)
})

test('a place is its city with its state at home, or its country abroad', () => {
  equal(
    placeOf({ city: 'Portland', region: 'Oregon', country: 'US' }),
    'Portland, Oregon',
  )
  equal(placeOf({ country: 'JP' }), 'Japan')
})
