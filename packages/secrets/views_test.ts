import { equal, test } from '@yaks/testing'
import { define } from '@yaks/render'
import { views as docViews } from '@yaks/doc/views'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { plain, tree } from '@yaks/text'
import { secretsDoc } from './vocab.ts'
import { views } from './views.ts'

let vocab = loadVocab([secretsDoc, docDoc])
let registry = define([...views.renderers, ...docViews.renderers])
test('secret listings show only the config name and optional title', () => {
  let secret = {
    entity: { eid: 'secret' },
    secret: { name: 'MAIL_TOKEN', value: 'must-not-be-listed' },
  }
  for (let view of ['Title', 'Tile']) {
    equal(
      plain(tree(registry, secret, view, vocab)),
      `MAIL_TOKEN${view == 'Tile' ? ' (/secret)' : ''}`,
    )
    equal(
      plain(
        tree(
          registry,
          {
            ...secret,
            doc: { title: 'Outgoing mail', body: 'Not listing text' },
          },
          view,
          vocab,
        ),
      ),
      `Outgoing mail · MAIL_TOKEN${view == 'Tile' ? ' (/secret)' : ''}`,
    )
  }
})
