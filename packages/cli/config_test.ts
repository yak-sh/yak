import { assertEquals } from '@std/assert'
import { doorOf, hostOf } from './config.ts'
import { hostFor } from './run.ts'

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

Deno.test('a config says one address, and serve and the client read it alike', () => {
  assertEquals(doorOf({}), 'http://127.0.0.1:8787')
  assertEquals(doorOf({ port: 9000 }), 'http://127.0.0.1:9000')
  assertEquals(doorOf({ hostname: 'graph.local' }), 'http://graph.local:8787')
  // An interface a host BINDS is everything here; as an address to talk to,
  // that is this box.
  assertEquals(doorOf({ hostname: '0.0.0.0', port: 1 }), 'http://127.0.0.1:1')
  assertEquals(doorOf({ hostname: '::1', port: 1 }), 'http://[::1]:1')
})

Deno.test('a line says where it is aimed; a config says it when the line does not', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let path = `${dir}/yak.json`
    Deno.writeTextFileSync(path, JSON.stringify({ db: ':memory:', port: 9 }))
    withEnv({ YAKS_HOST: undefined, YAK_CONFIG: undefined }, () => {
      assertEquals(hostOf(path), 'http://127.0.0.1:9')
      assertEquals(hostOf(), undefined)
      assertEquals(hostFor({}), 'yaks.app')
      assertEquals(hostFor({ config: path }), 'http://127.0.0.1:9')
      // What the line said wins over everything.
      assertEquals(hostFor({ host: 'yaks.app', config: path }), 'yaks.app')
    })
    // $YAK_CONFIG is the config nobody named; $YAKS_HOST still wins over it.
    withEnv({ YAKS_HOST: undefined, YAK_CONFIG: path }, () => {
      assertEquals(hostFor({}), 'http://127.0.0.1:9')
    })
    withEnv({ YAKS_HOST: 'graph.test', YAK_CONFIG: path }, () => {
      assertEquals(hostFor({}), 'graph.test')
    })
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
