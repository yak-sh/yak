import { assertEquals } from '@std/assert'
import { mode } from '../live.ts'
import {
  navigationKey,
  navigationOpen,
  toggleNavigation,
} from './Navigation.tsx'

Deno.test('n toggles web navigation only from unmodified normal mode', () => {
  toggleNavigation(false)
  mode.value = 'insert'
  assertEquals(navigationKey('n'), false)
  mode.value = 'normal'
  assertEquals(navigationKey('n', true), false)
  assertEquals(navigationKey('n', false, true), false)
  assertEquals(navigationKey('n', false, false, true), false)
  assertEquals(navigationKey('x'), false)
  assertEquals(navigationKey('n'), true)
  assertEquals(navigationOpen.value, true)
  assertEquals(navigationKey('n'), true)
  assertEquals(navigationOpen.value, false)
})
