#![windows_subsystem = "windows"]

mod capture;

use eframe::egui;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug)]
struct Action {
    operator: String,
    action: String,
    time: f64,
    note: String,
}

struct App {
    capture: Option<capture::Capture>,
    game_dir: String,
    csv_dir: String,
    actions: Vec<Action>,
    origin_ms: Option<i64>,
    countdown_end_ms: Option<i64>,
    saved_actions: usize,
    skill_by_inst: HashMap<i64, String>,
    name_by_inst: HashMap<i64, String>,
    status: String,
    packets: u64,
    auto_save: bool,
    show_settings: bool,
}

impl Default for App {
    fn default() -> Self {
        Self {
            capture: None,
            game_dir: String::new(),
            csv_dir: dirs::document_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("EndfieldRotations")
                .to_string_lossy()
                .into_owned(),
            actions: vec![],
            origin_ms: None,
            countdown_end_ms: None,
            saved_actions: 0,
            skill_by_inst: HashMap::new(),
            name_by_inst: HashMap::new(),
            status: "未开始抓包".into(),
            packets: 0,
            auto_save: true,
            show_settings: false,
        }
    }
}

impl App {
    fn start(&mut self) {
        match capture::Capture::start(&self.game_dir) {
            Ok(capture) => {
                self.capture = Some(capture);
                self.packets = 0;
                self.status = "正在启动抓包".into();
            }
            Err(e) => {
                self.status = format!("抓包启动失败：{e}");
                self.show_settings = true;
            }
        }
    }

    fn poll(&mut self) {
        for _ in 0..256 {
            let event = self.capture.as_ref().and_then(|c| c.events.try_recv().ok());
            let Some(event) = event else {
                break;
            };
            self.consume(event);
        }
        let exit = self.capture.as_mut().map(|c| c.poll_exit());
        match exit {
            Some(Ok(Some(code))) => {
                while let Some(event) = self.capture.as_ref().and_then(|c| c.events.try_recv().ok())
                {
                    self.consume(event);
                }
                self.capture = None;
                if !self.status.starts_with("抓包失败") {
                    self.status = if code.success() {
                        "抓包已停止".into()
                    } else {
                        format!("抓包异常退出（{code}），请查看 capture.log")
                    };
                }
                self.finish();
            }
            Some(Err(e)) => {
                self.capture = None;
                self.status = format!("抓包失败：{e}");
            }
            _ => {}
        }
    }

