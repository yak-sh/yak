// Timed apply boundary only: seed, warmup, verification and disposal excluded.
import { APPLY_MODES, APPLY_SHAPES, APPLY_SIZES, APPLY_WORK } from './names.ts'
import {
  applyBundles,
  applyFixture,
  runApplies,
  verifyApplies,
} from './apply-fixture.ts'
for (let mode of APPLY_MODES) {
  for (let work of APPLY_WORK) {
    for (let n of APPLY_SIZES) {
      for (let shape of APPLY_SHAPES) {
        Deno.bench({
          name: `apply/${mode}/${work}-${shape}-${n}`,
          n: 3,
          warmup: 1,
          fn: (b) => {
            let f = applyFixture(mode)
            try {
              let bundles = applyBundles(work, n)
              b.start()
              runApplies(f, bundles, shape)
              b.end()
              verifyApplies(f, bundles)
            } finally {
              f.close()
            }
          },
        })
      }
    }
  }
}
