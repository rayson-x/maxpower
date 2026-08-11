# 当前动作 Profile 盘点与 Android 注入 Rust Motion SDK 方案

日期：2026-08-08  
范围：当前工作区中的动作目录、TypeScript 运动学/模拟/观测 profile、Rust motion-sdk、Android Expo 原生模块。  
证据口径：只使用仓库源码、测试和项目合同作为一手证据；这里把“识别能力”定义为：在动作与机位已知时，能够构造一个 Rust 可接受的 executable profile，并由同一 rep engine 输出 phase/rep。它不等于动作质量已经验证，也不要求先完成人工标注。

## 结论先行

**改造前 Android 只开放 6 个动作，不是 Rust 或 profile 数据只能识别 6 个动作，而是客户端把“能否识别”错误地等同于 8 个硬编码 profile code。** 现已接入动态 data-profile 安装链路，Android 不再以 code 表关闭其他动作。（`src/mobile/exerciseRecognition.ts`；`modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt`）

实现完成后，65 个 registry 动作在推荐机位、bilateral、空 variation 下都能解析出 Rust 可执行 profile。原先未映射的 `ankleLateralSpread` 与 `wristLateralRelativeElbow` 已转成 torso-normalized landmark-distance signal；`side_step_touch`、`step_jack` 的推荐正面机位仍优先使用专用 built-in。当前能力因此是 **65/65 个动作可装载 profile 并运行识别、计数和 phase**。（`src/motion/simulatedRecognitionProfile.ts:19-72`；`src/mobile/exerciseRecognition.ts`；`tools/mobile-mvp/mobileDataLayer.test.ts`。）

这里的 65/65 是“技术上有 executable profile、引擎能跑”的能力结论，不是准确率结论。是否经过人工观测、阈值是否校准、表现是否稳定，应作为独立 evidence 元数据呈现，**不能再被拿来关闭 Android 的识别能力**。

当前各层数字如下：

| 层 | 当前数量 | 真实含义 |
| --- | ---: | --- |
| 动作目录 | 65 个动作 | Android 动作库可选择；其中 14 个 `experimental`、51 个 `catalog_only`，没有 `validated` 或 `suspended` 条目。目录 maturity 只决定是否允许专用分析，不代表 Rust 已经有可执行 profile。（`src/pose/exerciseRegistry.ts:1-5,99-590,634-637`；`tools/exercise-registry/exerciseRegistry.test.ts:45-75`） |
| TypeScript `KinematicsProfile` | 10 个动作 | 有明确分期信号、机位和指标定义的 TS 运动学配置；10 个都仍对应目录中的 `experimental` 动作。（`src/pose/kinematicsProfile.ts:24-55,62-189`；`src/pose/exerciseRegistry.ts:149-279`） |
| TypeScript simulated prior | 65 个模板 | 所有目录动作都有动作信号先验，并能在推荐机位解析为 Rust built-in 或 data initializer。它们不是质量评分标准，但在技术上是 executable recognition profile。（`src/pose/simulatedKinematicPrior.ts:12-20,70-110,248-331`；`src/motion/simulatedRecognitionProfile.ts:14-72`） |
| 本地人工观测 recognition artifact | 8 个 action×view profile，覆盖 6 个动作 | 8 个均为 `provisional`，其数据结构可由 Web/WASM 安装 API 交给 Rust；但当前 Web 产品路径会为两个高位下拉 context 保留 reference-compatible built-in，所以实际优先启用 observed data 的是其余 6 个 context。它们都不能被解释为标准姿势或质量评分。（`public/archives/confirmed-captures/recognition-profiles.json:1-14,16-56,77-117,139-177,198-236,259-299,326-366,390-430,456-496`；`src/components/CameraPoseView.web.tsx:302-339`） |
| Android 当前实际开放 | 推荐机位覆盖 65 个动作 | 共享 resolver 产生 built-in 或 data profile envelope；Kotlin/JNI 将其安装进 Rust，不再维护 action×view code 镜像表。（`src/mobile/exerciseRecognition.ts`；`modules/pose-camera/android/src/main/cpp/motion_bridge.cpp`） |
| 当前可执行识别能力 | 65/65 个动作 | 标准 Rust data profile 与现有 built-in 在推荐机位覆盖全部目录动作；这些 profile 可用于识别当前动作、phase 和 rep，evidence/准确率另算。 |

所以，回答“目前能识别多少动作”的当前口径是：**65 个目录动作在推荐机位都能解析并装载 executable profile。** 人工观测 artifact 的作用是后续改进阈值与稳定性，不是首次开放识别的前置门槛。

