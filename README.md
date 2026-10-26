# Endfield Axis

把终末地战斗技能顺序 CSV/TSV 转成一张图片时间轴。每行覆盖 10 秒；节点是干员头像与右下角的动作图标，箭头表示释放顺序。

在仓库目录运行 `python3 -m http.server 4173`，打开 `http://127.0.0.1:4173/`。粘贴表格或导入文件，点击「生成预览」，再下载 PNG。图片已存仓库，运行时无需联网或安装依赖。浏览器直接打开 `file://` 页面时无法导出包含本地图片的画布。

输入表头为 `operator,action,label,time,note`。`operator` 使用全名：赛希、祀、诀、提弗洛斯。`action` 取 `attack`、`skill`、`combo`、`ultimate`、`switch`；`label` 是节点下方的短文字。`time` 可写 `:57`、`57` 或 `1:57`，也可留空。已填写的时间必须倒序；留空的节点只按前后时间插值定位，不标注精确时刻。包含逗号的内容按 CSV 规范用双引号包裹。

[示例 CSV](examples/rotation.csv) 与 [示例输出](examples/rotation.png) 对应。原输入中一行包含多个动作的地方已拆成多个节点；原先未指明执行者的重击，示例暂按赛希、诀分别标注，可直接在 CSV 中修改。

图片资源来自 AKEData，详见 [来源记录](assets/sources.csv)。新增干员时使用 [.agents/skills/akedata-assets/SKILL.md](.agents/skills/akedata-assets/SKILL.md) 获取对应素材。
