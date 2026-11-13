// The voice card as a browser reads it: what its host offers, in the order
// offered, the one picked now checked in each field, each voice with the ways
// that speak in it and where its sample plays from.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { equal, test } from '@yaks/testing'
import { type Offer, VoiceCard } from './ui.ts'

let offer: Offer = {
  setup: { voice: 'ash', pace: 'brisk', model: 'quick', backend: 'big' },
  voices: [
    {
      id: 'draco',
      name: 'Draco',
      about: 'Calm',
      ways: ['quick'],
      like: 'a butler',
    },
    { id: 'ash', name: 'Ash', about: 'Warm', ways: ['quick', 'talky'] },
  ],
  ways: [
    { model: 'talky', name: 'Quickest', about: 'At once' },
    { model: 'quick', name: 'Quick', about: 'After a pause' },
  ],
  paces: [
    { id: 'relaxed', name: 'Relaxed', about: 'Slow' },
    { id: 'brisk', name: 'Brisk', about: 'Fast' },
  ],
  backends: [
    { id: 'operator', name: 'Your Operator', about: 'It' },
    { id: 'big', name: 'A larger model', about: 'Them' },
  ],
}
let { document } = parseHTML(renderToString(h(VoiceCard, {
  name: 'Elihu',
  offer,
  sample: (id) => `/play?${id}`,
})))
// Each choice a field offers, by the name it shows, and the one checked.
let names = (field: string) =>
  [...document.querySelectorAll(`[name=${field}]`)]
    .map((i) => i.closest('label')!.querySelector('b')!.textContent)
let picked = (field: string) =>
  document.querySelector(`[name=${field}]:checked`)?.getAttribute('value')

test('the voice card offers its voices in order, the one picked checked', () => {
  equal(names('voice'), ['Draco', 'Ash'])
  equal(picked('voice'), 'ash')
  equal(
    document.querySelector('[value=draco]')!.closest('label')!.textContent,
    'Draco (like a butler) Calm',
  )
  equal(
    [...document.querySelectorAll('[name=voice]')]
      .map((v) => v.getAttribute('data-ways')),
    ['quick', 'quick talky'],
  )
  equal(
    [...document.querySelectorAll('[data-sample]')]
      .map((
        b,
      ) => [b.getAttribute('data-sample'), b.getAttribute('aria-label')]),
    [['/play?draco', 'Play Draco'], ['/play?ash', 'Play Ash']],
  )
})

test('the voice card picks a speed, a way to answer and who takes hard requests', () => {
  equal(names('voice_speed'), ['Relaxed', 'Brisk'])
  equal(names('voice_model'), ['Quickest', 'Quick'])
  equal(names('voice_backend'), ['Your Operator', 'A larger model'])
  equal(
    ['voice_speed', 'voice_model', 'voice_backend'].map(picked),
    ['brisk', 'quick', 'big'],
  )
})
