# Endfield Axis

把终末地战斗技能顺序 YAML 转成一张图片时间轴。节点是干员头像与右下角的动作图标，箭头表示释放顺序。图标边框及角标使用每条动作指定的属性。

在仓库目录运行 `python3 -m http.server 4173`，打开 `http://127.0.0.1:4173/`。粘贴 YAML 或导入文件，点击「生成预览」，再下载 PNG。图片、配色和解析器都在仓库内，运行时无需联网或安装依赖。浏览器直接打开 `file://` 页面无法加载配置与导出图片。

YAML 顶层可设置 `title` 和 `row_seconds`。`steps` 每行按“干员、动作、标签、时间、属性、备注”排列；备注可省略。干员使用全名：赛希、祀、诀、提弗洛斯。动作取 `attack`、`skill`、`combo`、`ultimate`、`switch`；属性取物理、寒冷、灼热、自然、电磁或无，按技能效果填写，不能由干员推断。时间写成 `'6:57'`，未知时写 `~`。已知时间必须倒序，未知时间只用于插值定位。同一秒的相邻节点不画箭头。

[示例 YAML](examples/rotation.yaml) 与 [示例输出](examples/rotation.png) 对应。原输入中一行包含多个动作的地方已拆成多个节点；原先未指明执行者的重击，示例暂按赛希、诀分别标注，可直接在 YAML 中修改。无直接属性伤害的辅助动作标为“无”。

[透明视频测试片](examples/alpha-test.mov) 是 3 秒、1080p、30 fps 的 ProRes 4444 MOV。导入必剪后放在录屏上方，检查画面上部能否透出录屏、下方半透明面板能否正常合成；此文件仅用于验证必剪的 Alpha 导入，不对应示例 YAML 的完整时间轴。

图片及五属性展示色来自 AKEData，详见 [来源记录](assets/sources.csv) 和 [配色](assets/elements.yaml)。新增干员时使用 [.agents/skills/akedata-assets/SKILL.md](.agents/skills/akedata-assets/SKILL.md) 获取对应素材。YAML 解析器采用仓库内的 js-yaml（MIT 许可）。
