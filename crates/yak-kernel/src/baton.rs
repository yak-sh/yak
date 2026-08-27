// The DB WRITER baton, Rust half — ported from src/baton.ts (T-22890, D-22804
// §8). An advisory exclusive lock beside the graph file that serializes which
// PROCESS may WRITE (or migrate) it. Reads never take it: WAL lets many readers
// run beside the one writer, and that pairing is safe. What is NOT safe is two
// WRITERS over one file — a Deno→Rust swap's successor migrating and casting
// beside its still-live predecessor. That overlap corrupted the live WAL twice
// (T-20223). The baton closes the window: a successor must hold it before it
// migrates or writes, and the predecessor holds it until it EXITS — which the
// kernel turns into a release on ANY end (clean drain, crash, SIGKILL, SIGBUS),
// so no reap and no handshake can leave it stuck held.
//
// CROSS-RUNTIME is the whole point (T-22890): during the swap a Rust successor
// takes over from a Deno predecessor, and the two runtimes MUST serialize on
// the SAME OS-level lock. Deno's `FsFile.tryLockSync(true)` on Linux is
// `flock(fd, LOCK_EX | LOCK_NB)` (verified by strace: the byte-range fcntl locks
// in a Deno process are SQLite's own POSIX locks, NOT this baton) — so this port
// takes `flock(2)` with `LOCK_EX`, on the SAME `<db>-writer.lock` sidecar path,
// and nothing else. A different primitive (fcntl F_SETLK) would NOT contend with
// Deno's flock and would silently reopen the two-writer window. flock and the
// db file's own POSIX locks are independent classes, which is exactly why the
// baton lives on a dedicated sidecar (never the DB file itself, which would
// fight SQLite's own POSIX locks).
//
// Per graph FILE, on a dedicated `<db>-writer.lock` sidecar. ':memory:' and
// every test/probe copy carry their own path, so the live baton only ever
// serializes real successors of the live graph — a probe on a copied file never
// contends. The suffix selects WHICH role: '-writer.lock' is the schema/WAL
// writer; '-effects.lock' is the effects daemon's exactly-one-dispatcher lease
// (D-22388) — same kernel-released flock, an independent sidecar, so a writer
// taker and an effects taker coexist.

use std::fs::{File, OpenOptions};
use std::io::Error;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::time::{Duration, Instant};

pub const WRITER_LOCK: &str = "-writer.lock";
pub const EFFECTS_LOCK: &str = "-effects.lock";

// The held baton: the open File whose flock the kernel drops when this process
// ends (all fds closed on exit) or when this value is dropped. A caller that
// wants the writer role for its whole life keeps the Baton alive for the process
// lifetime and never drops it — dropping surrenders the role while still
// serving, exactly as closing Deno's FsFile would. Nothing to unlock by hand:
// `flock` releases on the last close of the open file description, which File's
// Drop performs.
#[derive(Debug)]
pub struct Baton {
    _file: File,
}

// Why a wait timed out or a sole taker was refused. A stringly message mirrors
// baton.ts's thrown Error text (`already held` / `did not release`) so a caller
// surfaces the same news whichever runtime holds the baton against it.
#[derive(Debug)]
pub struct BatonError(pub String);

impl std::fmt::Display for BatonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for BatonError {}

// How a wait taker polls — mirrors baton.ts's `{ wait, deadlineMs, poll }`.
// `wait:false` is the sole writer (first boot, revive, probe): it expects the
// baton free NOW, and a held one is a bug to surface, not to sit on. `wait:true`
// is the deploy successor (--join): its predecessor holds the baton and will
// release it on exit, so it polls until the baton frees or the deadline names a
// predecessor that would not let go.
pub struct TakeOpts<'a> {
    pub wait: bool,
    pub deadline: Duration,
    pub poll: Duration,
    pub suffix: &'a str,
}