Web 的 data-profile 安装能力现已接到 Android：动作切换时共享 resolver 生成版本化 native envelope，Kotlin 校验后经 JNI 安装进 Rust，随后每帧继续走现有 landmark→Rust→packet 流程。8 个 built-in 继续承载专用 state graph/signal；TypeScript/Kotlin 的重复 action×view code 表已删除。长期仍可把 profile source 收口为统一版本化 bundle。

## 1. 当前各层到底支持哪些动作

### 1.1 动作目录：65 个都可选择，但只有 14 个是 experimental

目录 maturity 有四种声明值：`catalog_only`、`experimental`、`validated`、`suspended`；当前 registry 的专用分析开关只对 `experimental`/`validated` 返回 true。（`src/pose/exerciseRegistry.ts:1-5,54-59,634-637`）当前测试冻结了总数 65。（`tools/exercise-registry/exerciseRegistry.test.ts:45-75`）

当前 14 个 `experimental` 动作是：

- `march_in_place`、`side_step_touch`、`alternating_knee_raise`、`step_jack`；
- `barbell_row`、`pull_up`、`lat_pulldown`、`seated_row`、`straight_arm_pulldown`；
- `bodyweight_squat`；
- `seated_shoulder_press`、`lateral_raise`、`rear_delt_fly`、`face_pull`。

这些 maturity 直接写在 registry 记录中。（`src/pose/exerciseRegistry.ts:99-207,221-279`）

当前 51 个 `catalog_only` 动作是：

- 胸：`barbell_bench_press`、`dumbbell_bench_press`、`incline_dumbbell_press`、`machine_chest_press`、`cable_chest_fly`、`push_up`、`decline_barbell_bench_press`、`chest_dip`、`pec_deck_fly`；
- 背：`wide_grip_lat_pulldown`、`one_arm_dumbbell_row`、`chest_supported_row`、`single_arm_cable_row`、`assisted_pull_up`、`chin_up`、`t_bar_row`、`back_extension`；
- 腿：`barbell_back_squat`、`leg_press`、`romanian_deadlift`、`conventional_deadlift`、`walking_lunge`、`bulgarian_split_squat`、`leg_extension`、`leg_curl`、`hip_thrust`、`calf_raise`、`front_squat`、`goblet_squat`、`seated_leg_curl`、`lying_leg_curl`、`glute_bridge`；
- 肩：`front_raise`、`single_arm_cable_lateral_raise`、`landmine_press`、`cable_y_raise`、`cable_external_rotation`、`rear_delt_row`、`dumbbell_shoulder_press`、`arnold_press`、`upright_row`；
- 手臂：`barbell_biceps_curl`、`dumbbell_biceps_curl`、`hammer_curl`、`cable_biceps_curl`、`triceps_pushdown`、`overhead_triceps_extension`、`skull_crusher`、`preacher_curl`、`incline_dumbbell_curl`、`close_grip_bench_press`。

这些条目明确说明“可记录但没有未验证的 scoring profile”；后续扩展条目同样声明只是目录 identity，不会安装 recognition profile。（`src/pose/exerciseRegistry.ts:209-219,282-385,383-590`）

### 1.2 TypeScript 运动学配置：10 个动作，全部是 v1

`KinematicsProfile` 定义了 `exerciseId`、独立 `version`、movement pattern、是否可自动识别、recognition tags、首选/支持机位、phase signal，以及 amplitude/asymmetry/torso drift/phase duration 四类指标定义。（`src/pose/kinematicsProfile.ts:24-55`）当前 10 个 profile 是：

| 动作 | 版本 | 主分期信号 |
| --- | --- | --- |
| `barbell_row` | `barbell-row-kinematics/v1` | elbow angle |
| `pull_up` | `pull-up-kinematics/v1` | wrist height |
| `lat_pulldown` | `lat-pulldown-kinematics/v1` | wrist height |
| `seated_row` | `seated-row-kinematics/v1` | elbow angle |
| `straight_arm_pulldown` | `straight-arm-pulldown-kinematics/v1` | shoulder angle |
| `bodyweight_squat` | `bodyweight-squat-kinematics/v1` | knee angle |
| `seated_shoulder_press` | `seated-shoulder-press-kinematics/v1` | wrist height |
| `lateral_raise` | `lateral-raise-kinematics/v1` | shoulder angle |
| `rear_delt_fly` | `rear-delt-fly-kinematics/v1` | shoulder angle |
| `face_pull` | `face-pull-kinematics/v1` | elbow angle |

动作、版本和信号均来自当前 profile list。（`src/pose/kinematicsProfile.ts:62-189`）当前历史列表为空，但代码已经要求旧版本进入 append-only archive，不能原地删除；查找键是 `exerciseId:version`。（`src/pose/kinematicsProfile.ts:191-229`）

