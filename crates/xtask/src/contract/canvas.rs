// The canvas plugin (D-22530 §8): the spatial UI vocabulary — canvases, cards,
// pins, per-client chrome (camera/fold/shelf/cursor), tiling layouts.

use yak_vocab::{Number, Ref, Sel, Text};
use yak_vocab_derive::Comp;

// A container pane lays its children along this axis.
venum!("canvas", "dirs", 100, ["h", "v"]);

#[derive(Comp)]
#[comp(plugin = "canvas", rank = 120, kind_rank = 60, by_name)]
struct Canvas {}

// A tiling layout (D-14718). death 'detach' on root: deleting the root pane
// orphans the layout instead of chaining a second cascade.
#[derive(Comp)]
#[comp(plugin = "canvas", rank = 80, kind_rank = 40, prefix = "L", by_name)]
struct Layout {
    #[col(eid = "pane", death = "detach")]
    root: Ref,
}

// One pane of a layout: a CONTAINER when dir is set, a LEAF otherwise. size is
// a WEIGHT among siblings; content a SOFT ref whose death empties the pane.
#[derive(Comp)]
#[comp(plugin = "canvas", rank = 90, kind_rank = 90)]
struct Pane {
    #[col(eid = "layout", death = "cascade")]
    layout: Ref,
    #[col(eid = "pane", death = "cascade")]
    parent: Ref,
    size: Number,
    order: Number,
    #[col(sel = "dirs")]
    dir: Sel,
    #[col(eid = "entity", death = "detach")]
    content: Ref,
    view: Text,
}

#[derive(Comp)]
#[comp(plugin = "canvas", rank = 150, kind_rank = 80)]
struct Card {
    #[col(eid = "entity", death = "cascade")]
    target: Ref,
    view: Text,
}

#[derive(Comp)]
#[comp(plugin = "canvas", rank = 160)]
struct Pin {
    #[col(eid = "entity", death = "cascade")]
    canvas: Ref,
    x: Number,
    y: Number,
    w: Number,
    h: Number,
    z: Number,
}

// actor is the identity CHAIN: a client is one browser's presence, the actor
// who it acts for. ip is server-stamped.
#[derive(Comp)]
#[comp(plugin = "canvas", rank = 170, kind_rank = 100, stamped_rank = 120)]
struct Client {
    user_agent: Text,
    #[col(eid = "entity", death = "detach")]
    actor: Ref,
    #[stamped]
    ip: Text,
}

#[derive(Comp)]
#[comp(plugin = "canvas", rank = 180, kind_rank = 110)]
#[index(cols(client, canvas), unique)]
struct Camera {
    #[col(eid = "client", death = "cascade")]
    client: Ref,
    #[col(eid = "entity", death = "cascade")]
    canvas: Ref,
    x: Number,
    y: Number,
    zoom: Number,
    w: Number,
    h: Number,
}

#[derive(Comp)]
#[comp(plugin = "canvas", rank = 190, kind_rank = 120)]
#[index(cols(client, board), unique)]
struct Fold {
    #[col(eid = "client", death = "cascade")]
    client: Ref,
    #[col(eid = "board", death = "cascade")]
    board: Ref,
    statuses: Text,
}

// Binds a client to their tray canvas. 'release': a dead client's shelf sheds
// the tag, the canvas survives as a plain canvas.
#[derive(Comp)]
#[comp(plugin = "canvas", rank = 200)]
#[index(cols(client), unique)]
struct Shelf {
    #[col(eid = "client", death = "release")]
    client: Ref,
}

// WHERE a client is LOOKING — navigation as graph data (T-12788). death 'keep'
// on target: a cursor aimed at a dead entity keeps the tombstone and derives a
// nearest-live fallback at READ time.
#[derive(Comp)]
#[comp(plugin = "canvas", rank = 210, kind_rank = 130)]
#[index(cols(client), unique)]
struct Cursor {
    #[col(eid = "client", death = "cascade")]
    client: Ref,
    #[col(eid = "entity", death = "keep")]
    target: Ref,
    view: Text,
}
