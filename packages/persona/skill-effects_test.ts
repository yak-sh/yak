import { test, until } from '@yaks/testing'
import { assert, assertEquals, assertIsError, assertRejects } from '@std/assert'
import { derivedEid, type Graph } from '@yaks/graph'
import { held, take, until as stopped } from '@yaks/effects'
import { effectDoc } from '@yaks/effects/vocab'
import { loadVocab } from '@yaks/vocab'
import { dirname, join, resolve } from 'node:path'
import { localFilesystem, repositoryEid } from '@yaks/git/host'
import { run } from '@yaks/git/land'
import { repoSkills } from './skills.ts'
import { skillEffects, type SkillRuntime } from './skill-effects.ts'
import { world } from './testing.ts'

let host = crypto.randomUUID()
let other = crypto.randomUUID()

let report = () => ({
  read: [],
  wrote: [],
  removed: [],
  conflicts: [],
  failed: [],
})
let deferred = () => {
  let resolve!: () => void
  let promise = new Promise<void>((done) => resolve = done)
  return { promise, resolve }
}
let invoke = (
  handlers: ReturnType<typeof skillEffects>,
  name = 'skill_files',
) => (handlers[name] as () => Promise<void>)()
let exists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path)
    return true
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}
let graph = world()
let fixture = (
  runtime: SkillRuntime = {},
  stopping?: AbortSignal,
  db?: string,
) =>
  skillEffects({ graph, stopping, config: { db } }, { skills: true }, {
    roots: () => Promise.resolve(['/repo']),
    sync: () => Promise.resolve(report()),
    ...runtime,
  })
let leased = loadVocab([{
  $defs: {
    entity: { component: true, type: 'object' },
    lease: effectDoc.$defs!.lease,
  },
}])
let leasedGraph = (): Graph => world(leased)

test('skill effects require their independent explicit opt-in', () => {
  let graph = world()
  assertEquals(skillEffects({ graph }), {})
  assertEquals(skillEffects({ graph }, { skills: false }), {})
  assertEquals(
    skillEffects({ graph }, { files: true } as { skills?: boolean }),
    {},
  )
  assertEquals(Object.keys(fixture()).sort(), ['skill_files', 'skill_watch'])
})

test('skill effects await failure, share burst rejection, and retry later', async () => {
  let entered = deferred()
  let release = deferred()
  let attempts = 0
  let problem = new Error('unexpected mirror failure')
  let fx = fixture(
    {
      sync: async () => {
        attempts++
        if (attempts == 1) {
          entered.resolve()
          await release.promise
          throw problem
        }
        return report()
      },
    },
    undefined,
    '/virtual/state.db',
  )
  let first = invoke(fx)
  await entered.promise
  let burst = Array.from({ length: 100 }, () => invoke(fx))
  assert(burst.every((promise) => promise == first))
  let observed = Promise.allSettled([first, ...burst])
  release.resolve()
  let failures = await observed
  assert(failures.every((r) => r.status == 'rejected' && r.reason === problem))
  assertEquals(attempts, 1)
  await invoke(fx)
  assertEquals(attempts, 2)
})

test('skill effects serialize and coalesce events into one trailing pass', async () => {
  let entered = deferred()
  let release = deferred()
  let calls = 0
  let running = 0
  let maximum = 0
  let fx = fixture({
    sync: async () => {
      running++
      maximum = Math.max(maximum, running)
      calls++
      if (calls == 1) {
        entered.resolve()
        await release.promise
      }
      running--
      return report()
    },
  })
  let first = invoke(fx)
  // Events before the first queued pass starts owe no redundant work.
  let early = invoke(fx)
  assert(first == early)
  await entered.promise
  let burst = Array.from({ length: 250 }, () => invoke(fx))
  assert(burst.every((promise) => promise == first))
  release.resolve()
  await Promise.all([first, early, ...burst])
  assertEquals(calls, 2)
  assertEquals(maximum, 1)
})

