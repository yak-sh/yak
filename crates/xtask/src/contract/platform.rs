// The platform plugin (D-32318 §Nouns, §The meta-space): the directory the
// kernel worker routes by. These live in the meta-space's store — the Store
// object named (yak, platform) — and nowhere else; an app's own store never
// carries them. Kept to what routing and membership need: who a hostname is,
// what apps it has, who may write to them.

use yak_vocab::{Number, Ref, Sel, Text, Time};
use yak_vocab_derive::Comp;

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
// `version` counts deploys, so an error names the deploy it happened on. Dies
// with its space; one slug per space.
#[derive(Comp)]
#[comp(plugin = "platform", rank = 1030, kind_rank = 400)]
#[index(cols(space, slug), unique)]
struct App {
    slug: Text,
    #[col(eid = "space", death = "cascade")]
    space: Ref,
    version: Number,
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
