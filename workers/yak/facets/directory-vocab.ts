// The directory’s Worker-owned words beside the package platform vocabulary.
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import { sweepDoc } from './sweep-vocab.ts'
import { bool, num, owned, ref, text, time } from './schema.ts'
export let directoryDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'directory',
  $defs: {
    // Storage survives config edits and renames. Only the kernel may record
    // account resource ids, so an app cannot claim another tenant's data.
    binding: {
      component: true,
      type: 'object',
      unique: [['app', 'name', 'type'], ['type', 'resource']],
      properties: {
        app: owned(ref('cascade')),
        name: owned(text),
        type: owned({ type: 'string', enum: ['d1', 'r2_bucket', 'vectorize'] }),
        id: owned(text),
        resource: owned(text),
      },
    },
    // Every address an app has answered at, oldest first: `slug` the one it was
    // born at, `slugs` each one a rename left behind. Address history and
    // nothing else — its storage handle is @yaks/platform’s `app.store`, which
    // is why a rename moves an address and never a byte (T-34657). Bare slugs,
    // in the space's own namespace, so a space rename leaves every app's
    // history standing.
    //
    // It was named `alias` until T-34390, when that word became the
    // platform's own (@yaks/alias, in {@link coreDocs}): a name any entity may
    // wear in any store. Two things cannot share one word, and the one every
    // store speaks wins — so the app's addresses are `former`, which is what
    // the record is about.
    //
    // A space wears it too, for the same reason and in the same shape
    // (T-34658): its birth subdomain and every one a rename left behind, each
    // still redirecting. Not unique here — uniqueness is over an address within
    // a space for an app, and over the whole platform for a space, and neither
    // is one property's own race; the tools decide both (tools.ts `taken`).
    former: {
      component: true,
      type: 'object',
      properties: { slug: text, slugs: text },
    },
    // Which app is the space's front page, and the paths its worker sees first
    // before the app whose slug owns them (D-34197, T-34227). One fact, one
    // place: the app wearing `home` is the home app, and its globs are
    // properties of the same word — a `space.home` beside it would be a second
    // place to say the same thing, and two copies of one fact drift.
    //
    // At most one app per space wears it. The vocabulary cannot say so —
    // `unique` covers one component's own properties and `home` has no space of
    // its own — so it is the directory's rule instead (directory.ts `homing`,
    // where moving it is one batch that drops the old and adds the new).
    //
    // A property is a scalar (@yaks/vocab `storable`), so the list is JSON in
    // one text property — ordered, and read back by router.ts `firstOf`. The
    // `former.slugs` above splits on whitespace instead, which is the older
    // form of a list here; JSON is the one that round-trips exactly what an
    // agent passed.
    home: {
      component: true,
      type: 'object',
      properties: { first: text },
    },
    member: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['space', 'person']],
      properties: {
        space: ref('cascade'),
        person: ref('cascade'),
        role: { type: 'string', enum: ['owner', 'editor', 'viewer'] },
      },
    },
    // A seat reaches every app in its space; this reaches one (T-37615). It is
    // the word @yaks/member already uses for that — the same three levels,
    // the same meaning — said here because the ladder a page is read by is the
    // platform's roster and this is its other rung: somebody invited to one
    // app holds that app's data and its page as a member does, and holds no
    // other app in the space at all. Never its files: writing an app's bytes
    // stays a member's act (apps.ts, public/docs/sharing.md).
    grant: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['app', 'person']],
      properties: {
        app: ref('cascade'),
        person: ref('cascade'),
        access: { type: 'string', enum: ['owner', 'editor', 'viewer'] },
      },
    },
    // A seat or a grant offered and not yet taken (invite.ts, T-37880). `to`
    // is the space (a seat) or the app (a grant), one property the way
    // `hostname.serves` is, and accepting is one batch that writes the
    // `member` or `grant` row and drops this one. A word of its own rather
    // than a pending mark on the seat, so everything that reads `member` and
    // `grant` (reach, the roster, a bare app slug) reads accepted rows and
    // nothing else, with no filter for a new reader to forget. `sent` is when
    // its latest letter went, which is what its inviter asks when the person
    // says they cannot get in (people.ts), and `by` who sent it, which is who
    // the letter's link names to whoever opens it (pages.ts `invited`).
    invite: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['to', 'person']],
      properties: {
        to: ref('cascade'),
        person: ref('cascade'),
        role: { type: 'string', enum: ['owner', 'editor', 'viewer'] },
        sent: owned(time),
        by: owned(ref('keep')),
      },
    },
    // How many invitations this person has sent in the hour it names
    // (invite.ts `CAP`). On the inviter's own row, because the cap is theirs
    // and an invitation row dies when it is accepted or withdrawn, which would
    // hand a sender back the letter it had counted.
    inviting: {
      component: true,
      type: 'object',
      properties: { hour: owned(text), sent: owned(num) },
    },
    email: {
      component: true,
      type: 'object',
      properties: { address: text },
    },
    // A file an app published at a path of its address (public-files.ts):
    // served to anyone there, before the app runs, whatever its access. Its
    // eid is derived from the app and the path, so an address holds one file.
    // The bytes are the app's, under its own prefix (`public/<sha>`).
    public_file: {
      description:
        'A file an app published at a path of its address, served to anyone before the app runs.',
      component: true,
      type: 'object',
      kind: true,
      identity: ['app', 'path'],
      properties: {
        app: owned(ref('cascade')),
        path: owned(text),
        sha: owned(text),
        mime: owned(text),
        size: owned(num),
      },
    },
    // One time this app's store was put back to a moment (recover.ts,
    // T-34507): when it was asked for, the moment asked for, who asked, and
    // the bookmark the store stood at before it moved.
    //
    // An entity of its own per restore, like `deploy`, and not a word on the
    // app row — because the record exists so that a restore can itself be
    // undone, and a second restore overwriting the first would take away the
    // way back from it. It lives in the directory, which is a different object
    // from the store it describes, so the trail survives the very recovery it
    // is about: what the store held is wound back, and what happened to it is
    // still written down here.
    restored: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        app: ref('cascade'),
        at: owned(time),
        to: owned(time),
        by: owned(ref('keep')),
        from_bookmark: owned(text),
      },
    },
    // That this app — or this space — is in the trash, and since when
    // (erase.ts, T-34430, T-34431). A delete marks it and keeps everything:
    // the bytes, the store, the slug. While it is worn the app answers
    // nothing on the web, leaves everyone's tool and view lists, is not the
    // front page whatever else it wears, and its mail bounces; a space wearing
    // it does all of that for every app in it at once. `app_restore` and
    // `space_restore` take the word off and give all of that back, and thirty
    // days on the daily sweep erases it for good.
    //
    // One word on the row rather than a state property beside it, for the
    // reason `home` is one: what is in the trash is what wears this, and a
    // second copy of the same fact drifts from it. That is also why an
    // app and a space share the word — it says one thing, thrown away and
    // since when, and every reader asks the row in front of it.
    trashed: {
      component: true,
      type: 'object',
      properties: { at: time, by: ref('keep') },
    },
    // That this app's offer has been put forward for the gallery, and whether
    // we said yes (gallery.ts, T-34476). Two stamps rather than a state word:
    // `asked_at` is the owner of the app asking, `listed_at` is the platform
    // answering, and a row wearing both is on https://yaks.app/gallery. The
    // pair reads as one sentence in either direction — nothing is listed that
    // was never asked for, and clearing the word un-asks and de-lists at once.
    //
    // Server-owned, both of them, and the only word on an app that is: the
    // listing is on our site under our name (M-4522), so it may never be
    // something a write can lift for itself. The tools stamp them through the
    // kernel's own door (directory.ts `stamp`).
    gallery: {
      component: true,
      type: 'object',
      properties: { asked_at: owned(time), listed_at: owned(time) },
    },
    // An uploaded image the owner chose to represent this app. Its bytes and
    // attachment live in the app's store; only the content address lives here.
    screenshot: {
      component: true,
      type: 'object',
      properties: { blob: text },
    },
    // The colours an app's owner set for its installed chrome (apps.ts
    // `manifesting`/`pinned`, T-33055) — settable by the app, through
    // `app_set`, never guessed off its page: an app that names neither gets
    // the platform's own palette instead of a browser's default grey.
    theme: {
      component: true,
      type: 'object',
      properties: { theme_color: text, background_color: text },
    },
    // That this app's store has been seeded, and by which release (seed.ts,
    // T-34327). The mark is what makes the seed a once — a redeploy finds it
    // and writes nothing, so the data an app comes with never lands on top of
    // what the person has changed since. It lives on the app rather than in
    // the store because an install mints a new app row and a new store
    // together, and the copy is meant to be seeded again.
    seeded: {
      component: true,
      type: 'object',
      properties: { at: time, version: num },
    },
    // The Stripe account this space sells through (sell.ts, T-34524). Direct
    // charges: the connected account is the merchant, so this is the whole of
    // what the platform keeps about it — the id every call carries in its
    // `Stripe-Account` header, and the two words Stripe answers with about
    // whether it is ready. Everything else about the merchant — their bank,
    // their business details, their disputes — is Stripe's and stays there.
    //
    // Server-owned, all three, for the reason `plan` is: `charges_enabled` is
    // what the checkout door reads before it takes anybody's money, and a
    // property a space could write for itself is a space selling before Stripe
    // ever said it may. Only the Connect webhook and `space_sell` write them,
    // through the kernel's own door (directory.ts `stamp`).
    stripe: {
      component: true,
      type: 'object',
      properties: {
        account: owned(text),
        charges_enabled: owned(bool),
        details_submitted: owned(bool),
      },
    },
    // What the platform takes from one sale, in basis points (sell.ts `fee`),
    // on the platform's own space row — `yak`, the one row in this directory
    // that is the platform rather than a customer. Unset reads as 0, which is
    // every sale until somebody sets a rate.
    //
    // Stamped, and the only writer is the owner's own door (sell.ts `fees`).
    // A fee a space could write for itself is a seller choosing what they pay
    // us; a fee written around that door is one the read cache would go on
    // answering for a TTL, and the rate a sale is charged has to be the rate
    // the owner set a moment ago.
    fee: {
      component: true,
      type: 'object',
      properties: { bps: owned(num) },
    },
    // What a space just spent on its month: a letter, a build, a model call, a
    // voice's lease, container seconds. The directory adds it to the `meter`
    // inside the write's own transaction (meter.ts `spend`), so two spends at
    // once both count, and takes it off again: it is never kept.
    spend: {
      component: true,
      type: 'object',
      properties: {
        month: text,
        emails: num,
        builds: num,
        models: num,
        realtime: num,
        seconds: num,
      },
    },
    // When this person last got in, and how (identity.ts `landed`, T-34351).
    // One row, so it holds the last way in rather than a trail — which is the
    // question a standing sign-in link raises: has anybody used it at all. Not
    // `kind`: it is a mark a person wears, never a thing of its own.
    signed_in: {
      component: true,
      type: 'object',
      properties: {
        at: owned(time),
        via: owned({ type: 'string', enum: ['code', 'link'] }),
      },
    },
  },
}
export let useDoc: VocabDoc = {
  title: 'directory-use',
  reserved: false,
  $defs: {
    used: {
      description: 'When a person or their app last used this entity.',
      component: true,
      type: 'object',
      wire: false,
      journal: false,
      properties: { at: owned(time) },
    },
    // An app whose code still sends a query in a retired spelling, which the
    // grammar translates for kept releases (T-122930). A translation goes only
    // once no app has sent its spelling for a while (T-123000, M-37853).
    translated: {
      description:
        'A retired query spelling an app still sends, which the grammar translates, and the hour it last did.',
      component: true,
      type: 'object',
      wire: false,
      journal: false,
      identity: ['app', 'spelling'],
      properties: {
        app: owned(ref('cascade')),
        spelling: owned(text),
        at: owned(time),
      },
    },
  },
}
// How the directory serves an app, in words no app's manifest needs kept
// from it: they only ever sit on the directory's own app rows.
export let servingDoc: VocabDoc = {
  title: 'directory-serving',
  reserved: false,
  $defs: {
    // An app whose pages in folders resolve their relative URLs from the
    // app's root, the base every page had until each page was based at its
    // own folder (apps.ts `asset`). Worn by the apps whose pages were written
    // against the old base (app-grep found one, thecompanygardener's
    // openai-math, T-124410); nothing else wears it.
    rooted: {
      description:
        "An app whose pages in folders resolve relative URLs from the app's root.",
      component: true,
      type: 'object',
      properties: {},
    },
    // An app that has published a file (public-files.ts), so each request it
    // is sent looks for one at its path before the app runs. Worn from its
    // first publish on; an app that never published pays nothing for it.
    publishing: {
      description:
        'An app that has published files, so its requests look for one at their path first.',
      component: true,
      type: 'object',
      properties: {},
    },
  },
}
export let docs: VocabDoc[] = [
  directoryDoc,
  sweepDoc,
  useDoc,
  servingDoc,
  // The release's start-up work that seeds the schedules (directory-effects.ts).
  { reserved: false, $defs: { sweep_install: { effect: true, start: true } } },
]
