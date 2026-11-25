import { choose } from './choose.ts'
import { note, survey } from './deps.ts'
import { equal, test } from './mod.ts'

let unchanged = await choose(['missing_test.ts'], { changed: [] })

test('no changed paths selects no tests without needing a dependency graph or cache', () => {
  equal(unchanged.run, [])
  equal(unchanged.keys.size, 0)
  equal(unchanged.reaches(['missing_test.ts']), false)
})

// A survey of tests importing a.ts directly or through relay.ts.
let importing = async (tests: string[], indirect: string[] = []) => {
  let url = (f: string) => new URL(f, `file://${Deno.cwd()}/`).href
  let imports = (file: string, from: string) => ({
    specifier: url(file),
    dependencies: [{
      specifier: './' + from,
      code: { specifier: url(from) },
    }],
  })
  return (await survey([...tests, 'a.ts', 'relay.ts'], () =>
    Promise.resolve({
      modules: [
        ...tests.map((f) =>
          imports(f, indirect.includes(f) ? 'relay.ts' : 'a.ts')
        ),
        imports('relay.ts', 'a.ts'),
        { specifier: url('a.ts'), dependencies: [] },
      ],
      redirects: {},
    })))!
}

test('selection uses the supplied command snapshot and retains dependency keys', async () => {
  let s = await importing(['a_test.ts'])
  let asked: string[][] = []
  let selected = await choose(['a_test.ts'], {
    changed: ['a.ts'],
    all: true,
    inspect: (paths) => {
      asked.push(paths)
      return Promise.resolve(s)
    },
  })
  equal(asked, [['a_test.ts']])
  equal(selected.run, ['a_test.ts'])
  equal(selected.reaches(['a.ts']), true)
  equal(selected.keys.size, 1)
})

test('what a file read is known only as this version of it read it, not as another did', async () => {
  let s = await importing(['a_test.ts'])
  let reads = `${await Deno.makeTempDir()}/reads.json`
  let read = async () =>
    (await choose(['a_test.ts'], {
      all: true,
      observed: true,
      reads,
      inspect: () => Promise.resolve(s),
    })).read('a_test.ts')
  let { keys } = await choose(['a_test.ts'], {
    all: true,
    inspect: () => Promise.resolve(s),
  })
  // As the file read before a test reading a generated page was added to it.
  note({ 'a_test.ts': ['a.ts'] }, reads, { 'a_test.ts': 'its last version' })
  equal(await read(), undefined)
  note({ 'a_test.ts': ['a.ts'] }, reads)
  equal(await read(), undefined)
  note({ 'a_test.ts': ['a.ts'] }, reads, {
    'a_test.ts': keys.get('a_test.ts')!,
  })
  equal(await read(), ['a.ts'])
})

test('a workspace-wide change keeps its own tests within the local budget', async () => {
  let { within } = await import('./choose.ts')
  equal(within(['a', 'b', 'c'], () => 0, () => 10, 20), ['a', 'b'])
})

test('a test file the change edits runs whatever it costs, and what is left of the budget holds the rest', async () => {
  let files = ['slow_test.ts', 'b_test.ts', 'c_test.ts']
  let s = await importing(files, files)
  let cost = (f: string) => ({ 'slow_test.ts': 50 })[f] ?? 10
  let selected = await choose(files, {
    changed: ['a.ts', 'slow_test.ts'],
    all: true,
    budget: 65,
    cost,
    inspect: () => Promise.resolve(s),
  })
  equal(selected.run, ['slow_test.ts', 'b_test.ts'])
  equal(selected.beyond, 1)
})

test('a direct test still runs when its estimated cost exceeds the entire budget', async () => {
  let files = ['a_test.ts', 'farther_test.ts']
  let s = await importing(files, ['farther_test.ts'])
  let selected = await choose(files, {
    changed: ['a.ts'],
    all: true,
    budget: 6,
    cost: (f) => f == 'a_test.ts' ? 7 : 1,
    inspect: () => Promise.resolve(s),
  })
  equal(selected.run, ['a_test.ts'])
  equal(selected.beyond, 1)
})

test('a test importing an edited declaration through a re-export still runs when the budget is spent', async () => {
  let files = ['page_test.ts', 'other_test.ts']
  let s = await importing(files, files)
  let source = (f: string) =>
    ({
      'relay.ts': "export { page } from './a.ts'",
      'page_test.ts': "import { page } from './relay.ts'",
    })[f]
  let selected = await choose(files, {
    changed: ['a.ts'],
    all: true,
    budget: 0,
    cost: () => 1,
    edits: { 'a.ts': ['page'] },
    source,
    inspect: () => Promise.resolve(s),
  })
  equal(selected.run, ['page_test.ts'])
  equal(selected.beyond, 1)
})

