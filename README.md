# Endfield Axis

把终末地战斗动作 CSV 生成图片时间轴。节点使用干员头像和对应技能图标；技能属性从内置查表取得，画在动作图标圆内向下的 120° 扇形中。

在仓库目录运行 `python3 -m http.server 4173`，打开 `http://127.0.0.1:4173/`。粘贴或导入 CSV 与海报 TOML，点击「生成预览」，再下载 PNG；点击「动态预览」或打开 `http://127.0.0.1:4173/video.html` 可在网页中播放时间轴。CSV/TOML 文本会缓存在当前浏览器，刷新后自动恢复；图片页和视频页分别缓存。视频页的 CSV、TOML 支持导入、保存和另存为，导入后会显示文件名；Chrome 中“另存为”可选择保存位置。运行时无需联网或安装依赖。

CSV 表头为 `operator,action,time,note`，见[示例](examples/rotation.csv)。干员、素材文件和技能属性统一维护在[干员元数据](assets/operators.toml)，当前支持 34 名干员（管理员区分男女形态）；`提丰`、`小葱`分别是提弗洛斯、祀的别名，统一维护在[仓库别名表](assets/aliases.toml)。`action` 可填任意非空文字；主控、战技、战技II、战技III、连携、大招、普攻、重击、切人、闪避沿用内置技能图标和键位。动作名显示在头像上方，`note` 作为下方小字说明。时间支持 `6:42` 或 `6:42.012`，已填写的时间必须倒序；首条动作必须填写时间，后续空白时间继承前一个动作。相邻动作间隔不超过 0.3 秒时紧凑排列且不画箭头；图上只显示整秒，每组最多标一次时间，主控不显示时间。技能属性按干员和动作查表，每个动作至多一个属性。

[默认渲染参数](assets/default.toml)集中维护默认间距、最大间距、尺寸、字体、颜色和视频动画参数；输入的海报/视频 TOML 只覆盖需要修改的字段，也兼容旧的扁平字段写法。CSV/TOML 中出现未定义字段时会在生成状态中给出警告。时间轴文字统一使用黑色描边；视频文字默认全白，海报保留原配色。

[海报 TOML](examples/poster.toml) 可设 `title`（默认“战斗技能时间轴”）、`timeline`（页脚可选署名）、`row_seconds`（默认 10，范围 1–60，支持小数）和 `operators`（默认提弗洛斯、祀、诀、赛希）。队伍顺序决定键位：切人 `F1`–`F4`，战技 `1`–`4`，连携 `E`，大招为圆圈内的 `1`–`4`；普攻、重击用鼠标左键图标，闪避用右键图标。`timeline` 不填或为空时，页脚只显示“制作：@菲比是拉拉”。未填写的 TOML 字段使用默认值。[示例图片](examples/rotation.png)由示例 CSV 和海报 TOML 生成。

[视频 TOML](examples/video.toml) 可设 `width`、`height`（默认 960×320，紧凑透明画布）、`fps`（默认 30）、`sync_offset_seconds`（默认 0，首条 CSV 动作在录屏中的秒数）和 `operators`。使用与海报相同的 CSV；视频按真实时间长度排布，相邻间隔不超过 0.3 秒的动作聚合为一组，组内和组间都有最小节点间距，组间间距也有最大值，镜头移动到组中心并同时高亮组内动作。当前组触发时播放白色水滴扩散圈，其他动作半透明，末尾停留 1 秒。

视频页的「生成」使用当前输入框中的 CSV/TOML 重新绘制；若在磁盘上修改了已导入的文件，需重新导入。「保存」使用浏览器 `MediaRecorder` 导出 WebM/Alpha；需要最新版 Chrome，导出过程按帧显示进度。需要 QuickTime Animation MOV 时，继续使用下方的 Node.js + FFmpeg 命令行。

生成透明视频需要 Node.js、Google Chrome 和 FFmpeg。在仓库目录运行 `npm install`，再运行 `npm run video -- examples/rotation.csv examples/video.toml output/rotation.mov`。输出为 QuickTime Animation MOV；`output/` 不纳入 Git。Chrome 不在默认安装位置时设置 `CHROME_PATH`。

透明视频兼容性测试片均为 3 秒、1080p、30 fps，内容相同：[HEVC Alpha MOV](examples/alpha-test-hevc.mov)、[VP9 Alpha WebM](examples/alpha-test-vp9.webm)、[QuickTime Animation MOV](examples/alpha-test-animation.mov) 和 [ProRes 4444 MOV](examples/alpha-test.mov)。必剪已验证 QuickTime Animation 版本可播放。

人物图片及属性配色来自 AKEData，鼠标图标来自 Material Design Icons，页脚图标来自 Wikimedia Commons。详见[来源记录](assets/sources.csv)、[配色](assets/elements.toml)和[图标许可](assets/keys/LICENSE)。新增干员素材时按 [.agents/skills/akedata-assets/SKILL.md](.agents/skills/akedata-assets/SKILL.md) 获取。CSV 和 TOML 解析器分别为仓库内的 Papa Parse（MIT）与 smol-toml（BSD-3-Clause）。
