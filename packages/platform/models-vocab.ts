// Hosted providers remain server-owned, alongside release start-up work.
import { modelDoc } from '@yaks/model/vocab'
import { pick, type VocabDoc } from '@yaks/vocab'
let providers = pick(modelDoc, ['provider', 'serves', 'price'])
export let docs: VocabDoc[] = [{
  ...providers,
  $defs: Object.fromEntries(
    Object.entries(providers.$defs ?? {}).map((
      [name, definition],
    ) => [name, { ...definition, wire: false }]),
  ),
}, {
  reserved: false,
  $defs: { models_install: { effect: true, start: true } },
}]
