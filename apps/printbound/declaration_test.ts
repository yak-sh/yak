import { equal, test } from '@yaks/testing'
import { appDoc } from '../../workers/yak/vocab.ts'
import { invoke, parseTools } from '@yaks/tools/declared'
import printbound from './vocab.json' with { type: 'json' }
import crayonbloom from '../crayonbloom/vocab.json' with { type: 'json' }

test('released print services carry selected artwork options through declared commands', async () => {
  appDoc(printbound)
  appDoc(crayonbloom)
  let tools = parseTools(printbound)
  parseTools(crayonbloom)
  let selected = {
    title: 'My book',
    front_bleed: false,
    back_text: 'For my family',
  }
  let result = await invoke(tools.prepare, selected, {
    apply: () => {
      throw new Error('Unexpected graph write')
    },
    query: () => {
      throw new Error('Unexpected graph read')
    },
    worker: (path, args) => ({
      path,
      args,
      pricing: tools.prepare.service?.pricing,
    }),
  })
  equal(result.path, '/service/prepare')
  equal(result.args, selected)
  equal(typeof result.pricing, 'string')
})
