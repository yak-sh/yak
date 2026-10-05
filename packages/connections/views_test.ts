import { equal, ok, test } from '@yaks/testing'
import { define } from '@yaks/render'
import { views as generic } from '@yaks/render/views'
import { views as secrets } from '@yaks/secrets/views'
import { secretsDoc } from '@yaks/secrets/vocab'
import { views as docs } from '@yaks/doc/views'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge/vocab'
import { loadVocab } from '@yaks/vocab'
import { show } from '../cli/answer.ts'
import { connectionsDoc } from './vocab.ts'
import { integrationEid } from './integrations.ts'
import { views } from './views.ts'

let vocab = loadVocab([connectionsDoc, secretsDoc, docDoc, edgeDoc], [
  edgeKeywords,
])
let registry = define([
  ...secrets.renderers,
  ...docs.renderers,
  ...views.renderers,
  ...generic.renderers,
])

test('a connection draws its integration, account, status and using apps', async () => {
  let app = { entity: { eid: 'app' }, doc: { title: 'Trip planner' } }
  for (
    let [integration, account, status, used, expected] of [
      [
        'openai',
        'jeff@yak.sh',
        'connected',
        false,
        'OpenAI · jeff@yak.sh · connected',
      ],
      ['unknown', null, 'needed', false, 'unknown · needed'],
      [
        'openai',
        null,
        'broken',
        true,
        'OpenAI · broken · used by Trip planner',
      ],
    ] as const
  ) {
    let b = {
      entity: { eid: 'connection' },
      connection: { integration, account, status },
      secret: { name: 'PRIVATE_KEY', value: 'PRIVATE_VALUE' },
      doc: { title: 'Secret title', body: 'PRIVATE_BODY' },
    }
    let service = {
      entity: { eid: integrationEid('openai') },
      integration: { name: 'openai', title: 'OpenAI' },
    }
    let link = {
      entity: { eid: 'link' },
      edge: { from: 'app', to: 'connection' },
      uses: {},
    }
    let lines: string[] = []
    await show(
      { tui: false, out: (line) => lines.push(line) },
      registry,
      vocab,
      used ? [b, link] : [b],
      {},
      {
        lookup: (eids) =>
          [service, app].filter((b) => eids.includes(b.entity.eid)),
        query: () => [],
      },
    )
    equal(lines[0].split('\n')[0], expected)
    ok(!lines[0].includes('PRIVATE'))
    ok(!lines[0].includes('Secret title'))
  }
})
