// The web tray hotkey respects normal mode, editable controls, and browser
// shortcuts before it toggles the tray state.
import { assertEquals } from '@std/assert'
import { mode } from '../live.ts'
import { trayKey, trayOpen } from './Tray.tsx'

Deno.test('t opens and closes the tray only from normal mode', () => {
  trayOpen.value = false
  mode.value = 'insert'
  assertEquals(trayKey('t'), false)
  mode.value = 'normal'
  assertEquals(trayKey('t', false, true), false)
  assertEquals(trayKey('t', true), false)
  assertEquals(trayKey('t', false, false, true), false)
  assertEquals(trayKey('x'), false)
  assertEquals(trayKey('t'), true)
  assertEquals(trayOpen.value, true)
  assertEquals(trayKey('t'), true)
  assertEquals(trayOpen.value, false)
})
