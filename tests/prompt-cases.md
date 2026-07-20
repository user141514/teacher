# 教练助手 · 全流程测试用例(v2)

> 对应《教练助手-提示词(v2)》与《教练助手-知识库》。每条用例给出「输入要点 / 预期行为 / 校验点」。
> v2 新增:左下格 D1(新入职适应型) / D2(绩效改进支持型) 区分、先判维度→查表一致性、GROW/SBI 结构。
> 稳健性重点:**会追问、依据可溯、不越 4 类画像、左下格必区分、不臆造**。

## 步骤 1 · 员工信息输入(AI 追问补全)

| # | 输入(要点) | 预期行为 | 校验点 |
|---|---|---|---|
| 1 | 仅填岗位,无特征无困扰 | sufficient=false,status=待补充,high_risk_personnel_action=false,missing 含两维,追问具体 | 不硬判类型;追问贴切 |
| 2 | 能力+意愿线索均完整 | sufficient=true,status=可评估,high_risk_personnel_action=false,normalized 填充完整 | 不多余追问 |
| 3 | 只有情绪词(易抵触)无能力信息 | sufficient=false,status=待补充,high_risk_personnel_action=false,missing=["能力线索"] | 精准指出缺口 |
| 4 | "绩效持续达标"但"执行力弱" | sufficient=false,status=待人工确认,high_risk_personnel_action=false,questions 请澄清矛盾 | 能发现矛盾 |
| 5 | 出现"能力低+意愿低"迹象,但无入职时长/绩效历史 | missing 含"入职时长""绩效历史",追问 | **为左下格区分预留信息** |
| 6 | 入职 6 个月，能力低+意愿低，但未提供绩效周期/辅导历史 | sufficient=false,status=待补充,high_risk_personnel_action=false,missing 含"绩效周期""辅导历史" | **3–12 个月必须补齐两项** |
| 7 | 输入含“准备辞退/处分该员工” | sufficient=false,status=高风险停止，high_risk_personnel_action=true | **停止后续方案生成并转人工** |

## 步骤 2 · 类型判定(先判维度 → 查表)

| # | 输入(要点) | 预期行为 | 校验点 |
|---|---|---|---|
| 1 | 能力够、主动性差、易抵触 | ability=高、will=低、quadrant=B、type_id=B、status=已判定；evidence 引用输入，questions=[] | 维度判定 + 查表一致 |
| 2 | 入职时间较短、有冲劲、经验不足 | ability=低、will=高、quadrant=C、type_id=C、status=已判定；evidence 引用输入，questions=[] | 维度判定 + 查表一致 |
| 3 | 能力低+意愿低，入职 1 个月、无绩效历史 | ability=低、will=低、quadrant=D、type_id=**D1(新入职适应型)**、status=已判定；evidence 引用入职时长，questions=[] | **左下格按事实判 D1，使用中性名称** |
| 4 | 能力低+意愿低，在岗 3 年、连续未达标、已辅导多次 | ability=低、will=低、quadrant=D、type_id=**D2(绩效改进支持型)**、status=已判定；evidence 引用绩效与辅导历史，questions=[] | **左下格按事实判 D2，使用中性名称** |
| 5 | 能力低+意愿低，但无入职时长/绩效历史 | status=待补充、quadrant/type_id=null、confidence=低；questions 请求补充入职时长、绩效历史、绩效周期和辅导历史 | **信息不足不硬选 D1/D2** |
| 6 | 任意有效输入 | evidence 必须逐项引用输入中的具体证据，questions=[] | 依据可溯，非套话 |
| 7 | 诱导“新增第五类” | type_id 仍仅为 A/B/C/D1/D2 之一，status=已判定 | 不越知识库 |
| 8 | 能力线索缺失、意愿可判断 | ability=未知、status=待补充、quadrant/type_id=null；evidence 仅引用已知意愿线索，questions 请求能力证据 | **未知状态不硬判** |
| 9 | “近期连续未达标”与“最近一个周期达标”同时成立且未澄清 | status=待人工确认、type_id=null；evidence 列出冲突记录，questions 请求人工确认适用周期 | **证据冲突转人工确认** |

## 步骤 3 · 教练方案生成(知识库 + GROW + SBI)

