// The command line leaves before an intent can synchronously rerender it.
import { assertEquals } from '@std/assert'
import { submit } from './Status.tsx'

Deno.test('submitting leaves command mode before graph writes can rerender it', () => {
  let seen: string[] = []

  submit('fix the bug', () => seen.push('leave'), () => seen.push('execute'))

  assertEquals(seen, ['leave', 'execute'])
})
