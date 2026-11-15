# CareerGuard Lite 系统完成检查清单

检查日期：2026-11-11（Asia/Singapore）
检查版本：HEAD `1fad4e4`，extension 0.2.0。
依据：`../FYP Thesis/RSW_ChenKaiJian_FullText.pdf`，109 页，SHA-256 `125a94dab2fa2a24d08a5fe52d69148b358ea2e3a59bdbf16e862189312447c5`。PDF 页码指文件物理页码。

## 当前结论

**系统主体已经做好，但按照这份 thesis，还不能说整个项目已经完成。**

之前修好的广告过滤、失败记录、重复页面识别、人工答案配对、内部资料检查，不用再做一次。现在主要剩分析程序的漏洞、正式实验工具与资料，以及单人标注和论文承诺之间的协调。

本次只检查和更新 checklist，没有修改系统评分、功能或论文。检查是静态阅读、现有测试与 synthetic probe，不是新的真实页面实验或 production security audit。

## 已完成 不再列为待修改

- [x] 支持网站抽取与 bounded generic extraction；找不到可靠职位时停止评分，没有可评分的 document.body fallback。
- [x] 已识别广告区域的文字、公司字段和申请链接一起排除；正常职位内容和申请链接保留。未标记的陌生广告布局仍需真实页面覆盖检查。
- [x] Text-only、metadata-only、50/50 combined 三种评分与解释已实现。
- [x] 扫描失败记录原因、阶段、时间和耗时；存储本身故障时明确提示无法保存。
- [x] 同 URL 新扫描使用稳定编号；成功率与耗时按案例汇总，重复扫描和 forced/warm-up 分开处理。
- [x] dashboard 可登记固定编号、网址、人工答案和可选 group/split；显示/导出时配对三种结果。晚填答案有标记，不参与评分。
- [x] PageSignal 必填资料、格式、长度、flags 和状态一致性检查；错误时停止并记录 validationCode/validationField。
- [x] Clear logs 已清除成功记录、失败记录和 lastScan；不再存在旧 checklist 所说的“失败记录删不掉”。
- [x] Hash-only backend、两秒 deadline、local result fallback 与基本安全控制已实现。当前系统没有 RDAP 查询。
- [x] EMSCAD duplicate-aware supporting benchmark 有 runner 和结果；它不是实际浏览器评分模型。

本次重跑：8 组 JavaScript 脚本（其中 69 个异常 PageSignal 案例被拒绝）、29 项 Python tests、52 个 Edge DOM fixtures 和 dashboard 操作测试。测试对象包括 prepared HTML、mock browser API 和 synthetic data；这些不等于独立真实页面 benchmark，也不等于已安装扩展的完整 E2E 验证。

## 一 仍需处理的程序和工具

### 1 资料不完整时 分析程序仍可能宣布方法有效

- [ ] **要改什么：** 修正 `analysis/rq1.py` 的标签完整性检查。
- **为什么：** 当前只对有两份标签的一小部分案例计算一致性，没有确认所有正式纳入案例都具备所需标签。
- **本次复核：** 用项目的 synthetic test corpus，共 30 条案例，仅 3 条保留双人 labels；在其余测试条件设为通过时，仍得到 Supported 和空 missing_gates。这是人工构造的程序复核，不是正式研究结果。
- **解决方法：** 每条案例检查必要 reference、原始标签和 protocol；缺少就明确报告，不得宣布验证完成。若采用单人方案，另用明确标识的 pilot protocol，不能复制同一标签当成两个人。
- **目的／依据：** 防止没有足够答案却得出有效结论。论文明确要求，PDF 44–45、50–59。

### 2 单人答案收集已经能做 但正式 RQ1 工具还没接齐

- [ ] **要改什么：** 把最终采用的人工标注协议与 analysis contract、正式输入字段统一。
- **现状：** dashboard 收集单人 groundTruth；正式 runner 仍要求 annotatorLabels、annotationProtocolVersion、overlapCategory 等。普通登记表未提供全部字段，后台扫描默认 overlapCategory=null。因此目前“可以配对”不代表“可以直接跑完当前严格协议”。
- **解决方法：** 先确定实际协议；补充独立 reference/manifest 合并流程，或为获批单人 exploratory study 建立明确区分的分析入口。正式分组和 overlap 分类来自研究设计，不由预测结果自动推断。
- **目的／依据：** 确保采集的数据真能进入正确的实验。论文明确要求，PDF 43–59、75。

### 3 正式测速度的流程还没完成

- [ ] **要改什么：** 增加可重复执行的计时流程，保留同一案例的固定编号和运行序号。
- **现状：** 已有 median/p95、成功/失败耗时和 client backend timing；可以标记 warm-up，但没有自动安排和验证 2 次热身 + 10 次测量的完整 runner。
- **解决方法：** 按事先固定顺序测试每个保存的页面，前 2 次标为热身、后 10 次为 measured；检查运行是否齐全，失败和 timeout 保留，输出每案例结果。明确扫描总时间、抽取时间和 backend 等待时间的区别。
- **目的／依据：** 让 RQ2 的速度结果可以重做、可以比较。论文明确要求，PDF 54、86。

### 4 RQ2 还需区分 读不到职位 和 正确停止

- [ ] **要改什么：** 增加“页面原本是否应该能评分”的 reference category，分别报告正常职位抽取成功率、unsupported 页面 safe-stop 和系统异常。
- **现状：** dashboard 统计的是整体 scan 成功／失败；一个本来不该评分的页面正确停止，也进入 failed case。这可作为整体尝试统计，但不能直接当作论文的 supported-page extraction-success 指标。
- **解决方法：** 在测试登记表／manifest 事先标明页面类型和预期处理，分析时分开分母；不要用混合总成功率直接判断 90% 目标是否通过。
- **目的／依据：** 公平评估系统，避免正确拒绝页面也被误解释为抽取坏了。论文要求固定分母和失败分类，PDF 50、67。

