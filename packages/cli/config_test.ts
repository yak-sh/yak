import { assertEquals, assertThrows } from '@std/assert'
import { Usage } from './args.ts'
import { aimed } from './run.ts'

// The environment is process-wide, so each case sets what it means and puts
// back what it found.
let withEnv = <T>(
  env: Record<string, string | undefined>,
  body: () => T,
): T => {
  let had = Object.fromEntries(
    Object.keys(env).map((k) => [k, Deno.env.get(k)]),
  )
  let put = (vars: Record<string, string | undefined>) => {
    for (let [k, v] of Object.entries(vars)) {
      if (v == null) Deno.env.delete(k)
      else Deno.env.set(k, v)
    }
  }
  put(env)
  try {
    return body()
  } finally {
    put(had)
  }
}

Deno.test('a line says where it runs: a config it opens, or a door it talks to', () => {
  withEnv({ YAKS_HOST: undefined, YAK_CONFIG: undefined }, () => {
    // Nothing said: the platform this command came with.
    assertEquals(aimed({}), { host: 'yaks.app' })
    // A config is a FILE this process opens; the door comes back too, because
    // it is also the name a bearer is kept under.
    assertEquals(aimed({ config: 'yak.json' }), {
      config: 'yak.json',
      host: 'yaks.app',
    })
    assertEquals(aimed({ host: 'graph.test' }), { host: 'graph.test' })
    // Two places named is a line that means two things.
    assertThrows(() => aimed({ host: 'graph.test', config: 'yak.json' }), Usage)
  })
  // The environment says the same two things, and the line beats either.
  withEnv({ YAKS_HOST: undefined, YAK_CONFIG: '/srv/yak.json' }, () => {
    assertEquals(aimed({}), { config: '/srv/yak.json', host: 'yaks.app' })
    assertEquals(aimed({ host: 'graph.test' }), { host: 'graph.test' })
  })
  // $YAKS_HOST is a graph this box cannot open, so it wins over a config it
  // did not name on the line.
  withEnv({ YAKS_HOST: 'graph.test', YAK_CONFIG: '/srv/yak.json' }, () => {
    assertEquals(aimed({}), { host: 'graph.test' })
    assertEquals(aimed({ config: 'yak.json' }), {
      config: 'yak.json',
      host: 'yaks.app',
    })
  })
})