// The persistent mirror's directory and first pass exist before another event.
let persistentDir = await Deno.makeTempDir({ prefix: 'skill-effects-db-' })
let persistentSeen: string[] = []
let persistentRoots = ['/one', '/two']
let persistentEffects = skillEffects(
  { graph, config: { db: join(persistentDir, 'state.db') } },
  { skills: true },
  {
    roots: () => Promise.resolve(persistentRoots),
    sync: (_g, _root, path) => {
      persistentSeen.push(path)
      return Promise.resolve(report())
    },
  },
)
await invoke(persistentEffects)
await Deno.mkdir(dirname(persistentSeen[0]), { recursive: true })
await Deno.writeTextFile(persistentSeen[0], '{}')

test('skill effects use stable DB-adjacent per-absolute-root memo paths', async () => {
  try {
    await invoke(persistentEffects)
    assertEquals(
      persistentSeen,
      [...persistentRoots, ...persistentRoots].map((root) =>
        join(
          persistentDir,
          'mirror',
          'skills',
          `${derivedEid(`skills|${root}`)}.json`,
        )
      ),
    )
    assert(await exists(persistentSeen[0]))
  } finally {
    await Deno.remove(persistentDir, { recursive: true })
  }
})

test('skill effects resolve a relative configured DB to an absolute memo path', async () => {
  let path = ''
  let fx = skillEffects(
    { graph: world(), config: { db: 'relative/state.db' } },
    {
      skills: true,
    },
    {
      roots: () => Promise.resolve(['/repo']),
      sync: (_g, _root, memory) => {
        path = memory
        return Promise.resolve(report())
      },
    },
  )
  await invoke(fx)
  assertEquals(
    path,
    join(
      resolve('relative'),
      'mirror',
      'skills',
      `${derivedEid('skills|/repo')}.json`,
    ),
  )
})

test('skill effects preserve temporary memo bytes between handler calls and failures', async () => {
  let paths: string[] = []
  let problem = new Error('after remembering')
  let fx = fixture({
    sync: async (_g, _root, path) => {
      paths.push(path)
      if (paths.length == 1) {
        assert(!await exists(path))
        await Deno.writeTextFile(path, '{"agreement":"raw and rendered"}\n')
      } else {
        assertEquals(
          await Deno.readTextFile(path),
          paths.length == 2
            ? '{"agreement":"raw and rendered"}\n'
            : '{"agreement":"after failure"}\n',
        )
        if (paths.length == 2) {
          await Deno.writeTextFile(path, '{"agreement":"after failure"}\n')
          throw problem
        }
      }
      return report()
    },
  })
  await invoke(fx)
  assert(!await exists(dirname(paths[0])))
  await assertRejects(() => invoke(fx), Error, 'after remembering')
  assert(!await exists(dirname(paths[1])))
  await invoke(fx)
  assert(!await exists(dirname(paths[2])))
  assertEquals(new Set(paths.map(dirname)).size, 3)
})

test('skill effects coalesce an event arriving during temporary cleanup', async () => {
  let entered = deferred()
  let release = deferred()
  let path = ''
  let calls = 0
  let read = Deno.readTextFile
  let fx = fixture({
    sync: async (_g, _root, memory) => {
      calls++
      path = memory
      await Deno.writeTextFile(memory, '{}')
      return report()
    },
  })
  Deno.readTextFile = async (file, options) => {
    if (file == path && calls == 1) {
      entered.resolve()
      await release.promise
    }
    return await read(file, options)
  }
  try {
    let first = invoke(fx)
    await entered.promise
    let event = invoke(fx)
    assert(event == first)
    release.resolve()
    await Promise.all([first, event])
    assertEquals(calls, 2)
    assert(!await exists(dirname(path)))
  } finally {
    release.resolve()
    Deno.readTextFile = read
  }
})

