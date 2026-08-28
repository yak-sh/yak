// The Everforest palette and the status/edge glyphs, mirrored from the TS TUI
// (src/tui/paint.ts) so the Rust cockpit reads the same as `task tui`. Colors
// are the only thing this module owns; it never touches the graph.

use ratatui::style::Color;

pub const BG: Color = Color::Rgb(0x2b, 0x33, 0x39); // bg0 (dark hard)
pub const FG: Color = Color::Rgb(0xd3, 0xc6, 0xaa); // default foreground
pub const GREY: Color = Color::Rgb(0x7a, 0x84, 0x78); // ids, dim marks
pub const BODY: Color = Color::Rgb(0x9d, 0xa9, 0xa0); // titles, secondary text
pub const BLUE: Color = Color::Rgb(0x7f, 0xbb, 0xb3); // open, reads
pub const YELLOW: Color = Color::Rgb(0xdb, 0xbc, 0x7f); // wip, contains
pub const GREEN: Color = Color::Rgb(0xa7, 0xc0, 0x80); // done, verbs
pub const RED: Color = Color::Rgb(0xe6, 0x7e, 0x80); // gated, requires
pub const AQUA: Color = Color::Rgb(0x83, 0xc0, 0x92); // wants
pub const PURPLE: Color = Color::Rgb(0xd6, 0x99, 0xb6); // claim, selection

// A task's status pip — ring open, half-moon wip, ✓ done, ✕ cancelled — with
// the blocked facet (an unresolved `requires` dep) overriding to a red `!`,
// exactly the Dot-gated rule in live.ts.
pub fn status_dot(status: &str, gated: bool) -> (char, Color) {
    if gated && matches!(status, "open" | "wip") {
        return ('!', RED);
    }
    match status {
        "open" => ('○', BLUE),
        "wip" => ('◐', YELLOW),
        "done" => ('✓', GREEN),
        "cancelled" => ('✕', GREY),
        _ => ('◦', GREY),
    }
}

// An edge's type colors its label the way Dependency_Type-* does in paint.ts.
pub fn edge_color(kind: &str) -> Color {
    match kind {
        "requires" => RED,
        "wants" => AQUA,
        "reads" => BLUE,
        "contains" => YELLOW,
        _ => BODY,
    }
}
