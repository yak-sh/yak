import { equal, test } from '@yaks/testing'
import { aimOf, takenBy, type Target } from './targeting.ts'

let at = (eid: string, x: number, z: number, width = 1, down = false) => ({
  eid,
  near: Math.hypot(x, z),
  body: { x, z },
  width,
  down,
})
let size = (m: ReturnType<typeof at>) => m.width
let me = { x: 0, z: 0, yaw: 0 }
let blade = { reach: 1.4, arc: 1.5 }
let bow = { reach: 12, arc: 1.5, shot: true }
let ids = (ms: Target[]) => ms.map((m) => m.eid)

test('aim uses live forward targets, caller sizes and shortest available reach', () => {
  let near = at('near', 0, 2), far = at('far', 0, 6)
  equal(aimOf([at('behind', 0, -1), far, near], me, blade, size), near)
  equal(aimOf([far], me, blade, size), null)
  equal(aimOf([far], me, blade, size, '', [4]), far)
  // The larger body is reachable by the blade, before the nearer one
  // requiring the extra reach of an ability.
  let hen = at('hen', 0, 3.2, 0.2), ox = at('ox', 1, 3.7, 2)
  equal(aimOf([hen, ox], me, blade, size, '', [4]), ox)
  equal(aimOf([at('down', 0, 1, 1, true)], me, bow, size), null)
})

test('aim holds a comparable target, scores a point and honours a chosen live target', () => {
  let a = at('a', 0, 3), b = at('b', 1, 2.6)
  equal(aimOf([a, b], me, bow, size), b)
  equal(aimOf([a, b], me, bow, size, 'a'), a)
  let close = at('b', 0, 1.5)
  equal(aimOf([a, close], me, bow, size, 'a'), close)
  let behind = at('behind', 0, -2)
  equal(aimOf([a, behind], me, bow, size, '', [], undefined, 'behind'), behind)
  let mouse = at('mouse', 4, 2), point = { x: 4, z: 2 }
  equal(aimOf([a, mouse], me, bow, size, '', [], point), mouse)
  equal(aimOf([a, mouse], me, bow, size, '', [], point, 'a'), a)
  equal(
    aimOf([{ ...a, down: true }, mouse], me, bow, size, '', [], point, 'a'),
    mouse,
  )
  equal(
    aimOf([at('far', 0, 30), mouse], me, bow, size, '', [], point, 'far'),
    mouse,
  )
})

test('attack shapes cover live targets using widths, angular limits and burst centres', () => {
  let ahead = at('ahead', 0, 2), side = at('side', 2, 0.5)
  let behind = at('behind', 0, -2), far = at('far', 0, 9)
  let mobs = [ahead, side, behind, far, at('down', 0, 1, 1, true)]
  equal(ids(takenBy({ shape: 'arc', far: 1 }, mobs, me, blade, size, ahead)), [
    'ahead',
    'side',
  ])
  equal(ids(takenBy({ shape: 'ring', far: 2 }, mobs, me, blade, size, ahead)), [
    'ahead',
    'side',
    'behind',
  ])
  equal(
    ids(takenBy({ shape: 'burst', far: 1 }, mobs, me, blade, size, ahead)),
    ['ahead'],
  )
  equal(
    ids(
      takenBy(
        { shape: 'burst', far: 1 },
        mobs,
        me,
        blade,
        size,
        null,
        far.body,
      ),
    ),
    ['far'],
  )
  equal(takenBy({ shape: 'burst', far: 1 }, mobs, me, blade, size, null), [])
  equal(takenBy({ shape: 'self' }, mobs, me, blade, size, ahead), [])
  // Shooting arcs sweep at arm's length, not the bow's full range.
  equal(ids(takenBy({ shape: 'arc', far: 1 }, mobs, me, bow, size, ahead)), [
    'ahead',
    'side',
  ])
  equal(takenBy({ shape: 'arc', arc: 0.1 }, [side], me, blade, size, null), [])
  let touching = at('touching', 0, -0.8)
  equal(
    takenBy({ shape: 'arc', arc: 0.1 }, [touching], me, blade, size, null),
    [touching],
  )
})

test('one-target attack supports aimed range slack and a point-directed corridor', () => {
  let aimed = at('aimed', 0, 2.6), beyond = at('beyond', 0, 4)
  let one = { shape: 'one' as const }
  equal(takenBy(one, [aimed], me, blade, size, aimed), [aimed])
  equal(takenBy(one, [beyond], me, blade, size, beyond), [])
  equal(
    takenBy(one, [at('edge', 0, 14.5)], me, bow, size, at('edge', 0, 14.5))
      .length,
    1,
  )
  let near = at('near', 0.1, 1.5), miss = at('miss', 0.7, 1)
  equal(
    takenBy(
      one,
      [miss, aimed, near, at('back', 0, -1)],
      me,
      blade,
      size,
      null,
      { x: 0, z: 2 },
    ),
    [near],
  )
  equal(
    takenBy(one, [{ ...aimed, down: true }, near], me, blade, size, aimed, {
      x: 0,
      z: 2,
    }),
    [],
  )
  let wide = at('wide', 0.7, 1, 2)
  equal(takenBy(one, [wide], me, blade, size, null, { x: 0, z: 2 }), [wide])
  equal(takenBy(one, [near], me, blade, size, null, { x: 0, z: 0 }), [])
})
