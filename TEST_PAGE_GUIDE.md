# 测试页面与人工答案配对

## RQ1 direct-export workflow (updated 2026-11-14)

1. Open **RQ1 research protocol (single annotator)** in the dashboard. Save your actual annotator ID and annotation protocol version before recording answers.
2. Complete the real precision/support justification, implementation conformance checks, browser duplicate audit and overlap taxonomy. Enter justified lower-overlap group/class floors, zero unresolved cross-split pairs and references to those actual records. Leave unfinished gates unchecked.
3. **Seal protocol before held-out access** only before test labels or scans have been recorded. A seal stores a timestamp/digest and locks the form. **Revise as unsealed draft** invalidates it. Local held-out access tracking survives case deletion and **Clear scan history**, preventing retrospective resealing. The seal checks local consistency, not the truth of declarations or undisclosed external access.
4. Register each case's group, split and **Reference overlap category**. Overlap concerns reference/scoring-criterion similarity, not text duplicates. New answers capture the saved annotator/rubric IDs and actual label time. Unchanged legacy answers keep missing metadata; **Record a new reference now** deliberately timestamps a new answer, which is late for any earlier prediction.
5. Scan the registered pages, then **Export JSON**. The file includes `analysisContract`, joined reference fields, paired/sensitivity predictions, failures and readiness diagnostics. No manual JSON enrichment is needed. CSV adds reference metadata but remains a summary.
6. From CareerGuard-Lite run:

```powershell
python analysis/evaluate.py path/to/careerguard-evaluation.json --output path/to/report.json
```

Readiness checks metadata, not final validity. Python still checks realised support, leakage, repeated-record conflicts and sensitivity direction. Drafts and insufficient evidence remain Inconclusive. No research result is fabricated by this workflow. The earliest retained attempt and a persistent first-prediction time prevent retries or history purge from turning late labels into blind references. Group, split and overlap are fixed once scanned.

1. 重新加载扩展，打开 Evaluation dashboard。
2. 找到 **Test pages and human answers**。
3. 给页面填写固定编号，例如 `CG-001`，并粘贴该职位的完整网址。不要删除用于识别职位的参数。
4. 先独立阅读页面，在 **Your answer** 填写 Low / Uncertain / Elevated。不够资料时选择 Insufficient information；尚未判断时留空。答案由你填写，程序不会替你判断。
5. Group ID 和 Split 供正式实验使用；没有预先分组时可先留空，系统不会自动声称这些条件已完成。
6. 点击 **Save test page**，再打开登记的网址扫描。通常会自动匹配编号；同一个网址有多个测试案例时，展开侧栏的 **Research test page**，输入具体编号。
7. 同一页面重扫仍使用同一编号，每次扫描保留自己的 attempt ID 和三种评分。
8. 回 dashboard 导出 JSON 或 CSV。每条成功扫描会带上固定编号、你的答案、text-only、metadata-only 和 combined 评分。JSON 另外保留 reference 来源/时间、未配对状态及失败记录。

人工答案独立保存在本机 testCases 中，不传给评分函数或 backend；原始扫描记录的 groundTruth 保持为空，导出时才配对。单人答案被明确标为 researcher-manual，没有伪造第二位标注者。扫描后才填写或修改答案的记录，会标明 recordedBeforePrediction=false，不能声称它是事前盲评。

同一 ID 不得改绑另一网址；已有扫描后不能改 Group/Split。未知编号、编号与网址不匹配、同 URL 多案例却未指定编号等会明确报错。未填写答案的案例仍可扫描，但导出会标为 missing-label，不会猜测答案。未登记的普通扫描标为 unregistered。

Clear scan history 清除成功／失败扫描记录和最近结果，不删除页面登记和人工答案。案例列表现在显示 Group ID 和 Split，点击 Edit 编辑，New / cancel edit 清空表单以登记新案例；编辑期间 Case ID 固定，已有扫描的案例仍不能改网址、Group 或 Split。

Delete 会在确认后删除该案例的登记、人工答案、成功／失败扫描记录及匹配的最近结果，其他案例保留。操作前先导出需要保留的资料；导出的 JSON 包含 testCases，便于保存该次实验的登记表。

顶部三张卡片显示“与人工参考一致率（描述性）”，不是正式 RQ1 判定。每个案例取首次保留的实测尝试，重复扫描不增加权重，首次失败也不能由成功重试代替。三种方法使用同一批纳入案例；资料不足、未标注、缺少预测前标注证据、旧版／未知评分配置、抽取不可用或预测不完整等会被排除，并显示原因和数量。强制／合成、热身、无案例 ID 或无有效时间的记录另列跳过数量。卡片按案例而非独立组计算，不能替代正式分组分析。数字旁显示 Low / Uncertain / Elevated；Multi 的绿色 ✓ 只标识主要方法，不表示预测正确。

Backend URL 固定为 http://127.0.0.1:8765，旧的自定义地址不再用于扫描。Test backend 分别检查服务连接与已验证资料库是否加载，整个健康检查最多两秒。启动了服务但没有配置获授权的 index 时，服务可连接而资料库未配置；旧版后台未返回资料库状态时显示“无法确认”，不要当作可用。

请按研究数据保留规则管理资料。网址相同但页面内容变化时，建议使用获准保存的 snapshot 和新的案例编号。这项配对功能本身不证明标注独立性，也不替代论文所需的分组、保存页面及正式协议。
