import { mint } from '@yaks/graph'
import { equal, match, test } from '@yaks/testing'
import { strip } from '@yaks/esbuild/strip'
import { connector, fresh } from './probe.ts'
import { compiler } from './testing.ts'

let urlOf = (source: string) =>
  'data:text/javascript,' + encodeURIComponent(source)

test('app_test compiles draft test files and drops their store writes after the run', async () => {
  let compiled: string[] = []
  let k = await fresh({
    ESBUILD: compiler(async (req) => {
      let { ask } = await req.json()
      let path: string = ask.worker.entry
      compiled.push(path)
      return Response.json({
        worker: { main: path, code: await strip(path, ask.files[path]) },
        pages: {},
        assets: {},
        errors: [],
        notes: [],
        installed: [],
      })
    }),
    CODE_MODE: async (modules, bridge, _signal, opts) => {
      equal(opts?.isolated, true)
      let globals = Object.getOwnPropertyDescriptors(globalThis)
      try {
        let source = modules['script.js']
          .replace(
            "import { WorkerEntrypoint } from 'cloudflare:workers';",
            'class WorkerEntrypoint {}',
          )
          .replace('globalThis.Deno = { test };', '')
          .replace(
            '"./test.js"',
            JSON.stringify(
              urlOf(
                'const Deno = { test: globalThis.test };\n' +
                  modules['test.js'],
              ),
            ),
          )
        let { default: Entry } = await import(urlOf(source))
        return await new Entry().run(bridge)
      } finally {
        if (globals.test) {
          Object.defineProperty(globalThis, 'test', globals.test)
        } else Reflect.deleteProperty(globalThis, 'test')
        if (globals.store) {
          Object.defineProperty(globalThis, 'store', globals.store)
        } else Reflect.deleteProperty(globalThis, 'store')
      }
    },
  })
  try {
    let agent = connector(k, k.owner.cookie)
    let app = 'test-runner', space = k.owner.name, id = mint()
    await agent.tool('app_new', { space, slug: app, title: 'Test runner' })
    await agent.tool('app_files', {
      space,
      app,
      files: [{
        path: 'suite_test.ts',
        content: `
          Deno.test('writes stay on a branch', async ({store}) => {
            let title: string = 'Branch only';
            await store.apply([{ entity: { eid: '${id}' }, doc: { title } }]);
            let { result } = await store.query('.entity.eid=${id}&.doc');
            if (result[0]?.doc?.title !== title) throw Error('missing branch row');
          });
          test('assertion failure', () => { throw Error('example failure'); });
        `,
      }, {
        path: 'other_test.js',
        content: "test('not selected', () => {})",
      }],
    })
    let out = await agent.answer('app_test', {
      space,
      app,
      paths: ['suite_test.ts'],
    })
    equal(compiled, ['suite_test.ts'])
    equal([out.value?.passed, out.value?.failed], [1, 1], out.text)
    match(out.value?.tests, [
      { path: 'suite_test.ts', name: 'writes stay on a branch' },
      { path: 'suite_test.ts', name: 'assertion failure' },
    ])
    let live = await agent.answer('graph_query', {
      q: `.in=${space}/${app}&.entity.eid=${id}&.doc`,
    })
    equal(live.rows, [])
  } finally {
    await k.stop()
  }
})
