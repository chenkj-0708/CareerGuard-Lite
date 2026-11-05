# CareerGuard Lite 系统完成检查清单

检查日期：2026-11-05（Asia/Singapore）  
检查代码：本地 HEAD d216a66，extension 0.2.0。  
依据：`../FYP Thesis/RSW_ChenKaiJian_FullText.pdf`，109 页，SHA-256 `125a94dab2fa2a24d08a5fe52d69148b358ea2e3a59bdbf16e862189312447c5`。下文 PDF 页码为文件物理页码。  
性质：代码检查、已有测试重跑及针对性 synthetic probes；不是正式真实网页 benchmark，也不是 production security audit。本次未修改系统功能、规则或论文。

## 完成判断

**核心研究原型已实现，但按照当前 thesis，尚未全部完成，也尚未准备好直接进行正式实验。**

有三种不同的剩余工作：修复实际程序问题；补齐实验数据与分析工具；完成论文承诺的研究证据。不要把后两项全部理解成必须新增产品功能。

用户此前说明只有自己可以标注，而且希望控制范围。本文仍以当前论文为检查依据；单人 pilot 是可讨论的协议修改方案，并未被视为已经获批。RDAP 不属于当前论文 hash-only 方案的必做项。

## 已实现并在本次检查通过的部分

- [x] Browser extension shell、用户主动扫描和结果界面存在。
- [x] JobStreet / Indeed / LinkedIn 的 site-specific selectors 与 bounded generic extraction 存在；没有把 document.body 作为可评分 fallback。
- [x] 无法找到可靠单一职位时，已提供停止评分路径；仍需补齐所有失败的记录，见 A3。
- [x] Text-only、metadata-only、50/50 fusion、30/60 tiers 和预设 sensitivity configurations 已实现。
- [x] 评分、context 和 uncertainty reason 有区分；backend 不改变本地分数和 tier。
- [x] 六字段 hash-only 请求、两秒 deadline、backend unavailable fallback 已实现。
- [x] Loopback backend、exact origin、token expiry、request-ID replay、rate limit 和请求大小限制已有实现和测试。
- [x] 固定只读 index 查询与 PSL parity 已实现；这不表示已有真实授权 index。
- [x] 本地历史 500 条 / 30 天、lastScan 24 小时的 purge 逻辑存在；完整删除仍有问题，见 A2。
- [x] EMSCAD duplicate-aware benchmark runner 和结果存在；不属于浏览器运行时模型。

本次验证：4 组 JS 测试通过；26 项 Python tests 通过；46 个 headless Edge DOM extraction fixtures 通过。后者是 prepared HTML representations，并非 46 个独立真实招聘网页。已有测试通过没有覆盖下面新增发现。

## A 必须优先处理的系统和分析代码问题

### A1 排除区域的链接仍可能参与 metadata 评分

- [x] **已修改（2026-11-05）** `content-script.js` 的 links / applicationLinks 收集逻辑，使其与文本使用相同的可见、排除区域边界。公司字段及标题候选也排除广告区域；新增 6 个案例后共 52 个 DOM 案例通过，验证广告不改变评分、正常职位申请链接保留。未标记或未知布局的广告仍需真实页面覆盖测试。
- 现状：文字清理移除了 `.advertisement`，但链接从原始 root 收集，只排除 nav/footer/aside 等，没有同样排除 `.advertisement`。
- 复现：职位容器中的 `.advertisement` 内放置 bit.ly 的 “Apply now” 链接；广告文字不在 visibleText，链接仍出现在 applicationLinks，随后可触发 META_SHORTENER。
- 验收：相同案例中广告文字、URL 和由它引起的风险分数均被排除；正常职位申请链接仍保留。Schema.org 路径也应检查：description 与 metadata 不能来自包含其他职位/广告的过大 main root。
- 对应论文：PDF 73–75，选定职位区域与同一 PageSignal 的证据边界。

### A2 Clear logs 没有清除全部记录

- [ ] **修改** `dashboard.js` 的 clear handler，同时清除 storage 和内存中的 `scanLogs`、`extractionFailures`、`lastScan`。
- 现状：只清 scanLogs / lastScan；失败记录仍保留，JSON export 仍可带出这些数据。
- 验收：先产生成功和失败记录，点击 Clear logs，再导出、重开 dashboard，两类记录均为空。
- 对应论文：PDF 54，user export/delete controls。