    fn consume(&mut self, e: Value) {
        let kind = e["type"].as_str().unwrap_or_default();
        let ts = e["timestamp_ms"].as_i64().unwrap_or(0);
        match kind {
            "capture_error" => {
                self.status = format!("抓包失败：{}", e["message"].as_str().unwrap_or("未知错误"));
                self.show_settings = true;
            }
            "capture_status" => {
                self.status = match e["state"].as_str().unwrap_or_default() {
                    "waiting_restart" => "抓包已启动，请重启游戏以捕获握手",
                    "waiting_game" => "抓包已启动，等待游戏",
                    "waiting_connection" => "等待游戏连接",
                    "waiting_handshake" => "等待登录握手",
                    "live" => "实时抓包中",
                    _ => "抓包已就绪",
                }
                .into()
            }
            "capture_metrics" => self.packets = e["packets"].as_u64().unwrap_or(0),
            "capture_session" => {
                if !self.finish() {
                    return;
                }
                self.actions.clear();
                self.saved_actions = 0;
                self.skill_by_inst.clear();
                self.name_by_inst.clear();
                self.origin_ms = None;
                self.countdown_end_ms = None;
            }
            "SC_SELF_SCENE_INFO" | "squad_update" => {
                if let Some(members) = e["char_list"]
                    .as_array()
                    .or_else(|| e["members"].as_array())
                {
                    for member in members {
                        if let (Some(id), Some(name)) = (
                            member["battle_inst_id"].as_i64(),
                            member["display_name"].as_str(),
                        ) {
                            self.name_by_inst.insert(id, name.to_owned());
                        }
                    }
                }
                self.set_countdown(&e["dungeon"]["challenge_expire_ts"]);
            }
            "BattleOpSkillAttach" => {
                if let (Some(inst), Some(skill)) =
                    (e["skill_inst_id"].as_i64(), e["template_str_id"].as_str())
                {
                    self.skill_by_inst.insert(inst, skill.into());
                }
            }
            "BattleOpSkillDetach" => {
                if let Some(inst) = e["skill_inst_id"].as_i64() {
                    self.skill_by_inst.remove(&inst);
                }
            }
            "SC_GAME_MECHANICS_SYNC_CHALLENGE_START" => {
                if !self.begin(ts) {
                    return;
                }
                self.set_countdown(&e["challenge_expire_ts"]);
            }
            "BattleOpModifyBattleState" => match e["is_in_battle"].as_bool() {
                Some(true) => {
                    if self.origin_ms.is_none() {
                        self.begin(ts);
                    }
                }
                Some(false) => {
                    self.finish();
                }
                _ => {}
            },
            "SC_SYNC_WEEK_RAID_SETTLEMENT"
            | "SC_GAME_MECHANICS_SYNC_CHALLENGE_COMPLETE"
            | "SC_RESET_BATTLE_STATUS"
            | "SC_GAME_MECHANICS_SYNC_RESTART_GAME_INST" => {
                self.finish();
                self.origin_ms = None;
                self.countdown_end_ms = None;
            }
            "BattleOpSkillStartCast" => {
                let skill = e["skill_inst_id"]
                    .as_i64()
                    .and_then(|id| self.skill_by_inst.get(&id))
                    .cloned()
                    .unwrap_or_default();
                let Some(action) = classify(&skill) else {
                    return;
                };
                let Some(owner) = e["owner_id"]
                    .as_i64()
                    .and_then(|id| self.name_by_inst.get(&id))
                    .cloned()
                else {
                    return;
                };
                if self.origin_ms.is_none() && !self.begin(ts) {
                    return;
                }
                let time = self
                    .countdown_end_ms
                    .map(|end| (end - ts).max(0))
                    .unwrap_or_else(|| (ts - self.origin_ms.unwrap_or(ts)).max(0))
                    as f64
                    / 1000.0;
                self.actions.push(Action {
                    operator: owner,
                    action: action.into(),
                    time,
                    note: skill,
                });
            }
            _ => {}
        }
    }

    fn set_countdown(&mut self, value: &Value) {
        if let Some(end) = value
            .as_i64()
            .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
            .filter(|end| *end > 0)
        {
            self.countdown_end_ms = Some(if end < 100_000_000_000 {
                end * 1000
            } else {
                end
            });
        }
    }

    fn begin(&mut self, ts: i64) -> bool {
        if !self.finish() {
            return false;
        }
        self.actions.clear();
        self.saved_actions = 0;
        self.origin_ms = Some(ts);
        true
    }

    fn finish(&mut self) -> bool {
        if self.auto_save && self.actions.len() > self.saved_actions {
            match self.save_csv() {
                Ok(_) => self.saved_actions = self.actions.len(),
                Err(e) => {
                    self.status = format!("CSV 保存失败：{e}");
                    return false;
                }
            }
        }
        self.origin_ms = None;
        true
    }

