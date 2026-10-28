#![windows_subsystem = "windows"]

mod capture;
mod timing;

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
    stamp: timing::Stamp,
    origin: timing::Stamp,
}

struct App {
    capture: Option<capture::Capture>,
    game_dir: String,
    csv_dir: String,
    actions: Vec<Action>,
    origin: Option<timing::Stamp>,
    clock: timing::Clock,
    countdown_end_ms: Option<i64>,
    saved_actions: usize,
    skill_by_inst: HashMap<i64, String>,
    name_by_inst: HashMap<i64, String>,
    leader: Option<i64>,
    status: String,
    packets: u64,
    auto_save: bool,
    record_dodges: bool,
    show_settings: bool,
    always_on_top: bool,
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
            origin: None,
            clock: timing::Clock::default(),
            countdown_end_ms: None,
            saved_actions: 0,
            skill_by_inst: HashMap::new(),
            name_by_inst: HashMap::new(),
            leader: None,
            status: "未开始抓包".into(),
            packets: 0,
            auto_save: true,
            record_dodges: false,
            show_settings: false,
            always_on_top: true,
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
                self.leader = None;
                self.origin = None;
                self.clock = timing::Clock::default();
                self.countdown_end_ms = None;
            }
            "capture_clock_sample" => {
                if let (Some(send), Some(receive), Some(server)) = (
                    e["send_ms"].as_i64(),
                    e["receive_ms"].as_i64(),
                    e["server_ms"].as_i64(),
                ) {
                    self.clock.ping(send, receive, server);
                    self.refresh_times();
                }
            }
            "SC_SELF_SCENE_INFO" | "squad_update" => {
                if let Some(members) = e["char_list"]
                    .as_array()
                    .or_else(|| e["members"].as_array())
                {
                    self.leader = members
                        .iter()
                        .find(|m| m["is_leader"].as_bool() == Some(true))
                        .and_then(|m| m["battle_inst_id"].as_i64());
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
                    (e["skill_inst_id"].as_i64(), e["action"].as_str())
                {
                    self.skill_by_inst.insert(inst, skill.into());
                } else if let Some(inst) = e["skill_inst_id"].as_i64() {
                    self.skill_by_inst.remove(&inst);
                }
            }
            "BattleOpSkillDetach" => {
                if let Some(inst) = e["skill_inst_id"].as_i64() {
                    self.skill_by_inst.remove(&inst);
                }
            }
            "SC_GAME_MECHANICS_SYNC_CHALLENGE_START" => {
                if !self.begin(&e) {
                    return;
                }
                self.set_countdown(&e["challenge_expire_ts"]);
            }
            "BattleOpModifyBattleState" => {
                if e["is_in_battle"].as_bool() == Some(false) {
                    self.finish();
                }
            }
            "SC_SYNC_WEEK_RAID_SETTLEMENT"
            | "SC_GAME_MECHANICS_SYNC_CHALLENGE_COMPLETE"
            | "SC_RESET_BATTLE_STATUS"
            | "SC_GAME_MECHANICS_SYNC_RESTART_GAME_INST" => {
                self.finish();
                self.origin = None;
                self.countdown_end_ms = None;
            }
            "BattleOpSkillStartCast" => {
                let action = e["skill_inst_id"]
                    .as_i64()
                    .and_then(|id| self.skill_by_inst.get(&id))
                    .cloned()
                    .unwrap_or_default();
                if action.is_empty() || (action == "闪避" && !self.record_dodges) {
                    return;
                };
                if matches!(action.as_str(), "重击" | "闪避")
                    && (self.leader.is_none() || e["owner_id"].as_i64() != self.leader)
                {
                    return;
                }
                let Some(owner) = e["owner_id"]
                    .as_i64()
                    .and_then(|id| self.name_by_inst.get(&id))
                    .cloned()
                else {
                    return;
                };
                if self.origin.is_none() && !self.begin(&e) {
                    return;
                }
                let stamp = self.stamp(&e);
                let origin = self.origin.unwrap();
                let time = self.clock.time_ms(stamp, origin, self.countdown_end_ms) as f64 / 1000.0;
                self.actions.push(Action {
                    operator: owner,
                    action: action.into(),
                    time,
                    stamp,
                    origin,
                });
                self.refresh_times();
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
            self.refresh_times();
        }
    }

    fn stamp(&mut self, e: &Value) -> timing::Stamp {
        self.clock.observe(
            e["timestamp_ms"].as_i64().unwrap_or(0),
            e["client_tick_tms"].as_i64(),
            e["generation"].as_i64(),
            e["seq_id"].as_i64(),
        )
    }

    fn refresh_times(&mut self) {
        if self.origin.is_none() {
            return;
        }
        for action in &mut self.actions {
            action.time = self
                .clock
                .time_ms(action.stamp, action.origin, self.countdown_end_ms)
                as f64
                / 1000.0;
        }
    }

    fn begin(&mut self, event: &Value) -> bool {
        if !self.finish() {
            return false;
        }
        self.actions.clear();
        self.saved_actions = 0;
        self.clock.begin();
        self.origin = Some(self.stamp(event));
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
        self.origin = None;
        true
    }

    fn save_csv(&self) -> std::io::Result<Option<PathBuf>> {
        if self.actions.is_empty() {
            return Ok(None);
        }
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
            w.write_record([&a.operator, &a.action, &format_time(a.time), ""])?;
        }
        w.flush()?;
        Ok(Some(path))
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll();
        ctx.request_repaint_after(Duration::from_millis(100));
        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(egui::vec2(
            640.0,
            if self.show_settings { 440.0 } else { 56.0 },
        )));
        egui::CentralPanel::default()
            .frame(
                egui::Frame::none()
                    .fill(egui::Color32::from_rgb(19, 22, 28))
                    .inner_margin(12.0),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    let color = if self.status.contains("失败") {
                        egui::Color32::from_rgb(248, 113, 113)
                    } else if self.capture.is_some() {
                        egui::Color32::from_rgb(94, 218, 174)
                    } else {
                        egui::Color32::from_gray(120)
                    };
                    ui.colored_label(color, "●");
                    let drag = ui
                        .add_sized(
                            [265.0, 30.0],
                            egui::Label::new(&self.status)
                                .truncate()
                                .sense(egui::Sense::drag()),
                        )
                        .on_hover_text(format!(
                            "{} · {} 包 · {} · 拖动移动窗口",
                            self.status,
                            self.packets,
                            if self.clock.server_offset_ms().is_some() {
                                "服务器时钟已校准"
                            } else {
                                "等待心跳校准时钟"
                            }
                        ));
                    if drag.dragged() {
                        ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
                    }
                    ui.label(egui::RichText::new(format!("{} 动作", self.actions.len())).weak());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("×").on_hover_text("退出").clicked() {
                            self.finish();
                            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                        if ui
                            .button(if self.show_settings {
                                "收起"
                            } else {
                                "设置"
                            })
                            .clicked()
                        {
                            self.show_settings = !self.show_settings;
                        }
                        if ui.button("保存").clicked() {
                            self.status = match self.save_csv() {
                                Ok(Some(_)) => {
                                    self.saved_actions = self.actions.len();
                                    "CSV 已保存".into()
                                }
                                Ok(None) => "没有动作记录，未保存".into(),
                                Err(e) => format!("CSV 保存失败：{e}"),
                            };
                        }
                        if self.capture.is_some() {
                            if ui.button("停止").clicked() {
                                self.capture.as_mut().unwrap().stop();
                                self.status = "正在停止抓包".into();
                            }
                        } else if ui.button("抓包").clicked() {
                            self.start();
                        }
                    });
                });
                if self.show_settings {
                    ui.add_space(10.0);
                    ui.separator();
                    ui.add_space(8.0);
                    let mut changed = false;
                    ui.horizontal(|ui| {
                        changed |= ui.checkbox(&mut self.always_on_top, "窗口置顶").changed();
                        changed |= ui
                            .checkbox(&mut self.auto_save, "战斗结束自动保存")
                            .changed();
                        changed |= ui
                            .checkbox(&mut self.record_dodges, "记录手动闪避")
                            .on_hover_text("AI 闪避始终忽略")
                            .changed();
                    });
                    if changed {
                        self.apply_window_level(ctx);
                    }
                    ui.add_space(8.0);
                    ui.label(egui::RichText::new("游戏目录").weak());
                    changed |= ui
                        .add(
                            egui::TextEdit::singleline(&mut self.game_dir)
                                .hint_text("留空自动检测 · 修改后重新抓包")
                                .desired_width(f32::INFINITY),
                        )
                        .changed();
                    ui.label(egui::RichText::new("保存位置").weak());
                    changed |= ui
                        .add(
                            egui::TextEdit::singleline(&mut self.csv_dir)
                                .desired_width(f32::INFINITY),
                        )
                        .changed();
                    if changed {
                        self.save_settings();
                    }
                    ui.add_space(8.0);
                    ui.label(
                        egui::RichText::new("先开始抓包，再启动游戏。已进入游戏时需重启游戏。")
                            .small()
                            .weak(),
                    );
                    ui.add_space(8.0);
                    ui.separator();
                    ui.add_space(6.0);
                    ui.label(egui::RichText::new("最近动作").small().weak());
                    egui::ScrollArea::vertical()
                        .max_height(110.0)
                        .stick_to_bottom(true)
                        .show(ui, |ui| {
                            if self.actions.is_empty() {
                                ui.label(egui::RichText::new("等待战斗动作…").weak());
                            }
                            for a in &self.actions {
                                ui.horizontal(|ui| {
                                    ui.label(
                                        egui::RichText::new(format_time(a.time)).monospace().weak(),
                                    );
                                    ui.label(&a.operator);
                                    ui.label(
                                        egui::RichText::new(&a.action)
                                            .color(egui::Color32::from_rgb(94, 218, 174)),
                                    );
                                });
                            }
                        });
                }
            });
    }
}

