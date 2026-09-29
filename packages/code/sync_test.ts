// A codebase in a scratch Git repository, read into an in-memory graph and read
// again as it changes. It runs git and `deno doc` as subprocesses.

import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { gitDoc } from '@yaks/git'
import { sync } from '@yaks/mirror'
import { ram } from '@yaks/ram'
import { loadVocab, metaDoc } from '@yaks/vocab'
import { codeDoc } from './vocab.ts'
import { codeMirror } from './sync.ts'

let entity = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

let fixture = () => {
  let vocab = loadVocab([entity, edgeDoc, gitDoc, docDoc, codeDoc, metaDoc], [
    edgeKeywords,
  ])
  return graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })
}

let git = (cwd: string, ...args: string[]) =>
  new Deno.Command('git', { args, cwd, stdout: 'null', stderr: 'null' })
    .output()

let write = (dir: string, files: Record<string, string | null>) => {
  for (let [path, text] of Object.entries(files)) {
    if (text == null) Deno.removeSync(`${dir}/${path}`)
    else Deno.writeTextFileSync(`${dir}/${path}`, text)
  }
}

let commit = async (dir: string) => {
  await git(dir, 'add', '-A')
  await git(
    dir,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-qm',
    'x',
  )
}

let names = (bundles: Bundle[]) =>
  bundles.map((b) => String((b.symbol as Comp).name)).sort()

Deno.test(
  'code sync reads a tree, then only what moved, and clears what went',
  async () => {
    let dir = Deno.makeTempDirSync()
    await git(dir, 'init', '-q')
    write(dir, {
      'deno.json': '{"name": "@t/p", "exports": "./mod.ts"}',
      'mod.ts': "// The package.\nexport * from './a.ts'\n",
      'a.ts': '// A.\n/** Adds. */\nexport let add = 1\nexport let gone = 2\n',
      'README.md': '# T\n\nRead me.\n',
    })
    await commit(dir)
    let g = fixture()
    let pass = async () => {
      let m = await codeMirror(g, dir)
      return { ...(await sync(m.binding)), said: m.said }
    }

    let first = await pass()
    assertEquals(first.read.length, 4)
    assertEquals(
      [first.said.symbols, first.said.imports, first.said.packages],
      [2, 1, 1],
    )
    assertEquals(names(await g.read('.symbol')), ['add', 'gone'])
    let [add] = await g.read('.symbol.name=add&?doc')
    assertEquals((add.doc as Comp).body, 'Adds.')
    assertEquals((await pass()).read, [])

    write(dir, {
      'a.ts': '// A.\nexport let add = 1\n',
      'README.md': null,
    })
    await commit(dir)
    assertEquals((await pass()).read, ['README.md', 'a.ts'])
    assertEquals(names(await g.read('.symbol')), ['add'])
    assertEquals((await g.read('.module')).length, 3)

    // A name that comes back is the same entity, filled in again.
    let [was] = await g.read('.symbol.name=add')
    write(dir, { 'a.ts': 'export let add = 1\nexport let gone = 3\n' })
    await commit(dir)
    await pass()
    assertEquals(names(await g.read('.symbol')), ['add', 'gone'])
    assertEquals(
      (await g.read('.symbol.name=add'))[0].entity.eid,
      was.entity.eid,
    )
    Deno.removeSync(dir, { recursive: true })
  },
)

Deno.test(
  'code sync reads what each package declares, and clears what it stops declaring',
  async () => {
    let dir = Deno.makeTempDirSync()
    await git(dir, 'init', '-q')
    let vocab = ($defs: Record<string, unknown>) => JSON.stringify({ $defs })
    let note = (properties: Record<string, unknown>, before = ['doc']) => ({
      component: true,
      type: 'object',
      kind: true,
      before,
      properties,
    })
    Deno.mkdirSync(`${dir}/q`)
    write(dir, {
      'deno.json': '{"name": "@t/p"}',
      'vocab.json': vocab({
        note: note({ a: { type: 'string' }, b: { type: 'number' } }),
      }),
      'q/deno.json': '{"name": "@t/q"}',
      'q/vocab.json': vocab({
        note: {
          component: true,
          extends: true,
          properties: { c: { type: 'boolean' } },
        },
      }),
    })
    await commit(dir)
    let g = fixture()
    let pass = async () => sync((await codeMirror(g, dir)).binding)
    let titles = async (q: string) =>
      (await g.read(`${q} ?doc`)).map((b) => (b.doc as Comp).title).sort()

    await pass()
    assertEquals(await titles('._comp'), ['note'])
    assertEquals(await titles('._prop'), ['note.a', 'note.b', 'note.c'])
    assertEquals((await g.read('._before')).length, 1)

    // A property and a `before` the file stops saying are cleared; the other
    // package's property stays on the component.
    write(dir, {
      'vocab.json': vocab({ note: note({ a: { type: 'string' } }, []) }),
    })
    await commit(dir)
    await pass()
    assertEquals(await titles('._prop'), ['note.a', 'note.c'])
    assertEquals((await g.read('._before')).length, 0)

    // A vocabulary that is gone takes what it declared with it.
    write(dir, { 'q/vocab.json': null })
    await commit(dir)
    await pass()
    assertEquals(await titles('._prop'), ['note.a'])
    Deno.removeSync(dir, { recursive: true })
  },
)
