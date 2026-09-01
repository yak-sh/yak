// The inbox's draw pass: a tab bar with the unread and waiting counts, the
// open tab's rows, or one item read whole with its thread, and a footer that
// becomes the input line while a reply or a search is being typed. Pure
// layout over the Inbox's already-loaded state; every string passed sane()
// at load time.

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::App;
use crate::inbox::{Inbox, Pane, Tab};
use crate::theme;
use crate::ui::wrap;

pub fn draw(f: &mut Frame, app: &App) {
    f.render_widget(Block::default().style(Style::default().bg(theme::BG)), f.area());
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0), Constraint::Length(1)])
        .split(f.area());
    let ib = &app.inbox;
    header(f, rows[0], ib, &app.db);
    match ib.pane {
        Pane::Read => reading(f, rows[1], ib),
        _ => list(f, rows[1], ib),
    }
    footer(f, rows[2], app);
}

fn tag(text: &str, fg: ratatui::style::Color) -> Span<'static> {
    Span::styled(text.to_string(), Style::default().fg(fg))
}

fn header(f: &mut Frame, area: Rect, ib: &Inbox, db: &str) {
    let mut spans = vec![Span::styled(
        " yak inbox ",
        Style::default().fg(theme::BG).bg(theme::GREEN).add_modifier(Modifier::BOLD),
    )];
    spans.push(tag(&format!("  {}  ", ib.owner_label), theme::FG));
    let tabs: Vec<Tab> = if ib.tab == Tab::Search {
        Tab::ALL.iter().copied().chain(std::iter::once(Tab::Search)).collect()
    } else {
        Tab::ALL.to_vec()
    };
    for t in tabs {
        let badge = match t {
            Tab::Received if ib.unread > 0 => format!(" {}●", ib.unread),
            Tab::Attention if ib.waiting > 0 => format!(" {}", ib.waiting),
            Tab::Search => format!(" {}", ib.items.len()),
            _ => String::new(),
        };
        let text = format!(" {}{badge} ", t.name());
        spans.push(if t == ib.tab {
            Span::styled(
                text,
                Style::default().fg(theme::BG).bg(theme::PURPLE).add_modifier(Modifier::BOLD),
            )
        } else {
            tag(&text, theme::BODY)
        });
        spans.push(Span::raw(" "));
    }
    spans.push(tag(&format!("  ·  {db}"), theme::GREY));
    f.render_widget(Paragraph::new(Line::from(spans)).style(Style::default().bg(theme::BG)), area);
}

fn list(f: &mut Frame, area: Rect, ib: &Inbox) {
    if ib.items.is_empty() {
        let msg = match ib.tab {
            Tab::Received => "  (inbox empty)",
            Tab::Said => "  (nothing said yet)",
            Tab::Recent => "  (nothing touched yet)",
            Tab::Attention => "  (nothing waiting on you)",
            Tab::Search => "  (no hits)",
        };
        f.render_widget(
            Paragraph::new(Line::from(tag(msg, theme::GREY))).style(Style::default().bg(theme::BG)),
            area,
        );
        return;
    }
    let width = area.width as usize;
    let items: Vec<ListItem> = ib
        .items
        .iter()
        .map(|i| {
            let dot = if i.unread { "●" } else { "·" };
            let mut spans = vec![
                Span::styled(
                    format!(" {dot} "),
                    Style::default().fg(if i.unread { theme::YELLOW } else { theme::GREY }),
                ),
                tag(&format!("{:<11} ", i.when), theme::GREY),
                Span::styled(format!("{:<9} ", i.id), Style::default().fg(theme::PURPLE)),
                tag(&format!("{:<8} ", i.kind), theme::AQUA),
            ];
            if !i.from.is_empty() {
                spans.push(tag(&format!("{} ", i.from), theme::BLUE));
            }
            if !i.target_id.is_empty() {
                spans.push(tag(&format!("→ {} ", i.target_id), theme::GREY));
            }
            let used: usize = spans.iter().map(|s| s.content.chars().count()).sum();
            let room = width.saturating_sub(used + 3);
            let line: String = i.line.chars().take(room).collect();
            spans.push(Span::styled(
                format!("· {line}"),
                Style::default().fg(if i.unread { theme::FG } else { theme::BODY }),
            ));
            ListItem::new(Line::from(spans))
        })
        .collect();
    let list =
        List::new(items).style(Style::default().bg(theme::BG).fg(theme::FG)).highlight_style(
            Style::default().bg(theme::PURPLE).fg(theme::BG).add_modifier(Modifier::BOLD),
        );
    let mut state = ListState::default();
    state.select(Some(ib.sel));
    f.render_stateful_widget(list, area, &mut state);
}

