// One thing, one name (M-12915): every package's words, all at once, declare
// each component once, so no role a process serves composes two packages that
// both claim one (@yaks/vocab `loadVocab` refuses that at startup). A
// store's own words (`yak/app`) are laid over the packages' instead
// (@yaks/host `beneath`), so only packages are asked here.
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { vocabFacets } from './load.ts'

test('every package together declares each component once', () => {
  let packages = Object.entries(vocabFacets)
    .filter(([pkg]) => pkg.startsWith('@yaks/'))
  loadVocab(
    packages.flatMap(([pkg, f]) =>
      (f.docs ?? []).map((d) => ({ ...d, package: pkg }))
    ),
    packages.flatMap(([, f]) => f.keywords ?? []),
  )
})
