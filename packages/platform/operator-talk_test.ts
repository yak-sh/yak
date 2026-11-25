import { equal, test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { operatorTalk, talkAsked, talkRow } from './operator-talk.ts'

test('a conversation’s line says its space and the conversation shown, and parses as a query', () => {
  for (let task of ['T-1', undefined]) {
    let line = operatorTalk('space-home', task)
    parse(line)
    equal(talkAsked(line), { space: 'space-home', ...task ? { task } : {} })
  }
  equal(talkAsked('.operatorDraft.space=space-home&*'), undefined)
})

test('each person’s conversation is its own row', () => {
  let talk = { space: 'space-home', task: 'T-1' }, told = { opened: 'o', n: 0 }
  equal(talkRow('ada', talk, told).operatorTalk, {
    ...talk,
    typing: '',
    ...told,
  })
  equal(
    talkRow('ada', talk, told).entity.eid ==
      talkRow('bea', talk, told).entity.eid,
    false,
  )
})
