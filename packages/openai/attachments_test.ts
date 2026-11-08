import { equal, ok, test } from '@yaks/testing'
import { modelReads } from '@yaks/model'
import { input, responses } from './responses.ts'

test('native office files retain their filename separately from the attachment label', () => {
  let mediaType =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  equal(
    input([{
      kind: 'document',
      bytes: new Uint8Array([80, 75]),
      mediaType,
      filename: 'report.docx',
      label: '[Attachment: report.docx, sha=123]',
    }]),
    [{
      role: 'user',
      content: [
        { type: 'input_text', text: '[Attachment: report.docx, sha=123]' },
        {
          type: 'input_file',
          filename: 'report.docx',
          file_data: `data:${mediaType};base64,UEs=`,
        },
      ],
    }],
  )
})

test('text-only Responses models take office files while vision adds image and PDF input', async () => {
  let model = responses({
    credential: () => ({ token: 'key', base: 'https://api.openai.com/v1' }),
  })
  let text = await modelReads(model, 'o3-mini')
  let vision = await modelReads(model, 'gpt-6-sol')
  let docx =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ok(text[docx] > 16 * 1024 * 1024)
  equal(text['application/pdf'], undefined)
  equal(text['image/png'], undefined)
  ok(vision[docx] && vision['application/pdf'] && vision['image/png'])
  equal(await modelReads(model, 'text-embedding-3-small'), {})
  equal(await modelReads(model, 'gpt-4o-transcribe'), {})
})