let removedMemoCalls = 0
let removedMemoBytes: string | undefined
let removedMemoAbsent = false
let removedMemoEffects = fixture({
  sync: async (_g, _root, memory) => {
    removedMemoCalls++
    if (removedMemoCalls == 1) await Deno.writeTextFile(memory, 'agreement')
    else if (removedMemoCalls == 2) {
      removedMemoBytes = await Deno.readTextFile(memory)
      await Deno.remove(memory)
    } else removedMemoAbsent = !await exists(memory)
    return report()
  },
})
await invoke(removedMemoEffects)
await invoke(removedMemoEffects)

test('skill effects do not restore a deliberately removed temporary memo', async () => {
  assertEquals(removedMemoBytes, 'agreement')
  await invoke(removedMemoEffects)
  assert(removedMemoAbsent)
  assertEquals(removedMemoCalls, 3)
})

test('skill effects await cleanup errors, remove their directory, and allow retry', async () => {
  let path = ''
  let read = Deno.readTextFile
  let problem = new Error('memo read failed')
  let fx = fixture({
    sync: async (_g, _root, memory) => {
      path = memory
      await Deno.writeTextFile(memory, '{}')
      return report()
    },
  })
  Deno.readTextFile = (file, options) =>
    file == path ? Promise.reject(problem) : read(file, options)
  try {
    await assertRejects(() => invoke(fx), Error, 'memo read failed')
    assert(!await exists(dirname(path)))
  } finally {
    Deno.readTextFile = read
  }
  await invoke(fx)
  assert(!await exists(dirname(path)))
})

// Resolve both memory-host configurations while the environment names a DB,
// then restore the environment before any other case runs.
let environmentDir = await Deno.makeTempDir({ prefix: 'skill-effects-env-' })
let priorDB = Deno.env.get('DB_PATH')
let environmentPaths: string[] = []
let environmentCleaned: boolean[] = []
let environmentMirrorAbsent = false
Deno.env.set('DB_PATH', join(environmentDir, 'forbidden.db'))
try {
  for (let config of [undefined, { db: ':memory:' }]) {
    let path = ''
    let fx = skillEffects({ graph, config }, { skills: true }, {
      roots: () => Promise.resolve(['/repo']),
      sync: async (_g, _root, memory) => {
        path = memory
        await Deno.mkdir(dirname(memory), { recursive: true })
        await Deno.writeTextFile(memory, '{}')
        return report()
      },
    })
    await invoke(fx)
    environmentPaths.push(path)
    environmentCleaned.push(!await exists(dirname(path)))
  }
  environmentMirrorAbsent = !await exists(join(environmentDir, 'mirror'))
} finally {
  if (priorDB == undefined) Deno.env.delete('DB_PATH')
  else Deno.env.set('DB_PATH', priorDB)
  await Deno.remove(environmentDir, { recursive: true })
}

test('skill effects memory DB never uses the environment DB fallback', () => {
  for (let [index, path] of environmentPaths.entries()) {
    assert(!path.startsWith(environmentDir))
    assert(path.endsWith(`${derivedEid('skills|/repo')}.json`))
    assert(environmentCleaned[index])
  }
  assert(environmentMirrorAbsent)
})

test('skill watcher reconciles at startup, polls, and cleans on shutdown', async () => {
  let stop = new AbortController()
  let sleeping: (() => void)[] = []
  let paths: string[] = []
  let polls: number[] = []
  let fx = fixture({
    poll: 17,
    sync: async (_g, _root, memory) => {
      paths.push(memory)
      await Deno.writeTextFile(memory, '{}')
      return report()
    },
    pause: (ms, signal) => {
      polls.push(ms)
      let wake = deferred()
      sleeping.push(wake.resolve)
      return Promise.race([wake.promise, stopped(signal!)])
    },
  }, stop.signal)
  let watcher = invoke(fx, 'skill_watch')
  assert(watcher == invoke(fx, 'skill_watch'))
  await until(() => sleeping.length == 1)
  assertEquals(paths.length, 1)
  assert(await exists(dirname(paths[0])))
  sleeping[0]()
  await until(() => sleeping.length == 2)
  assertEquals(paths.length, 2)
  assertEquals(paths[0], paths[1])
  assertEquals(polls, [17, 17])
  stop.abort()
  await watcher
  assert(!await exists(dirname(paths[0])))
  await invoke(fx)
  assertEquals(paths.length, 2)
})