impl App {
    fn apply_window_level(&self, ctx: &egui::Context) {
        ctx.send_viewport_cmd(egui::ViewportCommand::WindowLevel(if self.always_on_top {
            egui::WindowLevel::AlwaysOnTop
        } else {
            egui::WindowLevel::Normal
        }));
    }

    fn save_settings(&mut self) {
        let path = settings_path();
        let settings = serde_json::json!({"always_on_top": self.always_on_top,
            "auto_save": self.auto_save, "record_dodges": self.record_dodges,
            "game_dir": self.game_dir, "csv_dir": self.csv_dir});
        if let Err(e) = fs::create_dir_all(path.parent().unwrap())
            .and_then(|_| fs::write(path, settings.to_string()))
        {
            self.status = format!("设置保存失败：{e}");
        }
    }

    fn load_settings(&mut self) {
        let Some(settings) = fs::read(settings_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        else {
            return;
        };
        self.always_on_top = settings["always_on_top"].as_bool().unwrap_or(true);
        self.auto_save = settings["auto_save"].as_bool().unwrap_or(true);
        self.record_dodges = settings["record_dodges"].as_bool().unwrap_or(false);
        if let Some(dir) = settings["game_dir"].as_str() {
            self.game_dir = dir.into();
        }
        if let Some(dir) = settings["csv_dir"].as_str() {
            self.csv_dir = dir.into();
        }
    }
}

fn settings_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("EndfieldActionCapture/settings.json")
}

