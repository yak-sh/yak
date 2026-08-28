// The draw pass: a header, the current view's body (projects, a project's
// sessions, or a session's entries), and a keys/liveness footer. It reads the
// App's already-computed lists — no store access here, so a redraw is pure
// layout. Every string it paints has already passed theme::sane at load time.

use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, List, ListItem, ListState, Paragraph};
use ratatui::Frame;

use crate::app::{short_when, App, View};
use crate::theme;

pub fn draw(f: &mut Frame, app: &App) {
    f.render_widget(Block::default().style(Style::default().bg(theme::BG)), f.area());
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0), Constraint::Length(1)])
        .split(f.area());

    header(f, rows[0], app);
    match &app.view {
        View::Projects => projects(f, rows[1], app),
        View::Project(_) => sessions(f, rows[1], app),
        View::Session(_) => session(f, rows[1], app),
    }
    footer(f, rows[2], app);
}

fn tag(text: &str, fg: ratatui::style::Color) -> Span<'static> {
    Span::styled(text.to_string(), Style::default().fg(fg))
}

fn header(f: &mut Frame, area: Rect, app: &App) {
    let (projects, sessions) = app.counts();
    let crumb = match &app.view {
        View::Projects => "projects".to_string(),
        View::Project(_) => {
            format!("session · {}", app.crumb_project())
        }
        View::Session(_) => {
            let s = app.open_session();
            format!("session · {}", s.map(|s| s.id.clone()).unwrap_or_default())
        }
    };
    let line = Line::from(vec![
        Span::styled(
            " yak tui ",
            Style::default().fg(theme::BG).bg(theme::GREEN).add_modifier(Modifier::BOLD),
        ),
        tag(&format!("  {crumb}"), theme::FG),
        tag(&format!("   ·  {projects} projects  {sessions} sessions  ·  {}", app.db), theme::GREY),
    ]);
    f.render_widget(Paragraph::new(line).style(Style::default().bg(theme::BG)), area);
}

fn list_widget(items: Vec<ListItem<'static>>, sel: usize, f: &mut Frame, area: Rect) {
    if items.is_empty() {
        let msg = Paragraph::new(Line::from(tag("  (nothing here)", theme::GREY)))
            .style(Style::default().bg(theme::BG));
        f.render_widget(msg, area);
        return;
    }
    let list =
        List::new(items).style(Style::default().bg(theme::BG).fg(theme::FG)).highlight_style(
            Style::default().bg(theme::PURPLE).fg(theme::BG).add_modifier(Modifier::BOLD),
        );
    let mut state = ListState::default();
    state.select(Some(sel));
    f.render_stateful_widget(list, area, &mut state);
}

fn projects(f: &mut Frame, area: Rect, app: &App) {
    let items: Vec<ListItem> = app
        .project_list()
        .into_iter()
        .map(|p| {
            ListItem::new(Line::from(vec![
                Span::raw(" "),
                Span::styled(format!("{:<7} ", p.id), Style::default().fg(theme::GREY)),
                Span::styled(p.title, Style::default().fg(theme::BODY)),
                Span::styled(
                    format!("  ·  {} sessions", p.sessions),
                    Style::default().fg(theme::GREY),
                ),
            ]))
        })
        .collect();
    list_widget(items, app.sel, f, area);
}

fn sessions(f: &mut Frame, area: Rect, app: &App) {
    let items: Vec<ListItem> = app
        .sessions_in_view()
        .into_iter()
        .map(|s| {
            let mut spans = vec![
                Span::raw(" "),
                Span::styled(format!("{:<9} ", s.id), Style::default().fg(theme::PURPLE)),
            ];
            if !s.agent.is_empty() {
                spans.push(Span::styled(format!("{} ", s.agent), Style::default().fg(theme::AQUA)));
            }
            if !s.status.is_empty() {
                spans.push(Span::styled(
                    format!("{} ", s.status),
                    Style::default().fg(theme::session_status_color(&s.status)),
                ));
            }
            spans.push(Span::styled(
                format!(
                    "· {} entries · {} · {}",
                    s.entries,
                    short_when(&s.when),
                    app.actor_label(&s.actor)
                ),
                Style::default().fg(theme::GREY),
            ));
            ListItem::new(Line::from(spans))
        })
        .collect();
    list_widget(items, app.sel, f, area);
}

fn session(f: &mut Frame, area: Rect, app: &App) {
    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(4), Constraint::Min(0)])
        .split(area);
    session_head(f, split[0], app);
    entries(f, split[1], app);
}

