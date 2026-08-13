# 动作识别与质量评估资源

## Knowledge

- [MS-TCN: Multi-Stage Temporal Convolutional Network for Action Segmentation](https://openaccess.thecvf.com/content_CVPR_2019/html/Abu_Farha_MS-TCN_Multi-Stage_Temporal_Convolutional_Network_for_Action_Segmentation_CVPR_2019_paper.html)
  时序动作分段的一手论文。用于理解“动作在什么时候发生”以及过度分段为什么会导致重复计数。
- [What and How Well You Performed? A Multitask Learning Approach to Action Quality Assessment](https://openaccess.thecvf.com/content_CVPR_2019/html/Parmar_What_and_How_Well_You_Performed_A_Multitask_Learning_Approach_CVPR_2019_paper.html)
  动作识别与动作质量评估的一手论文。用于理解“做了什么”和“做得怎样”共享时空证据，但不是同一个输出目标。
- [Rust SDK 高位下拉轨迹接入交接](docs/reports/rust-sdk-reference-trajectory-integration-handoff.md)
  本项目对 provisional 轨迹比较、缺失点、profile identity 和禁止输出未经校准质量结论的当前约束。

## Wisdom (Communities)

- 暂未指定外部社区；动作质量结论在发布前需要独立教练或领域专家审核。

## Gaps

- 尚无覆盖本项目全部动作、机位、器械和目标人群的商业可用标准轨迹数据。
- 尚未确定能够审核动作质量规则的独立教练或生物力学专家。
