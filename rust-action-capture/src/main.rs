use eframe::egui;
use serde::Deserialize;
use std::{fs, path::{Path, PathBuf}, time::{Duration, Instant}};

#[derive(Clone, Debug)]
struct Action { operator: String, action: String, time: Option<f64>, note: String }

#[derive(Default, Deserialize)]
struct Event { #[serde(rename = "type")] kind: Option<String>, timestamp_ms: Option<i64>, payload: Option<serde_json::Value>, #[serde(flatten)] rest: serde_json::Map<String, serde_json::Value> }

struct App {
    log_dir: String,
    csv_dir: String,
    current_file: Option<PathBuf>,
    offset: u64,
    actions: Vec<Action>,
    battle_started: Option<Instant>,
    first_capture_ms: Option<i64>,
    countdown_origin_ms: Option<i64>,
    status: String,
    last_tick: Instant,
    auto_save: bool,
    skill_by_inst: std::collections::HashMap<i64, String>,
    name_by_inst: std::collections::HashMap<i64, String>,
    countdown_end_ms: Option<i64>,
}

impl Default for App {
    fn default() -> Self {
        let log_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        let csv_dir = dirs::document_dir().unwrap_or_else(|| PathBuf::from("."));
        Self { log_dir: log_dir.to_string_lossy().into_owned(), csv_dir: csv_dir.to_string_lossy().into_owned(), current_file: None, offset: 0, actions: vec![], battle_started: None, first_capture_ms: None, countdown_origin_ms: None, status: "等待 session_*.ndjson".into(), last_tick: Instant::now(), auto_save: true, skill_by_inst: Default::default(), name_by_inst: Default::default(), countdown_end_ms: None }
    }
}

impl App {
    fn poll(&mut self) {
        let dir = Path::new(&self.log_dir);
        let file = newest_session(dir);
        if file != self.current_file { self.current_file = file; self.offset = 0; self.actions.clear(); self.battle_started = None; self.first_capture_ms = None; self.countdown_origin_ms = None; self.countdown_end_ms = None; self.skill_by_inst.clear(); self.name_by_inst.clear(); }
        let Some(path) = self.current_file.clone() else { self.status = "未找到 session_*.ndjson".into(); return; };
        let Ok(bytes) = fs::read(&path) else { return; };
        if self.offset > bytes.len() as u64 { self.offset = 0; }
        let new = &bytes[self.offset as usize..];
        for line in new.split(|b| *b == b'\n') {
            if let Ok(text) = std::str::from_utf8(line) { if !text.trim().is_empty() { if let Ok(event) = serde_json::from_str::<Event>(text) { self.consume(event); } } }
        }
        self.offset = bytes.len() as u64;
        self.status = format!("{} · {} 个技能", path.file_name().unwrap_or_default().to_string_lossy(), self.actions.len());
    }

    fn consume(&mut self, e: Event) {
        let kind = e.kind.unwrap_or_default();
        let ts = e.timestamp_ms.unwrap_or(0);
        let data = e.payload.unwrap_or_else(|| serde_json::Value::Object(e.rest));
        let obj = data.as_object();
        let in_battle = obj.and_then(|o| o.get("is_in_battle")).and_then(|v| v.as_bool());
        if kind == "BattleOpModifyBattleState" && in_battle == Some(true) { self.begin(ts); }
        if kind == "BattleOpModifyBattleState" && in_battle == Some(false) { self.finish(); }
        if matches!(kind.as_str(), "SC_SYNC_WEEK_RAID_SETTLEMENT" | "SC_GAME_MECHANICS_SYNC_CHALLENGE_COMPLETE" | "SC_RESET_BATTLE_STATUS") { self.finish(); }
        if kind == "SC_GAME_MECHANICS_SYNC_CHALLENGE_START" { if let Some(end) = obj.and_then(|o| o.get("challenge_expire_ts")).and_then(|v| v.as_i64()) { self.countdown_end_ms = Some(end); } self.begin(ts); }
        if kind == "BattleOpSkillAttach" { if let (Some(inst), Some(skill)) = (obj.and_then(|o| o.get("skill_inst_id")).and_then(|v| v.as_i64()), obj.and_then(|o| o.get("template_str_id").or_else(|| o.get("template_int_id"))).map(value_text)) { self.skill_by_inst.insert(inst, skill); } }
        if kind == "BattleOpSkillStartCast" {
            let owner = obj.and_then(|o| o.get("owner_display_name").or_else(|| o.get("owner"))).and_then(|v| v.as_str()).unwrap_or("未知干员");
            let inst = obj.and_then(|o| o.get("skill_inst_id")).and_then(|v| v.as_i64());
            let skill = obj.and_then(|o| o.get("skill").or_else(|| o.get("skill_id"))).map(value_text).or_else(|| inst.and_then(|id| self.skill_by_inst.get(&id).cloned())).unwrap_or_default();
            let action = classify(&skill);
            let t = self.countdown(ts);
            self.actions.push(Action { operator: clean_operator(owner), action, time: t, note: skill.to_string() });
        }
    }