impl Default for TakeOpts<'_> {
    fn default() -> Self {
        // Mirrors baton.ts's defaults: 330s deadline, 50ms poll, writer sidecar.
        TakeOpts {
            wait: false,
            deadline: Duration::from_millis(330_000),
            poll: Duration::from_millis(50),
            suffix: WRITER_LOCK,
        }
    }
}

// The sidecar path this baton locks — `<db><suffix>`, the exact string baton.ts
// opens, so the two runtimes lock ONE inode.
fn sidecar(db: &str, suffix: &str) -> String {
    format!("{db}{suffix}")
}

// Open the sidecar the way Deno's `Deno.openSync(path, {create,read,write,mode:0o600})`
// does — same flags, same mode, so either runtime may create it and the other
// locks the same file.
fn open_sidecar(path: &str) -> Result<File, Error> {
    // truncate(false) matches Deno's non-truncating openSync — the sidecar's
    // bytes are irrelevant to an advisory lock, and never emptying it keeps the
    // two runtimes' opens identical.
    OpenOptions::new().create(true).read(true).write(true).truncate(false).mode(0o600).open(path)
}

// One non-blocking exclusive grab — `flock(fd, LOCK_EX | LOCK_NB)`, Deno's
// `tryLockSync(true)`. true = acquired; false = a live process (Deno or Rust)
// holds it; Err = a real filesystem error, not contention.
fn try_flock(file: &File) -> Result<bool, Error> {
    // SAFETY: `fd` is a live, open descriptor owned by `file` for the duration
    // of the call; flock only reads it.
    let ret = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if ret == 0 {
        return Ok(true);
    }
    let e = Error::last_os_error();
    // EWOULDBLOCK (== EAGAIN on Linux) is "another open file description holds
    // it" — contention, not failure. Anything else is a real error.
    if e.raw_os_error() == Some(libc::EWOULDBLOCK) {
        Ok(false)
    } else {
        Err(e)
    }
}

// One synchronous grab, no waiting: Some(baton) if free, None if a live process
// holds it — baton.ts's `tryBaton`. ':memory:' has nothing to hold. A file that
// will not open is treated as contention-free-refused: None (the sole caller,
// connect()'s transient hold, treats absence of the baton as "not sole owner").
pub fn try_baton(db: &str, suffix: &str) -> Option<Baton> {
    if db == ":memory:" {
        return None;
    }
    let file = open_sidecar(&sidecar(db, suffix)).ok()?;
    match try_flock(&file) {
        Ok(true) => Some(Baton { _file: file }),
        _ => None,
    }
}