    fn save_csv(&self) -> std::io::Result<PathBuf> {
        let dir = Path::new(&self.csv_dir);
        fs::create_dir_all(dir)?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = dir.join(format!("endfield_rotation_{stamp}.csv"));
        let mut w = csv::Writer::from_path(&path)?;
        w.write_record(["operator", "action", "time", "note"])?;
        for a in &self.actions {
            w.write_record([&a.operator, &a.action, &format_time(a.time), &a.note])?;
        }
        w.flush()?;
        Ok(path)
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll();
        ctx.request_repaint_after(Duration::from_millis(100));
        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(egui::vec2(
            600.0,
            if self.show_settings { 300.0 } else { 34.0 },
        )));
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.spacing_mut().item_spacing = egui::vec2(3.0, 2.0);
            ui.horizontal(|ui| {
                let drag = ui
                    .add_sized(
                        [365.0, 18.0],
                        egui::Label::new(format!(
                            "{} · {} 包 · {} 动作",
                            self.status,
                            self.packets,
                            self.actions.len()
                        ))
                        .truncate()
                        .sense(egui::Sense::drag()),
                    )
                    .on_hover_text(&self.status);
                if drag.dragged() {
                    ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
                }
                if self.capture.is_some() {
                    if ui.small_button("停止").clicked() {
                        self.capture.as_mut().unwrap().stop();
                        self.status = "正在停止抓包".into();
                    }
                } else if ui.small_button("抓包").clicked() {
                    self.start();
                }
                if ui.small_button("存").clicked() {
                    self.status = match self.save_csv() {
                        Ok(_) => {
                            self.saved_actions = self.actions.len();
                            "CSV 已保存".into()
                        }
                        Err(e) => format!("CSV 保存失败：{e}"),
                    };
                }
                if ui
                    .small_button(if self.show_settings { "收" } else { "设置" })
                    .clicked()
                {
                    self.show_settings = !self.show_settings;
                }
                if ui.small_button("×").clicked() {
                    self.finish();
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            });
            if self.show_settings {
                ui.separator();
                ui.checkbox(&mut self.auto_save, "战斗结束自动保存");
                ui.label("游戏目录（留空自动检测，修改后重新抓包）");
                ui.text_edit_singleline(&mut self.game_dir);
                ui.label("CSV 保存目录");
                ui.text_edit_singleline(&mut self.csv_dir);
                ui.label("先开始抓包，再启动游戏；已进入游戏时请重启游戏。");
                ui.label("抓包需要安装 Npcap；若驱动限制权限，请以管理员身份运行。");
                egui::ScrollArea::vertical()
                    .max_height(110.0)
                    .show(ui, |ui| {
                        for a in &self.actions {
                            ui.label(format!(
                                "{} {} {}",
                                a.operator,
                                a.action,
                                format_time(a.time)
                            ));
                        }
                    });
            }
        });
    }
}

impl Drop for App {
    fn drop(&mut self) {
        self.finish();
    }
}

fn classify(skill: &str) -> Option<&str> {
    if skill.is_empty() {
        return None;
    }
    Some(if skill.contains("ultimate") {
        "大招"
    } else if skill.contains("combo") {
        "连携"
    } else if skill.contains("normal_skill") {
        "战技"
    } else if skill.contains("dodge") {
        "闪避"
    } else if skill.contains("power_attack") {
        "重击"
    } else if skill.contains("attack") {
        return None;
    } else {
        "其他"
    })
}
fn format_time(t: f64) -> String {
    format!("{}:{:06.3}", (t / 60.0).floor() as i64, t % 60.0)
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([600.0, 34.0])
            .with_min_inner_size([300.0, 28.0])
            .with_resizable(false)
            .with_decorations(false)
            .with_always_on_top(),
        ..Default::default()
    };
    eframe::run_native(
        "终末地排轴",
        options,
        Box::new(|cc| {
            install_cjk_font(&cc.egui_ctx);
            let mut app = App::default();
            app.start();
            Ok(Box::new(app))
        }),
    )
}

