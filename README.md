# Endfield Axis

把终末地战斗技能顺序 CSV/TSV 转成一张 PNG。第一版只展示动作、时间和备注，不需要人物图片。

直接在浏览器打开 [index.html](index.html)，粘贴表格或导入文件，点击「生成预览」，再下载 PNG。无需安装依赖或启动服务。

输入必须有 `skill,time,note` 表头。`time` 和 `note` 可以为空；包含逗号的内容按 CSV 规范用双引号包裹。项目内的 [示例 CSV](examples/rotation.csv) 与 [示例输出](examples/rotation.png) 对应。

后续需要添加干员头像时，使用 [.agents/skills/akedata-assets/SKILL.md](.agents/skills/akedata-assets/SKILL.md) 获取并记录素材来源。