### 5 Dashboard 的准确率显示可能误导

- [ ] **要改什么：** 修正 `dashboard.js` 的 `metricFor()`。
- **现状：** 它把所有非空 groundTruth 当成可比较类别，包括 reference-insufficient；同一案例重复扫描也会多次进入该百分比。正式 RQ1 有另一个 runner，这个卡片不是正式结果。
- **解决方法：** 排除资料不足和不符合评估条件的记录，显示排除数量；明确按案例／预定运行计算，并标成描述性结果。若采用严格协议，晚填答案和不完整 reference 也必须按协议处理。
- **目的／依据：** 避免界面百分比被误认为可靠研究成绩。资料不足不能强行归类是论文明确要求；改卡片的具体方式是实现建议，PDF 44–45、50。

### 6 Backend 设置和实际限制仍不一致

- [ ] **要改什么：** 统一 `dashboard.js` 的地址设置、health check 与 `background.js` 的固定 localhost 限制。
- **现状：** dashboard 可保存任意 URL 并测试；实际 scan verify 只接受 http://127.0.0.1:8765。health 请求没有 deadline，ok 也不代表真实 index 已配置。
- **解决方法：** 固定同一个本机地址，或统一允许的 loopback 配置；增加 health timeout；分别显示服务能否连接、资料库能否查询。
- **目的／依据：** 避免“界面说正常，实际不能用”。明确 unavailable 与 loopback boundary 来自论文，PDF 67、75；界面统一是直接修复。

### 7 完整使用流程和保留期限还缺验证

- [ ] 真正安装扩展，验证点击扫描 → 注入／抽取 → 评分 → pending／completed／unavailable → 导出／删除。
- [ ] 验证 500 条／30 天、lastScan 24 小时、重启后清理、过期数据导出和多窗口操作；保存结果证据。现有代码有 purge，但没有足够测试证明所有边界。
- [ ] 为 testCases／人工答案提供明确的删除操作或操作说明；Clear logs 刻意不删除这些资料，界面需要让人看懂，并执行研究保留期限。
- **目的／依据：** 确认真实使用和研究数据管理符合承诺。论文明确要求，PDF 50、54、59、75。

## 二 主要 RQ 实验还没完成 不是继续加产品功能

- [ ] **确定单人标注方案。** 用户只有自己，论文写两名独立成人标注者。与 supervisor 确认允许的范围，再改论文和工具。当前单人标签界面不会自动解决这项冲突。依据：PDF 44–45、58。
- [ ] **准备真实可复现页面。** 保存获准保留的页面 representation／snapshot、来源、日期、预期抽取区域和固定编号；做好分组和 exact/near-duplicate 检查。不同 URL 不自动代表独立案例。依据：PDF 43–46。
- [ ] **完成 RQ1 比较。** 同批新页面比较 text-only、metadata-only、50/50 fusion；依最终协议报告 MAOE、F1／confusion matrix、改善／变差案例与 sensitivity。没有 outperform 不自动等于 FYP 失败，仍需诚实回答研究问题。依据：PDF 47–53。
- [ ] **完成 RQ2 实测。** 记录正常抽取、unsupported safe-stop、动态／缺内容／多职位／异常页面和 backend unavailable，报告正确分母、速度和局限。依据：PDF 50、54、67。
- [ ] **核对解释是否确实来自页面证据。** 对每条显示的理由，保存 rule ID 与允许审计的 capture 对应证据，做误报／漏报分析。现有关键词测试不能单独证明真实效果。普通历史仍不要保存完整原文。依据：PDF 48、50、54。
- [ ] **固定最终实验版本。** 归档 code/config/schema/PSL、测试与分析协议，记录时间和 hash。现有 output 主要是 2026-10-13 archive，不代表当前 HEAD。依据：PDF 53、59、86。
- [ ] **更新论文实现说明。** 论文中 0.1.0 的 body fallback、raw backend payload、wildcard CORS 等是旧 snapshot；在后续实现章节说明当前版本已修改的内容，保留清楚的历史边界，不要重复当成现存问题。

## 三 RQ3 和 RQ4 的范围

- [ ] 若开展正式 RQ3：需要真实获授权的预建只读 index，以及独立 usefulness 评估。现在有查询代码与 synthetic tests，尚未发现完成实际 index／usefulness 的证据。
- [ ] 若没有这些条件：按当前论文的 conditional 设计写 Not Assessed／technical-only，系统显示 unavailable。不是为了完成核心 RQ1/RQ2 就必须做 RDAP。
- [ ] RQ4 用户研究是 optional secondary；不开展就明确 Not Assessed。若保留，当前界面没有完整 score-only/explanation participant workflow，需另行实现并满足研究条件。

## 建议下一步顺序

1. 先修第 1 项的错误结论风险，并修第 5 项 dashboard 百分比。
2. 确定单人标注范围，打通正式分析字段与资料。
3. 补正式 timing runner、页面类型分母和 backend 设置。
4. 完成真实扩展 E2E、数据期限检查，然后封存版本。
5. 做实际 RQ1/RQ2 实验并写结果。

这是一份待办清单，不是要求继续增加 RDAP、chatbot、账号或 cloud deployment。核心代码已有相当基础，剩余完成度要以这些具体项目和实验结果判断，不给没有依据的百分比。