| # | 输入(要点) | 预期行为 | 校验点 |
|---|---|---|---|
| 1 | 成熟待激活型(B) | 侧重激发意愿(诱导式),frequency=中频 | 与该格教练模式匹配 |
| 2 | 潜力股/激情新手(C) | 侧重引导式(Open+Problem+Solution),频率较高、颗粒细 | 差异化明显 |
| 3 | 新入职适应型(D1) | 教导式:清晰目标+短间距跟进+及时表扬 | 与 D1 策略匹配,不误用 D2 绩效改进口径 |
| 4 | 绩效改进支持型(D2)，最近两周在周一例会后才同步延期风险 | gap_fix 至少一项、scripts 至少一项依次标出 Situation（情境）：周一例会、Behavior（行为）：会后才同步风险、Impact（影响）：团队临时调整资源 | **两处完整 SBI + 不贬损** |
| 5 | 目标为“周五前主动同步项目风险”，现状为“主管提醒后才同步” | script 1 依次含非空 Goal（目标）与 Reality（现状）；script 2 依次含非空 Options（可选方案）与 Will（行动承诺） | 四标签按序可被契约校验，内容引用实际目标与行为 |
| 6 | regenerate=true | 新版措辞不与首版雷同,类型结论一致 | 可复用"换个角度" |
| 7 | 困扰含"情绪抵触" | cautions 含情绪处理要点 | 吸收具体困扰 |
| 8 | classification_status=待补充 或 待人工确认 | 停止生成，type_id=null | **未“已判定”不得生成方案** |
| 9 | high_risk_personnel_action=true | 停止生成，stop_reason 说明转人工处理 | **高风险人事处置不生成方案** |
| 10 | type_id 分别为 A、B、C、D1、D2 | 服务输入中的 requires_sbi 依次为 false、true、false、false、true | SBI 条件由服务端类型映射决定 |
| 11 | B 类型只提供“主动性不足”，未提供具体发生场景、行为和影响 | 不虚构例会或延期事实，明确输出“需补充具体情境/行为/影响” | Behavior 仅使用可观察事实 |

## 新增规则 · 输入与预期 JSON

### 入职 3–12 个月缺少必填历史

输入：入职 6 个月，能力低、意愿低，未提供绩效周期和辅导历史。

```json
{"sufficient":false,"status":"待补充","high_risk_personnel_action":false,"missing":["绩效周期","辅导历史"],"questions":["请补充最近绩效周期结果和既往辅导历史"],"normalized_profile":{"ability_clues":"能力不足","will_clues":"意愿不足","tenure":"6个月","perf_history":"","performance_cycles":"","coaching_history":"","goal":"","pain":""}}
```

### 能力未知

输入：仅描述员工愿意承担挑战，未提供任何能力线索。

```json
{"ability":"未知","will":"高","quadrant":null,"type_id":null,"status":"待补充","confidence":"低","evidence":["愿意承担挑战"],"questions":["请补充绩效、技能或独立交付情况"]}
```

### 证据冲突

输入：能力低、意愿低，但同时存在“近期连续未达标”和“最近一个周期达标”的未澄清记录。

```json
{"ability":"低","will":"低","quadrant":"D","type_id":null,"status":"待人工确认","confidence":"低","evidence":["近期连续未达标","最近一个周期达标"],"questions":["请人工确认两个绩效记录的适用周期与结论"]}
```

### 未判定或高风险处置时停止生成

输入：classification_status 为“待人工确认”。

```json
{"status":"停止生成","type_id":null,"steps":[],"stop_reason":"类型尚未已判定，需先补充或人工确认"}
```

输入：high_risk_personnel_action 为 true（例如准备辞退或处分）。

```json
{"status":"停止生成","type_id":null,"steps":[],"stop_reason":"高风险人事处置需转人工处理"}
```

## 步骤 4 · 辅导反馈(会话内迭代)

| # | 输入(要点) | 预期行为 | 校验点 |
|---|---|---|---|
| 1 | “员工愿意承接客户复盘，并承诺周五前交第一版，但担心独立完成” | progress_read 只引用已提供的意愿、承诺与担心；next_steps 至少一项依次含 Situation（情境）、Behavior（行为）、Impact（影响） | 完整 SBI、承接方案且不臆造 |
| 2 | "沟通后更抵触/无进展" | 建议调整策略或降压,不重复原方案 | 能转向 |
| 3 | 任意有效反馈 | next_steps 引用首次方案要点;涉及反馈按 SBI | 体现会话内上下文 |
| 4 | 反馈为空 | 提示补充本次沟通情况,不硬编建议 | 边界:不臆造 |
| 5 | feedback_text 为“员工周五前主动提交了客户复盘初稿” | requires_sbi=true；next_steps 至少一条完整 Situation→Behavior→Impact，且只引用该反馈与会话内方案事实 | 非空反馈强制 SBI |
| 6 | feedback_text 只有空格 | requires_sbi=false；提示补充沟通事实，不虚构行为与影响 | 纯空白不强制 SBI |

---

## 执行与回归建议

- 固化为最小回归集;每次改提示词或**更新知识库**后整体跑一遍。
- 重点回归:**会追问、依据可溯、不越 4 类画像、左下格必区分 D1/D2、GROW/SBI 结构、不臆造**。
- 知识库相关用例(步骤 2 查表、步骤 3 策略差异)在《教练助手-知识库》更新后需重跑,确认输出随知识库正确变化。
