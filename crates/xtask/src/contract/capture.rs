// The capture plugin (D-22530 §8): frozen web pages (freeze.ts, page.ts).

use yak_vocab::{Time, Url};
use yak_vocab_derive::Comp;

// An external page. The URL is what was pasted; the frozen archive is the
// server's, stamped frozen_at when ready (server-owned, never wire-set).
#[derive(Comp)]
#[comp(plugin = "capture", rank = 130, kind_rank = 70, stamped_rank = 110)]
struct Web {
    url: Url,
    #[stamped]
    frozen_at: Time,
}
