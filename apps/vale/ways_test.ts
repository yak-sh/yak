// A sign's wooden finger follows the road it names, on either approach to a
// land, even where the road bends beside it.
import { test } from '@yaks/testing'
import { seedBuildings } from './buildings_fixture.ts'
import { assert } from '@std/assert'
import { spin } from './buildings/kit.ts'
import { LEVELS } from './levels.ts'
import { unkey } from './mesh.ts'
import { KINDS } from './props.ts'
import { builtOf } from './terrain.ts'
import { roadsOf } from './ways.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

seedBuildings()

test('signpost fingers point along their named roads', () => {
  for (let id of Object.keys(LEVELS)) {
    let posts = builtOf(id).filter((p) => p.kind.startsWith('signpost'))
    for (let road of roadsOf(id)) {
      let sign = road.signs.find((s) => s.level == id)!
      let post = posts.find((p) =>
        Math.hypot(p.x - sign.at[0], p.z - sign.at[1]) < 1
      )
      assert(post, `${id} to ${sign.to}: no visible sign`)

      // The finger gives the prop's shape its outward direction.
      let x = 0, z = 0
      for (let [key] of KINDS[post.kind].make(0).vox) {
        let [vx, , vz] = unkey(key)
        x += vx
        z += vz
      }
      let [ax, az] = spin(x, z, post.turn ?? 0)
      let c = road.c
      let i = c.xs.reduce(
        (best, _, n) =>
          Math.hypot(c.xs[n] - sign.at[0], c.zs[n] - sign.at[1]) <
              Math.hypot(c.xs[best] - sign.at[0], c.zs[best] - sign.at[1])
            ? n
            : best,
        0,
      )
      let j = Math.max(
        0,
        Math.min(c.xs.length - 1, i + (road.from == id ? 6 : -6)),
      )
      let dx = c.xs[j] - c.xs[i], dz = c.zs[j] - c.zs[i]
      let cos = (ax * dx + az * dz) /
        (Math.hypot(ax, az) * Math.hypot(dx, dz))
      assert(cos > Math.cos(Math.PI / 6), `${id} to ${sign.to}: wrong way`)
    }
  }
})
