// A person's machine behind their space's tunnel, both ends in one process:
// the machine is a host composed from the box's own packages behind its
// tunnel's filter, and the gateway between them is the stub that marks each
// request as @yaks/tunnel's own does. Ada owns the space `adas` and is the
// person whose own acts the machine takes; Bob is an editor there.
import { mint } from '@yaks/graph'
import { compose, every } from '@yaks/cli/host'
import { HEADER } from '@yaks/tunnel'
import { platform } from './directory-probe.ts'
import { directoryOf, stamp } from './directory.ts'
import type { Env } from './env.ts'

/** The machine, opening `tools` to the Operator, and the platform its
 * tunnel's space is on, named `name`. */
export let machineOf = async (name: string, tools: string[]) => {
  let ada = mint(), bob = mint()
  // The machine's own person, the persona its Operator's calls write as.
  let person = mint(), persona = mint()
  let config = {
    db: ':memory:',
    person,
    plugins: [
      '@yaks/kernel',
      '@yaks/provenance',
      '@yaks/doc',
      '@yaks/process',
      '@yaks/persona',
      '@yaks/task',
      '@yaks/session',
      '@yaks/api',
      '@yaks/mcp',
      {
        use: '@yaks/tunnel',
        with: {
          callers: {
            operator: { routes: ['/mcp'], tools, persona, owner: ada },
          },
        },
      },
    ],
  }
  let box = await compose(config, every(config))
  await box.graph.apply([
    { entity: { eid: person }, person: {}, doc: { title: 'Ada, at her box' } },
    { entity: { eid: persona }, persona: {}, doc: { title: 'the Operator' } },
  ], { trusted: true })
  let DISPATCH = {
    get: () => ({
      fetch: (r: Request) => {
        let headers = new Headers(r.headers)
        headers.set(HEADER, '1')
        return box.handler!(new Request(r, { headers }))
      },
    }),
  } as unknown as Env['DISPATCH']
  let { env } = platform(name, { DISPATCH })
  let dir = directoryOf(env.STORE)
  let eid = await dir.mint(ada, 'adas', 'Ada', {
    'x-yak-person': ada,
    'x-yak-role': 'owner',
  })
  await stamp(env, {
    entities: [{
      entity: { eid },
      tunnel: { id: mint(), service: mint(), adopted: true },
    }, {
      entity: { eid: '$seat' },
      member: { space: eid, person: bob, role: 'editor' },
    }],
  })
  let space = (await dir.at(eid))!
  return { box, env, dir, space, ada, bob, person, persona }
}
