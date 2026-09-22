import { assertEquals, assertThrows } from '@std/assert'
import { Usage } from './args.ts'
import { aimed } from './run.ts'
import { configPath, OWN_CONFIG } from './config.ts'

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
  // A home with no graph of its own, so a case that means "nothing said" is
  // not answered by the box this test runs on.
  let bare = Deno.makeTempDirSync()
  withEnv({ YAKS_HOST: undefined, YAK_CONFIG: undefined, HOME: bare }, () => {
    // Nothing said: the platform this command came with.
    assertEquals(aimed({}), { host: 'yaks.app' })
    // A config is a file this process opens; the door comes back too, because
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
  withEnv(
    { YAKS_HOST: undefined, YAK_CONFIG: '/srv/yak.json', HOME: bare },
    () => {
      assertEquals(aimed({}), { config: '/srv/yak.json', host: 'yaks.app' })
      assertEquals(aimed({ host: 'graph.test' }), { host: 'graph.test' })
    },
  )
  // $YAKS_HOST is a graph this box cannot open, so it wins over a config it
  // did not name on the line.
  withEnv(
    { YAKS_HOST: 'graph.test', YAK_CONFIG: '/srv/yak.json', HOME: bare },
    () => {
      assertEquals(aimed({}), { host: 'graph.test' })
      assertEquals(aimed({ config: 'yak.json' }), {
        config: 'yak.json',
        host: 'yaks.app',
      })
    },
  )
  Deno.removeSync(bare)
})

Deno.test('a box that keeps a graph of its own is where a bare line runs', () => {
  let home = Deno.makeTempDirSync()
  let own = `${home}/${OWN_CONFIG}`
  withEnv({ YAKS_HOST: undefined, YAK_CONFIG: undefined, HOME: home }, () => {
    // Nothing there is nothing said.
    assertEquals(configPath(), undefined)
    assertEquals(aimed({}), { host: 'yaks.app' })
    Deno.mkdirSync(own.slice(0, own.lastIndexOf('/')), { recursive: true })
    Deno.writeTextFileSync(own, '{"db": "./yak.db"}')
    assertEquals(configPath(), own)
    assertEquals(aimed({}), { config: own, host: 'yaks.app' })
    // And everything said still beats it.
    assertEquals(aimed({ host: 'graph.test' }), { host: 'graph.test' })
    assertEquals(configPath('/srv/yak.json'), '/srv/yak.json')
  })
  withEnv({ YAK_CONFIG: '/srv/yak.json', HOME: home }, () => {
    assertEquals(configPath(), '/srv/yak.json')
  })
  Deno.removeSync(home, { recursive: true })
})
