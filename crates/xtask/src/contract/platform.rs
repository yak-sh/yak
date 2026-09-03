// The platform plugin (D-32318 §Nouns, §The meta-space): the directory the
// kernel worker routes by. These live in the meta-space's store — the Store
// object named (yak, platform) — and nowhere else; an app's own store never
// carries them. Kept to what routing and membership need: who a hostname is,
// what apps it has, who may write to them.

use yak_vocab::{Number, Ref, Sel, Text, Time};
use yak_vocab_derive::Comp;

// What an app lets someone who is not a member do (T-32504). `public` is the
// default and what every app had before there was a word for it: anyone with
// the link reads, members write. `open` is the vote page and the shared list
// — anyone with the link writes too. `private` answers members only, both
// ways. It governs the app's DATA, never its files: a deploy is always a
// member's.
venum!("platform", "appAccess", 160, ["public", "open", "private"]);

// A tenant: `<slug>.yaks.app`. doc carries its name; `home` is the app that
// answers the bare hostname, null while the space has none. Slugs are unique
// — a hostname names one space — so a doubled seed bounces instead of
// forking the directory.
#[derive(Comp)]
#[comp(plugin = "platform", rank = 1020, kind_rank = 390)]
#[index(cols(slug), unique)]
struct Space {
    slug: Text,
    #[col(eid = "app", death = "detach")]
    home: Ref,
}

// An app inside a space: `<space>.yaks.app/<slug>`. doc carries its title;
// `version` counts deploys, so an error names the deploy it happened on;
// `access` is who may read and write its store, absent meaning `public`, so
// every app born before the word keeps the behavior it had. Dies with its
// space; one slug per space.
#[derive(Comp)]
#[comp(plugin = "platform", rank = 1030, kind_rank = 400)]
#[index(cols(space, slug), unique)]
struct App {
    slug: Text,
    #[col(eid = "space", death = "cascade")]
    space: Ref,
    version: Number,
    #[col(sel = "appAccess")]
    access: Sel,
}

// A person's standing in a space — the one fact the kernel hands an app as
// `x-yak-role`. Credentials are never here (D-32318 §Auth): identity is
// platform-wide, membership is the space's. One row per (space, person).
#[derive(Comp)]
#[comp(plugin = "platform", rank = 1040, kind_rank = 410)]
#[index(cols(space, person), unique)]
struct Member {
    #[col(eid = "space", death = "cascade")]
    space: Ref,
    #[col(eid = "person", death = "cascade")]
    person: Ref,
    #[col(sel(owner, editor, viewer))]
    role: Sel,
}

// A sign-in in flight (D-32318 §Auth): the six-digit code mailed to an
// address, kept only as a keyed digest — HMAC under the session secret, so a
// row read from the store cannot be brute-forced — with the moment it dies
// and how many guesses it has taken. Wholly server-stamped: the kernel mints
// one at `POST /login` and deletes it when the code is spent; no client
// writes one. Several may stand for one address; the newest live one is the
// code that counts.
#[derive(Comp)]
#[comp(plugin = "platform", rank = 1050, kind_rank = 420, stamped_rank = 370)]
struct Signin {
    #[stamped]
    email: Text,
    #[stamped]
    code: Text,
    #[stamped]
    expires: Time,
    #[stamped]
    tries: Number,
}

// What a space pays (D-32751): `free` is every space today — 5 apps, 50,000
// app requests a month, 1 GB of data, 100 emails — and `plus` is the $5 tier
// waiting on Stripe. Absent means free, so a space born before the word is on
// the terms it always had.
venum!("platform", "planTiers", 161, ["free", "plus"]);

// What a space pays, and nothing else: one row on the space, so the tier is a
// fact about the tenant rather than a column on every app in it. The platform
// writes it — the usage sweep today, Stripe later — never the person whose
// bill it is.
#[derive(Comp)]
#[comp(plugin = "platform", rank = 1035, kind_rank = 395)]
struct Plan {
    #[col(sel = "planTiers")]
    tier: Sel,
}

// A calendar month's consumption, as Cloudflare measured it (D-32751 §Billing
// and metering, T-32757) — the meter reading the hourly sweep takes. It rides
// TWO entities and says the same thing on both: on an app, what that app's
// store did; on its space, the whole tenant's — every app summed, plus the
// letters the space sent, which are counted at the send door and appear in no
// app's store at all. `meter` and not `usage`, which a session's token count
// already spells (sessions.rs).
//
// `month` is `YYYY-MM` and is the row's own reset: a sweep that finds a month
// behind starts the counters over rather than keeping a running total nobody
// asked for. `bytes` is what the store itself reports (its SQLite size), not
// an analytics figure — Cloudflare's storage dataset has no per-object
// dimension. `at` is when the sweep last read.
#[derive(Comp)]
#[comp(plugin = "platform", rank = 1036)]
struct Meter {
    month: Text,
    requests: Number,
    rows_read: Number,
    rows_written: Number,
    bytes: Number,
    emails: Number,
    at: Time,
}
