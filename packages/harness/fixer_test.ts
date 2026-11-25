// A heal request is routed by its provider, not by whether a CLI launched it,
// and a native fixer is the host's to isolate, not to place in a checkout.
import { equal, ok, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
import { link } from '@yaks/edge'
import { effects } from './effects.ts'
import { at, attachedWorkspace } from './testing.ts'

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
  let attached = await attachedWorkspace({ g: host.graph }, directory)
  host.workspaces = attached.workspaces
  let homes = 0
  host.resolveHome = async () => {
    homes++
    await host.graph.apply([
      { entity: { eid: 'computer' }, machine: { address: 'local://' } },
      {
        entity: { eid: 'checkout' },
        workspace: { machine: 'computer', root: directory },
      },
    ])
    return { workspace: 'checkout', cwd: directory }
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
      { entity: { eid: 'venture' }, project: {} },
      {
        entity: { eid: 'common' },
        persona: { home: 'venture' },
        doc: { title: 'Common', body: 'Fix the cause.' },
      },
      link('venture', 'contains', 'common'),
      {
        entity: { eid: 'fixer' },
        session: {},
        fixer: { bug: '55555555-5555-4555-8555-555555555555' },
        filed: { project: 'venture' },
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
      await handlers.session_run(
        { entity: { eid: 'input' } } as never,
        f.host.graph,
        {} as never,
      )
    }
    let [session] = await f.host.graph.get(['fixer'])
    return {
      session,
      homes: f.homes(),
    }
  } finally {
    await f.close()
  }
})()

test('an HTTP fixer is routed native, and works in its sandbox, never a host checkout', () => {
  ok(http.session.native)
  equal(http.session.home, undefined)
  equal(http.homes, 0)
  // Its project's persona is worn, not copied: each ask is told it afresh.
  equal((http.session.session as Comp).persona, 'common')
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
