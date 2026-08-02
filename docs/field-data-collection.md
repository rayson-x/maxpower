# Web 真实动作数据采集与标注

目标是产生可复现的三件套：原视频、同一录制会话导出的 canonical 关键点，以及逐 rep 标注。它们共同用于验证半程、躯干借力、双侧不对称和离心失控；单独一段视频或关键点都不能作为规则验证证据。

## 现场采集

1. 打开 Web 应用，先在“训练动作”中选择动作，再选择机位。不要使用“自动识别”录制验证样本。
2. 开启相机、完成一组动作后停止相机。保存“视频”“关键点”和“rep 标注模板”三个下载文件。
3. 每个训练条件至少录一组正常对照和一组明确正例：
   - 半程：前几次完整、最后一次明确减少幅度；
   - 躯干借力：斜侧或侧面，稳定对照与明显甩动分开录；
   - 双侧不对称：正面或斜侧，双侧稳定与单侧明确偷懒分开录；
   - 离心：可控回放与明显快速回放分开录。
4. 对深蹲，正面或斜侧要完整包含髋、膝、踝；同时采集正确、故意半程和因遮挡/出框不可判断的各一组。

不要把“看起来有点问题”的动作标为正例；应标为 `unjudgeable` 并重新拍摄。

## 标注

打开 `*.labels.json`，只替换两个身份字段和每个 rep 的 `labels`：

- `subjectId`：非识别性、稳定的受试者代号，例如 `subject-07`；
- `recordingBatchId`：独立采集批次代号，例如 `gym-2026-08-02-a`；
- `amplitude`：`full` / `partial` / `unjudgeable`；
- `torsoCompensation`：`stable` / `obvious` / `unjudgeable`；
- `bilateralAsymmetry`：`symmetric` / `asymmetric` / `unjudgeable`；
- `eccentricControl`：`controlled` / `uncontrolled` / `unjudgeable`。

时间段、极点、profile 版本与 rule/threshold 版本由客户端以同一份 canonical 关键点生成，人工不要改写。若分段错误，请保留文件并备注问题，而不是伪造正确边界。

## 入库前校验

```sh
npm run validate:labeled-fixture -- path/to/capture.labels.json path/to/capture.json
```

校验器会拒绝占位身份、没有 profile 的动作、版本漂移、超出视频时长或重叠的 rep，以及非法标签。调参与验证数据必须使用不同 `subjectId` 或不同 `recordingBatchId`；在验证前冻结 sidecar 中记录的 profile 版本和规则/阈值版本。

通过校验不等同于规则准确：只有正负例均已人工复核并在独立数据集上统计 precision、recall、误报率和拒答率后，规则才可能从 `experimental` 晋级为 `validated`。
