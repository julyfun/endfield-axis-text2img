# Endfield Axis

把终末地战斗动作 CSV 生成图片时间轴。节点使用干员头像和对应技能图标；技能属性从内置查表取得，画在动作图标圆内向下的 120° 扇形中。

在仓库目录运行 `python3 -m http.server 4173`，打开 `http://127.0.0.1:4173/`。粘贴或导入 CSV 与海报 TOML，点击「生成预览」，再下载 PNG。运行时无需联网或安装依赖。

CSV 表头为 `operator,action,time,note`，见[示例](examples/rotation.csv)。`operator` 用赛希、祀、诀、提弗洛斯；`提丰`、`小葱`分别是提弗洛斯、祀的别名。`action` 用主控、战技、战技II、战技III、连携、大招、普攻、重击、切人、其他、闪避。`note` 是小字说明；动作是「其他」时，`note` 改为节点主标题。时间如 `6:57`，已填写的时间必须倒序，空白时间按相邻节点插值。同一秒的相邻节点不画箭头，只标一次时间。技能属性按干员和动作查表，每个动作至多一个属性。

[海报 TOML](examples/poster.toml) 可设 `title`（默认“战斗技能时间轴”）、`row_seconds`（默认 10，范围 1–60）、`operators`（默认提弗洛斯、祀、诀、赛希）和 `[aliases]`。队伍顺序决定键位：切人 `F1`–`F4`，战技 `1`–`4`，连携 `E`，大招为圆圈内的 `1`–`4`；普攻、重击用鼠标左键图标，闪避用右键图标。未填写的 TOML 字段使用默认值。[示例图片](examples/rotation.png)由示例 CSV 和海报 TOML 生成。

[视频 TOML](examples/video.toml) 暂定 `width`、`height`（默认 1920×1080）、`fps`（默认 30）、`seconds_visible`（默认 10，单行可见时间）、`sync_offset_seconds`（默认 0，首条 CSV 动作在录屏中的秒数）、`operators` 和 `[aliases]`。视频渲染尚未接入这组配置；当前透明测试片是固定演示，后续仍使用同一 CSV。

透明视频兼容性测试片均为 3 秒、1080p、30 fps，内容相同：[HEVC Alpha MOV](examples/alpha-test-hevc.mov)、[VP9 Alpha WebM](examples/alpha-test-vp9.webm)、[QuickTime Animation MOV](examples/alpha-test-animation.mov) 和 [ProRes 4444 MOV](examples/alpha-test.mov)。必剪已验证 QuickTime Animation 版本可播放。

人物图片及属性配色来自 AKEData；鼠标图标来自 Material Design Icons。详见[来源记录](assets/sources.csv)、[配色](assets/elements.toml)和[图标许可](assets/keys/LICENSE)。新增干员素材时按 [.agents/skills/akedata-assets/SKILL.md](.agents/skills/akedata-assets/SKILL.md) 获取。CSV 和 TOML 解析器分别为仓库内的 Papa Parse（MIT）与 smol-toml（BSD-3-Clause）。