### A3 所有 scan failure 都需要可统计的记录

- [x] **已修改（2026-11-05）** `background.js`，统一记录 tab access、非 HTTP(S)、script injection、消息/内容读取、PageSignal validation、评分和结果保存失败。记录 attempt ID、原因/阶段、开始/失败时间、总耗时、scenario/config/override 信息；同一次失败写入一条，失败写入串行化。JSON export 可导出记录。存储本身不可用时明确提示无法保存，不声称已经记录。
- 现状：只有 extractor 返回 unavailable 后的一条分支保存 extractionFailures；activeTab、注入或 validation 抛错时只返回 UI error，没有进入实验失败统计。
- 验收：每次实验 scan attempt 均能与成功或失败记录对应；失败含 attempt/scenario ID、类别、configuration 和 elapsed time；失败仍然不产生分数。
- 对应论文：PDF 67，processing states 的失败状态与 timing；PDF 54，失败不可从分母静默消失。

### A4 RQ2 分母需要排除 forced runs 并按独立 scenario 汇总

- [x] **已修改（2026-11-05）** dashboard 与 `analysis/evaluate.py` 采用相同的 case-level 统计；排除 forced 和明确标记的 warm-ups，重复 attempt ID 去重。同 URL 的新扫描采用稳定 hash scenarioId，保留识别职位的 query 参数；同一案例按首次保留的 measured attempt 判断成功，重试不覆盖失败，另外报告每次尝试和 mixed outcomes。未知 URL 失败仍保留并单列排除量；真实 independent group/不同职位共用 URL 仍需 manifest。
- 现状：RQ2 直接用 records + extractionFailures 数量计算成功率；`evaluationOverride=true` 的记录也进入 RQ2，而失败记录未保存同样的 override 字段。重复扫描会重复计数。
- 复核：只输入一条 forced record 时，当前输出 scan_attempts=1、success_rate=1.0。
- 验收：natural RQ2 统计不包含 forced runs；同一 scenario 多次测量不冒充多个独立样本；supported-page success、unsupported safe stop 和 overall attempt counts 的分母分别写清。
- 对应论文：PDF 50、54，固定分母、forced-path isolation 和 scenario-level timing。

### A5 RQ2 latency runner 尚不完整

- [ ] **部分完成（2026-11-05）** dashboard、JSON 和 `analysis/evaluate.py` 已按每案例中位数报告 median/p95，分别统计成功/失败耗时，保留 missing timing 数量和 client-observed backend timeout 耗时。仍需 formal timing harness 自动安排 2 warm-ups + 10 measured runs、独立 scenario manifest 与正式实测；不能把目前普通用户扫描统计视为完成正式 thesis timing protocol。
- 现状：分析程序主要返回 mean local/total/backend latency，缺 thesis 的 median/p95 和 warm-up/repeat 处理；background 未单独记录完整 client-side hash/health/POST/parse 的耗时，backendLatencyMs 是 server verify 自报值，不等于客户端等待时间。
- 验收：每个 timing scenario 排除 2 次 warm-up，保留 10 次技术重复；按 scenario 汇总，再报告分布及目标达成情况。区分 extraction/local-ready/backend/total latency，失败不静默删除。
- 对应论文：PDF 50、54、86。90%、250/500 ms 是项目 engineering targets，必须对齐实际测量范围，不能拿 local scoring time 替代整个流程。

### A6 PageSignal schema 与实际 runtime validation 不完整

- [x] **已修改（2026-11-05）** `lib/page-signal.js` 和 `lib/page-signal.schema.json`：补齐成功/失败所需字段、时间/flags/URL/arrays/limits 与状态一致性；评分前拒绝不完整或异常对象，失败日志保存安全的 validationCode/validationField 和总耗时。允许明确声明的公司名称缺失。新增 malformed-object 与端到端拒绝/日志测试；52 个 DOM fixtures 也逐条执行 runtime validation。
- 复核：删除 capturedAt，并把 truncationFlags / fallbackFlags 设为 `{}` 后，runtime validator 仍接受该对象。
- 其他现状：externalLinks 等 scorer 会使用的字段没有完整 runtime 检查；JSON schema 也未完整定义所有 flag、URL/status 和失败对象规则。
- 验收：缺时间、错误 flag 类型、缺 array、scoreable/status 冲突等均明确拒绝；extractor 的合法成功/失败对象均能通过；拒绝事件按 A3 记录。
- 对应论文：PDF 73–74，finalised schema/status/flags contract。