这 10 个 TS `KinematicsProfile` 不等于 10 个 Android Rust profile。Android 安装的是独立的 `RustExerciseProfileData`，不是把 `KinematicsProfile` 对象直接交给 Rust。

### 1.3 Simulated prior：不是只能采集，65 个动作已有 executable coverage

模拟先验 schema 是 `maxpower-simulated-kinematic-prior/v1`；模板表与 65 个目录动作一一覆盖，并通过 `listSimulatedKinematicPriorTemplates()` 对外提供；测试显式要求模板数与 registry 总数相同。（`src/pose/simulatedKinematicPrior.ts:12-20,101-110,248-331,356-369`；`tools/simulated-kinematic-prior/simulatedKinematicPrior.test.ts:36-63`）

关键是仓库还存在 `resolveSimulatedRecognitionProfile()`：它不是标注功能，而是把 template 的 primary feature、trend 和宽松 gates 转成带 identity/hash 的 `RustExerciseProfileData`，供 Rust 的标准 `ready-effort-peak-return/v1` 状态机运行计数和 phase。源码注释也明确称它为 “recognition/counting initializer”。（`src/motion/simulatedRecognitionProfile.ts:14-54`）

当前 converter 已映射 elbow/knee/hip angle、三类 landmark Y、wrist-to-shoulder distance、wrist spread、ankle spread 和 wrist-to-elbow distance。（`src/motion/simulatedRecognitionProfile.ts:57-72`）与专用 built-in 合并后，65 个动作在推荐机位全部有 executable profile。

因此 `uncalibrated` 只能表示阈值没有证据校准，不能被解释为“不能识别”。它们可以用于本次技术验证的动作确认、分期和计数，但不能据此输出标准姿势评分、医学判断或强断言纠错。

### 1.4 本地人工观测 recognition profiles：8 个 context，6 个动作

当前 artifact schema 是 `maxpower-observed-recognition-profiles/v1`，用途只包括 rep segmentation、rep counting、anti-interference，明确排除 standard form、quality scoring、medical assessment。（`public/archives/confirmed-captures/recognition-profiles.json:1-14`）8 个 exact context 是：

| 动作 | 机位 | identity | maturity |
| --- | --- | --- | --- |
| `barbell_row` | front | `barbell_row/front/bilateral/observed/v1` | provisional |
| `barbell_row` | frontLeft45 | `barbell_row/frontLeft45/bilateral/observed/v1` | provisional |
| `lat_pulldown` | rear | `lat_pulldown/rear/bilateral/observed/v1` | provisional |
| `lat_pulldown` | rearLeft45 | `lat_pulldown/rearLeft45/bilateral/observed/v1` | provisional |
| `lateral_raise` | front | `lateral_raise/front/bilateral/observed/v1` | provisional |
| `rear_delt_fly` | front | `rear_delt_fly/front/bilateral/observed/v1` | provisional |
| `seated_shoulder_press` | front | `seated_shoulder_press/front/bilateral/observed/v1` | provisional |
| `straight_arm_pulldown` | frontRight45 | `straight_arm_pulldown/frontRight45/bilateral/observed/v1` | provisional |

逐项 identity、maturity、状态机和 content hash 可在 artifact 中核对。（`public/archives/confirmed-captures/recognition-profiles.json:16-56,77-117,139-177,198-236,259-299,326-366,390-430,456-496`）这些 profile 由批准分段数据按 `exerciseId|capturePosition` 分桶生成；少于 4 个双侧完整 rep 的桶会跳过，生成器记录 evidence 和 approval export digest。（`tools/recognition-profile/generate.ts:45-87,90-178`）

Web 运行时会 fetch 这个 artifact，校验外层 schema，并且只允许 exact action×view×bilateral×empty-variation 匹配；`contentHash` 从十进制字符串恢复为 `BigInt`。（`src/motion/observedRecognitionProfiles.ts:19-64`）其中 front lateral raise 和 front rear-delt fly 会得到另一个有独立 identity/hash 的兼容版本，原始归档 profile 不会被修改。（`src/motion/observedRecognitionProfiles.ts:67-119`；`CONTEXT.md:45-53`）当前 Web 产品选择器不会让两个 observed 高位下拉 profile 覆盖 built-in，因为 reference trajectory 仍绑定 built-in identity；因此 artifact 有 8 个，但通常路径实际用 observed data 的是另外 6 个 context。（`src/components/CameraPoseView.web.tsx:302-339`）

### 1.5 Rust/Android 当前状态：built-in 与 data profile 都可安装

当前 Rust code 表是：

