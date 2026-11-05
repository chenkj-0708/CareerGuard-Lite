# 测试页面与人工答案配对

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

Clear logs 清除扫描记录，不删除页面登记和人工答案；导出的 JSON 包含 testCases，便于保存该次实验的登记表。请按研究数据保留规则管理这些资料。网址相同但页面内容变化时，建议使用获准保存的 snapshot 和新的案例编号。这项配对功能本身不证明标注独立性，也不替代论文所需的分组、保存页面及正式协议。