// One item whole: a head (id, kind, from, when, what it is about), the body
// wrapped, then the thread on its target, oldest first. `j`/`k` scroll.
fn reading(f: &mut Frame, area: Rect, ib: &Inbox) {
    let Some(r) = &ib.reading else { return };
    let width = area.width.saturating_sub(4) as usize;
    let label = |k: &str| Span::styled(k.to_string(), Style::default().fg(theme::GREY));
    let val = |v: &str| Span::styled(v.to_string(), Style::default().fg(theme::FG));
    let mut lines: Vec<Line> = vec![
        Line::from(vec![
            Span::raw(" "),
            Span::styled(
                format!("{} ", r.item.id),
                Style::default().fg(theme::PURPLE).add_modifier(Modifier::BOLD),
            ),
            tag(&format!("{} ", r.item.kind), theme::AQUA),
            tag(&r.item.from, theme::BLUE),
            tag(&format!("  {}", r.item.when), theme::GREY),
        ]),
        Line::from(vec![
            Span::raw(" "),
            label("about "),
            val(&if r.item.target_id.is_empty() {
                r.item.id.clone()
            } else {
                r.item.target_id.clone()
            }),
            Span::raw("  "),
            val(&r.title),
        ]),
        Line::from(""),
    ];
    for w in wrap(&r.body, width, 400) {
        lines.push(Line::from(Span::styled(format!("   {w}"), Style::default().fg(theme::FG))));
    }
    if !r.thread.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(tag(&format!(" ── thread · {} ──", r.thread.len()), theme::GREY)));
        for n in &r.thread {
            lines.push(Line::from(vec![
                Span::raw(" "),
                Span::styled(format!("{} ", n.id), Style::default().fg(theme::PURPLE)),
                tag(&n.from, theme::BLUE),
                tag(&format!("  {}", n.when), theme::GREY),
            ]));
            for w in wrap(&n.body, width, 60) {
                lines.push(Line::from(Span::styled(
                    format!("   {w}"),
                    Style::default().fg(theme::BODY),
                )));
            }
        }
    }
    let scroll = r.scroll.min(lines.len().saturating_sub(1)) as u16;
    f.render_widget(
        Paragraph::new(lines).style(Style::default().bg(theme::BG)).scroll((scroll, 0)),
        area,
    );
}

fn footer(f: &mut Frame, area: Rect, app: &App) {
    let ib = &app.inbox;
    if ib.typing() {
        let prompt = match ib.pane {
            Pane::Reply => " reply › ",
            _ => " search › ",
        };
        let line = Line::from(vec![
            Span::styled(
                prompt.to_string(),
                Style::default().fg(theme::BG).bg(theme::YELLOW).add_modifier(Modifier::BOLD),
            ),
            Span::styled(format!(" {}", ib.input), Style::default().fg(theme::FG)),
            Span::styled("▏", Style::default().fg(theme::YELLOW)),
            tag("   enter send · esc cancel", theme::GREY),
        ]);
        f.render_widget(Paragraph::new(line).style(Style::default().bg(theme::BG)), area);
        return;
    }
    let key = |k: &str| Span::styled(k.to_string(), Style::default().fg(theme::YELLOW));
    let sep = || Span::styled("  ", Style::default().fg(theme::GREY));
    let hint = |h: &str| Span::styled(format!(" {h}"), Style::default().fg(theme::GREY));
    let mut spans = vec![Span::raw(" ")];
    let mut add = |k: &str, h: &str| {
        spans.push(key(k));
        spans.push(hint(h));
        spans.push(sep());
    };
    match ib.pane {
        Pane::Read => {
            add("j/k", "scroll");
            add("h/esc", "back");
        }
        _ => {
            add("j/k", "browse");
            add("enter", "open");
            add("tab", "next tab");
            add("1-4", "tabs");
        }
    }
    if ib.tab == Tab::Received {
        add("a", "archive");
    }
    add("r", "reply");
    add("/", "search");
    add("R", "refresh");
    add("q", "quit");
    let (note, color) = match &app.flash {
        Some(msg) => (msg.clone(), theme::YELLOW),
        None if app.live_events > 0 => (format!("live · {} events", app.live_events), theme::AQUA),
        None => ("live · watching".to_string(), theme::AQUA),
    };
    let left: usize = spans.iter().map(|s| s.content.chars().count()).sum();
    let pad = (area.width as usize).saturating_sub(left + note.chars().count() + 1);
    spans.push(Span::raw(" ".repeat(pad)));
    spans.push(Span::styled(note, Style::default().fg(color)));
    f.render_widget(Paragraph::new(Line::from(spans)).style(Style::default().bg(theme::BG)), area);
}