// Prepare the completed failed startup and retry; assertions inspect both
// outcomes and the bytes the production cleanup retained between them.
let failedWatcherPaths: string[] = []
let failedWatcherPauses = 0
let restoredWatcherBytes: string | undefined
let failedWatcherStop = new AbortController()
let failedWatcher = fixture({
  sync: async (_g, _root, memory) => {
    failedWatcherPaths.push(memory)
    if (failedWatcherPaths.length > 1) {
      restoredWatcherBytes = await Deno.readTextFile(memory)
    }
    await Deno.writeTextFile(memory, 'remembered')
    return report()
  },
  pause: () => {
    if (++failedWatcherPauses == 1) {
      return Promise.reject(new Error('poll failure'))
    }
    failedWatcherStop.abort()
    return Promise.resolve()
  },
}, failedWatcherStop.signal)
let watcherFailure = await invoke(failedWatcher, 'skill_watch').then(
  () => undefined,
  (error: unknown) => error,
)
let failedWatcherCleaned = !await exists(dirname(failedWatcherPaths[0]))
let watcherRetry = await invoke(failedWatcher, 'skill_watch').then(
  () => undefined,
  (error: unknown) => error,
)
let retriedWatcherCleaned = !await exists(dirname(failedWatcherPaths[1]))

test('skill watcher failure is awaited, cleans, and retains agreement for retry', () => {
  assertIsError(watcherFailure, Error, 'poll failure')
  assert(failedWatcherCleaned)
  assertEquals(watcherRetry, undefined)
  assertEquals(restoredWatcherBytes, 'remembered')
  assertEquals(failedWatcherPaths.length, 2)
  assert(retriedWatcherCleaned)
})

test('skill watcher one-shot host reconciles and cleans before returning', async () => {
  let path = ''
  let fx = fixture({
    sync: async (_g, _root, memory) => {
      path = memory
      await Deno.writeTextFile(memory, '{}')
      return report()
    },
    pause: () => {
      throw new Error('one-shot must not poll')
    },
  })
  await invoke(fx, 'skill_watch')
  assert(path)
  assert(!await exists(dirname(path)))
})

test('skill shutdown waits for an in-flight pass before cleaning its memo', async () => {
  let stop = new AbortController()
  let entered = deferred()
  let release = deferred()
  let path = ''
  let fx = fixture({
    sync: async (_g, _root, memory) => {
      path = memory
      await Deno.writeTextFile(memory, '{}')
      entered.resolve()
      await release.promise
      assert(await exists(memory))
      return report()
    },
  }, stop.signal)
  let watcher = invoke(fx, 'skill_watch')
  await entered.promise
  let event = invoke(fx)
  stop.abort()
  assert(await exists(path))
  release.resolve()
  await Promise.all([watcher, event])
  assert(!await exists(dirname(path)))
})

test('skill effects hold separate watcher and per-pass graph leases', async () => {
  let graph = leasedGraph()
  let stop = new AbortController()
  let entered = deferred()
  let release = deferred()
  let fx = skillEffects({ graph, me: host, stopping: stop.signal }, {
    skills: true,
  }, {
    roots: () => Promise.resolve(['/repo']),
    sync: async () => {
      entered.resolve()
      await release.promise
      return report()
    },
    pause: (_ms, signal) => stopped(signal!),
  })
  let watcher = invoke(fx, 'skill_watch')
  await entered.promise
  assertEquals((await held(graph, '@yaks/persona/skill_watch'))?.holder, host)
  assertEquals((await held(graph, '@yaks/persona/skill_files'))?.holder, host)
  assertEquals(
    await take(graph, '@yaks/persona/skill_watch', {
      holder: other,
    }),
    false,
  )
  assertEquals(
    await take(graph, '@yaks/persona/skill_files', {
      holder: other,
    }),
    false,
  )
  release.resolve()
  await until(async () =>
    (await held(graph, '@yaks/persona/skill_files'))?.holder === undefined
  )
  assertEquals((await held(graph, '@yaks/persona/skill_watch'))?.holder, host)
  stop.abort()
  await watcher
  assertEquals(
    (await held(graph, '@yaks/persona/skill_watch'))?.holder,
    undefined,
  )
})