### A7 RQ1 可能只检查少量标签就通过 reference gate

- [ ] **修改** `analysis/rq1.py`，验证每条纳入正式分析的案例都具有协议要求的有效原始标签和对应 reference provenance。
- 现状：agreement 只在存在两份有效 labels 的子集计算，没有检查这个子集是否覆盖所有 eligible records。
- 复核：用现有 synthetic test corpus 的 30 条记录，只保留 3 条的双人标签，其余删除，并提供测试用通过条件，当前仍返回 `Supported`、`missing_gates=[]`。
- 验收：当前双人协议下，缺失标签的案例不得悄悄绕过 gate；明确报告完整/缺失 annotation 数量和处理方式。若正式改为单人 pilot，应使用新的 protocol/version，并明确不提供 inter-rater agreement 或假造独立标签。
- 对应论文：PDF 44–45，two independent primary labels 与 reliability gate。

### A8 让 browser benchmark 数据能够完整进入分析

- [ ] **配对流程已实现，正式资料仍待准备（2026-11-05）**：dashboard 可登记固定 case ID/URL、人工答案及可选 group/split；扫描按 URL/指定编号匹配，三种评分沿用同一 case ID。答案单独保存，显示/导出时才合并，保留来源和时间；后填答案会标记。未知/歧义/错配、group/split 冲突有检查，JSON 与 CSV 包含配对结果。仍需实际获准保存的 scenarios/captures、正式 manifest/grouping、reference protocol 与 RQ1 evidence；详见 TEST_PAGE_GUIDE.md。
- 现状：普通 popup 不提供稳定 scenarioId/groupId/split 输入；每次重扫默认生成新 scenarioId；groundTruth 固定为 null；没有实际 manifest/label join 工具。后台 message options 已支持部分 ID，不需要把这些实验字段全部放进普通用户界面。
- 验收：同一 saved scenario 的重复扫描共用稳定 scenarioId；group/split 来自预先制定的 manifest；labels 在 prediction 后按 ID 合并；未匹配/重复/冲突 ID 明确报错；保留同一 PageSignal 给各方法计算的证据。
- 对应论文：PDF 53–54、75，formal runner、traceability 与 repeat unit。

### A9 Backend 设置界面与实际运行限制不一致

- [ ] **修改** dashboard 的 backend URL 设置和 health check。
- 现状：dashboard 可保存任意 backend URL，也向该地址发起 health 请求；但 background 的正式 verify 只接受 `http://127.0.0.1:8765`。界面可能显示检查成功，扫描仍拒绝验证。
- 验收：固定 loopback 地址，或统一实施获批的 loopback 配置；health 请求有 deadline，并区分“backend process 可用”和“authorised index 未配置”。当前 `/health` 返回 ok 并不证明 index 可用。
- 对应论文：PDF 75，localhost boundary 与 explicit unavailable state。

### A10 补齐实际 extension UI 和数据生命周期的 E2E 验证

- [ ] **补测** loaded unpacked extension 的用户点击 → injection → extractor → local UI → backend state → export/delete 全链路。
- 当前 scoring/workflow mocks 与 DOM fixture tests 不能替代真实 extension UI 验证。核对 pending、completed、unavailable 和 safe stop 的实际显示，以及新标签页/页面变化后的扫描行为。
- [ ] 证明每条 displayed scored reason 能对应 rule ID 与独立保存的允许审计的 capture/evidence；确认 export 去除 raw evidence 后仍有足够研究 traceability。
- [ ] 增加 500 条/30 天/24 小时边界、重启 purge、export/delete 和过期记录处理的测试。
- 验收：保存测试步骤、版本、日期和实际 pass/fail。论文 PDF 50 的 trace-correctness target 为 100%；完整原文不应为此写入普通 scan history。

## B 论文实验与资料 这些不等于新增系统功能

