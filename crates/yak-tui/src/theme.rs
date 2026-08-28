// The Everforest palette and the small styling helpers, mirrored from the TS
// TUI (src/tui/paint.ts) so the Rust cockpit reads the same as `task tui`.
// Colors and the content-boundary scrub are the only things this module owns;
// it never touches the graph.

use ratatui::style::Color;

pub const BG: Color = Color::Rgb(0x2b, 0x33, 0x39); // bg0 (dark hard)
pub const FG: Color = Color::Rgb(0xd3, 0xc6, 0xaa); // default foreground
pub const GREY: Color = Color::Rgb(0x7a, 0x84, 0x78); // ids, dim marks
pub const BODY: Color = Color::Rgb(0x9d, 0xa9, 0xa0); // titles, secondary text
pub const BLUE: Color = Color::Rgb(0x7f, 0xbb, 0xb3); // user, links
pub const YELLOW: Color = Color::Rgb(0xdb, 0xbc, 0x7f); // running, accents
pub const GREEN: Color = Color::Rgb(0xa7, 0xc0, 0x80); // done, agent, verbs
pub const RED: Color = Color::Rgb(0xe6, 0x7e, 0x80); // failed, errors
pub const AQUA: Color = Color::Rgb(0x83, 0xc0, 0x92); // the agent line, liveness
pub const PURPLE: Color = Color::Rgb(0xd6, 0x99, 0xb6); // selection, session accent

// A session's lifecycle status, colored the way the web Dot/Session views read
// it: live states warm, a clean end green, a bad end red, the rest grey.
pub fn session_status_color(status: &str) -> Color {
    match status {
        "running" | "starting" => YELLOW,
        "stopping" => AQUA,
        "completed" | "done" => GREEN,
        "failed" | "lost" => RED,
        "interrupted" => GREY,
        _ => GREY,
    }
}

// A log entry's role: the user's words blue, the agent's green (messageRoles).
pub fn role_color(role: &str) -> Color {
    match role {
        "user" => BLUE,
        "agent" => GREEN,
        _ => GREY,
    }
}

// The content boundary (terminal.ts safe()): nothing painted is written by the
// operator — session titles, entry bodies, cwd strings, actor names all come off
// the open graph — so strip the whole control class (C0 except the newlines a
// caller keeps, DEL, and C1) before it reaches a Span. A terminal reading a raw
// ESC/CSI out of a body would otherwise run it as its own escape. Tabs become a
// space we chose; `keep_newlines=false` flattens to one line for a preview.
pub fn sane(s: &str, keep_newlines: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\n' if keep_newlines => out.push('\n'),
            '\t' => out.push(' '),
            // C0 (below space), DEL, and the C1 range (0x80..=0x9f) — a
            // terminal takes 0x9b as CSI even with ESC dropped.
            c if (c as u32) < 0x20 || c == '\u{7f}' || (0x80..=0x9f).contains(&(c as u32)) => {
                out.push(' ')
            }
            c => out.push(c),
        }
    }
    out
}
