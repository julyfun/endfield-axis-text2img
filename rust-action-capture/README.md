# Endfield Action Capture

独立的 Rust + egui 子项目，用于把 `EndfieldLogsClient` 产生的 `session_*.ndjson` 战斗事件转换为参考仓库的简洁 CSV：

```csv
operator,action,time,note
提丰,战技,6:47.000,skill_xxx
```

程序会自动跟随日志目录中最新的 session 文件，维护技能实例到模板 ID 的映射，识别 `BattleOpSkillStartCast`，并在副本结束、重新开始或手动保存时写出 CSV。`challenge_expire_ts` 存在时优先使用副本倒计时；否则使用该场次首个事件的相对秒数。

当前版本复用现有抓包客户端的解密和 protobuf 层，Rust 程序负责 GUI、事件归一化和 CSV 输出。这样不需要在 Rust 中重复实现游戏私有协议，也避免直接读取游戏进程内存。

## 构建

```powershell
cargo run --manifest-path .\rust-action-capture\Cargo.toml
cargo build --release --manifest-path .\rust-action-capture\Cargo.toml
```

GUI 中填写 `EndfieldLogsClient` 的日志目录和 CSV 保存目录即可。
