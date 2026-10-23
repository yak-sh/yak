// A comment in a list says who wrote it, when, what it is on, and its words.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { prepared } from '@yaks/render'
import { render } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { kernelDoc, kernelKeywords } from './vocab.ts'
import { views } from './views.ts'

let vocab = loadVocab([kernelDoc, docDoc, provenanceDoc], [kernelKeywords])
let ready = await prepared(views)

test('a comment in a list is who, when, what it is on, and its words', () => {
  let comment = {
    entity: { eid: 'c1' },
    doc: { title: 'Looks right.', body: 'Looks right. Ship it.' },
    comment: { target: 't9' },
    created: { by: 'u1', at: '2026-10-23T16:00:00Z' },
  }
  let ctx = {
    name: (eid: string) => ({ u1: 'Jeff', t9: 'T-9' })[eid] ?? eid,
    when: () => 'today',
  }
  assertEquals(
    render(ready, comment, 'Tile', vocab, ctx, 'plain'),
    'Jeff · today · on T-9 Looks right. Ship it.',
  )
})
