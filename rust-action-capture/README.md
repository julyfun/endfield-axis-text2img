# Endfield Action Capture

独立的 Rust + egui 程序，直接启动随附的无界面抓包组件，实时解析终末地战斗动作并导出 CSV：

```csv
operator,action,time,note
提弗洛斯,战技,6:47.000,
```

程序通过标准输出管道接收实时事件，使用登录时的角色技能清单及后续挂载／更新事件维护技能映射，并在战斗结束、重新开始、停止抓包或退出时自动保存 CSV（可关闭自动保存）。空记录无论手动还是自动保存都不生成 CSV。CSV 的 note 留空；普攻仅记录末段为重击，且只记录当前主控角色的重击，处决单独记录。多段战技依技能表区分为战技、战技II、战技III。闪避默认不记录，可在设置勾选手动闪避；AI 闪避和其他 common_ 技能始终过滤。主控根据入场队伍信息和服务器切人消息实时更新，主控未知时不记录重击或闪避。同一场战斗的重复结算不会重复自动导出。`challenge_expire_ts` 存在时使用副本倒计时；否则使用该场次开始后的相对秒数。CSV 保存在文档目录的 `EndfieldRotations` 子目录，可在设置中修改。

抓包组件复用本机 `EndfieldLogsClient` 的 Npcap、解密和 protobuf 核心，打包后与 GUI 一起分发。运行发行包不需要打开原客户端、不读取原客户端历史日志，也不需要另装 Python。游戏目录自动检测，也可在设置中填写包含 `GameAssembly.dll` 的目录。

## 使用

安装 [Npcap](https://npcap.com/#download)，然后运行完整发行目录中的 `endfield-action-capture.exe`。程序启动时自动开始抓包，也可以通过「停止／抓包」按钮控制。界面采用深色紧凑工具栏；展开「设置」可实时切换窗口置顶，保存后重启仍生效。置顶、自动保存、手动闪避和目录设置保存在 `%LOCALAPPDATA%\EndfieldActionCapture\settings.json`。

先开始抓包，再启动游戏，以捕获登录握手。如果游戏已经运行，程序会提示重启游戏。若 Npcap 安装时选择了仅管理员可用，则需要以管理员身份启动本程序。缺少驱动、游戏目录或解密依赖时，界面会显示错误；详细日志位于 `%LOCALAPPDATA%\EndfieldActionCapture\capture.log`，本程序的抓包事件日志位于同目录的 `logs` 子目录。

## 动作映射

`data/action_metadata.json` 保存来源与识别规则、各角色普攻末段和战技分段映射；`data/skill_actions.csv` 保存数值技能 ID、字符串 ID 和导出动作（空值表示过滤）。构建时从完整技能表重新生成，并随发行包附带。`power_attack` 按 CharacterPowerAttack 记为处决，仍需实际处决抓包复核；编号普攻的最高段记为重击。

## 开发运行

需要 Rust Windows 工具链和 64 位 Python 3.11+。安装抓包核心的 Python 依赖后，指定现有客户端的 `_internal` 目录（也会自动查找文档目录中的客户端）：

```powershell
cd rust-action-capture
python -m pip install -r capture/requirements.txt
$env:ENDFIELD_CAPTURE_CORE = 'C:\path\EndfieldLogsClient\_internal'
cargo run
```

可用 `ENDFIELD_CAPTURE_PYTHON` 指定 Python 解释器。运行 `python capture/worker.py --core-root $env:ENDFIELD_CAPTURE_CORE --log-dir work/logs --check` 可检查游戏 DLL、协议资源、密钥和抓包设备是否可用。

## 独立发行包

```powershell
python build.py --core-root $env:ENDFIELD_CAPTURE_CORE
```

输出为 `dist/endfield-action-capture/`，必须保留整个目录（含 `capture/`），可以复制到没有原客户端或 Python 的位置运行。构建时从指定核心中收集协议模块、消息表、技能表、角色名和解密资源；不会把这些外部资源提交到本仓库。游戏 DLL 仍从游戏安装目录读取，Npcap 需要在运行机器上安装。

如使用 GNU Rust 工具链，在 PATH 中加入 MinGW 的 `bin` 目录，并传入 `--toolchain stable-x86_64-pc-windows-gnu`。

## 验证

```powershell
cargo test
python -m unittest discover -s capture -p test_worker.py
```

Python 集成测试需要设置 `ENDFIELD_CAPTURE_CORE`，用于验证真实 protobuf 战斗事件到实时管道的转换，以及父程序退出时抓包服务的关闭。实际游戏抓包还需要 Npcap 和一次完整的游戏登录握手。