| code | 动作×机位 | Rust identity | Rust maturity |
| ---: | --- | --- | --- |
| 1 | `lat_pulldown` × rear | `lat-pulldown/rear/bilateral/cable/v1` | Provisional |
| 2 | `seated_shoulder_press` × front-left-45 | `seated-shoulder-press/front-left-45/bilateral/dumbbell/v1` | Provisional |
| 3 | `lat_pulldown` × rear-left-45 | `lat-pulldown/rear-left-45/bilateral/cable/v1` | Provisional |
| 4 | `seated_shoulder_press` × front | `seated-shoulder-press/front/bilateral/dumbbell/v1` | Provisional |
| 5 | `march_in_place` × front | `march-in-place/front/bilateral/bodyweight/v1` | Provisional |
| 6 | `side_step_touch` × front | `side-step-touch/front/bilateral/bodyweight/v1` | Provisional |
| 7 | `alternating_knee_raise` × front | `alternating-knee-raise/front/bilateral/bodyweight/v1` | Provisional |
| 8 | `step_jack` × front | `step-jack/front/bilateral/bodyweight/v1` | Provisional |

code 到构造器的权威选择仍在 Rust ABI；identity 在各构造器中。（`rust/motion-sdk/src/web_abi.rs:780-801`；`rust/motion-sdk/src/lib.rs:535-704`）对于非 built-in context，共享 resolver 编码与 Web 相同的 scalar installation，Android Kotlin/JNI 调用 `motion_sdk_begin_profile_identity` + `motion_sdk_install_profile` 完成安装。（`src/mobile/exerciseRecognition.ts`；`src/motion/rustCanonicalWasm.ts`；`modules/pose-camera/android/src/main/cpp/motion_bridge.cpp`）

## 2. 当前 Rust profile 的 schema、版本和配置

### 2.1 Rust 内部数据模型

Rust `ExerciseProfile` 当前包含：

- `identity` 和 `content_hash`；
- maturity、pose schema、coordinate unit、state-machine id、required capabilities；
- primary/secondary signal、movement direction；
- start/min amplitude、return hysteresis、ready tolerance；
- gap 和 rep duration gates。（`rust/motion-sdk/src/lib.rs:472-533`）

当前支持的内部信号枚举有 6 种：landmark Y、joint angle、landmark distance、horizontal distance、vertical distance、paired distance sum；pose schema 只有 BlazePose33。（`rust/motion-sdk/src/lib.rs:482-504`）profile 必须要求 canonical landmarks 和 subject lock。（`rust/motion-sdk/src/lib.rs:506-521`）

`content_hash` 是基于 identity、coordinate unit、state graph、capabilities、maturity、schema/direction、信号/关键点、浮点 gates 和时长的 FNV-1a 64 位内容哈希；任何配置变化都会进入 lineage，而不是只靠名字区分。（`rust/motion-sdk/src/lib.rs:711-762`）安装前还会校验 identity、hash、schema、unit、state graph、capabilities、maturity、关键点范围和 gate 合法性。（`rust/motion-sdk/src/lib.rs:764-839`）

### 2.2 当前实际存在三种“版本”

1. **Artifact schema version**：人工观测 JSON 为 `maxpower-observed-recognition-profiles/v1`。（`public/archives/confirmed-captures/recognition-profiles.json:1-14`）
2. **Profile semantic identity version**：每个 identity 尾部有 `/v1`，兼容性调整会追加独立的 `soft-cycle/v1` 或 `wrist-spread-cycle/v2`，而不是覆盖旧 identity。（`src/motion/observedRecognitionProfiles.ts:78-110`）
3. **Rust ABI/packet contract version**：当前 `motion_sdk_contract_major/minor` 返回 1.5；packet lineage同时携带 active profile identity/hash 和 config version。（`rust/motion-sdk/src/web_abi.rs:707-717,769-777`；`rust/motion-sdk/src/lib.rs:445-455`）

当前还**没有一个统一的、Rust 与 Android 都消费的离线 profile bundle**。Android 已改为消费共享 TypeScript resolver 产生的版本化 native envelope，不再单独维护 code 表；Web 的 observed artifact 仍由 Web 运行时加载。（`src/motion/observedRecognitionProfiles.ts:24-43`；`src/mobile/exerciseRecognition.ts`）

### 2.3 当前两条 profile 进入 Rust 的路径

**内建 code 路径：** `motion_sdk_set_profile(code)` 在 Rust 中实例化 8 个内建 profile 或把 code 0 变成 `None`；切换会清空 rep state、completed/pending reps 和 reference state。（`rust/motion-sdk/src/web_abi.rs:780-801`）Web 的 `setExerciseProfile()` 只是把字符串再次映射为 code 1–8。（`src/motion/rustCanonicalWasm.ts:544-570`）

