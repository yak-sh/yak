// The Worker’s own app and store words; package words stay in their facets.
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import { edgeKeywords } from '@yaks/edge/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { num, owned, ref, text, time } from './schema.ts'
let referencedDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true, [edgeKeywords.uri]: true },
  title: 'relations',
  $defs: {
    referenced: {
      component: true,
      type: 'object',
      edge: true,
      properties: {},
    },
  },
}

export let exceptionDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'exception',
  $defs: {
    exception: {
      ...toolsDoc.$defs!.exception,
      kind: true,
      before: ['doc'],
    },
  },
}

export let kernelDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'kernel',
  $defs: {
    // A known failure state the platform reports deliberately, as against a
    // break nobody chose. `app_errors` reads both facets in every store, so
    // both are declared in every store.
    error: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      // `code` is @yaks/tools' half of this word: what a refused call says
      // about itself, written by the runner rather than stamped by the
      // platform. One word, both meanings, so a store never has to choose.
      properties: { at: owned(time), message: owned(text), code: text },
    },
    // The two rows a page's upload makes (apps.ts `took`): the content,
    // addressed by its sha, and the use of it, addressed off that. They stay
    // apart because they are two things, and because a component may not point
    // at its own entity.
    blob: {
      component: true,
      type: 'object',
      properties: { bytes: num },
    },
    attachment: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        blob: ref('cascade'),
        mime: text,
        name: text,
        artifact: ref('keep'),
        call: text,
        revised_prompt: text,
      },
    },
    // Deleting an upload's content row deletes its bytes too (app-effects.ts),
    // unless a row the app keeps still names them (apps.ts `naming`). So the
    // row is the one door for deleting an upload, and whoever may delete the
    // row (@yaks/member) is who may delete the file.
    delete_upload: {
      effect: true,
      removed: ['blob'],
      description: 'delete a deleted upload’s bytes once nothing names them',
    },
  },
}

export let appsDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'apps',
  $defs: {
    // Something for sale (sell.ts, T-34525). Platform's rather than each app's
    // for the reason every other word here is platform's — a `product` in one
    // shop is the same word as a `product` in the next, so one filter reads
    // both — and for one more: the checkout door reads `price_cents` off this
    // row, and a door that took the price off the wire would take a price a
    // buyer can edit. A word the platform charges money against is a word the
    // platform declares.
    //
    // `sizes` is the variants the seller offers, comma-separated, and what a
    // page turns into the `options` on a cart line. `stock` is the seller's own
    // count — nothing here decrements it, because a shop that oversells by one
    // is a conversation and a shop that loses an order to a race is a bug.
    product: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price_cents: num,
        sizes: text,
        stock: num,
        image: { type: 'string', format: 'uri' },
      },
    },
    // Something sold (sell.ts, T-34526): one row per completed Stripe
    // checkout, written into the app's own store by the Connect webhook, as
    // the app. Platform's rather than each app's for the reason `product` is:
    // the platform writes it, and a word the platform writes is a word the
    // platform declares — an app that declared its own `order` would have the
    // platform writing into a shape it does not know.
    //
    // It is the whole record of a sale on this side. The money itself is
    // Stripe's: `session` and `intent` are how a seller finds it there, and
    // `account` says whose books it landed on. Nothing here is authoritative
    // about the payment — Stripe is — and the row exists so the seller knows
    // what to put in the box and who to post it to.
    //
    // `items` is the cart as JSON in one text property, the way `home.first`
    // is; a property is a scalar, and this is a list.
    //
    // Every property is server-owned: the webhook writes it through the
    // kernel's door (sell.ts `asApp`), and no page, member or visitor can say
    // an order was paid (T-37881). Who may remove one is graph.ts `FLOORS`.
    order: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        session: owned(text),
        intent: owned(text),
        account: owned(text),
        items: owned(text),
        total_cents: owned(num),
        fee_cents: owned(num),
        email: owned(text),
        status: owned({
          type: 'string',
          enum: ['paid', 'partially_refunded', 'refunded', 'disputed', 'lost'],
        }),
      },
    },
    web: {
      component: true,
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        frozen_at: owned(time),
      },
    },
  },
}
export let classificationDoc: VocabDoc = {
  ...archetypeDoc,
  $defs: Object.fromEntries(
    Object.entries(archetypeDoc.$defs ?? {}).map((
      [name, definition],
    ) => [name, { ...definition, wire: false }]),
  ),
}
export let docs: VocabDoc[] = [
  referencedDoc,
  exceptionDoc,
  kernelDoc,
  appsDoc,
  classificationDoc,
  {
    reserved: false,
    $defs: { builder_install: { effect: true, start: true } },
  },
]
