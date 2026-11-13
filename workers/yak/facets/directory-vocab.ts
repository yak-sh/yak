// The directory’s Worker-owned words beside the package platform vocabulary.
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import { sweepDoc } from './sweep-vocab.ts'
import { operatorDoc } from '../operator-vocab.ts'
import { bool, num, owned, ref, text, time, unique } from './schema.ts'
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
        // The space is the person's own: the one minted for them, which their
        // settings and an unnamed tool call mean (directory.ts `own`). A rename
        // leaves it standing, where their address no longer names it.
        own: bool,
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
    // Another space's Operator let into this one (T-136179): the Operator of
    // `operator` works in `space` with `role`, for whoever may ask it there.
    // A space's owner writes it on its People page (operator-reach.ts), and
    // `by` is who.
    operator_reach: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['space', 'operator']],
      properties: {
        space: ref('cascade'),
        operator: ref('cascade'),
        role: { type: 'string', enum: ['editor', 'viewer'] },
        by: owned(ref('keep')),
      },
    },
    // The Operator's settings are its persona's, in its own store
    // (operator-persona.ts `held`). The directory keeps a copy of its name,
    // which the store's `operator_named` writes, for what reads a space
    // without its store (lists, letters, christening). Its other properties
    // are what the store copies from on its first read, until every store
    // has copied them.
    operator: operatorDoc.$defs!.operator,
    // The picture a space wears where its first letter stood (pages.ts
    // `choice`): the bytes at `sha` in the bucket under the space's
    // handle (apps.ts `LOGO`), and their image type. Its owner sets it in
    // the space's settings, or takes it off.
    space_logo: {
      component: true,
      type: 'object',
      description:
        "The space's logo: the SHA-256 of its image's bytes and their type.",
      properties: { sha: text, type: text },
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
    // How a person is told what their Operators tell them away from the page
    // (operator-alerts.ts): on the browsers they allowed, by text, by email,
    // or only in their Updates. Without it, by text when they agreed to
    // texts, else by email.
    operator_alerts: {
      component: true,
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['push', 'text', 'email', 'updates'] },
      },
    },
    // How a person keeps the side of their yaks.app pages (desk-pages.ts
    // `deskFrame`, operator-page.ts `side`): collapsed to a rail of icons,
    // or open with each one's name beside it, the way it was without it.
    desk_sidebar: {
      component: true,
      type: 'object',
      properties: { collapsed: { type: 'boolean' } },
    },
    // One list an MCP server a person connected offers their Operator's page,
    // drawn beside the conversation with no model turn (operator-lists.ts),
    // on an entity of its own whose `doc{title}` heads it: the `server`'s
    // `tool` called with `args` (a JSON object, read whole), whose rows are
    // drawn in its order. `waits` says its rows wait on the person, so the
    // bar and the installed page's icon count them; `ord` is its place among
    // the server's lists.
    mcp_list: {
      component: true,
      type: 'object',
      properties: {
        server: ref('cascade'),
        tool: text,
        args: text,
        waits: bool,
        ord: num,
      },
    },
    // Where an id the same server's rows carry (T-123) opens, on its
    // `mcp_server` row: `url` with `{id}` where the id goes. The Operator page
    // makes each such id in a reply a link there (operator-rows.ts `mention`).
    mentions: {
      component: true,
      type: 'object',
      properties: { url: text },
    },
    // One OAuth grant a person holds, as their agents and services are listed
    // (grant-rows.ts): written as the provider writes the grant to KV, gone
    // when it deletes it, and holding none of its secrets. Its eid is derived
    // from the grant's id. Times are unix seconds; `until` is when KV lets a
    // grant whose code was never exchanged go.
    oauth_grant: {
      component: true,
      type: 'object',
      properties: {
        person: owned(ref('cascade')),
        id: owned(text),
        client: owned(text),
        created: owned(num),
        redirect: owned(text),
        name: owned(text),
        scope: owned(text),
        expires: owned(num),
        until: owned(num),
      },
    },
    // On a person's row: their `oauth_grant` rows are whole, every grant they
    // held before the rows began copied in from KV since `at`.
    grants_listed: {
      component: true,
      type: 'object',
      properties: { at: owned(time) },
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
    // A private published app's sample store (sample.ts, D-134327): the
    // handle of the store holding its published seed, which strangers read,
    // the sha of the declaration and seed it was made from, and the version
    // and release it was made at, which strangers are served. Server-owned:
    // a handle an app could write is a door into another app's store.
    demo: {
      component: true,
      type: 'object',
      properties: {
        store: owned(text),
        seed: owned(text),
        version: owned(num),
        release: owned(text),
      },
    },
    // A browser's own store of an app it visited without a seat (visit.ts,
    // D-134327), on its `worked` edge to the app: the store's handle and where
    // its uploads go, both written once at its first write, when it was last
    // used (at most hourly), and the app it became when its person installed
    // it. Server-owned for the reason `demo` is.
    visit: {
      component: true,
      type: 'object',
      properties: {
        store: owned(text),
        blobs: owned(text),
        seen: owned(time),
        adopted: owned(text),
      },
    },
    // The connected account this space sells through (sell.ts, T-34524).
    // Direct charges: the connected account is the merchant, so this is the
    // whole of what the platform keeps about it — the payment provider it is
    // held at (`via`, its name: `stripe`), the id every call names it by, and
    // the provider's two answers about whether it is ready: `submitted`, they
    // finished its form, and `ready`, it will take money for them. Everything
    // else about the merchant — their bank, their business details, their
    // disputes — is the provider's and stays there.
    //
    // Server-owned, all four, for the reason `plan` is: `ready` is what the
    // checkout door reads before it takes anybody's money, and a property a
    // space could write for itself is a space selling before its provider ever
    // said it may. Only the provider's webhook and `space_sell` write them,
    // through the kernel's own door (directory.ts `stamp`).
    seller: {
      component: true,
      type: 'object',
      properties: {
        via: owned(text),
        account: owned(text),
        ready: owned(bool),
        submitted: owned(bool),
      },
    },
    // A number the platform holds for a space (numbers.ts): bought through
    // the phone lent as `via`, on the platform's account, at the price it was
    // bought at in dollars, `upfront` once and `monthly`, and the toll-free
    // verification filed for it by the provider's id. Whichever space or app
    // row wears it as `phone{number}` is where it texts from; the line says
    // only who holds it. The row wears the wake that charges each later
    // month (meter-graph.ts `lines`). The space keeps it, so erasing the
    // space releases it at the provider and buries it (erase.ts) rather than
    // its death taking it.
    //
    // Stamped, all of it, for the reason `seller` is: it is money the
    // platform spends, written only by the number tools (numbers.ts).
    phone_line: {
      component: true,
      type: 'object',
      properties: {
        number: owned(unique(text)),
        via: owned(text),
        space: owned(ref('keep')),
        upfront: owned(num),
        monthly: owned(num),
        at: owned(time),
        verification: owned(text),
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
    // A space's monthly dollar budget for models and voice, in place of its
    // plan's (meter.ts `limitOf`). Stamped, and written only by the platform
    // owner's door (budget.ts), for the reason the fee is, and by a
    // newcomer's start (newcomer.ts `oneBuild`), whose budget is one build's
    // and says so (`newcomer`) until keeping it lifts the budget whole.
    budget: {
      component: true,
      type: 'object',
      properties: { dollars: owned(num), newcomer: owned(bool) },
    },
    // The dollars a space holds once, before its monthly budget, where it
    // holds other than meter.ts `STARTER`: none on a person's later spaces
    // (directory.ts `mint`). Stamped, for the reason the budget is.
    starter: {
      component: true,
      type: 'object',
      properties: { dollars: owned(num) },
    },
    // The percent of a space's month budget for models and voice that its
    // apps' visitors may spend together (meter.ts `visiting`), and the model
    // calls one visitor may ask for in a day (meter.ts `visitorCalls`), where
    // its owner set them with space_set; none is meter.ts `VISITORS` and
    // `VISITOR_CALLS`. The owner's to write, so it is not stamped.
    visitor_share: {
      component: true,
      type: 'object',
      properties: { percent: num, calls: num },
    },
    // The space a person's starter went to (directory.ts `mint`): worn from
    // their first space on, and kept once that space is gone, so the starter
    // is theirs once.
    started: {
      component: true,
      type: 'object',
      properties: { space: owned(ref('keep')) },
    },
    // When a person came in by the home page's box (newcomer.ts), before they
    // had an address: a newcomer (directory.ts `newcomer`) until they sign in
    // on that browser or their space is erased, when the row goes
    // (erase.ts `vacated`).
    newcomer: {
      component: true,
      type: 'object',
      properties: { at: { type: 'string', format: 'date-time' } },
    },
    // When the home page's box opened this space for a newcomer
    // (newcomer.ts `oneBuild`). It stays once they keep it, so the platform
    // admin's Visitor builds page (admin.ts) says who kept each build after
    // the newcomer's own row is gone.
    visitor_build: {
      component: true,
      type: 'object',
      properties: { at: time },
    },
    // A site somebody else may own, rebuilt here from its web address
    // (newcomer.ts `previewing`). On a space: the box was given that address
    // `at`, and the apps born here for KEEPING after are previews of it. On
    // an app: it is one, private, marked on its pages and never indexed,
    // until a domain of that site is verified on its space (domains.ts
    // `refresh`), which takes the mark off both rows.
    preview: {
      component: true,
      type: 'object',
      properties: { site: owned(text), at: owned(time) },
    },
    // What a space just spent on its month: a letter, a build, a model call, a
    // voice's lease, an app's text, container seconds. The directory adds it to the `meter`
    // inside the write's own transaction (meter.ts `spend`), so two spends at
    // once both count, and takes it off again: it is never kept. A `held`
    // spend is a model call or a voice's lease holding its most before it
    // starts (model-spend.ts `reserved`), and the write is refused when it
    // does not fit what is left of the month's budget. A `refunded` one is
    // the platform owner's correction (budget.ts), `why` it was refunded,
    // journaled with who wrote it since the meter is not. A `bought` one is a
    // block of credit paid for, added to the space's `credit` (billing.ts
    // `credited`). Stamped, all three, for the reason the budget is.
    spend: {
      component: true,
      type: 'object',
      properties: {
        month: text,
        held: { type: 'boolean' },
        emails: num,
        builds: num,
        models: num,
        realtime: num,
        texts: num,
        seconds: num,
        visitors: num,
        // What its dollars bought (meter.ts `SOURCES`), kept by the day in
        // the space's `trend.sources`.
        source: text,
        refunded: owned(num),
        why: owned(text),
        bought: owned(num),
      },
    },
    // One block of credit paid for (billing.ts `credited`), named by the
    // checkout that sold it, so a payment told twice is credited once: the
    // row is written only where none is, in the write whose `spend{bought}`
    // adds the block to the space's `credit`. Stamped, for the reason the
    // budget is.
    credit_block: {
      component: true,
      type: 'object',
      properties: {
        space: owned(ref('keep')),
        dollars: owned(num),
        checkout: owned(text),
      },
    },
    // When this person last got in, and how (signin.ts `stamped`, T-34351).
    // One row, so it holds the last way in rather than a trail — which is the
    // question a standing sign-in link raises: has anybody used it at all —
    // and `first`, when they first got in, written once by that first
    // sign-in, which is the funnel's sign-up (T-149011). Not `kind`: it is a
    // mark a person wears, never a thing of its own.
    signed_in: {
      component: true,
      type: 'object',
      properties: {
        at: owned(time),
        via: owned({ type: 'string', enum: ['code', 'link'] }),
        first: owned(time),
      },
    },
    // A build of yaks.app the kernel asked main's deploy hook for, and the
    // commit it asked for: the build's own record names none (builds.ts).
    built: {
      description:
        "A Workers Build the kernel started through main's deploy hook, and the commit it rebuilds.",
      component: true,
      type: 'object',
      wire: false,
      journal: false,
      properties: { commit: owned(text) },
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
    changed: {
      description:
        "When a write last changed this app's store, to the hour; an install or a schema move is no change.",
      component: true,
      type: 'object',
      wire: false,
      journal: false,
      properties: { at: owned(time) },
    },
    errored: {
      description: "When this app's code last reported an error, to the hour.",
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
    // The paths an app has published files at (public-files.ts), so a request
    // at one of them asks the directory for its file before the app runs, and
    // a request at any other path goes on to the app without asking. The list
    // is JSON in one text property, sorted, as `home.first` is. The directory
    // keeps it in the transaction that writes the files themselves
    // (facets/publishing-graph.ts); an app that never published wears none.
    publishing: {
      description:
        'The paths an app has published files at, so a request at one of them is answered its file before the app runs.',
      component: true,
      type: 'object',
      properties: { paths: text },
    },
  },
}
// A person's own invite to yaks.app (referral.ts, D-136811): words only the
// directory keeps, about people, so no app's manifest needs them kept from it.
export let referralDoc: VocabDoc = {
  title: 'directory-referral',
  reserved: false,
  $defs: {
    // The code a person's invite carries (referral.ts `words`), on their own
    // row, minted the first time their invite page opens. Unique, so a code
    // names one person and the sign-up that sends it finds them.
    referral_code: {
      description:
        "The code a person's invite to yaks.app carries: whoever signs up sending it was invited by them.",
      component: true,
      type: 'object',
      unique: [['code']],
      properties: { code: owned(text) },
    },
    // One person who signed up through another's invite (referral.ts
    // `credit`): who invited them. Its eid is derived from the invitee, so a
    // person is invited once, by whoever's code their first message carried;
    // its `created` stamp is when.
    referral: {
      description:
        "One person who signed up for yaks.app through another's invite: who invited them.",
      component: true,
      type: 'object',
      kind: true,
      identity: ['invitee'],
      properties: {
        inviter: owned(ref('keep')),
        invitee: owned(ref('cascade')),
      },
    },
    // The month of the Plus plan a referral gave its inviter once the
    // invitee built their first app (referral.ts `rewarding`): when, to which
    // space, the day that space's free time now runs through, and, for a
    // space already paying, the provider's subscription whose next charge
    // moved a month later. A mark, written once.
    rewarded: {
      description:
        "The free month of the Plus plan a referral gave its inviter's space when the invitee built their first app.",
      component: true,
      type: 'object',
      properties: {
        at: owned(time),
        space: owned(ref('keep')),
        until: owned(time),
        subscription: owned(text),
      },
    },
    // The Plus plan given to a space free, through `until`, where the payment
    // provider bills it nothing (directory.ts `tierOf`): each reward adds a month
    // after the later of now and the free time it already had.
    comped: {
      description:
        'The Plus plan given to a space free, through `until`, with nothing billed for it.',
      component: true,
      type: 'object',
      properties: { until: owned(time) },
    },
    // An app made in a space whose owner was invited gives their inviter
    // the month, the first time (facets/directory-effects.ts).
    reward_referral: {
      effect: true,
      created: ['app'],
      target: '.app !installed',
      description:
        "give an invitee's inviter a free month of the Plus plan when the invitee builds their first app",
    },
    // The platform's answer in a support thread, or its completion, carried
    // to the thread's person (support-reply.ts).
    support_reply: {
      effect: true,
      created: ['comment', 'completed'],
      target: '(.comment !support|.conversation .report)',
      description:
        "carry the platform's answer in a support thread to the person's Updates and to the Operator conversation or connector agent it came from, until each takes it",
    },
  },
}
export let docs: VocabDoc[] = [
  directoryDoc,
  referralDoc,
  sweepDoc,
  useDoc,
  servingDoc,
  // The release's start-up work that seeds the schedules (directory-effects.ts).
  { reserved: false, $defs: { sweep_install: { effect: true, start: true } } },
]
