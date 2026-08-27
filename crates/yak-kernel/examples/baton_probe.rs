// A tiny cross-runtime lock probe (T-22890) so a Deno slow test can PROVE the
// Rust writer baton and Deno's `FsFile.tryLockSync` contend on ONE flock. Two
// modes, both over `take_baton`/`try_baton` on `<db><suffix>`:
//
//   try  <db> [suffix]   — try_baton once; print `acquired`/`held`, exit 0/3.
//   hold <db> [suffix]   — take_baton(wait:false); on success print `held` (so
//                          the parent can wait for it), then block until killed,
//                          holding the flock. The kernel drops it when this
//                          process dies — no unlock path, which is the point.
//
// Never opens the db, only the sidecar, so no SQLite build ever touches a file.

use yak_kernel::baton::{take_baton, try_baton, TakeOpts, WRITER_LOCK};

fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap_or_default();
    let db = args.next().unwrap_or_else(|| {
        eprintln!("baton_probe: <try|hold> <db> [suffix]");
        std::process::exit(2);
    });
    let suffix = args.next().unwrap_or_else(|| WRITER_LOCK.to_string());
    match mode.as_str() {
        "try" => match try_baton(&db, &suffix) {
            Some(_held) => {
                println!("acquired");
                // Drop immediately: this mode reports the instantaneous state.
            }
            None => {
                println!("held");
                std::process::exit(3);
            }
        },
        "hold" => match take_baton(&db, &TakeOpts { suffix: &suffix, ..TakeOpts::default() }) {
            Ok(Some(_held)) => {
                // Report acquisition, then hold the flock until this process is
                // killed. The bind keeps `_held` alive across the park.
                println!("held");
                use std::io::Write;
                let _ = std::io::stdout().flush();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3600));
                }
            }
            Ok(None) => {
                println!(":memory:");
            }
            Err(e) => {
                println!("refused: {e}");
                std::process::exit(3);
            }
        },
        _ => {
            eprintln!("baton_probe: unknown mode {mode:?} (try|hold)");
            std::process::exit(2);
        }
    }
}
