import { assertEquals, assertThrows } from '@std/assert'
import { Usage } from './args.ts'
import { aimed } from './run.ts'
import { configPath, OWN_CONFIG } from './config.ts'

// An environment of exactly these variables. The process's own is shared by
// every test running beside this one, so none is ever set.
let envOf = (vars: Record<string, string>) => (name: string) => vars[name]

Deno.test('a line says where it runs: a config it opens, or a door it talks to', () => {
  // A home with no graph of its own, so a case that means "nothing said" is
  // not answered by the box this test runs on.
  let bare = Deno.makeTempDirSync()
  let env = envOf({ HOME: bare })
  // Nothing said: the platform this command came with.
  assertEquals(aimed({}, 'yaks.app', env), { host: 'yaks.app' })
  // A config is a file this process opens; the door comes back too, because
  // it is also the name a bearer is kept under.
  assertEquals(aimed({ config: 'yak.json' }, 'yaks.app', env), {
    config: 'yak.json',
    host: 'yaks.app',
  })
  assertEquals(aimed({ host: 'graph.test' }, 'yaks.app', env), {
    host: 'graph.test',
  })
  // Two places named is a line that means two things.
  assertThrows(
    () => aimed({ host: 'graph.test', config: 'yak.json' }, 'yaks.app', env),
    Usage,
  )
  // The environment says the same two things, and the line beats either.
  env = envOf({ YAK_CONFIG: '/srv/yak.json', HOME: bare })
  assertEquals(aimed({}, 'yaks.app', env), {
    config: '/srv/yak.json',
    host: 'yaks.app',
  })
  assertEquals(aimed({ host: 'graph.test' }, 'yaks.app', env), {
    host: 'graph.test',
  })
  // $YAKS_HOST is a graph this box cannot open, so it wins over a config it
  // did not name on the line.
  env = envOf({
    YAKS_HOST: 'graph.test',
    YAK_CONFIG: '/srv/yak.json',
    HOME: bare,
  })
  assertEquals(aimed({}, 'yaks.app', env), { host: 'graph.test' })
  assertEquals(aimed({ config: 'yak.json' }, 'yaks.app', env), {
    config: 'yak.json',
    host: 'yaks.app',
  })
  Deno.removeSync(bare)
})

Deno.test('a box that keeps a graph of its own is where a bare line runs', () => {
  let home = Deno.makeTempDirSync()
  let own = `${home}/${OWN_CONFIG}`
  let env = envOf({ HOME: home })
  // Nothing there is nothing said.
  assertEquals(configPath(undefined, env), undefined)
  assertEquals(aimed({}, 'yaks.app', env), { host: 'yaks.app' })
  Deno.mkdirSync(own.slice(0, own.lastIndexOf('/')), { recursive: true })
  Deno.writeTextFileSync(own, '{"db": "./yak.db"}')
  assertEquals(configPath(undefined, env), own)
  assertEquals(aimed({}, 'yaks.app', env), { config: own, host: 'yaks.app' })
  // And everything said still beats it.
  assertEquals(aimed({ host: 'graph.test' }, 'yaks.app', env), {
    host: 'graph.test',
  })
  assertEquals(configPath('/srv/yak.json', env), '/srv/yak.json')
  assertEquals(
    configPath(undefined, envOf({ YAK_CONFIG: '/srv/yak.json', HOME: home })),
    '/srv/yak.json',
  )
  Deno.removeSync(home, { recursive: true })
})
