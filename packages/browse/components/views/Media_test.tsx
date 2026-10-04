// The media view serves an artifact at its own address, including when an
// attachment points to it.
import { test } from '@yaks/testing'
import '../../testing.ts'
import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { cache, ent } from '../../live.ts'
import { mount } from '../mount.ts'

await import('../Entity.tsx')
let { resolve } = await import('../registry.ts')

let address = 'a'.repeat(64)
let show = (eid: string) => {
  let e = ent(eid)
  assertEquals(resolve(e).view, 'Media')
  return mount(h(resolve(e).Render, { e }))
}

test('artifact images, audio, and video preview at their blob address', () => {
  try {
    for (
      let [mime, tag] of [
        ['image/png', 'img'],
        ['audio/ogg', 'audio'],
        ['video/mp4', 'video'],
      ]
    ) {
      cache.value = {
        [address]: {
          entity: { eid: address, num: 9 },
          artifact: { eid: address, address, media_type: mime, size: 1234 },
          image: mime == 'image/png'
            ? { eid: address, w: 320, h: 180 }
            : undefined,
        },
      }
      let { root, free } = show(address)
      try {
        let media = root.querySelector(tag)!
        assertEquals(media.getAttribute('src'), `/blob/${address}`)
        if (tag == 'img') {
          assertEquals(media.getAttribute('width'), '320')
          assertEquals(media.getAttribute('height'), '180')
        } else assertEquals(media.hasAttribute('controls'), true)
      } finally {
        free()
      }
    }
  } finally {
    cache.value = {}
  }
})

test('other artifacts download, and attachments share the media face', () => {
  try {
    cache.value = {
      [address]: {
        entity: { eid: address, num: 9 },
        artifact: {
          eid: address,
          address,
          media_type: 'application/pdf',
          size: 2048,
        },
      },
      attached: {
        entity: { eid: 'attached', num: 10 },
        attachment: {
          eid: 'attached',
          artifact: address,
          media_type: 'application/pdf',
          name: 'notes.pdf',
        },
      },
    }
    for (
      let [eid, name] of [
        [address, 'file'],
        ['attached', 'notes.pdf'],
      ]
    ) {
      let { root, free } = show(eid)
      try {
        let link = root.querySelector('a')!
        assertEquals(link.getAttribute('href'), `/blob/${address}`)
        assertEquals(link.getAttribute('download'), name)
        assertEquals(link.textContent?.includes('2 KB'), true)
      } finally {
        free()
      }
    }
  } finally {
    cache.value = {}
  }
})