impl Drop for App {
    fn drop(&mut self) {
        self.finish();
    }
}

fn format_time(t: f64) -> String {
    format!("{}:{:06.3}", (t / 60.0).floor() as i64, t % 60.0)
}

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([640.0, 56.0])
            .with_min_inner_size([640.0, 56.0])
            .with_resizable(false)
            .with_decorations(false),
        ..Default::default()
    };
    eframe::run_native(
        "终末地排轴",
        options,
        Box::new(|cc| {
            install_cjk_font(&cc.egui_ctx);
            install_theme(&cc.egui_ctx);
            let mut app = App::default();
            app.load_settings();
            app.apply_window_level(&cc.egui_ctx);
            app.start();
            Ok(Box::new(app))
        }),
    )
}

fn install_theme(ctx: &egui::Context) {
    let mut style = (*ctx.style()).clone();
    style.visuals = egui::Visuals::dark();
    style.visuals.override_text_color = Some(egui::Color32::from_rgb(220, 225, 233));
    style.visuals.panel_fill = egui::Color32::from_rgb(19, 22, 28);
    style.visuals.extreme_bg_color = egui::Color32::from_rgb(14, 17, 22);
    style.visuals.selection.bg_fill = egui::Color32::from_rgb(42, 91, 78);
    style.visuals.widgets.inactive.bg_fill = egui::Color32::from_rgb(32, 37, 46);
    style.visuals.widgets.hovered.bg_fill = egui::Color32::from_rgb(45, 53, 65);
    style.visuals.widgets.active.bg_fill = egui::Color32::from_rgb(42, 91, 78);
    for widget in [
        &mut style.visuals.widgets.inactive,
        &mut style.visuals.widgets.hovered,
        &mut style.visuals.widgets.active,
    ] {
        widget.rounding = egui::Rounding::same(6.0);
        widget.bg_stroke = egui::Stroke::NONE;
    }
    style.spacing.item_spacing = egui::vec2(8.0, 7.0);
    style.spacing.button_padding = egui::vec2(10.0, 6.0);
    style.spacing.interact_size.y = 28.0;
    ctx.set_style(style);
}

