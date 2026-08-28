// The draw pass: a header, the scrolling tree, and a keys/liveness footer. It
// reads the App's prebuilt `visible` list only — no store access here, so a
// redraw is pure layout over values the App already computed.

use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::{App, Node};
use crate::theme;

pub fn draw(f: &mut Frame, app: &App) {
    let bg = Style::default().bg(theme::BG);
    f.render_widget(Block::default().style(bg), f.area());

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0), Constraint::Length(1)])
        .split(f.area());

    header(f, rows[0], app);
    tree(f, rows[1], app);
    footer(f, rows[2], app);
}

fn header(f: &mut Frame, area: ratatui::layout::Rect, app: &App) {
    let (projects, tasks) = app.counts();
    let line = Line::from(vec![
        Span::styled(
            " yak tui ",
            Style::default().fg(theme::BG).bg(theme::GREEN).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("  wants/requires tree  ·  {projects} projects  {tasks} tasks  ·  {}", app.db),
            Style::default().fg(theme::GREY),
        ),
    ]);
    f.render_widget(Paragraph::new(line).style(Style::default().bg(theme::BG)), area);
}

fn tree(f: &mut Frame, area: ratatui::layout::Rect, app: &App) {
    if app.visible.is_empty() {
        let msg = Paragraph::new(Line::from(Span::styled(
            "  (no tasks in the graph)",
            Style::default().fg(theme::GREY),
        )))
        .style(Style::default().bg(theme::BG));
        f.render_widget(msg, area);
        return;
    }
    let items: Vec<ListItem> = app.visible.iter().map(row_line).collect();
    let list = List::new(items)
        .style(Style::default().bg(theme::BG).fg(theme::FG))
        .highlight_style(
            Style::default().bg(theme::PURPLE).fg(theme::BG).add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("");
    let mut state = ListState::default();
    state.select(Some(app.sel));
    f.render_stateful_widget(list, area, &mut state);
}

fn row_line(n: &Node) -> ListItem<'static> {
    let indent = "  ".repeat(n.depth as usize);
    let marker = if n.expandable {
        if n.expanded {
            "▾ "
        } else {
            "▸ "
        }
    } else {
        "  "
    };
    let mut spans = vec![
        Span::raw(format!(" {indent}")),
        Span::styled(marker, Style::default().fg(theme::GREY)),
        Span::styled(format!("{} ", n.glyph), Style::default().fg(n.glyph_color)),
        Span::styled(format!("{:<8} ", n.id), Style::default().fg(theme::GREY)),
    ];
    if !n.meta.is_empty() {
        spans.push(Span::styled(format!("{} ", n.meta), Style::default().fg(n.meta_color)));
    }
    if !n.title.is_empty() {
        spans.push(Span::styled(n.title.clone(), Style::default().fg(theme::BODY)));
    }
    ListItem::new(Line::from(spans))
}

fn footer(f: &mut Frame, area: ratatui::layout::Rect, app: &App) {
    let key = |k: &str| Span::styled(k.to_string(), Style::default().fg(theme::YELLOW));
    let sep = || Span::styled("  ", Style::default().fg(theme::GREY));
    let hint = |h: &str| Span::styled(format!(" {h}"), Style::default().fg(theme::GREY));
    let mut spans = vec![
        Span::raw(" "),
        key("j/k"),
        hint("move"),
        sep(),
        key("enter"),
        hint("descend"),
        sep(),
        key("h/l"),
        hint("fold"),
        sep(),
        key("space"),
        hint("status"),
        sep(),
        key("g/G"),
        hint("ends"),
        sep(),
        key("q"),
        hint("quit"),
    ];
    // The right note prefers the last write's result; otherwise it shows the
    // liveness heartbeat, so the operator can see both the write door and the
    // journal tail working.
    let (note, color) = if !app.status_msg.is_empty() {
        (app.status_msg.clone(), theme::YELLOW)
    } else if app.live_events > 0 {
        (format!("live · {} events", app.live_events), theme::AQUA)
    } else {
        ("live · watching".to_string(), theme::AQUA)
    };
    let left_len: usize = spans.iter().map(|s| s.content.chars().count()).sum();
    let pad = (area.width as usize).saturating_sub(left_len + note.chars().count() + 1);
    spans.push(Span::raw(" ".repeat(pad)));
    spans.push(Span::styled(note, Style::default().fg(color)));
    f.render_widget(Paragraph::new(Line::from(spans)).style(Style::default().bg(theme::BG)), area);
}