    fn begin(&mut self, ts: i64) { self.battle_started = Some(Instant::now()); self.first_capture_ms = Some(ts); self.countdown_origin_ms = Some(ts); }
    fn countdown(&self, ts: i64) -> Option<f64> { self.countdown_end_ms.map(|end| ((end - ts).max(0) as f64) / 1000.0).or_else(|| self.countdown_origin_ms.map(|origin| ((ts - origin).max(0) as f64) / 1000.0)) }
    fn finish(&mut self) { if self.actions.is_empty() { return; } if self.auto_save { let _ = self.save_csv(); } self.battle_started = None; self.first_capture_ms = None; self.countdown_origin_ms = None; }
    fn save_csv(&self) -> std::io::Result<()> {
        let dir = Path::new(&self.csv_dir); fs::create_dir_all(dir)?;
        let stamp = chrono_like_stamp(); let path = dir.join(format!("endfield_rotation_{stamp}.csv"));
        let mut w = csv::Writer::from_path(path)?; w.write_record(["operator", "action", "time", "note"])?;
        for a in &self.actions { w.write_record([a.operator.as_str(), a.action.as_str(), &format_time(a.time), a.note.as_str()])?; } w.flush()
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if self.last_tick.elapsed() >= Duration::from_millis(500) { self.poll(); self.last_tick = Instant::now(); ctx.request_repaint(); }
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("Endfield Action Capture"); ui.label("读取 EndfieldLogsClient 的 session_*.ndjson，生成简洁 action CSV");
            ui.horizontal(|ui| { ui.label("日志目录"); ui.text_edit_singleline(&mut self.log_dir); });
            ui.horizontal(|ui| { ui.label("CSV 保存目录"); ui.text_edit_singleline(&mut self.csv_dir); });
            ui.checkbox(&mut self.auto_save, "战斗结束自动保存");
            if ui.button("立即扫描").clicked() { self.poll(); }
            ui.separator(); ui.label(&self.status);
            let elapsed = self.battle_started.map(|t| t.elapsed().as_secs_f32()).unwrap_or(0.0);
            ui.label(format!("当前场次：{} 个技能 · 首个技能后 {:.1} 秒", self.actions.len(), elapsed));
            if ui.button("手动保存当前 CSV").clicked() { self.status = match self.save_csv() { Ok(()) => "已保存当前 CSV".into(), Err(e) => format!("保存失败：{e}") }; }
            egui::ScrollArea::vertical().show(ui, |ui| { for (i, a) in self.actions.iter().enumerate() { ui.label(format!("{:>3}  {:<8} {:<8} {}", i + 1, a.operator, a.action, format_time(a.time))); } });
        });
    }
}

fn newest_session(dir: &Path) -> Option<PathBuf> { let mut files: Vec<_> = fs::read_dir(dir).ok()?.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with("session_") && n.ends_with(".ndjson")).unwrap_or(false)).collect(); files.sort_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok()); files.pop() }
fn clean_operator(s: &str) -> String { s.split('_').next().unwrap_or(s).to_string() }
fn value_text(v: &serde_json::Value) -> String { v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string().trim_matches('"').to_string()) }
fn classify(s: &str) -> String { let s = s.to_lowercase(); if s.contains("ultimate") || s.contains("skill_3") { "大招".into() } else if s.contains("combo") { "连携".into() } else if s.contains("skill") { "战技".into() } else { "其他".into() } }
fn format_time(v: Option<f64>) -> String { v.map(|x| format!("{}:{:06.3}", (x / 60.0).floor() as i64, x % 60.0)).unwrap_or_default() }
fn chrono_like_stamp() -> String { use std::time::{SystemTime, UNIX_EPOCH}; SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs().to_string()).unwrap_or_else(|_| "now".into()) }

fn main() -> eframe::Result<()> { eframe::run_native("Endfield Action Capture", eframe::NativeOptions::default(), Box::new(|_cc| Ok(Box::new(App::default())))) }
