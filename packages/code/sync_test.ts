// A codebase in a scratch Git repository, read into an in-memory graph and read
// again as it changes. Slow: it runs git and `deno doc` as subprocesses.

import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { gitDoc } from '@yaks/git'
import { sync } from '@yaks/mirror'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { codeDoc } from './vocab.ts'
import { codeMirror } from './sync.ts'

let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })

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
  let vocab = loadVocab([entity, edgeDoc, gitDoc, docDoc, codeDoc], [
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

slow(
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
    let [add] = await g.read('.symbol.name=add')
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