**数据安装路径：** 共享 TypeScript encoder 先校验 content hash，再固定 scalar ABI 的 24 个参数顺序；Web 直接调用 WASM，Android 将同一参数序列放入 versioned envelope，经 Kotlin/JNI 调用 native ABI。（`src/motion/rustCanonicalWasm.ts`；`src/mobile/exerciseRecognition.ts`；`modules/pose-camera/android/src/main/cpp/motion_bridge.cpp`；`rust/motion-sdk/src/web_abi.rs:805-942`）

这个 scalar 安装 API 还不能完全替代 8 个 built-in：

- TypeScript 数据型 schema 只允许 `ready-effort-peak-return/v1` 和 3 种 signal kind。（`src/motion/rustCanonicalWasm.ts:103-130`）
- Rust ABI 的安装入口也只把 state-machine code 0 解析为 `ready-effort-peak-return/v1`，signal code 只接受 landmark Y、joint angle、landmark distance。（`rust/motion-sdk/src/web_abi.rs:880-907`）
- 四个居家 built-in 使用 `alternating-ready-effort-return/v1`，并依赖 vertical/horizontal/paired-distance 信号。（`rust/motion-sdk/src/lib.rs:535-631`；`CONTEXT.md:85-91`）

因此统一 bundle 前必须先扩展数据 schema 和 Rust decoder，使其覆盖两种现有 state graph 与 6 种现有 signal kind；否则迁移后会丢掉四个居家动作。

## 3. Android 当前集成与数据流

### 3.1 构建期

Rust crate 同时产出 `rlib`、`cdylib`、`staticlib`。（`rust/motion-sdk/Cargo.toml:1-13`）Android 构建脚本通过 `cargo ndk` 为 armeabi-v7a、arm64-v8a、x86、x86_64 编译同一个 motion-sdk。（`tools/motion-sdk/build-native.sh:20-34`）Gradle 的 `preBuild` 同时依赖 Rust native build 和 MediaPipe pose model asset 同步；当前 asset 同步只包含 `pose_landmarker_*.task`，不包含 recognition profile bundle。（`modules/pose-camera/android/build.gradle:8-10,29-33,40-63`）

CMake 把 Rust `.so` 作为 imported library，再链接进 `pose_camera_motion` JNI bridge。（`modules/pose-camera/android/src/main/cpp/CMakeLists.txt:1-14`）

### 3.2 运行期

当前 Android 数据流是：

1. React Native setup 用 exact action×view 解析 `RecognitionCapability`，得到 built-in、data 或 none，以及版本化 native envelope。（`src/mobile/exerciseRecognition.ts`；`src/mobile/ui/SetupScreen.tsx`）
2. Live/Replay 页只把这个 opaque envelope 作为 `recognitionProfile` prop 传给 Kotlin。（`src/mobile/ui/LiveScreen.tsx`；`src/mobile/ui/ReplayScreen.tsx`）
3. Kotlin 校验 schema、mode、identity 和 24 个 ABI 参数；配置顺序固定为 reset → built-in/none → 可选 data install → begin set。profile 切换会先结束当前 set、清空旧状态、安装后再恢复。（`modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt`）
4. JNI 只负责将已验证参数转交 Rust，不解析动作或阈值语义。（`modules/pose-camera/android/src/main/cpp/motion_bridge.cpp`）
5. CameraX 保留最新帧，MediaPipe VIDEO 模式生成最多一个人的 33 个 landmarks；同一个单线程 executor 把 landmarks 交给 Rust。（`modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt:207-225,228-259,274-323`）
6. JNI 逐 landmark 调 Rust，复制二进制 canonical packet；Kotlin Base64 后通过 `onPose` 发给 TS。（`modules/pose-camera/android/src/main/cpp/motion_bridge.cpp:45-79`；`modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt:323-354`）
7. TS 只解码 packet，以 Rust sealed reps 做确认计数、录制和组后报告。（`src/mobile/ui/LiveScreen.tsx:81-128,130-160`）

这个链路保持离线：模型来自 APK assets，Rust 是本地 `.so`，帧路径中没有网络调用。（`modules/pose-camera/android/build.gradle:53-59,65-72`；`modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt:207-225`）

### 3.3 Android 动态安装已经补齐

公共 C header、JNI 和 Kotlin surface 现已暴露 data-profile installation。原先的 Kotlin `resolveProfileCode()` 与 TypeScript tier/code 镜像已经删除；Android capability 只取决于共享 resolver 是否返回 executable profile。（`modules/pose-camera/common/motion_sdk.h`；`modules/pose-camera/android/src/main/java/expo/modules/posecamera/MotionNative.kt`；`src/mobile/exerciseRecognition.ts`）

