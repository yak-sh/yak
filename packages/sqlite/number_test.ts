import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, Refused, type Tx } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { among, by, col, select, table, val } from '@yaks/sql'
import { mem } from './testing.ts'
import { mintSql, storage } from './mod.ts'
import { idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'

let vocab = loadVocab([{
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    entry: {
      component: true,
      properties: { seq: { type: 'number' } },
    },
    task: {
      component: true,
      properties: { target: { type: 'string', ref: 'entity' } },
    },
  },
}])

for (let backend of ['sqlite', 'ram']) {
  test(
    backend + ': numbering excludes facets across the whole batch',
    () => {
      let opts = { number: { except: ['entry'] } }
      let s = backend == 'sqlite'
        ? storage(mem(), vocab, opts)
        : ram(vocab, opts)
      s.install()
      s.tx((tx) => {
        tx.patch([
          { entity: { eid: 'task' }, task: { target: 'entry' } },
          { entity: { eid: 'entry' }, entry: { seq: 1 }, task: {} },
          { entity: { eid: 'second' }, task: {} },
        ])
        assertEquals(tx.get(['entry'])[0].entity, { eid: 'entry' })
        assertEquals(tx.get(['task'])[0].entity.num, 1)
        assertEquals(tx.get(['second'])[0].entity.num, 2)
        tx.patch([{ entity: { eid: 'second' }, entry: { seq: 2 } }])
        assertEquals(tx.get(['second'])[0].entity, { eid: 'second', num: 2 })
        tx.patch([{ entity: { eid: 'third' }, task: {} }])
        assertEquals(tx.get(['third'])[0].entity.num, 3)
      })
    },
  )
}

// A config names what it excepts once, for every graph it opens, and a graph
// whose plugins declare no such component simply has nothing wearing it.
for (let backend of ['sqlite', 'ram']) {
  test(backend + ': excepting an undeclared component numbers on', () => {
    let opts = { number: { except: ['archetype', 'entry'] } }
    let s = backend == 'sqlite' ? storage(mem(), vocab, opts) : ram(vocab, opts)
    s.install()
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'task' }, task: {} }])
      tx.patch([{ entity: { eid: 'task' }, task: { target: 'entry' } }])
      assertEquals(tx.get(['task'])[0].entity.num, 1)
    })
  })
}

for (let backend of ['sqlite', 'ram']) {
  test(backend + ': a reference to nothing numbers nothing', () => {
    let opts = { number: true }
    let s = backend == 'sqlite' ? storage(mem(), vocab, opts) : ram(vocab, opts)
    s.install()
    s.tx((tx) => {
      let born = (bs: Bundle[]) =>
        tx.patch(bs).map((e) => [e.eid, e.num ?? null])
      let target = (eid: string, at?: string) => ({
        entity: { eid },
        task: at ? { target: at } : {},
      })
      assertEquals(born([target('a', 'nobody')]), [['a', 1], ['nobody', null]])
      assertEquals(tx.get(['nobody']), [{ entity: { eid: 'nobody' } }])
      // In one batch, a target is numbered where it is first touched.
      assertEquals(born([target('b', 'c'), target('d'), target('c')]), [
        ['b', 2],
        ['c', 3],
        ['d', 4],
      ])
      assertEquals(born([target('nobody')]), [['nobody', 5]])
    })
  })
}

for (let backend of ['sqlite', 'ram']) {
  for (
    let behavior of [
      'gains an exclusion',
      'updates an exclusion',
      'creates an exclusion',
      'numbers the next task',
    ]
  ) {
    let d = mem()
    let s = backend == 'sqlite'
      ? storage(d, vocab, { number: true })
      : ram(vocab, { number: { except: ['entry'] } })
    s.install()
    s.tx((tx) => tx.patch([{ entity: { eid: 'old' }, task: {} }]))
    // Reopen under the changed policy; RAM gains the excluded facet instead.
    if (backend == 'sqlite') {
      s = storage(d, vocab, { number: { except: ['entry'] } })
      s.install()
    }
    if (behavior != 'gains an exclusion') {
      s.tx((tx) => tx.patch([{ entity: { eid: 'old' }, entry: { seq: 1 } }]))
    }
    if (
      behavior == 'creates an exclusion' || behavior == 'numbers the next task'
    ) {
      s.tx((tx) => tx.patch([{ entity: { eid: 'old' }, entry: { seq: 2 } }]))
    }
    if (behavior == 'numbers the next task') {
      s.tx((tx) => tx.patch([{ entity: { eid: 'new' }, entry: { seq: 3 } }]))
    }
    test(`${backend}: historic numbering when a row ${behavior}`, () => {
      s.tx((tx) => {
        if (behavior == 'creates an exclusion') {
          tx.patch([{ entity: { eid: 'new' }, entry: { seq: 3 } }])
          assertEquals(tx.get(['new'])[0].entity.num ?? null, null)
        } else if (behavior == 'numbers the next task') {
          tx.patch([{ entity: { eid: 'next' }, task: {} }])
          assertEquals(tx.get(['next'])[0].entity.num, 2)
        } else {
          tx.patch([{
            entity: { eid: 'old' },
            entry: { seq: behavior == 'gains an exclusion' ? 1 : 2 },
          }])
        }
        assertEquals(tx.get(['old'])[0].entity.num, 1)
      })
    })
  }
}

