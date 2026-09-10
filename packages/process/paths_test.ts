import { assertEquals } from '@std/assert'
import { dirOf } from './run.ts'

Deno.test('process files honor TASKS_HOME below explicit directory overrides', () => {
  let values: Record<string, string> = { HOME: '/owner' }
  let env = (key: string) => values[key]
  assertEquals(dirOf({}, env), '/owner/.tasks/processes')
  values.TASKS_HOME = '/probe'
  assertEquals(dirOf({}, env), '/probe/processes')
  values.PROCESS_DIR = '/processes'
  assertEquals(dirOf({}, env), '/processes')
  assertEquals(dirOf({ dir: '/explicit' }, env), '/explicit')
  delete values.PROCESS_DIR
  values.TASKS_HOME = ''
  assertEquals(dirOf({}, env), '/owner/.tasks/processes')
})
