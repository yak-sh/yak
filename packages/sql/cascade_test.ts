// Successive cascade lookups share SQL without sharing their seed bindings.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { doomSql, looseSql } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      properties: {
        about: { type: 'string', ref: 'entity', death: 'cascade' },
        related: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})

test('cascade lookups bind each seed independently, including empty sets', () => {
  for (let ask of [doomSql, looseSql]) {
    for (
      let [ids, next, value] of [
        [['a'], ['b'], 'b'],
        [['a', 'b'], ['c', 'c', 'd'], '["c","d"]'],
        [['a', 'b'], [], '[]'],
      ] as [string[], string[], string][]
    ) {
      let first = ask(vocab, ids), second = ask(vocab, next)
      let sql = second[0].sql, tail = second[0].params.slice(1)
      first[0].sql = 'changed'
      first[0].params.fill('changed')
      second[0].params.push('extra')
      let third = ask(vocab, next)[0]
      equal(third.sql, sql)
      equal(third.params, [value, ...tail])
      equal(second[0].params[0], value)
    }
  }
})
