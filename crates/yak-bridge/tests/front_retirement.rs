// The compatibility front must retire graph routes itself: an older Deno app
// plane may still serve them. This boots the bridge against an upstream that
// answers every request with 200, then proves the complete shared retirement
// manifest never reaches it while neighboring SPA and static paths still do.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use yak_bridge::front::retired_data_doors;

struct Stub {
    url: String,
    hits: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Stub {
    fn start() -> Stub {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let thread_hits = hits.clone();
        let thread_stop = stop.clone();
        let thread = thread::spawn(move || {
            while !thread_stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => answer(&mut stream, &thread_hits),
                    Err(e) if e.kind() == ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(e) => panic!("stub accept failed: {e}"),
                }
            }
        });
        Stub { url, hits, stop, thread: Some(thread) }
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

fn answer(stream: &mut TcpStream, hits: &AtomicUsize) {
    let mut request = [0; 4096];
    let n = stream.read(&mut request).unwrap();
    hits.fetch_add(1, Ordering::Relaxed);
    let head = request[..n].starts_with(b"HEAD ");
    let body = if head { "" } else { "fallback" };
    write!(
        stream,
        "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
}

struct Bridge {
    child: Child,
    db: PathBuf,
}

impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.db.display()));
        }
    }
}

fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

fn temp_db() -> PathBuf {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    std::env::temp_dir().join(format!("yak-front-{}-{stamp}.db", std::process::id()))
}

fn request(base: &str, method: &str, path: &str) -> Result<u16, String> {
    let agent = ureq::Agent::config_builder().http_status_as_error(false).build().new_agent();
    let request = axum::http::Request::builder()
        .method(method)
        .uri(format!("{base}{path}"))
        .body(Vec::new())
        .map_err(|e| e.to_string())?;
    agent.run(request).map(|r| r.status().as_u16()).map_err(|e| e.to_string())
}

#[test]
fn retired_routes_stop_before_the_app_plane_for_every_method() {
    let stub = Stub::start();
    let db = temp_db();
    drop(yak_kernel::WriteStore::create_or_migrate(db.to_str().unwrap()).unwrap());
    let port = free_port();
    let child = Command::new(env!("CARGO_BIN_EXE_yak-bridge"))
        .args(["--db", db.to_str().unwrap(), "--port", &port.to_string(), "--app-url", &stub.url])
        .env_remove("DB_PATH")
        .env_remove("PORT")
        .env_remove("TASKS_UPSTREAM")
        .env_remove("TASKS_APP_URL")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut bridge = Bridge { child, db };
    let base = format!("http://127.0.0.1:{port}");

    let mut ready = false;
    for _ in 0..200 {
        if let Some(status) = bridge.child.try_wait().unwrap() {
            panic!("bridge exited during boot: {status}");
        }
        if request(&base, "GET", "/graph").is_ok() {
            ready = true;
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(ready, "bridge did not become ready");

    for path in retired_data_doors() {
        for method in ["GET", "POST", "HEAD"] {
            assert_eq!(request(&base, method, path).unwrap(), 404, "{method} {path}");
        }
    }
    assert_eq!(request(&base, "GET", "/anchor?old=1").unwrap(), 404);
    assert_eq!(stub.hits.load(Ordering::Relaxed), 0, "a retired route reached the app plane");

    for (method, path) in [
        ("GET", "/T-123"),
        ("HEAD", "/asset.js"),
        ("GET", "/anchor/child"),
        ("GET", "/searchable"),
        ("POST", "/oauth/callback"),
    ] {
        assert_eq!(request(&base, method, path).unwrap(), 200, "{method} {path}");
    }
    assert_eq!(stub.hits.load(Ordering::Relaxed), 5, "valid fallback paths were intercepted");
}
