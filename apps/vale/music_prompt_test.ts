// A prompt is available for both songs in every playable land.
import { assert, assertEquals, assertThrows } from '@std/assert'
import { LEVELS } from './levels.ts'
import { musicPrompt } from './music_prompt.ts'

Deno.test('each land gives its songs a distinct direction', () => {
  assertEquals(Object.keys(LEVELS).length, 40)
  for (let id of Object.keys(LEVELS)) {
    let first = musicPrompt(id, 1)
    let second = musicPrompt(id, 2)
    assert(first.includes(LEVELS[id].name))
    assert(first.includes('song 1 of two'))
    assert(second.includes('song 2 of two'))
    assert(first != second)
  }
})

Deno.test('voices follow the land', () => {
  assert(musicPrompt('tombsands', 1).includes('Wordless choir voices'))
  assert(musicPrompt('elderglade', 1).includes('solo wordless voice'))
  assert(musicPrompt('cinderreach', 1).includes('Wordless choir voices'))
  assert(musicPrompt('mossvale', 1).includes('no human voice'))
  assert(!musicPrompt('mossvale', 1).includes('Wordless choir voices'))
  assertThrows(() => musicPrompt('unknown', 1), Error, 'No music direction')
})
