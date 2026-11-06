import { equal, test } from '@yaks/testing'
import { configOf, socket } from './connect.ts'
import { bearerOf } from './wire.ts'

let YAKS = {
  name: 'yaks.app',
  origin: 'https://yaks.app',
  socket: 'wss://yaks.app/manage/{space}/operator?browser=1',
}

test('the socket is the configured door for the space, with the token beside yaks', () => {
  let { url, protocols } = socket(YAKS, { token: 'tok:en/1', space: 'jeff' })
  equal(url, 'wss://yaks.app/manage/jeff/operator?browser=1')
  equal(protocols[0], 'yaks')
  equal(bearerOf(protocols.join(', ')), 'tok:en/1')
})

test('a configuration is read from JSON, or said to be wrong', () => {
  equal(configOf({ ...YAKS, description: 'Hi.' }), {
    ...YAKS,
    description: 'Hi.',
  })
  equal(configOf({ name: 'x' }), 'It needs an `origin`.')
  equal(
    configOf({ name: 'x', origin: 'https://x.dev' }),
    'It needs a `socket`, a ws(s) address with `{space}` in it.',
  )
  equal(
    configOf({ name: 'x', origin: 'https://x.dev/app' }),
    'Its origin is written https://x.dev, with no path.',
  )
  equal(configOf([]), 'It needs a `name`.')
})
