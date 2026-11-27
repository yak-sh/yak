// One thing, one name (M-12915): every package's words, all at once, declare
// each label once, so no role a process serves composes two packages that
// both claim one, and the base an app reads keeps one word per label. Two
// packages' words of one label without identities are refused at load
// (@yaks/vocab `loadVocab`); with them, each is held under its full label,
// which is what this names. A store's own words (`yak/app`) are laid over the
// packages' instead (@yaks/host `beneath`), so only packages are asked here.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { vocabFacets } from './load.ts'

test('every package together declares each component once', () => {
  let packages = Object.entries(vocabFacets)
    .filter(([pkg]) => pkg.startsWith('@yaks/'))
  let v = loadVocab(
    packages.flatMap(([pkg, f]) =>
      (f.docs ?? []).map((d) => ({ ...d, label: pkg }))
    ),
    packages.flatMap(([, f]) => f.keywords ?? []),
  )
  let shared = v.all.filter((n) => n != v.comp(n)?.label)
  equal(shared, [])
})
