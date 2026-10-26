import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { fileMark, imageUrl } from './media.js'

test('uploaded photos and direct image links have previews without treating documents as images', () => {
  assertEquals(
    imageUrl({ house_file: { blob: 'photo', mime: 'image/jpeg' } }),
    './api/blob/photo',
  )
  assertEquals(
    imageUrl({
      house_file: { url: 'https://example.org/photo.JPG?size=large' },
    }),
    'https://example.org/photo.JPG?size=large',
  )
  assertEquals(
    imageUrl({ house_file: { url: 'https://example.org/document.pdf' } }),
    '',
  )
  assertEquals(
    imageUrl({
      house_file: {
        url: 'https://example.org/photo.jpg',
        mime: 'application/pdf',
      },
    }),
    '',
  )
  assertEquals(
    imageUrl({ house_file: { url: 'https://example.org/unknown' } }),
    '',
  )
  assertEquals(
    imageUrl({
      house_file: { url: 'javascript:alert(1)', mime: 'image/svg+xml' },
    }),
    '',
  )
})

test('file marks identify hosted PDFs and files while website references keep an arrow', () => {
  assertEquals(
    fileMark({ house_file: { blob: 'pdf', mime: 'application/pdf' } }),
    'PDF',
  )
  assertEquals(
    fileMark({
      house_file: { url: 'https://example.org/care.PDF?download=1' },
    }),
    'PDF',
  )
  assertEquals(
    fileMark({ house_file: { blob: 'text', mime: 'text/plain' } }),
    '▤',
  )
  assertEquals(
    fileMark({ house_file: { url: 'https://example.org/codes' } }),
    '↗',
  )
})