// Number lookup is a read behavior separate from changing an excluded facet.
for (let backend of ['sqlite', 'ram']) {
  let d = mem()
  let s = backend == 'sqlite'
    ? storage(d, vocab, { number: true })
    : ram(vocab, { number: { except: ['entry'] } })
  s.install()
  s.tx((tx) => tx.patch([{ entity: { eid: 'old' }, task: {} }]))
  if (backend == 'sqlite') {
    s = storage(d, vocab, { number: { except: ['entry'] } })
    s.install()
  }
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'old' }, entry: { seq: 1 } }])
    tx.patch([{ entity: { eid: 'old' }, entry: { seq: 2 } }])
    tx.patch([{ entity: { eid: 'new' }, entry: { seq: 3 } }])
  })
  test(`${backend}: a historic number still finds an excluded row`, () => {
    assertEquals(s.read('.entity.num=1')[0].entity.eid, 'old')
  })
}

for (
  let [component, prefix] of [['session', 'S'], ['mail', 'E'], ['knock', 'K']]
) {
  let v = loadVocab([{
    $defs: {
      entity: {
        component: true,
        properties: { num: { type: 'number', stamped: true } },
      },
      task: { component: true, kind: true },
      session: { component: true, kind: true, prefix: 'S' },
      mail: { component: true, kind: true, prefix: 'E' },
      knock: { component: true, kind: true, prefix: 'K' },
    },
  }], [idKeywords])
  let d = mem()
  let old = storage(d, v, { number: true })
  old.install()
  old.tx((tx) => tx.patch([{ entity: { eid: 'old' }, [component]: {} }]))
  let s = storage(d, v, { number: { except: ['session', 'mail', 'knock'] } })
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'old' }, [component]: {} },
      { entity: { eid: 'new' }, [component]: {} },
    ])
  )
  test(`historic ${component} addresses survive a policy change and reopen`, () => {
    s.tx((tx) => {
      assertEquals(
        Object.fromEntries(
          ids(v).address!(tx, [`${prefix}-1`]) as Map<string, string>,
        ),
        { [`${prefix}-1`]: 'old' },
      )
      assertEquals(tx.get(['new'])[0].entity.num ?? null, null)
    })
  })
}

for (let component of ['session', 'mail', 'knock']) {
  let v = loadVocab([{
    $defs: {
      entity: {
        component: true,
        properties: { num: { type: 'number', stamped: true } },
      },
      task: { component: true },
      [component]: { component: true },
    },
  }])
  let d = mem()
  let old = storage(d, v, { number: true })
  old.install()
  old.tx((tx) => tx.patch([{ entity: { eid: 'old' }, [component]: {} }]))
  let s = storage(d, v, { number: { except: [component] } })
  s.install()
  s.tx((tx) =>
    tx.patch([{ entity: { eid: 'old' }, [component]: {} }, {
      entity: { eid: 'new' },
      [component]: {},
    }])
  )
  test(`a task follows historic ${component} numbers after reopening`, () => {
    s.tx((tx) => {
      tx.patch([{ entity: { eid: 'next-task' }, task: {} }])
      assertEquals(tx.get(['next-task'])[0].entity.num, 2)
    })
  })
}

