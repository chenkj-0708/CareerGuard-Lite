# 单人标注 RQ1 方案

本项目自 2026-11-13 起采用单人研究者参考标签方案。它是对原论文双人标注设计的方法修订，不代表原 PDF/DOCX 已被修改，也不代表实验已经执行或协议已经封存。

## 研究范围

比较 text-only、metadata-only 与固定 50/50 fusion 对单人参考标签的符合程度。标签是研究者的风险判断，不是真实诈骗身份。标注者同时参与系统开发可能带来偏差；没有第二名标注者，无法估计标注者间一致性。

主要分析保留 validation 选择最强单分支、test 独立分组 MAOE、LOWER-OVERLAP、敏感性、混淆矩阵和 macro F1。预测与参考标签之间的 kappa 仍可计算；它与两个标注者之间的 kappa 不同。不会因为改成单人而放宽去重、数据划分或事前封存要求。

## 收集顺序

1. 编写并保存有版本的标注标准，说明 low/uncertain/elevated 的判断依据。资料不足使用 reference-insufficient，不强迫归入 uncertain。
2. 在查看系统预测前，登记案例并保存自己的标签、判断依据和标注时间。dashboard 已记录 reference.recordedBeforePrediction；晚填标签不能改成 true 来补救。
3. 保留固定案例 ID、独立 groupId、validation/test 和 overlapCategory。不同 URL 不自动代表独立案例；类别不能从模型预测自动生成。
4. In the dashboard's **RQ1 research protocol (single annotator)** form, save the actual annotator ID and rubric version before collecting answers. The case form now collects **Reference overlap category**. New or explicitly refreshed answers store these IDs and their actual label time. Export JSON joins this metadata automatically; no manual enrichment is required. Unchanged legacy answers remain incomplete rather than being retrospectively assigned new IDs.
5. 封存实际 contract、代码及资料版本后，才执行未接触过的 test。已看过预测、用于改规则的旧资料用于开发或描述性 pilot，不作为新的 untouched holdout。

每条纳入记录示例（其余预测、分组等字段仍需保留）：

```json
{
  "scenarioId": "case-001",
  "groundTruth": "uncertain",
  "annotatorId": "researcher-1",
  "annotationProtocolVersion": "single-rubric-v1",
  "reference": {
    "source": "researcher-manual",
    "labelledAt": "2026-11-13T01:00:00Z",
    "recordedBeforePrediction": true
  }
}
```

这只是格式示例，不是可提交的真实标注证据。须保留实际时间与依据；程序检查声明是否完整，不能验证声明的真实性。

## Contract 与运行

Use the dashboard protocol form to save a draft, enter justified lower-overlap support floors, zero unresolved cross-split pairs, actual governance declarations and references to supporting records. **Seal protocol before held-out access** timestamps and hashes the completed declaration and locks the controls. Held-out labels or scans prevent retrospective sealing. **Revise as unsealed draft** removes the seal; clearing scan history or deleting cases does not reset recorded held-out access. This local workflow control cannot independently verify the declarations or detect undisclosed external access. The incomplete standalone template remains available for external workflows.

```powershell
python analysis/evaluate.py path/to/careerguard-evaluation.json --output path/to/report.json
```

Dashboard JSON exports embed the actual `analysisContract`, reference metadata, paired/sensitivity predictions, failures and `researchReadiness`. No separate `--contract` argument is needed. CSV is a summary rather than the full RQ1 input. Missing IDs, groups, labels or evidence are never invented; draft/incomplete runs remain Inconclusive. Timing is checked against the earliest retained attempt and the persistent first-prediction timestamp, so retries or ordinary history purge cannot certify late answers as prediction-blind. Warm-ups are excluded from RQ1. The readiness panel checks metadata; Python still checks realised group/class support, integrity and sensitivity direction. Synthetic end-to-end tests are software evidence only, not completed study results.

## 输出解释

- Exploratory Improvement：现有预设条件通过，fusion 在总体和 LOWER-OVERLAP 上 MAOE 更低，且通过既定方向检查。仅表示对单人参考标签的探索性改善，不是原双人协议的 Supported，也不是证明真实诈骗识别更准确。
- No Exploratory Improvement：预设条件通过，但没有满足上述改善条件。
- Inconclusive：实验完整性、样本、来源、封存或敏感性条件不足；仍可查看可计算的描述结果，不能宣称胜出。
- reference_agreement.status=not_applicable：没有标注者间一致性可计算；不以零分或伪造的满分代替。

旧数据默认使用原 dual 模式，避免静默改写历史研究含义。dual 模式现在要求所有纳入案例都有两份有效原始标签，不再允许仅凭一个小子集的一致性通过。

## 论文需要同步的方法修订

原 PDF 第 3 章关于两名独立标注者、标注者间一致性和相关判定的段落，应修订为实际的一人方案。可据实际执行情况使用下述表述：

> 本研究采用单名研究者提供的招聘风险参考标签。参考标签依据版本化标注说明，在查看所比较系统的预测之前记录。研究比较文字分支、metadata 分支及固定等权融合与该参考标签的符合程度，使用独立案例组划分、validation 选择单分支及 held-out test 评估。由于标注者同时参与系统开发，本研究存在参考判断与系统设计相关的偏差，且无法估计标注者间一致性。结果限定为单研究者参考下的探索性比较，不作为真实诈骗识别准确率或独立外部验证的证明。

只有实际完成“预测前标注”和 held-out 测试后，结果章节才能采用对应的过去时描述。如果执行条件不同，按实际情况修改；不保留双人 adjudication 或双人 kappa 的完成声明。
