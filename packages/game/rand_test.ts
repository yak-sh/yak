import { equal, ok, test } from '@yaks/testing'
import { fbm, hash, hashOf, noise, rand, stream, uuidOf } from './rand.ts'

test('seeds keep authored worlds and their entity ids stable', () => {
  equal(hash(3, 4, 5), 3473826407)
  equal(hashOf('mossvale'), 2601051589)
  equal(uuidOf('mossvale/slime/1'), '5a0669d3-7dcf-8e73-8dc3-bc1804dbff9b')
  let r = stream(7)
  equal([r(), r(), r()], [
    0.011704753153026104,
    0.06195825757458806,
    0.97690763277933,
  ])
  equal(noise(1.5, 2.25), 0.38408944570983294)
  equal(fbm(1.5, 2.25), 0.4712911802266414)
})

test('noise meets at integer boundaries and random values stay in range', () => {
  equal(noise(3, -2, 7), rand(3, -2, 7))
  for (let i = -20; i < 20; i++) {
    let value = noise(i / 3, i / 7, 18)
    ok(value >= 0 && value < 1)
    ok(Math.abs(noise(2 - 1e-6, i, 4) - noise(2 + 1e-6, i, 4)) < 1e-8)
  }
})