// Take the writer baton — baton.ts's `takeBaton`. ':memory:' returns None
// (nothing to hold, nothing to contend). `wait:false` expects it free now and
// errors on a held one; `wait:true` polls, yielding real time between tries,
// until the predecessor releases (its exit is the kernel release) or the
// deadline trips. The returned Baton is held for the caller's chosen lifetime;
// the swap successor keeps it for the whole process, releasing only on exit.
pub fn take_baton(db: &str, opts: &TakeOpts) -> Result<Option<Baton>, BatonError> {
    if db == ":memory:" {
        return Ok(None);
    }
    let path = sidecar(db, opts.suffix);
    let file =
        open_sidecar(&path).map_err(|e| BatonError(format!("cannot open baton {path}: {e}")))?;
    match try_flock(&file) {
        Ok(true) => return Ok(Some(Baton { _file: file })),
        Err(e) => return Err(BatonError(format!("baton {path} flock failed: {e}"))),
        Ok(false) => {}
    }
    if !opts.wait {
        return Err(BatonError(format!(
            "db baton {} for {db} is already held — another process owns this role. \
             Stop it, or point DB_PATH at a free copy.",
            opts.suffix
        )));
    }
    let deadline = Instant::now() + opts.deadline;
    loop {
        std::thread::sleep(opts.poll);
        match try_flock(&file) {
            Ok(true) => return Ok(Some(Baton { _file: file })),
            Err(e) => return Err(BatonError(format!("baton {path} flock failed: {e}"))),
            Ok(false) => {}
        }
        if Instant::now() >= deadline {
            return Err(BatonError(format!(
                "db baton {} for {db} still held after {}ms — the predecessor did not release it",
                opts.suffix,
                opts.deadline.as_millis()
            )));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> String {
        let dir =
            std::env::temp_dir().join(format!("baton-{}-{}", std::process::id(), fastrand_ish()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("graph.db").to_str().unwrap().to_string()
    }

    // A tiny per-call salt so parallel tests never share a sidecar — no dep.
    fn fastrand_ish() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    fn quick() -> TakeOpts<'static> {
        // Instant polls + a zero deadline for the wait cases that must trip.
        TakeOpts {
            wait: false,
            deadline: Duration::from_millis(0),
            poll: Duration::from_millis(1),
            suffix: WRITER_LOCK,
        }
    }

    #[test]
    fn memory_never_contends() {
        assert!(take_baton(":memory:", &TakeOpts::default()).unwrap().is_none());
        assert!(take_baton(":memory:", &TakeOpts { wait: true, ..TakeOpts::default() })
            .unwrap()
            .is_none());
        assert!(try_baton(":memory:", WRITER_LOCK).is_none());
    }

    #[test]
    fn free_taken_second_sole_refused() {
        let db = tmp_db();
        let held = take_baton(&db, &TakeOpts::default()).unwrap();
        assert!(held.is_some());
        // A second sole taker, in THIS process, is refused — flock is per open
        // file description, so a second open of the same path contends.
        let e = take_baton(&db, &quick()).unwrap_err();
        assert!(e.0.contains("already held"), "{}", e.0);
        assert!(e.0.contains(&db), "{}", e.0);
        // Released once the holder drops, so a fresh sole taker takes it again.
        drop(held);
        let again = take_baton(&db, &TakeOpts::default()).unwrap();
        assert!(again.is_some());
    }

    #[test]
    fn try_baton_reflects_holder() {
        let db = tmp_db();
        let held = try_baton(&db, WRITER_LOCK).unwrap();
        assert!(try_baton(&db, WRITER_LOCK).is_none()); // held → refused
        drop(held);
        assert!(try_baton(&db, WRITER_LOCK).is_some()); // released → free
    }

    #[test]
    fn a_predecessor_that_never_lets_go_trips_the_deadline() {
        let db = tmp_db();
        let pred = take_baton(&db, &TakeOpts::default()).unwrap();
        let e = take_baton(&db, &TakeOpts { wait: true, ..quick() }).unwrap_err();
        assert!(e.0.contains("did not release"), "{}", e.0);
        drop(pred);
    }

    #[test]
    fn a_successor_waits_then_takes_the_dropped_baton() {
        let db = tmp_db();
        let pred = take_baton(&db, &TakeOpts::default()).unwrap();
        let db2 = db.clone();
        // A helper thread drops the predecessor after a short hold; the waiter
        // must then acquire — the kernel release a real exit would perform.
        let dropper = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            drop(pred);
        });
        let succ = take_baton(
            &db2,
            &TakeOpts {
                wait: true,
                deadline: Duration::from_millis(5000),
                poll: Duration::from_millis(5),
                suffix: WRITER_LOCK,
            },
        )
        .unwrap();
        assert!(succ.is_some());
        dropper.join().unwrap();
    }

    #[test]
    fn writer_and_effects_locks_are_independent() {
        // The two roles ride separate sidecars, so a writer taker and an effects
        // taker coexist — the independence the split (D-22388) needs.
        let db = tmp_db();
        let w = take_baton(&db, &TakeOpts::default()).unwrap();
        let ef =
            take_baton(&db, &TakeOpts { suffix: EFFECTS_LOCK, ..TakeOpts::default() }).unwrap();
        assert!(w.is_some() && ef.is_some());
        // Each still excludes a second taker of its OWN role.
        assert!(take_baton(&db, &quick()).is_err());
        assert!(take_baton(&db, &TakeOpts { suffix: EFFECTS_LOCK, ..quick() }).is_err());
    }
}
