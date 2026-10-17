// A heal request is routed by its provider, not by whether a CLI launched it.
import { equal, ok, test, throws } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
import { processProvider } from '@yaks/process/machine'
import { effects } from './effects.ts'
import { at } from './testing.ts'

let fixture = async () => {
  let directory = await Deno.makeTempDir({ prefix: 'native-fixer-' })
  await Deno.writeTextFile(
    directory + '/AGENTS.md',
    'Preserve the task claim.\n',
  )
  let config = at()
  let host = await compose(
    {
      ...config,
      plugins: [...config.plugins!, '@yaks/heal'],
    },
    ['graph'],
    undefined,
  )
  let provider = processProvider(host.graph, { dir: directory + '/machines' })
  let homes = 0
  host.machines = {
    defaultProvider: 'process',
    provider: (name) =>
      Promise.resolve(name == 'process' ? provider : undefined),
    resolveHome: async () => {
      homes++
      await host.graph.apply([{
        entity: { eid: 'fixer-machine' },
        machine: { provider: 'process', address: directory, state: 'running' },
      }])
      return { machine: 'fixer-machine', cwd: directory }
    },
  }
  return {
    host,
    directory,
    homes: () => homes,
    close: async () => {
      await host.close()
      await Deno.remove(directory, { recursive: true })
    },
  }
}

let http = await (async () => {
  let f = await fixture()
  let handlers = effects(f.host)
  try {
    await f.host.graph.apply([
      {
        entity: { eid: identityEid('provider', ['openai']) },
        provider: { name: 'openai' },
      },
      {
        entity: { eid: 'fixer' },
        session: {},
        fixer: { bug: '55555555-5555-4555-8555-555555555555' },
      },
      {
        entity: { eid: 'input' },
        entry: { session: 'fixer' },
        using: {
          provider: identityEid('provider', ['openai']),
          effort: 'high',
        },
        content: { body: 'Resolve the bug last.' },
      },
    ], { trusted: true })
    for (let i = 0; i < 2; i++) {
      // No default model is installed, so preparation is tested without a
      // paid ask. The integration probe exercises the complete runner.
      await throws(() =>
        handlers.session_run(
          { entity: { eid: 'input' } } as never,
          f.host.graph,
          {} as never,
          {} as never,
        ), 'Choose a model')
    }
    let [session] = await f.host.graph.get(['fixer'])
    return {
      session,
      homes: f.homes(),
      directory: f.directory,
      prompts: await f.host.graph.read('.entry.session=fixer&.prompt&*'),
    }
  } finally {
    await f.close()
  }
})()

test('HTTP fixer routing admits a native home and immutable instructions once', () => {
  ok(http.session.native)
  equal((http.session.home as Comp).cwd, http.directory)
  equal(http.homes, 1)
  equal(http.prompts.length, 1)
  equal((http.prompts[0].content as Comp).body, 'Preserve the task claim.\n')
  equal(http.session.process, undefined)
})

let managed = await (async () => {
  let f = await fixture()
  let handlers = effects(f.host)
  try {
    await f.host.graph.apply([
      {
        entity: { eid: identityEid('provider', ['claude']) },
        provider: { name: 'claude', transport: 'process' },
      },
      {
        entity: { eid: 'managed' },
        session: {},
        fixer: { bug: '55555555-5555-4555-8555-555555555555' },
      },
      {
        entity: { eid: 'input' },
        entry: { session: 'managed' },
        using: { provider: identityEid('provider', ['claude']) },
        content: { body: 'existing Claude run' },
      },
    ], { trusted: true })
    await handlers.session_run(
      { entity: { eid: 'input' } } as never,
      f.host.graph,
      {} as never,
      {} as never,
    )
    let [session] = await f.host.graph.get(['managed'])
    return { session, homes: f.homes() }
  } finally {
    await f.close()
  }
})()

test('a managed Claude fixer is left with its original runner and no native home', () => {
  equal(managed.session.native, undefined)
  equal(managed.session.home, undefined)
  equal(managed.homes, 0)
})
