import { equal, test } from '@yaks/testing'
import { conversation } from './mod.ts'

test('plain text attachments use the Messages text-document source', () => {
  equal(
    conversation({
      model: 'claude-sonnet-5-5',
      tools: [],
      items: [{
        kind: 'document',
        mediaType: 'text/plain',
        bytes: new TextEncoder().encode('café'),
        filename: 'notes.txt',
        label: 'Notes attached to the message',
      }],
    }),
    [{
      role: 'user',
      content: [
        { type: 'text', text: 'Notes attached to the message' },
        {
          type: 'document',
          title: 'notes.txt',
          source: { type: 'text', media_type: 'text/plain', data: 'café' },
        },
      ],
    }],
  )
})