## 4. 推荐方案：先把识别能力接到 Android，再收口为版本化 bundle

### 4.0 Capability-first 的最短路径

本次技术验证不需要等待标注系统或统一 bundle 完成。最短路径是复用 Web 已验证的选择逻辑：

1. setup 根据 exact action×view×bilateral×empty-variation 解析 profile：优先 built-in，其次 observed，最后 simulated initializer；
2. built-in 继续传 code；data profile 在动作/机位改变时通过新增 JNI 方法一次性安装到 Rust；
3. 进入 live 后每帧路径完全不变，仍由 Rust packet 输出 phase、sealed reps 和 profile identity/hash；
4. `cable_external_rotation` 已使用 wrist-to-elbow landmark distance 补齐，推荐机位覆盖达到 65/65。

Android 对外能力定义应改成 resolver 结果，而不是 maturity tier：

```ts
type RecognitionMode = "built_in" | "observed" | "simulated_initializer" | "none";

interface RecognitionCapability {
  mode: RecognitionMode;
  canRunRustRecognition: boolean;
  canCount: boolean;
  canEmitPhase: boolean;
  profileIdentity: string | null;
}
```

`evidenceStatus`、`calibrationStatus` 和数据来源可以继续保留，但只能描述可信度和后续优化优先级，不能决定 `canRunRustRecognition`。技术验证 UI 可以明确显示 initializer 来源，不需要把它降级为“只能录制/标注”。

### 4.1 目标与边界

目标不是在每帧把 JSON 传进 Rust，而是：

- APK 内置一个小型、不可变、可审计的 recognition profile bundle；
- App/原生模块初始化时只安装一次，动作或机位改变时只传 context；
- Rust 原子校验 bundle、精确解析 context、激活一个 profile；
- 每帧仍只传 33 个 landmarks，packet 仍证明 active profile identity/hash；
- 无匹配或校验失败时 fail closed 到“无 profile、只骨架/入框/录制”，绝不借相近动作或相近机位计数。

这与项目现有“不推断 action identity”“profile identity/hash 进入 canonical packet lineage”的合同一致。（`rust/motion-sdk/src/lib.rs:472-479,445-455,2790-2805`；`CONTEXT.md:20-25`）

### 4.2 Canonical 生成产物

建议新增唯一生成产物，例如：

```json
{
  "schemaVersion": "maxpower-motion-profile-bundle/v1",
  "bundleVersion": "2026.08.08.1",
  "generatorVersion": "motion-profile-generator/v1",
  "minimumSdkContract": { "major": 1, "minor": 6 },
  "bundleHash": "fnv1a64-or-sha256:...",
  "sourceEvidenceDigest": "sha256:...",
  "profiles": [
    {
      "context": {
        "exerciseId": "lat_pulldown",
        "capturePosition": "rear",
        "trainingSide": "bilateral",
        "variation": "front_bar_pronated",
        "equipment": "cable_lat_pulldown/straight_bar",
        "poseSchema": "blazepose33"
      },
      "profile": {
        "identity": "lat-pulldown/rear/bilateral/cable/v1",
        "contentHash": "...",
        "maturity": "provisional",
        "stateMachineId": "ready-effort-peak-return/v1"
      },
      "evidence": {
        "status": "project-authored-provisional",
        "digest": "sha256:..."
      }
    }
  ]
}
```

生成器应当：

1. 从批准的 observed artifact 和项目维护的内建 profile source 生成一个按完整 context 排序的 bundle；不能把目录 metadata 自动提升为可执行 profile。当前 observed generator 已经具备分桶、最低可用 rep、evidence digest 和确定性 profile hash 的大部分基础。（`tools/recognition-profile/generate.ts:45-87,90-178`）
2. 把目前 8 个 built-in 也表示成数据，使 code 1–8 只成为迁移期兼容入口。为此 bundle v1 的 signal/state schema 必须覆盖 Rust 已有的两种 graph 和 6 种 signal，而不是沿用当前受限的 Web scalar DTO。（`rust/motion-sdk/src/lib.rs:482-533,535-631`）
3. 产出一份 canonical byte stream；Android asset 与 Web public artifact 必须是同一文件/同一 hash，不能分别生成。
4. Android 构建把它同步到类似 `build/generated/poseAssets/motion/motion-profile-bundle.v1.json`；Web 构建复制同一产物。Gradle 已经有 generated asset source set，可复用而不新增运行时下载。（`modules/pose-camera/android/build.gradle:8-10,29-33,53-63`）

