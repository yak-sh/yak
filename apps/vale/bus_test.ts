import { assertEquals } from '@std/assert'
import { bus } from './bus.ts'

Deno.test('sound levels resume from storage and persist independently', () => {
  let values = new Map([['mossvale.music.level', '0.35']])
  let storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
  let music = bus('music', 0.7, storage)
  let effects = bus('effects', 1, storage)
  let voice = bus('voice', 1, storage)
  assertEquals([music.level, effects.level, voice.level], [0.35, 1, 1])
  effects.set(0.4)
  voice.set(0)
  music.set(0.8)
  assertEquals(bus('effects', 1, storage).level, 0.4)
  assertEquals(bus('voice', 1, storage).level, 0)
  assertEquals(bus('music', 0.7, storage).level, 0.8)
})

Deno.test('volume controls stay between silence and full level', () => {
  let storage = {
    getItem: () => 'invalid',
    setItem: () => {},
  }
  let level = bus('effects', 0.6, storage)
  assertEquals(level.level, 0.6)
  level.set(2)
  assertEquals(level.level, 1)
  level.set(-1)
  assertEquals(level.level, 0)
  level.set(NaN)
  assertEquals(level.level, 0.6)
})
