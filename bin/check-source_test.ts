import { equal, test, throws } from '@yaks/testing'
import type { Diagnostic } from 'typescript-native/unstable/async'
import { check, diagnostics, format, type Program } from './check-source.ts'

let error = (code: number, fileName?: string, pos = 0): Diagnostic => ({
  code,
  fileName,
  pos,
  end: pos + 1,
  category: 1,
  text: `failure ${code}`,
})

let rig = () => {
  let calls: string[] = []
  let program: Program = {
    getProgramDiagnostics: () => Promise.resolve([error(1), error(2)]),
    getConfigFileParsingDiagnostics: () => Promise.resolve([error(3)]),
    getSyntacticDiagnostics: (f) => {
      calls.push(`parse ${f}`)
      return Promise.resolve([error(4, f)])
    },
    getBindDiagnostics: (f) => {
      calls.push(`bind ${f}`)
      return Promise.resolve([error(5, f)])
    },
    getSemanticDiagnostics: (f) => {
      calls.push(`types ${f}`)
      return Promise.resolve([error(6, f), error(5, f)])
    },
  }
  return { program, calls }
}

test('native source checking retains project errors and every diagnostic phase of selected sources', async () => {
  let { program, calls } = rig()
  equal(await diagnostics(program, ['a.ts', 'b.ts']), [
    error(1),
    error(2),
    error(3),
    error(4, 'a.ts'),
    error(5, 'a.ts'),
    error(6, 'a.ts'),
    error(4, 'b.ts'),
    error(5, 'b.ts'),
    error(6, 'b.ts'),
  ])
  equal(calls, [
    'parse a.ts',
    'bind a.ts',
    'types a.ts',
    'parse b.ts',
    'bind b.ts',
    'types b.ts',
  ])
})

test('a native source check opens its configured project and closes after diagnostics', async () => {
  let { program } = rig(), calls: unknown[] = []
  await check(
    {
      updateSnapshot: (params) => {
        calls.push(params)
        return Promise.resolve({
          getProject: (config) => {
            calls.push(config)
            return { program }
          },
        })
      },
      close: () => {
        calls.push('closed')
        return Promise.resolve()
      },
    },
    '/c/tsconfig.json',
    ['a.ts'],
  )
  equal(calls, [
    { openProjects: ['/c/tsconfig.json'] },
    '/c/tsconfig.json',
    'closed',
  ])
})

test('a native compiler closes when opening or checking fails', async () => {
  let { program } = rig()
  for (
    let getProject of [
      () => undefined,
      () => ({
        program: {
          ...program,
          getProgramDiagnostics: () =>
            Promise.reject(new Error('check failed')),
        },
      }),
    ]
  ) {
    let closed = false
    await throws(() =>
      check(
        {
          updateSnapshot: () => Promise.resolve({ getProject }),
          close: () => {
            closed = true
            return Promise.resolve()
          },
        },
        '/c/config.json',
        ['a.ts'],
      ), /Cannot open|check failed/)
    equal(closed, true)
  }
})

test('native diagnostics retain file positions, nested explanations and global errors', () => {
  let d = { ...error(1, '/c/a.ts', 5), messageChain: [error(2)] }
  equal(
    format(d, () => 'a\n123x', '/c'),
    'a.ts(2,4): error TS1: failure 1\n  failure 2',
  )
  equal(format(error(3), () => '', '/c'), 'error TS3: failure 3')
})

test('native diagnostic positions count UTF-16 characters across non-ASCII text', () => {
  let text = "// 🐂 café\nlet café = '🐂'; let count: number = café\n"
  let d = error(2322, '/c/a.ts', text.indexOf('count'))
  equal(format(d, () => text, '/c'), 'a.ts(2,22): error TS2322: failure 2322')
})