JSON 对当前几十个小 profile 足够轻：只在启动或版本变化时解析一次，逐帧零解析、零查表。若未来 bundle 变大，可保持同一语义 schema，再由生成器输出带长度前缀的二进制；不要先在 Kotlin 自创另一种 profile model。

### 4.3 Rust ABI/API 形状

沿用现有 begin→set byte→commit 模式，新增 ABI minor（建议从 1.5 到 1.6），以避免 Web/WASM 和 native 出现两套协议：（当前同类 byte-buffer 协议可见 `rust/motion-sdk/src/web_abi.rs:805-829`。）

```c
int32_t motion_sdk_begin_profile_bundle(uint32_t length);
int32_t motion_sdk_set_profile_bundle_byte(uint32_t index, uint32_t value);
int32_t motion_sdk_commit_profile_bundle(void);

int32_t motion_sdk_begin_profile_context(uint32_t length);
int32_t motion_sdk_set_profile_context_byte(uint32_t index, uint32_t value);
int32_t motion_sdk_activate_profile_context(void);

uint32_t motion_sdk_profile_bundle_status(void);
uint32_t motion_sdk_active_profile_identity_len(void);
ptrdiff_t motion_sdk_copy_active_profile_identity(uint8_t *out, size_t capacity);
uint32_t motion_sdk_active_profile_hash_low(void);
uint32_t motion_sdk_active_profile_hash_high(void);
```

`profile_context` 可用一个 deny-unknown-fields 的小 JSON envelope，避免给 action/view/side/variation/equipment 各加一组字符串 ABI。Rust 负责 exact key；未匹配返回一个明确状态并关闭 rep engine，不能回退到 parent exercise、相邻 view 或空 variation。现有 observed resolver 的 exact-match 策略可以作为迁移语义基线。（`src/motion/observedRecognitionProfiles.ts:45-64`）

Rust `commit_profile_bundle` 应当是原子的：先在临时结构中完成长度上限、UTF-8/JSON、schema、SDK contract、bundle hash、重复 context、逐 profile hash、capabilities、schema、state graph、signal landmark、gate 和 evidence-status 校验，全部通过后才替换 active bundle。现有 `ExerciseProfile::validate()` 已覆盖大部分逐 profile 校验。（`rust/motion-sdk/src/lib.rs:764-839`）

Android JNI 只需要两个高层方法：

```kotlin
nativeInstallProfileBundle(bytes: ByteArray): BundleInstallResult
nativeActivateProfile(contextJson: ByteArray): ProfileActivationResult
```

JNI 内部可以循环调用公共 C ABI；Kotlin 不解析 profile 内容。`PoseCameraView` 在 native pipeline 首次 configure 前安装 bundle，在 `exerciseId`/capture position/side/variation/equipment 改变时激活 context；每帧函数不变。

### 4.4 Android/TS 数据流收口后

推荐的新流向是：

```text
approved labels + authored provisional profiles
                  ↓ deterministic generator
       versioned canonical profile bundle
             ↙ same bytes/hash ↘
      Web/WASM                 Android APK asset
             ↘               ↙
        Rust bundle parser + exact-context resolver
                         ↓
              active ExerciseProfile
                         ↓
     canonical packet identity/hash + sealed reps
```

React/TypeScript 继续拥有动作目录、中文名、筛选、机位引导和 capability resolver；setup 页直接消费 `RecognitionCapability`，不再用 maturity tier 推导。（`src/mobile/exerciseRecognition.ts`；`src/mobile/ui/SetupScreen.tsx`。）

Kotlin 只做 camera/model/frame/envelope validation/JNI 生命周期；它不含 action×view resolver。Rust 是唯一的 rep/phase engine，packet lineage 是下游唯一 provenance。（`CONTEXT.md`）

### 4.5 验证、fallback 与迁移

**验证规则：**

- bundle 总长度和单 identity/context 长度有硬上限；当前 identity buffer 已经示范 512-byte 上限。（`rust/motion-sdk/src/web_abi.rs:805-813`）
- schema major 未知、SDK major 不符、bundle/profile hash 不符、context 重复、capability/schema/state/signal/gate 非法时拒绝整个 bundle；不应部分安装。
- bundle 安装成功后，激活结果必须返回 identity/hash；第一张 packet 的 lineage 必须完全相同。（`rust/motion-sdk/src/lib.rs:445-455,2790-2805`）
- profile 只能在 set 开始前或明确切换边界激活；核心 session 已经拒绝“处理过 frame 后安装”以及“已有 profile 再安装”。（`rust/motion-sdk/src/lib.rs:2645-2657`）

**安全 fallback：**

