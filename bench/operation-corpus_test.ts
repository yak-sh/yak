import { type Bundle, graph } from '@yaks/graph'
import { personaDoc } from '@yaks/persona'
import { ram } from '@yaks/ram'
import { sessionDoc } from '@yaks/session/vocab'
import { equal, test } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { runs } from '../packages/project/tools.ts'
import { team } from '../packages/project/testing.ts'
import { populate } from './operation-corpus.ts'

let vocab = loadVocab([
  ...team.docs,
  pick(personaDoc, ['persona']),
  pick(sessionDoc, ['session']),
], team.keywords)
let g = graph({ storage: ram(vocab), vocab })
await populate(g, 2)

test('the operation corpus leaves no governed entity outside its portfolio', async () => {
  let result = await runs({ vocab }).project_check({
    entity: { eid: 'check' },
    call: { args: {} },
  }, g) as Bundle[]
  equal(result[0].finding, undefined)
})