fn install_cjk_font(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    for path in [
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simsun.ttc",
    ] {
        if let Ok(bytes) = fs::read(path) {
            fonts
                .font_data
                .insert("cjk".into(), egui::FontData::from_owned(bytes).into());
            for family in [egui::FontFamily::Proportional, egui::FontFamily::Monospace] {
                fonts
                    .families
                    .entry(family)
                    .or_default()
                    .insert(0, "cjk".into());
            }
            ctx.set_fonts(fonts);
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn battle(app: &mut App) {
        app.consume(json!({"type":"capture_session", "session_id":"one"}));
        app.consume(json!({"type":"SC_SELF_SCENE_INFO", "char_list":[{"battle_inst_id":42,"display_name":"提弗洛斯"}], "dungeon":{"challenge_expire_ts":"1800000420"}}));
        app.consume(json!({"type":"BattleOpSkillAttach", "skill_inst_id":7, "template_str_id":"chr_0042_normal_skill"}));
        app.consume(json!({"type":"BattleOpModifyBattleState", "is_in_battle":true, "timestamp_ms":1800000000000_i64}));
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":7, "timestamp_ms":1800000001250_i64}));
    }

    #[test]
    fn live_events_export_named_actions_and_countdown_without_duplicate_settlements() {
        let dir = std::env::temp_dir().join(format!(
            "endfield-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut app = App::default();
        app.csv_dir = dir.to_string_lossy().into_owned();
        battle(&mut app);
        assert_eq!(app.actions[0].operator, "提弗洛斯");
        assert_eq!(app.actions[0].action, "战技");
        assert_eq!(format_time(app.actions[0].time), "6:58.750");
        app.consume(json!({"type":"SC_GAME_MECHANICS_SYNC_CHALLENGE_COMPLETE"}));
        app.consume(json!({"type":"SC_SYNC_WEEK_RAID_SETTLEMENT"}));
        let files: Vec<_> = fs::read_dir(&dir).unwrap().map(Result::unwrap).collect();
        assert_eq!(files.len(), 1);
        let mut reader = csv::Reader::from_path(files[0].path()).unwrap();
        let row = reader.records().next().unwrap().unwrap();
        assert_eq!(&row[0], "提弗洛斯");
        assert_eq!(&row[2], "6:58.750");
        fs::remove_file(files[0].path()).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn new_session_clears_old_identity_and_ignores_enemy_casts() {
        let mut app = App::default();
        app.auto_save = false;
        battle(&mut app);
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":99, "skill_inst_id":7}));
        assert_eq!(app.actions.len(), 1);
        app.consume(json!({"type":"capture_session", "session_id":"two"}));
        assert!(app.actions.is_empty());
        assert!(app.name_by_inst.is_empty());
        assert!(app.skill_by_inst.is_empty());
        assert!(app.countdown_end_ms.is_none());
    }

    #[test]
    fn csv_excludes_normal_attacks_but_keeps_skills_and_heavy_attacks() {
        let mut app = App::default();
        app.auto_save = false;
        battle(&mut app);
        for (inst, skill) in [
            (8, "chr_0036_jsspsi_attack1"),
            (9, "chr_0036_jsspsi_combo_skill"),
            (10, "chr_0036_jsspsi_ultimate_skill"),
            (11, "chr_0036_jsspsi_power_attack"),
        ] {
            app.consume(json!({"type":"BattleOpSkillAttach", "skill_inst_id":inst, "template_str_id":skill}));
            app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":inst, "timestamp_ms":1800000002000_i64}));
        }
        let dir = std::env::temp_dir().join(format!(
            "endfield-filter-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        app.csv_dir = dir.to_string_lossy().into_owned();
        let path = app.save_csv().unwrap();
        let rows: Vec<_> = csv::Reader::from_path(&path)
            .unwrap()
            .records()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            rows.iter().map(|r| &r[1]).collect::<Vec<_>>(),
            ["战技", "连携", "大招", "重击"]
        );
        assert!(rows.iter().all(|row| !row[3].ends_with("_attack1")));
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn failed_save_keeps_actions_and_reports_the_error() {
        let mut app = App::default();
        app.auto_save = false;
        battle(&mut app);
        app.csv_dir = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        app.auto_save = true;
        assert!(!app.finish());
        assert_eq!(app.actions.len(), 1);
        assert!(app.status.starts_with("CSV 保存失败"));
    }
}
