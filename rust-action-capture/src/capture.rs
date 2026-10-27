use serde_json::Value;
use std::{
    fs::{self, File},
    io::{self, BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

pub struct Capture {
    child: Child,
    pub events: Receiver<Value>,
    stopping: Option<Instant>,
    reader_done: Arc<AtomicBool>,
}

impl Capture {
    pub fn start(game_dir: &str) -> io::Result<Self> {
        let data = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("EndfieldActionCapture");
        fs::create_dir_all(&data)?;
        let exe = std::env::current_exe()?
            .parent()
            .unwrap()
            .join("capture/endfield-capture.exe");
        let mut command = if exe.is_file() {
            Command::new(exe)
        } else {
            let core = std::env::var_os("ENDFIELD_CAPTURE_CORE")
                .map(PathBuf::from)
                .or_else(find_core)
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::NotFound,
                        "缺少抓包组件，请使用完整发行包或设置 ENDFIELD_CAPTURE_CORE",
                    )
                })?;
            let mut command = Command::new(
                std::env::var_os("ENDFIELD_CAPTURE_PYTHON").unwrap_or_else(|| "python".into()),
            );
            command
                .arg("-u")
                .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/capture/worker.py"))
                .arg("--core-root")
                .arg(core);
            command
        };
        command.arg("--log-dir").arg(data.join("logs"));
        if !game_dir.trim().is_empty() {
            command
                .arg("--game-dir")
                .arg(game_dir.trim().trim_matches('"'));
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(File::create(data.join("capture.log"))?));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn()?;
        let stdout = child.stdout.take().unwrap();
        let (tx, events) = mpsc::sync_channel(1024);
        let reader_done = Arc::new(AtomicBool::new(false));
        let done = reader_done.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let event = match line {
                    Ok(line) => serde_json::from_str::<Value>(&line)
                        .unwrap_or_else(|e| serde_json::json!({"type": "capture_error", "message": format!("抓包组件输出无效：{e}")})),
                    Err(e) => serde_json::json!({"type": "capture_error", "message": e.to_string()}),
                };
                if tx.send(event).is_err() {
                    break;
                }
            }
            done.store(true, Ordering::Release);
        });
        Ok(Self {
            child,
            events,
            stopping: None,
            reader_done,
        })
    }

    pub fn stop(&mut self) {
        if self.stopping.is_none() {
            self.child.stdin.take(); // EOF requests a graceful shutdown.
            self.stopping = Some(Instant::now());
        }
    }

    pub fn poll_exit(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
        if self
            .stopping
            .is_some_and(|at| at.elapsed() > Duration::from_secs(3))
        {
            let _ = self.child.kill();
        }
        let status = self.child.try_wait()?;
        Ok(status.filter(|_| self.reader_done.load(Ordering::Acquire)))
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn find_core() -> Option<PathBuf> {
    let documents = dirs::document_dir()?;
    let mut roots: Vec<_> = fs::read_dir(documents)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("EndfieldLogsClient/_internal"))
        .filter(|path| path.join("src/endfield_pcap/service.py").is_file())
        .collect();
    roots.sort();
    roots.pop()
}
