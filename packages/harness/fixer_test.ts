import { Refused } from '@yaks/graph/errors'
// A heal request is routed by its provider, not by whether a CLI launched it.
import { equal, ok, test, throws } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { type Comp, identityEid } from '@yaks/graph'
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

let workspaceFixers = await (async () => {
  let results = []
  for (let available of [true, false, 'connector']) {
    let f = await fixture()
    if (!available) f.host.workspaces = undefined
    if (available == 'connector') {
      let resolve = f.host.resolveHome!
      f.host.resolveHome = async (session) => {
        let home = await resolve(session)
        await f.host.graph.apply([{
          entity: { eid: 'computer' },
          machine: { address: 'unknown://remote' },
        }])
        return home
      }
      f.host.workspaces = {
        connect: () =>
          Promise.reject(
            new Refused('Computer connector is not configured: unknown'),
          ),
      }
    }
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
          using: { provider: identityEid('provider', ['openai']) },
          content: { body: 'Fix the bug.' },
        },
      ], { trusted: true })
      for (let i = 0; i < 2; i++) {
        if (i) handlers = effects(f.host) // worker restart
        let run = () =>
          handlers.session_run(
            { entity: { eid: 'input' } } as never,
            f.host.graph,
            {} as never,
            {} as never,
          )
        if (available === true) await throws(run, 'Choose a model')
        else await run()
      }
      results.push({
        available,
        session: (await f.host.graph.get(['fixer']))[0],
        prompts: await f.host.graph.read('.entry.session=fixer&.prompt&*'),
        refusals: await f.host.graph.read('.entry.session=fixer&.refusal&*'),
      })
    } finally {
      await f.close()
    }
  }
  return results
})()

test('workspace fixer admits instructions through the host binding once', () => {
  let result = workspaceFixers[0]
  equal((result.session.home as Comp).workspace, 'checkout')
  equal(result.prompts.length, 1)
  equal((result.prompts[0].content as Comp).body, 'Preserve the task claim.\n')
  equal(result.refusals.length, 0)
})

test('unavailable workspace binding ends the fixer once across worker restart', () => {
  let result = workspaceFixers[1]
  equal((result.session.session as Comp).status, 'failed')
  equal(result.prompts.length, 0)
  equal(result.refusals.length, 1)
  equal(
    (result.refusals[0].content as Comp).body,
    'This host lends no workspace execution binding',
  )
})

test('unconfigured computer connector refuses the fixer once without going local', () => {
  let result = workspaceFixers[2]
  equal((result.session.session as Comp).status, 'failed')
  equal(result.prompts.length, 0)
  equal(result.refusals.length, 1)
  equal(
    (result.refusals[0].content as Comp).body,
    'Computer connector is not configured: unknown',
  )
})
