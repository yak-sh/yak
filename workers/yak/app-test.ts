// Bind app tests to the deploy compiler and one private branch of the app's
// store. The Dynamic Worker gets the branch's query and apply operations.
import { type Evaluate, HOSTED_LIMITS } from '@yaks/code-mode'
import { mint } from '@yaks/graph'
import {
  testPaths,
  testProgram,
  type TestResult,
} from '@yaks/platform/app-tests'
import { CallError } from '@yaks/tools/errors'
import { appStore } from './directory.ts'
import { compileEntry } from './esbuild.ts'
import { r2RawObjects } from './lib/objects.ts'
import { branches, branchWords } from './preview.ts'
import { vouched } from './session.ts'
import { APP, inApp, refuse, runOf, SPACE, str } from './tool.ts'
import type { Row } from './tool-words.ts'
import { anew, drafting, draftsOf, selecting } from './written.ts'
import { configured } from './deploy_worker.ts'

let bridgeFor = (
  store: ReturnType<typeof appStore>,
  headers: Record<string, string>,
  signal: AbortSignal,
): Parameters<Evaluate>[1] => ({
  read: () =>
    Promise.reject(
      refuse('arguments', 'app_test supplies store.query and store.apply'),
    ),
  call: async (set, name, json) => {
    signal.throwIfAborted()
    if (
      set != 'store' || !['query', 'apply'].includes(name) ||
      json.length > HOSTED_LIMITS.scriptBytes
    ) {
      throw refuse(
        'arguments',
        'A test store call takes a query or bundles up to 64 KiB',
      )
    }
    let { q, entities } = JSON.parse(json)
    let init = name == 'apply'
      ? { method: 'POST', body: JSON.stringify(entities), signal }
      : { signal }
    if (name == 'query' && typeof q != 'string') {
      throw refuse('arguments', 'store.query takes a query string')
    }
    let path = name == 'query'
      ? '/query?' + new URLSearchParams({ q })
      : '/apply'
    return await store.consume(
      path,
      async (response) => {
        if (response.ok) {
          return {
            content: [],
            structuredContent: { result: await response.json() },
          }
        }
        let text = await response.text()
        return { content: [{ type: 'text', text }], isError: true }
      },
      init,
      headers,
    )
  },
})

export let appTest: Row = {
  name: 'app_test',
  destructive: false,
  role: 'editor',
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      draft: str('An open draft id. Omit to use app_files draft selection.'),
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'App-relative test file paths. Omit to run all test files.',
      },
    },
    required: ['app'],
  },
  outlasts: (args, ctx) => ({
    key: runOf(args, ctx),
    progress: 'The app tests are still running.',
  }),
  run: async (ctx, args) => {
    let evaluate = ctx.env.CODE_MODE
    if (!evaluate) {
      throw refuse('unavailable', 'The app test runner is unavailable')
    }
    let { space, app, who } = await inApp(ctx, args, true)
    let target = typeof args.draft == 'string' ? anew(args.draft) : undefined
    let picked = await selecting(
      ctx.dir,
      app,
      await draftsOf(ctx.dir, app),
      who,
      target,
    )
    let draft = await drafting(
      r2RawObjects(ctx.env.BLOBS),
      ctx.dir,
      app,
      picked,
    )
    let paths = Object.keys(draft.files)
    let asked = args.paths as string[] | undefined
    let suite = testPaths(paths, asked)
    let missing = asked?.filter((path) => !suite.includes(path))
    if (missing?.length) {
      throw refuse('missing', `No test file at ${missing.join(', ')}`)
    }
    if (!suite.length) throw refuse('missing', 'The app has no test files')
    let read = (path: string) => draft.view.read(`${draft.root}/${path}`)
    let { config, refused } = await configured(read)
    if (refused.length) throw refuse('arguments', refused.join('\n'))
    let tests: TestResult[] = []
    let fork = branches(ctx.env, space, app)
    let branch = await fork.make()
    let store = appStore(ctx.env.STORE, space, { ...app, branch }, ctx.env)
    let signal = AbortSignal.timeout(HOSTED_LIMITS.wallMs)
    let bridge = bridgeFor(store, vouched(who), signal)
    try {
      if (picked) {
        await branchWords(ctx.env, space, app, store, who, paths, read)
      }
      for (let path of suite) {
        ctx.doing?.(`running ${path}`)
        try {
          signal.throwIfAborted()
          let module = await compileEntry(ctx, space, app, {
            paths,
            read,
            main: path,
            flags: config.compatibility_flags,
          })
          let result = await evaluate(
            {
              'script.js': testProgram(path, 'test.js'),
              'test.js': module.code,
            },
            bridge,
            signal,
            {
              bill: { space, person: ctx.person, call: mint() },
              isolated: true,
            },
          )
          tests.push(...JSON.parse(result) as TestResult[])
        } catch (error) {
          if (signal.aborted) {
            throw refuse('limit', 'The app test run exceeded two minutes')
          }
          if (!(error instanceof CallError) || error.code == 'limit') {
            throw error
          }
          tests.push({ path, name: path, error: error.message })
        }
      }
    } finally {
      await fork.drop(branch)
    }
    let failed = tests.filter((test) => test.error).length
    return {
      text: [
        `${tests.length - failed} passed, ${failed} failed.`,
        ...tests.map(({ path, name, error }) =>
          error ? `Fail ${path} / ${name}\n${error}` : `Pass ${path} / ${name}`
        ),
      ].join('\n'),
      value: { tests, passed: tests.length - failed, failed },
      space,
    }
  },
}
