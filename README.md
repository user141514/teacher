# 教练助手（teacher）

面向管理者的团队辅导智能体。它先收集员工的能力与意愿证据，再按知识库完成类型判定，随后用 GROW/SBI 组织辅导方案，并在本次会话内根据反馈迭代建议。

## 当前状态

- `frontend/index.html` 是静态交互原型；Markdown 解析器已固定版本并随项目离线打包，预览时不请求 CDN。
- 原型目前没有接入大模型或后端；页面中的类型、方案和反馈均为固定演示内容，表单输入也尚未进入真实推理链路。
- `prompts/system.md` 与 `knowledge/ability-willingness-grid.md` 是当前 v2 运行真源。
- `tests/prompt-cases.md` 是提示词行为验收集，当前为人工/模型评测用例，不是可直接执行的前端自动化测试。

## 目录

```text
teacher/
├─ frontend/index.html                    # 前端原型与 Markdown 样式
├─ frontend/markdown-renderer.js          # 模型自由文本的安全渲染边界
├─ frontend/vendor/markdown-it.min.js     # 固定版本的离线解析器
├─ prompts/system.md                      # v2 全流程提示词
├─ knowledge/ability-willingness-grid.md  # 能力×意愿知识库（单一事实源）
├─ tests/prompt-cases.md                  # v2 提示词测试用例
└─ docs/legacy-combined.md                # 旧版合并稿，仅供追溯
```

`docs/legacy-combined.md` 缺少 v2 新增的 D1/D2 区分、GROW/SBI 与合并知识库规则，不得用于生产配置。

## 本地预览

在本目录执行：

```powershell
python -m http.server 4173 --directory frontend
```

然后访问 `http://localhost:4173/`。

## 前端回归

```powershell
npm.cmd install
npx.cmd playwright install chromium
npm.cmd test
```

完整审查结论见 `docs/adversarial-review.md`。

## Markdown 渲染约定

模型返回的叙述性字段必须传入 `renderMarkdown(element, text)`，不得直接拼接到 `innerHTML`。当前覆盖标题、粗体/斜体、删除线、有序/无序列表、引用、表格、链接、行内代码和围栏代码块；原始 HTML 始终按文字显示。链接只允许 `http`、`https`、`mailto`，远程图片只显示替代文字，不发起图片请求。

生产接入仍须先校验提示词约定的 JSON Schema，再逐字段渲染；类型、状态、置信度等原子字段继续使用 `textContent`，不能把模型整段响应直接当 Markdown。

## 后端接入边界

真实实现需要按 `prompts/system.md` 串联四次结构化调用：信息审查、类型判定、方案生成、反馈迭代。每步只接收约定字段并返回约定 JSON；解析失败最多重试一次。员工资料属于敏感职场数据，默认只在当前会话内使用，不写入日志或跨会话记忆。