test('SQLite migration retains historic high-water across clearing and reopen', () => {
  let d = mem()
  let old = storage(d, vocab, { number: true })
  old.install()
  old.tx((tx) =>
    tx.patch([
      { entity: { eid: 'task' }, task: {} },
      { entity: { eid: 'entry' }, entry: { seq: 1 } },
    ])
  )
  // Represents a legacy allocator's last number, higher than surviving tasks.
  d.query({
    t: 'update',
    table: 'entity',
    set: { num: val(90000) },
    where: by({ eid: 'entry' }),
  })
  let s = storage(d, vocab, { number: { except: ['entry'] } })
  for (let i = 0; i < 2; i++) {
    s.install()
    d.query({
      t: 'update',
      table: 'entity',
      set: { num: val(null) },
      where: among(
        col('id'),
        select({ cols: [col('entity')], from: table('entry') }),
      ),
    })
  }
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'next' }, task: {} }])
    assertEquals(tx.get(['next'])[0].entity.num, 90001)
    assertEquals(tx.get(['task'])[0].entity.num, 1)
    assertEquals(tx.get(['entry'])[0].entity, { eid: 'entry' })
  })
})

test('a mint may state the number it is adopting', () => {
  // What a store seeded from another store's export needs: an entity read as
  // 37574 there is 37574 here, and the sequence carries on past it rather than
  // handing the next arrival a number already in use.
  let d = mem()
  let s = storage(d, vocab, { number: true })
  s.install()
  for (let [eid, n] of [['old', 37574], ['older', 12]] as const) {
    d.query(mintSql(eid, n))
  }
  d.query(mintSql('nameless', false))
  s.tx((tx) => {
    tx.patch([{ entity: { eid: 'fresh' }, task: {} }])
    assertEquals(tx.get(['old'])[0].entity.num, 37574)
    assertEquals(tx.get(['older'])[0].entity.num, 12)
    assertEquals(tx.get(['nameless'])[0].entity, { eid: 'nameless' })
    assertEquals(tx.get(['fresh'])[0].entity.num, 37575)
  })
})

// A number is a property like any other: a patch stating one gives it to a
// new entity or one holding another, `null` clears it, and the sequence
// carries on past every one given. A number another entity holds is that
// entity's address, so it is refused, unless that entity moves off it in the
// same batch. Each test's store is made beside it, and its patches run in one
// transaction, so the test times only them.
for (let backend of ['sqlite', 'ram']) {
  let fresh = () => {
    let s = backend == 'sqlite'
      ? storage(mem(), vocab, { number: true })
      : ram(vocab, { number: true })
    s.install()
    s.tx((tx) =>
      tx.patch([
        { entity: { eid: 'old', num: 37574 }, task: {} },
        { entity: { eid: 'made', num: null }, task: {} },
        { entity: { eid: 'mine' }, task: {} },
      ])
    )
    // A new entity takes a stated number, or none for null, and the sequence
    // carries on past it.
    assertEquals(
      s.tx((tx) => tx.get(['old', 'made', 'mine']).map((b) => b.entity.num)),
      [37574, undefined, 37575],
    )
    return (body: (tx: Tx, nums: () => (number | null)[]) => void) =>
      s.tx((tx) =>
        body(
          tx,
          () =>
            tx.get(['old', 'made', 'mine']).map((b) => b.entity.num ?? null),
        )
      )
  }
  let sets = fresh(), clears = fresh(), refuses = fresh()

  test(`${backend}: a patch stating a number gives it, and two may swap`, () =>
    sets((tx, nums) => {
      tx.patch([
        { entity: { eid: 'old', num: 37575 } },
        { entity: { eid: 'mine', num: 37574 } },
        { entity: { eid: 'made', num: 3 } },
      ])
      assertEquals(nums(), [37575, 3, 37574])
    }))

  test(`${backend}: a patch stating a null number clears it`, () =>
    clears((tx, nums) => {
      tx.patch([{ entity: { eid: 'old', num: null } }])
      assertEquals(nums(), [null, null, 37575])
    }))

  test(`${backend}: a number another entity holds is refused`, () =>
    refuses((tx, nums) => {
      assertThrows(
        () => tx.patch([{ entity: { eid: 'made', num: 37574 } }]),
        Refused,
        'two entities cannot share a number',
      )
      assertThrows(
        () => tx.patch([{ entity: { eid: 'made', num: 0 } }]),
        Refused,
        'a whole number from 1',
      )
      assertEquals(nums(), [37574, null, 37575])
    }))
}
