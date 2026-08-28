// yak-tui — the interactive terminal cockpit over the kernel read path
// (D-23845). A LIBRARY crate: the `yak` binary calls `run()` from its `tui`
// subcommand, so there is one binary and the ratatui code stays out of the CLI.
//
// v0.1 (T-23975) is a SESSION navigator: it opens on the cwd's project and
// drills project -> recent sessions -> a session's entries — the current model
// of an agent run. It reads the live graph directly through the kernel `Store`
// (D-23308: a local caller reads SQLite directly, no server) and keeps a
// separate READ_WRITE connection wired for the fork write that lands next. It
// stays live by tailing the journal's catchup feed rather than polling the whole
// graph. The terminal is ALWAYS restored — on quit, on error, and through a
// panic hook — so a crash never leaves a broken terminal.

mod app;
mod theme;
mod ui;

use std::io::{self, Stdout};
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;
use yak_kernel::{db_path, Store, WriteStore};

use app::App;

type Term = Terminal<CrosstermBackend<Stdout>>;

// The db this cockpit reads: an explicit `--db <path>` wins, else the CLI's own
// resolution (DB_PATH, then the home graph) — the same door every reader names
// itself by, and the seam that points the TUI at a scratch copy for testing
// without touching the owner's board.
pub fn run(args: &[String]) -> Result<(), String> {
    let mut path: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--db" => {
                i += 1;
                path = args.get(i).cloned();
            }
            "-h" | "--help" => {
                println!("yak tui [--db <path>] — project -> sessions -> entries, live");
                return Ok(());
            }
            other => return Err(format!("yak tui: unknown flag {other}")),
        }
        i += 1;
    }
    let db = path.unwrap_or_else(db_path);
    // The read/write split yak-bridge uses: a read-only `Store` (URI form so a
    // bare path still opens the WAL sidecar for reads — the door yak-cli's
    // open_store() uses) for rendering and the journal feed, and a READ_WRITE
    // `WriteStore` kept ready for the fork write. A library client opens an
    // existing file; it never creates or migrates.
    let store =
        Store::open(&format!("file:{db}?mode=ro")).map_err(|e| format!("cannot open {db}: {e}"))?;
    let write = WriteStore::open(&db).map_err(|e| format!("cannot open {db} read-write: {e}"))?;
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let app = App::new(store, write, db, &cwd);

    install_panic_hook();
    let mut term = setup().map_err(|e| e.to_string())?;
    let res = event_loop(&mut term, app);
    // ALWAYS restore, whatever the loop returned.
    let _ = restore();
    res.map_err(|e| e.to_string())
}

fn setup() -> io::Result<Term> {
    enable_raw_mode()?;
    let mut out = io::stdout();
    execute!(out, EnterAlternateScreen)?;
    Terminal::new(CrosstermBackend::new(out))
}

fn restore() -> io::Result<()> {
    disable_raw_mode()?;
    execute!(io::stdout(), LeaveAlternateScreen, crossterm::cursor::Show)?;
    Ok(())
}

// A panic must not leave the terminal in raw mode / the alternate screen. The
// hook restores first, then defers to the original so the backtrace still
// prints on the primary screen.
fn install_panic_hook() {
    let original = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = restore();
        original(info);
    }));
}

fn event_loop(term: &mut Term, mut app: App) -> io::Result<()> {
    while !app.quit {
        term.draw(|f| ui::draw(f, &app))?;
        // A 200ms input poll is the cadence for KEYS; liveness rides the cheap
        // data_version pragma below, so the graph is never scanned on a timer.
        if event::poll(Duration::from_millis(200))? {
            if let Event::Key(k) = event::read()? {
                if k.kind == KeyEventKind::Press {
                    on_key(&mut app, k.code, k.modifiers);
                }
            }
        }
        app.tick_live();
    }
    Ok(())
}

// The vim vocabulary the TS TUI teaches (keybindings.ts tuiKeys): j/k browse,
// l/Enter enter, h/Ctrl-D back, q/Ctrl-C quit — so muscle memory carries over.
fn on_key(app: &mut App, code: KeyCode, mods: KeyModifiers) {
    // A flash lives until the next keystroke moves on.
    app.flash = None;
    let ctrl = |c: char| mods.contains(KeyModifiers::CONTROL) && code == KeyCode::Char(c);
    if ctrl('c') {
        app.quit = true;
        return;
    }
    if ctrl('d') {
        app.back();
        return;
    }
    match code {
        KeyCode::Char('q') | KeyCode::Esc => app.quit = true,
        KeyCode::Char('j') | KeyCode::Down => app.down(),
        KeyCode::Char('k') | KeyCode::Up => app.up(),
        KeyCode::Char('l') | KeyCode::Right | KeyCode::Enter => app.enter(),
        KeyCode::Char('h') | KeyCode::Left => app.back(),
        KeyCode::Char('g') | KeyCode::Home => app.top(),
        KeyCode::Char('G') | KeyCode::End => app.bottom(),
        KeyCode::Char('r') => app.refresh(),
        // Fork the open session at the selected entry — a new session sharing
        // the prefix up to here, navigated straight into. A refusal is durable
        // in the footer rather than lost.
        KeyCode::Char('f') => {
            if let Err(e) = app.fork_here() {
                app.flash = Some(format!("fork refused: {e}"));
            }
        }
        _ => {}
    }
}
