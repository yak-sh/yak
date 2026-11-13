// A parent's channel ending is independent of terminal input and process ids.
import { EventEmitter } from 'node:events'
import { equal, test } from '@yaks/testing'
import { disconnected } from './system.ts'

test('a child stays attached until its parent channel closes', async () => {
  let source = Object.assign(new EventEmitter(), { connected: true })
  let closed = false
  let ended = disconnected(source).then(() => closed = true)
  await Promise.resolve()
  equal(closed, false)
  source.connected = false
  source.emit('disconnect')
  await ended
  equal(closed, true)
  equal(source.listenerCount('disconnect'), 0)
})

test('a child notices a parent channel that closed before it listened', async () => {
  let source = Object.assign(new EventEmitter(), { connected: false })
  await disconnected(source)
  equal(source.listenerCount('disconnect'), 0)
})

// A child whose main module meets one rejection and prints what mainFailed
// answers of it: its own top-level await, or a promise nobody held.
let answers = async (body: string) => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(
      `${dir}/main.ts`,
      `import { mainFailed } from ${
        JSON.stringify(import.meta.resolve('./system.ts'))
      }
addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  void mainFailed(e.reason).then((own) => console.log(e.reason.message, own))
})
${body}`,
    )
    let out = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-q', '--no-config', `${dir}/main.ts`],
      stdout: 'piped',
    }).output()
    return new TextDecoder().decode(out.stdout).trim().split('\n')
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

test("a main module's failed top-level await is its own, a stray is not", async () => {
  equal(
    await answers(`void Promise.reject(new Error('stray'))
await new Promise((done) => setTimeout(done, 100))
await Promise.reject(new SyntaxError('own'))`),
    ['stray false', 'own true'],
  )
})
