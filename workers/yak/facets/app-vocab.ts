// The Worker’s own app and store words; package words stay in their facets.
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import { edgeKeywords } from '@yaks/edge/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { num, owned, ref, text, time } from './schema.ts'
import { noticesDoc } from '../notices-vocab.ts'
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
        audience: { type: 'string', enum: ['user', 'model'] },
        call: text,
        revised_prompt: text,
        // The web address the file was fetched from (library-tools.ts).
        source: text,
      },
    },
    // Deleting an upload's content row deletes its bytes too (app-effects.ts),
    // unless a row the app keeps still names them (apps.ts `naming`). So the
    // row is the one door for deleting an upload, and whoever may delete the
    // row (@yaks/member) is who may delete the file.
    document_page: {
      component: true,
      type: 'object',
      description:
        'Text extracted from one stored document page; searchable by words and meaning.',
      properties: {
        document: owned(ref('cascade')),
        blob: owned(ref('cascade')),
        page: owned(num),
        location: owned(text),
        text: owned({ ...text, search: true }),
      },
    },
    document_text: {
      component: true,
      type: 'object',
      description: 'Completed extraction of an attachment’s immutable bytes.',
      properties: { blob: owned(ref('cascade')), pages: owned(num) },
    },
    document_extract: {
      effect: true,
      created: ['attachment'],
      changed: ['attachment.blob', 'attachment.mime', 'attachment.name'],
      target: '.attachment',
      description:
        'Extract stored documents once into searchable pages, reading scanned pages too.',
    },
    form_post: {
      effect: true,
      created: ['completed'],
      target: '.registration',
      description:
        'Notify a completed registration’s recipients and email its confirmation.',
    },
    delete_upload: {
      effect: true,
      removed: ['blob'],
      description: 'delete a deleted upload’s bytes once nothing names them',
    },
    // Every entity here carries `created`, so its removal is the entity's
    // death (deaths.ts).
    notify_deaths: {
      effect: true,
      removed: ['created'],
      description:
        'tell the space’s other apps an entity here died, so their references to it follow their death rules',
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
    // Something sold (sell.ts, T-34526): one row per completed checkout at the
    // payment provider, written into the app's own store by its shops
    // webhook, as
    // the app. Platform's rather than each app's for the reason `product` is:
    // the platform writes it, and a word the platform writes is a word the
    // platform declares — an app that declared its own `order` would have the
    // platform writing into a shape it does not know.
    //
    // It is the whole record of a sale on this side. The money itself is the
    // provider's: `session` and `intent` are how a seller finds it there, and
    // `account` says whose books it landed on. Nothing here is authoritative
    // about the payment — the provider is — and the row exists so the seller knows
    // what to put in the box and who to post it to.
    //
    // `items` is the cart as JSON in one text property, the way `home.first`
    // is; a property is a scalar, and this is a list.
    //
    // Every property is server-owned: the webhook writes it through the
    // kernel's door (sell.ts `asApp`), and no page, member or visitor can say
    // an order was paid (T-37881). Who may remove one is graph.ts `FLOORS`.
    refund_request: {
      component: true,
      type: 'object',
      readers: 'editor',
      status: {
        completed: 'refunded',
        refund_failed: 'failed',
        refund_sent: 'processing',
        default: 'requested',
      },
      properties: {
        order: owned(ref('keep')),
        amount: owned(num),
        reason: owned(text),
      },
    },
    refund_sent: {
      component: true,
      type: 'object',
      readers: 'editor',
      properties: { reference: owned(text), amount: owned(num) },
    },
    refund_failed: {
      component: true,
      type: 'object',
      readers: 'editor',
      properties: { at: owned(time), reason: owned(text) },
    },
    refund_retry: {
      component: true,
      type: 'object',
      readers: 'editor',
      properties: { at: owned(time) },
    },
    refund_sale: {
      effect: true,
      created: ['refund_request', 'refund_retry'],
      changed: ['refund_retry.at'],
      target: '.refund_request',
      description:
        'Refund a merchant payment under its durable request identity.',
    },
    service_checkout: {
      component: true,
      type: 'object',
      readers: 'editor',
      properties: { snapshot: owned(text) },
    },
    service_quote: {
      component: true,
      type: 'object',
      readers: 'editor',
      properties: { snapshot: owned(text), hash: owned(text) },
    },
    order: {
      component: true,
      type: 'object',
      kind: true,
      readers: 'editor',
      before: ['doc'],
      properties: {
        session: owned(text),
        intent: owned(text),
        account: owned(text),
        items: owned(text),
        quote: owned(ref('keep')),
        document: owned(ref('keep')),
        revision: owned(text),
        specification: owned(text),
        buyer: owned(ref('keep')),
        source: owned(ref('keep')),
        quantity: owned(num),
        currency: owned(text),
        shipping_cents: owned(num),
        tax_cents: owned(num),
        total_cents: owned(num),
        fee_cents: owned(num),
        refunded_cents: owned(num),
        email: owned(text),
        status: owned({
          type: 'string',
          enum: ['paid', 'partially_refunded', 'refunded', 'disputed', 'lost'],
        }),
      },
    },
    sale_access: {
      component: true,
      type: 'object',
      readers: 'editor',
      floor: 'editor',
      description: 'Customer authority for private sale records and artifacts.',
      properties: { buyer: owned(ref('keep')), via: owned(ref('keep')) },
    },
    sale_artifact: {
      component: true,
      type: 'object',
      readers: 'editor',
      floor: 'editor',
      description: 'A customer’s entitlement to one private sale artifact.',
      properties: { artifact: owned(ref('cascade')) },
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
  noticesDoc,
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
