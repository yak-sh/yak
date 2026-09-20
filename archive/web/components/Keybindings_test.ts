// The web help door respects modes and editable controls before it reveals the
// keybinding card.
import { assertEquals } from '@std/assert'
import { mode } from '../live.ts'
import { keybindingKey, keybindingsOpen } from './Keybindings.tsx'

Deno.test('question mark shows web keybindings only from normal mode', () => {
  keybindingsOpen.value = false
  mode.value = 'insert'
  assertEquals(keybindingKey('?'), false)
  mode.value = 'normal'
  assertEquals(keybindingKey('?', false, true), false)
  assertEquals(keybindingKey('?'), true)
  assertEquals(keybindingsOpen.value, true)
  assertEquals(keybindingKey('Escape'), true)
  assertEquals(keybindingsOpen.value, false)
})