- [ ] **B1 确认单人标注协议。** 当前论文要求双人独立标注，而用户只有自己。与 supervisor 确认是否采用 single-annotator exploratory/pilot；然后统一 thesis、README、analysis contract 和 runner。不能把自己标的同一份 label 复制两遍。未批准前，按当前论文仍属未满足。
- [ ] **B2 准备可复现 browser scenarios。** 记录来源、capture date、允许保留的 snapshot、expected extraction region、页面类别、group/split；做 exact/near-duplicate 检查。既有 40 rule-derived fixtures 与 46 DOM fixtures 不能作为独立准确性证明。
- [ ] **B3 完成正式 RQ1 comparison。** 同一 PageSignal 的 text-only / metadata-only / 50/50 fusion；validation 选定单分支，test 比较；报告 MAOE、错误矩阵、F1、corrections/worsenings、敏感性和局限。单人 reference 必须明确披露开发者偏差。没有 outperform 不自动等于 FYP 失败。
- [ ] **B4 完成 RQ2 实测。** 按 A3–A5 记录正常页面、unsupported、missing/dynamic/multiple listing 和 backend unavailable 等；报告成功/失败分类、latency distributions 和 trace correctness。
- [ ] **B5 当前严格协议下，完成或正式调整 analysis contract。** `analysis/contract.template.json` 仍为模板；lower-overlap 支持量、precision justification、annotation protocol、duplicate audit 和 freeze evidence 必须有真实依据。单人 pilot 调整需要新版本，不能直接把 false 改 true。相关要求见 PDF 43–59。
- [ ] **B6 做规则错误分析。** 包括 negation/quotation/benign context、常见漏检和误报、branch floor/saturation。已有关键词单元测试不能单独证明规则内容有效；禁止看完 held-out 结果后修改规则再声称原先验证成功。
- [ ] **B7 Freeze 最终 artifact。** 处理上面的缺口后，记录最终代码/配置/schema/PSL/hash contract、浏览器/OS/runtime、测试输出和新 archive/hash。现有 2026-10-13 ledger 不能自动代表后续修改。
- [ ] **B8 更新实现状态说明。** 当前 PDF 的 FYP1 0.1.0 limitations 多为历史 snapshot，包括 body fallback、wildcard CORS、raw backend payload 和 EMSCAD 缺失；保留历史时明确它是旧记录，另写当前 0.2.0 的实现/限制，避免将历史缺陷误写成当前状态。

## C 条件功能及无需为了完成而新增的内容

- [ ] **C1 若保留正式 RQ3**：提供真实获授权、预先建立的只读 index、完整来源/数量/平台分布/污染审计 manifest 和 usefulness reference；现在只有实现与 synthetic index tests，不能声称真实 corroboration 效果已完成。
- [ ] **C2 若没有 index**：在论文明确 RQ3 为 Not Assessed / technical-only；界面如实显示 unavailable。不要用 fabricated data 冒充 operational index。是否缩小范围需与 supervisor 统一。
- [ ] **C3 若保留研究数据或 backend stdout logs**：制定可执行 retention/deletion 操作记录；论文要求 status logs 7 天、研究资料依规定期限处理。可通过 operator 配置完成，不必无条件新增后台任务。
- [ ] **C4 RQ4 用户研究**：当前属于 optional secondary；如不开展，就明确 Not Assessed，不必为此扩展 account/participant 功能。dashboard 现有“alternate conditions”等旧说明也应随最终范围统一。

RDAP、cloud deployment、chatbot、新模型、更复杂 dashboard 和 account system 都不是当前 RQ1/RQ2 完成的必要项。建议先处理 A1–A8，再完成 loaded-extension E2E 和独立 browser evaluation。

## 本次针对性复核记录

所有 probes 使用 synthetic data，不涉及真实 label 或正式 held-out 数据。

| 复核 | 观察结果 | 对应项 |
| --- | --- | --- |
| 广告文字/链接边界 | visibleText 不含广告，但 applicationLinks 含 https://bit.ly/ad | A1 |
| 不完整 PageSignal | 缺 capturedAt 且 flags={} 仍被接受 | A6 |
| 强制记录的 RQ2 | 一条 evaluationOverride=true record 被统计为一次自然成功 | A4 |
| 部分双人标签的 RQ1 | 30 条中仅 3 条有双人 labels，仍可 Supported | A7 |

结论：先修实际缺口并补全实验路径，再封存版本。现有工程已经完成相当一部分；剩余不应简单地用一个“完成百分比”掩盖程序问题与研究证据之间的差别。