1. 未匹配 context：profile none，骨架/入框/录制继续，计数和 phase 关闭。
2. bundle 损坏或版本不支持：记录可见诊断；迁移期可以只对原 8 个 exact context 回退到 legacy code 表，且 packet 必须暴露 legacy identity/hash。不能对新 profile 猜测 fallback。
3. 更新失败：保留上一个完整、已验证 bundle；绝不把半个新 bundle 与旧 resolver 混用。

**实施状态与后续：**

1. 已把 Rust scalar data-profile install ABI 暴露到 C header/JNI/Kotlin，并保留 built-in code。
2. 已用共享 exact resolver 和 versioned envelope 覆盖推荐机位 65/65。
3. 已删除 Kotlin 与移动端的 action×view code 镜像，profile switch 会原子清空旧 set 状态。
4. 已通过 TypeScript 全量测试、WASM parity、Rust 全量测试和 Android 四 ABI debug AAR 构建。
5. 后续可引入统一离线 bundle，把 observed artifact 与 8 个 built-in 也统一数据化。

### 4.6 必须补的测试

| 测试层 | 必测内容 |
| --- | --- |
| Generator | 65 catalog 不会自动变成 executable profile；排序稳定；同输入得到相同 bytes/hash；duplicate context、missing evidence、unknown enum 拒绝。 |
| Rust unit | bundle schema/contract/hash；逐 profile `validate()`；两种 state graph、6 种 signal；oversize/truncated/invalid UTF-8/unknown fields；atomic rollback；exact-context no-match。 |
| ABI contract | 1.6 安装、激活、identity/hash query；code 1–8 与 bundle 等价；bundle 安装不改变现有 packet 1.5 解码语义。当前 native ABI 测试已经验证 packet contract 和内建 identity，可扩展同一测试文件。（`rust/motion-sdk/tests/native_abi_contract.rs:12-55`） |
| Web/native parity | 同一 bundle + 同一 canonical fixture，在 WASM 和 Android/native 得到相同 active identity/hash、rep boundaries、disposition、findings。现有 parity 已经覆盖自定义 profile 安装，可扩展为 bundle。（`tools/motion-sdk/parity.ts:98-153`） |
| Android native | APK asset hash 与 generator manifest 一致；冷启动安装成功；切 action/view 只激活一次；invalid bundle 显示 no-profile 而不崩溃；离线模式全流程可用。 |
| Product contract | capability 来自 exact resolver/Rust 激活结果；65 个动作在推荐机位可进入计数/phase；仅真正 resolve 为 none 时关闭；profile switch 会清空上一动作 rep state；packet 落盘包含 identity/hash。 |

## 5. 哪些东西绝对不要在 Kotlin/TypeScript 重复

下列内容应由 Rust bundle + resolver 唯一拥有：

- action×capture position×training side×variation×equipment 到 executable profile 的精确匹配；
- profile code、identity/version、maturity、state graph、signal kind/landmarks、阈值、duration gates；
- content hash 和 bundle hash 算法；
- schema/ABI compatibility、validation、fallback 决策；
- “这个 context 能不能计数”的最终结论；
- rep boundary、disposition 和 profile provenance。

action×view 映射现已从 Kotlin 删除；Rust profile code 表和共享 TypeScript resolver 分别负责 built-in 构造与 exact-context 选择。（`rust/motion-sdk/src/web_abi.rs:780-801`；`src/mobile/exerciseRecognition.ts`）

下列内容可以留在 TypeScript/Kotlin：

- TypeScript：65 动作目录、中文/英文名、搜索分组、课程与机位引导 UI；但 capability 必须读 Rust/manifest 结果。（`src/mobile/libraryModel.ts:1-49`）
- Kotlin：CameraX、MediaPipe、asset IO、JNI、线程和生命周期；不能解释 profile 内容。（`modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt:31-79,207-259`）
- TypeScript：解码并展示 canonical packet，不重算第二套 rep boundary。（`CONTEXT.md:29-34`）

## 6. 实施优先级

tracer bullet 已完成：**非 code 1–8 动作会安装 simulated initializer，Rust packet 继续输出 profile identity、phase 和 sealed reps。** Android 不再被 8 个 code 人为限制，推荐机位覆盖已达到 65/65。

标注/批准数据是后续替换 initializer 阈值、提升稳定性和纠错可信度的迭代输入，不是“这个动作能否开始识别”的准入条件。

最终标准流程应是：动作目录/先验定义产生 executable initializer → Android 与 Web 都可运行识别 → replay 验证基础计数行为 → 有真实样本后用 observed profile 替换或修正阈值 → bundle/version/hash 固化。正常新增动作不再改 Kotlin，也不再手工分配 profile code。