test('a test of code calling an edited declaration comes before cheaper farther consumers', async () => {
  let files = ['page_test.ts', 'b_test.ts', 'c_test.ts']
  let s = await importing(files, files)
  let source = (f: string) =>
    ({
      'relay.ts':
        "import { render } from './a.ts'\nexport let page = () => render()",
      'page_test.ts': "import { page } from './relay.ts'",
    })[f]
  let chosen = (edits?: Record<string, string[]>) =>
    choose(files, {
      changed: ['a.ts'],
      all: true,
      budget: 30,
      cost: (f) => f == 'page_test.ts' ? 30 : 10,
      edits,
      source,
      inspect: () => Promise.resolve(s),
    })
  equal((await chosen()).run, ['b_test.ts', 'c_test.ts'])
  equal((await chosen({ 'a.ts': ['render'] })).run, ['page_test.ts'])
})

test('a test importing a declaration that calls an edited local helper runs past the budget', async () => {
  let files = ['page_test.ts', 'other_test.ts']
  let s = await importing(files)
  let texts: Record<string, string> = {
    'a.ts': 'let links = () => []\nexport let page = () => links()',
    'page_test.ts': "import { page } from './a.ts'",
    'other_test.ts': "import { other } from './a.ts'",
  }
  let selected = await choose(files, {
    changed: ['a.ts'],
    all: true,
    budget: 0,
    cost: () => 1,
    edits: { 'a.ts': ['links'] },
    source: (f) => texts[f],
    inspect: () => Promise.resolve(s),
  })
  equal(selected.run, ['page_test.ts'])
  equal(selected.beyond, 1)
})

test('a test of a public wrapper in the same module competes for the budget', async () => {
  let files = ['direct_test.ts', 'wrapper_test.ts']
  let s = await importing(files)
  let texts: Record<string, string> = {
    'a.ts': 'export let leaf = () => 1\n' +
      'let helper = () => leaf()\nexport let wrapper = () => helper()',
    'direct_test.ts': "import { leaf } from './a.ts'",
    'wrapper_test.ts': "import { wrapper } from './a.ts'",
  }
  let selected = await choose(files, {
    changed: ['a.ts'],
    all: true,
    budget: 0,
    cost: () => 1,
    edits: { 'a.ts': ['leaf'] },
    source: (f) => texts[f],
    inspect: () => Promise.resolve(s),
  })
  equal(selected.run, ['direct_test.ts'])
  equal(selected.beyond, 1)
})

test('directory reads stay in the run and computed imports compete by distance', async () => {
  let files = ['other_test.ts', 'loader_test.ts', 'listing_test.ts']
  let s = await importing([...files, 'loaded.ts'], files)
  let dir = await Deno.makeTempDir()
  try {
    let reads = `${dir}/reads.json`
    note(
      { 'loader_test.ts': ['loaded.ts'], 'listing_test.ts': ['fixtures'] },
      reads,
    )
    let pick = (budget: number) =>
      choose(files, {
        changed: ['a.ts', 'fixtures/new.json'],
        all: true,
        observed: true,
        reads,
        budget,
        cost: () => 1,
        edits: { 'a.ts': ['links'] },
        inspect: () => Promise.resolve(s),
      })
    equal((await pick(0)).run, ['listing_test.ts'])
    equal((await pick(2)).run, ['loader_test.ts', 'listing_test.ts'])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('an edit inside one declaration of a shared module keeps only the direct tests naming it', async () => {
  let files = ['page_test.ts', 'other_test.ts']
  let s = await importing(files)
  let source = (f: string) =>
    ({
      'page_test.ts': "import { page } from './a.ts'",
      'other_test.ts': "import { other } from './a.ts'",
    })[f]
  let chosen = (edits: Record<string, string[]>) =>
    choose(files, {
      changed: ['a.ts'],
      all: true,
      budget: 0,
      cost: () => 1,
      edits,
      source,
      inspect: () => Promise.resolve(s),
    })
  equal((await chosen({ 'a.ts': ['page'] })).run, ['page_test.ts'])
  equal((await chosen({ 'a.ts': ['page', '*'] })).run, files)
})
