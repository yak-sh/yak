// The `@yaks/speech/ui` facet: where a persona's people pick how it speaks
// on a call (`speech{}`, ./vocab.json), drawn from the kit's parts. What it
// offers is its host's, which knows the providers it has keys for, and so is
// where its fields and its samples are sent.
import { h, type JSX } from 'preact'
import { Button, Card, Check, Form, Icon, Rows } from '@yaks/ui/parts'
// @ts-types="@yaks/ui/lucide"
import Play from 'lucide/dist/esm/icons/play.mjs'
import type { Voice } from './mod.ts'

/** One of a few to pick, in the words a person reads it in. */
export type Choice = { id: string; name: string; about: string }

/** A voice offered: the ways of answering that speak in it (their models),
 * and what it is like, said beside its name. */
export type Offered = Voice & { ways: string[]; like?: string }

/** How a call may be answered: the model, and what choosing it means. */
export type Way = { model: string; name: string; about: string }

/** What a voice card offers, each list holding the one picked now (`setup`),
 * by the ids `speech{voice, pace, model, backend}` holds. */
export type Offer = {
  setup: { voice: string; pace: string; model: string; backend: string }
  voices: Offered[]
  ways: Way[]
  paces: Choice[]
  backends: Choice[]
}

// One of a few to pick, as a radio: its name in bold, what it means beside
// it, `also` on its input.
let choice = (
  name: string,
  o: Choice,
  checked: boolean,
  also: Record<string, unknown> = {},
  more = '',
) =>
  h(
    Check,
    null,
    h(Check.Input, { type: 'radio', name, value: o.id, checked, ...also }),
    h(
      'span',
      null,
      h('b', null, o.name),
      more,
      ' ',
      h(Check.Note, null, o.about),
    ),
  )

// A field of few to pick one from, its label over them.
let choices = (
  id: string,
  label: string,
  name: string,
  offers: Choice[],
  picked: string,
) =>
  h(
    Form.Field,
    { role: 'radiogroup', 'aria-labelledby': id },
    h(Form.Label, { id }, label),
    offers.map((o) => choice(name, o, o.id == picked)),
  )

/** Where the people of `name` pick its voice from those offered, each played
 * from `sample(id)`, how fast it speaks, and how its calls are answered. It
 * posts `voice`, `voice_speed`, `voice_model` and `voice_backend`; each voice
 * names in `data-ways` the ways that speak in it, so its host's script can
 * grey the rest. */
export let VoiceCard = (
  { name, offer: { setup, voices, ways, paces, backends }, sample }: {
    name: string
    offer: Offer
    sample: (voice: string) => string
  },
): JSX.Element =>
  h(
    Card,
    null,
    h(Card.Head, null, h(Card.Title, null, 'Voice')),
    h(
      'p',
      null,
      `How ${name} sounds and answers when you call. Play a few voices, pick one, and save.`,
    ),
    h(
      Rows,
      null,
      voices.map((v) =>
        h(
          Rows.Item,
          null,
          choice(
            'voice',
            v,
            v.id == setup.voice,
            { 'data-ways': v.ways.join(' ') },
            v.like ? ` (like ${v.like})` : '',
          ),
          h(
            Rows.Actions,
            null,
            h(Button, {
              type: 'button',
              'data-sample': sample(v.id),
              'aria-label': `Play ${v.name}`,
              'data-tip': `Play ${v.name}`,
            }, h(Icon, { of: Play })),
          ),
        )
      ),
    ),
    choices('voice-speed', 'Speed', 'voice_speed', paces, setup.pace),
    choices(
      'voice-answers',
      'Answers',
      'voice_model',
      ways.map((w) => ({ id: w.model, name: w.name, about: w.about })),
      setup.model,
    ),
    choices(
      'voice-backend',
      'Hard requests',
      'voice_backend',
      backends,
      setup.backend,
    ),
  )
