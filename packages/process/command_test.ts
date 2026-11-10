// A signal sent to a child is only a signal: its IPC channel stays open.
import { execPath } from 'node:process'
import { equal, test, throws } from '@yaks/testing'
import { command } from './command.ts'

// Says `up` once listening, then what it heard: the signal, and whether its
// channel to this parent closed before it ended.
let CHILD = `
import process from 'node:process'
let heard = []
process.once('disconnect', () => heard.push('disconnect'))
process.on('SIGTERM', () => setTimeout(() => {
  console.log(['SIGTERM', ...heard].join(' '))
  process.exit(143)
}, 50))
console.log('up')
setInterval(() => {}, 1000)
`

test('a child tied over IPC drains on a forwarded signal', async () => {
  let child = command(execPath, {
    args: ['eval', CHILD],
    stdout: 'piped',
    ipc: true,
  }).spawn()
  let lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  equal((await lines.read()).value?.trim(), 'up')
  child.kill('SIGTERM')
  let said = ''
  for (let r = await lines.read(); !r.done; r = await lines.read()) {
    said += r.value
  }
  equal([said.trim(), (await child.status).code], ['SIGTERM', 143])
})

// Starts a child that would run for a minute, with every stream piped,
// unrefs it, and says its pid.
let PARENT = `
import { command } from ${
  JSON.stringify(new URL('./command.ts', import.meta.url).href)
}
let child = command('sleep', {
  args: ['60'],
  stdin: 'piped',
  stdout: 'piped',
  stderr: 'piped',
}).spawn()
await child.started
child.unref()
console.log(child.pid)
`

test("a parent exits past an unref'd child, its pipes included", async () => {
  let out = await command(execPath, { args: ['eval', PARENT] }).output()
  let pid = Number(new TextDecoder().decode(out.stdout))
  Deno.kill(pid, 'SIGKILL')
  equal(out.code, 0)
})

test('a missing program is refused as it starts', async () => {
  let child = command('/nonexistent/program', { stdin: 'piped' }).spawn()
  await throws(() => child.started, 'ENOENT')
  await throws(() => child.status, 'ENOENT')
})