test('skill effects leave a contended singleton watcher to its current holder', async () => {
  let graph = leasedGraph()
  await take(graph, '@yaks/persona/skill_watch', { holder: other })
  let calls = 0
  let fx = skillEffects({ graph, me: host }, { skills: true }, {
    roots: () => Promise.resolve(['/repo']),
    sync: () => {
      calls++
      return Promise.resolve(report())
    },
  })
  await invoke(fx, 'skill_watch')
  assertEquals(calls, 0)
  assertEquals(
    (await held(graph, '@yaks/persona/skill_watch'))?.holder,
    other,
  )
})

test('skill lease acquisition errors propagate through the awaited watcher', async () => {
  let graph = leasedGraph()
  let problem = new Error('store unavailable')
  graph.get = () => {
    throw problem
  }
  let fx = skillEffects({
    graph,
    me: host,
    stopping: new AbortController().signal,
  }, {
    skills: true,
  }, {
    roots: () => {
      throw new Error('must not run')
    },
  })
  await assertRejects(
    () => invoke(fx, 'skill_watch'),
    Error,
    'store unavailable',
  )
})

test('skill per-pass lease release errors reject the awaited effect and retry', async () => {
  let graph = leasedGraph()
  let apply = graph.apply.bind(graph)
  let fail = true
  graph.apply = (bundles, ...rest) => {
    if (
      fail &&
      bundles.some((bundle) =>
        (bundle.lease as { holder?: string | null } | undefined)?.holder ===
          null
      )
    ) {
      return Promise.reject(new Error('lease release failed'))
    }
    return apply(bundles, ...rest)
  }
  let calls = 0
  let fx = skillEffects({ graph, me: host }, { skills: true }, {
    roots: () => Promise.resolve(['/repo']),
    sync: () => {
      calls++
      return Promise.resolve(report())
    },
  })
  await assertRejects(() => invoke(fx), Error, 'lease release failed')
  fail = false
  await invoke(fx)
  assertEquals(calls, 2)
  assertEquals(
    (await held(graph, '@yaks/persona/skill_files'))?.holder,
    undefined,
  )
})

test('skill effects real temp Git and RAM graph preserve import/export agreement', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'skill-effects-git-' })
  let root = join(dir, 'main')
  let git = async (...args: string[]) => {
    let result = await run(args, root)
    assert(result.ok, result.err)
    return result.out.trim()
  }
  try {
    await Deno.mkdir(join(root, '.claude/skills/sample'), { recursive: true })
    await git('init', '-b', 'main')
    await git('config', 'user.name', 'Test')
    await git('config', 'user.email', 'test@example.com')
    let path = join(root, '.claude/skills/sample/SKILL.md')
    await Deno.writeTextFile(
      path,
      '---\nname: sample\ndescription: Useful\n---\nOriginal\n',
    )
    await git('add', '.')
    await git('commit', '-m', 'Initial')
    let graph = world()
    let repository = repositoryEid(
      join(root, '.git'),
      (await localFilesystem(graph)).entity.eid,
    )
    await graph.apply([{
      entity: { eid: repository },
      repository: { common: join(root, '.git') },
    }])
    let fx = skillEffects({ graph }, { skills: true }, {
      roots: () => Promise.resolve([root]),
    })
    await invoke(fx)
    let [skill] = await repoSkills(graph, repository)
    assert(skill)
    await graph.apply([{
      entity: { eid: skill.entity.eid },
      content: { body: 'Exported\n' },
    }])
    await invoke(fx)
    assert((await Deno.readTextFile(path)).endsWith('Exported\n'))
    assertEquals(await git('status', '--porcelain'), '')
    await invoke(fx)
    assertEquals((await repoSkills(graph, repository))[0].entity, skill.entity)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