fn install_cjk_font(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    for path in [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
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
        app.consume(json!({"type":"SC_SELF_SCENE_INFO", "char_list":[{"battle_inst_id":42,"display_name":"提弗洛斯","is_leader":true}], "dungeon":{"challenge_expire_ts":"1800000420"}}));
        app.consume(json!({"type":"BattleOpSkillAttach", "skill_inst_id":7, "action":"战技"}));
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
        assert!(app.save_csv().unwrap().is_none());
        assert!(app.finish());
        assert!(!dir.exists());
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
        assert_eq!(&row[3], "");
        fs::remove_file(files[0].path()).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn exported_casts_use_tick_spacing_and_late_clock_calibration() {
        let mut app = App::default();
        app.auto_save = false;
        battle(&mut app);
        app.actions.clear();
        let end = app.countdown_end_ms.unwrap();
        app.consume(
            json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":7,
            "timestamp_ms":end - 400_000, "client_tick_tms":1000, "seq_id":10, "generation":1}),
        );
        app.consume(
            json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":7,
            "timestamp_ms":end - 400_000, "client_tick_tms":1300, "seq_id":11, "generation":1}),
        );
        assert!((app.actions[0].time - app.actions[1].time - 0.3).abs() < 0.0001);
        let before = app.actions[0].time;
        app.consume(json!({"type":"capture_clock_sample", "send_ms":end - 5000,
            "receive_ms":end - 4980, "server_ms":end - 4690}));
        assert!((app.actions[0].time - before + 0.3).abs() < 0.0001);
        let dir = std::env::temp_dir().join(format!(
            "capture-clock-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        app.csv_dir = dir.to_string_lossy().into_owned();
        let path = app.save_csv().unwrap().unwrap();
        let rows: Vec<_> = csv::Reader::from_path(&path)
            .unwrap()
            .records()
            .map(Result::unwrap)
            .collect();
        assert_eq!(&rows[0][2], &format_time(app.actions[0].time));
        assert_eq!(&rows[1][2], &format_time(app.actions[1].time));
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
        app.consume(json!({"type":"capture_session", "session_id":"new"}));
        assert!(app.clock.server_offset_ms().is_none());
    }

    #[test]
    fn next_challenge_gets_a_fresh_tick_anchor() {
        let mut app = App::default();
        app.auto_save = false;
        battle(&mut app);
        let base = 1_800_000_000_000_i64;
        app.consume(
            json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":7,
            "timestamp_ms":base + 2000, "client_tick_tms":1000, "seq_id":10}),
        );
        app.consume(json!({"type":"SC_GAME_MECHANICS_SYNC_CHALLENGE_START",
            "timestamp_ms":base + 10_000, "challenge_expire_ts":base + 430_000}));
        app.consume(
            json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":7,
            "timestamp_ms":base + 11_000, "client_tick_tms":2000, "seq_id":20}),
        );
        assert_eq!(app.actions.len(), 1);
        assert_eq!(app.actions[0].time, 419.0);
    }

    #[test]
    fn entering_combat_does_not_start_or_clear_a_recording() {
        let mut app = App::default();
        app.auto_save = false;
        app.consume(json!({"type":"BattleOpModifyBattleState", "is_in_battle":true, "timestamp_ms":1800000000000_i64}));
        assert!(app.origin.is_none());
        battle(&mut app);
        app.consume(json!({"type":"BattleOpModifyBattleState", "is_in_battle":false}));
        let previous = app.actions[0].time;
        app.consume(json!({"type":"BattleOpModifyBattleState", "is_in_battle":true, "timestamp_ms":1800000003000_i64}));
        assert!(app.origin.is_none());
        assert_eq!(app.actions.len(), 1);
        assert_eq!(app.actions[0].time, previous);
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":7, "timestamp_ms":1800000004000_i64}));
        assert!(app.origin.is_some());
        assert_eq!(app.actions.len(), 1);
        assert_eq!(app.actions[0].stamp.capture_ms, 1800000004000_i64);
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
            (8, None),
            (9, Some("连携")),
            (10, Some("大招")),
            (11, Some("重击")),
            (12, Some("处决")),
            (13, Some("战技II")),
            (14, Some("战技III")),
            (15, Some("闪避")),
        ] {
            app.consume(
                json!({"type":"BattleOpSkillAttach", "skill_inst_id":inst, "action":skill}),
            );
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
        let path = app.save_csv().unwrap().unwrap();
        let rows: Vec<_> = csv::Reader::from_path(&path)
            .unwrap()
            .records()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            rows.iter().map(|r| &r[1]).collect::<Vec<_>>(),
            ["战技", "连携", "大招", "重击", "处决", "战技II", "战技III"]
        );
        assert!(rows.iter().all(|row| row[3].is_empty()));
        app.record_dodges = true;
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":15}));
        assert_eq!(app.actions.last().unwrap().action, "闪避");
        app.consume(json!({"type":"BattleOpSkillAttach", "skill_inst_id":15, "action":null}));
        let count = app.actions.len();
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":42, "skill_inst_id":15}));
        assert_eq!(app.actions.len(), count);
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn heavy_attacks_follow_leader_switches_and_ignore_unknown_leader() {
        let mut app = App::default();
        app.auto_save = false;
        battle(&mut app);
        app.consume(json!({"type":"BattleOpSkillAttach", "skill_inst_id":8,"action":"重击"}));
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":42,"skill_inst_id":8}));
        assert_eq!(app.actions.len(), 2);
        app.consume(json!({"type":"SC_SELF_SCENE_INFO", "char_list":[
            {"battle_inst_id":42,"display_name":"提弗洛斯","is_leader":false},
            {"battle_inst_id":43,"display_name":"祀","is_leader":true}]}));
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":42,"skill_inst_id":8}));
        assert_eq!(app.actions.len(), 2);
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":43,"skill_inst_id":8}));
        assert_eq!(app.actions.len(), 3);
        assert_eq!(app.actions.last().unwrap().operator, "祀");
        app.leader = None;
        app.consume(json!({"type":"BattleOpSkillStartCast", "owner_id":43,"skill_inst_id":8}));
        assert_eq!(app.actions.len(), 3);
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