fn session_head(f: &mut Frame, area: Rect, app: &App) {
    let Some(s) = app.open_session() else { return };
    let label = |k: &str| Span::styled(k.to_string(), Style::default().fg(theme::GREY));
    let val = |v: String| Span::styled(v, Style::default().fg(theme::FG));
    let lines = vec![
        Line::from(vec![
            Span::raw(" "),
            Span::styled(
                format!("{} ", s.id),
                Style::default().fg(theme::PURPLE).add_modifier(Modifier::BOLD),
            ),
            Span::styled(s.agent.clone(), Style::default().fg(theme::AQUA)),
            Span::raw("  "),
            Span::styled(
                s.status.clone(),
                Style::default().fg(theme::session_status_color(&s.status)),
            ),
            Span::styled(
                if s.origin.is_empty() { String::new() } else { format!("  ({})", s.origin) },
                Style::default().fg(theme::GREY),
            ),
        ]),
        Line::from(vec![
            Span::raw(" "),
            label("actor "),
            val(app.actor_label(&s.actor)),
            Span::raw("   "),
            label("when "),
            val(short_when(&s.when)),
            Span::raw("   "),
            label("entries "),
            val(s.entries.to_string()),
        ]),
        match app.fork_origin() {
            // A forked session shows its origin: where it branched from.
            Some(origin) => Line::from(vec![
                Span::raw(" "),
                Span::styled("⑂ forked from ", Style::default().fg(theme::YELLOW)),
                Span::styled(origin.to_string(), Style::default().fg(theme::AQUA)),
            ]),
            None => {
                Line::from(vec![Span::raw(" "), label("cwd "), val(theme::sane(&s.cwd, false))])
            }
        },
    ];
    f.render_widget(Paragraph::new(lines).style(Style::default().bg(theme::BG)), area);
}

// Each entry is one selectable item: a `#seq role` header line plus its body,
// word-wrapped to the width and capped so one giant transcript turn cannot make
// the list unnavigable.
fn entries(f: &mut Frame, area: Rect, app: &App) {
    let width = area.width.saturating_sub(2) as usize;
    let cap = 12usize;
    let items: Vec<ListItem> = app
        .entries_in_view()
        .iter()
        .map(|e| {
            let role = if e.role.is_empty() { "·" } else { &e.role };
            let mut head = vec![
                Span::raw(" "),
                Span::styled(format!("#{} ", e.seq), Style::default().fg(theme::GREY)),
                Span::styled(role.to_string(), Style::default().fg(theme::role_color(&e.role))),
            ];
            // A shared-prefix line names the session it is inherited from — the
            // prefix is rendered by reference, so its provenance stays visible.
            if e.inherited {
                head.push(Span::styled(
                    format!("  ↖ {}", e.source),
                    Style::default().fg(theme::GREY),
                ));
            }
            let mut lines = vec![Line::from(head)];
            // Dim the shared prefix so the fork's OWN turns read as the foreground.
            let body_fg = if e.inherited { theme::GREY } else { theme::BODY };
            let wrapped = wrap(&e.body, width, cap);
            for (i, w) in wrapped.iter().enumerate() {
                let last = i + 1 == wrapped.len();
                let text = if last && wrapped.len() == cap {
                    format!("   {w} …")
                } else {
                    format!("   {w}")
                };
                lines.push(Line::from(Span::styled(text, Style::default().fg(body_fg))));
            }
            ListItem::new(lines)
        })
        .collect();
    list_widget(items, app.sel, f, area);
}

// Greedy word wrap that also honors existing newlines, bounded to `max` lines.
fn wrap(s: &str, width: usize, max: usize) -> Vec<String> {
    let width = width.max(8);
    let mut out: Vec<String> = vec![];
    for para in s.split('\n') {
        let mut line = String::new();
        for word in para.split(' ') {
            if line.is_empty() {
                line = word.to_string();
            } else if line.chars().count() + 1 + word.chars().count() <= width {
                line.push(' ');
                line.push_str(word);
            } else {
                out.push(std::mem::take(&mut line));
                line = word.to_string();
                if out.len() >= max {
                    return out;
                }
            }
        }
        out.push(line);
        if out.len() >= max {
            return out;
        }
    }
    out
}

fn footer(f: &mut Frame, area: Rect, app: &App) {
    let key = |k: &str| Span::styled(k.to_string(), Style::default().fg(theme::YELLOW));
    let sep = || Span::styled("  ", Style::default().fg(theme::GREY));
    let hint = |h: &str| Span::styled(format!(" {h}"), Style::default().fg(theme::GREY));
    let mut spans = vec![
        Span::raw(" "),
        key("j/k"),
        hint("browse"),
        sep(),
        key("l/enter"),
        hint("enter"),
        sep(),
        key("h/^D"),
        hint("back"),
        sep(),
        key("g/G"),
        hint("ends"),
    ];
    // Fork is only offered where it can act — inside a session, on an entry.
    if matches!(app.view, View::Session(_)) {
        spans.push(sep());
        spans.push(key("f"));
        spans.push(hint("fork"));
    }
    spans.push(sep());
    spans.push(key("q"));
    spans.push(hint("quit"));
    // A flash (a fork's confirmation or refusal) takes the right slot; else the
    // live-tail note sits there.
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
