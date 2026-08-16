import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const sourcePath = resolve(root, 'docs/research/2026-08-15-expanded-action-motion-definitions.md');
const outputPath = resolve(root, 'rust/motion-sdk/assets/action-motion-catalog-v1.json');
const source = readFileSync(sourcePath, 'utf8');

const families = new Map();
for (const match of source.matchAll(/^### (M\d\d) ([^\n]+)\n([\s\S]*?)(?=^### M\d\d |^## 5\.)/gm)) {
  const bullets = Object.fromEntries(
    [...match[3].matchAll(/^- `([^`]+)`：([^\n]+)/gm)].map((entry) => [entry[1], entry[2].trim()]),
  );
  families.set(match[1], { name: match[2].trim(), ...bullets });
}

const leafSection = source.slice(source.indexOf('## 5. 扩展叶级动作目录'));
const leafRows = [...leafSection.matchAll(/^\| `([^`]+)`[^|]*\| ([^|]+) \| ([^|]+) \|$/gm)];
if (families.size !== 30 || leafRows.length !== 248) {
  throw new Error(`reviewed source shape changed: ${families.size} families, ${leafRows.length} leaves`);
}

function topology(binding, actionId) {
  if (binding.includes('rigid_frame') || actionId.includes('trap_bar')) return 'trap_bar';
  if (actionId.includes('kettlebell')) return 'kettlebell';
  if (actionId.includes('resistance_band') || actionId.includes('band_assisted')) return 'resistance_band';
  if (actionId.includes('plate_')) return 'weight_plate';
  if (binding.includes('smith_guided_bar')) return 'smith_guided_bar';
  if (binding.includes('rigid_bar')) return 'free_rigid_barbell';
  if (binding.includes('dual_free_load') || (binding.includes('single_free_load') && actionId.includes('dumbbell'))) return 'independent_dumbbell';
  if (binding.includes('single_free_load')) return 'generic_single_free_load';
  if (binding.includes('linked_machine') || binding.includes('independent_machine') || binding.includes('machine_')) return 'constrained_machine_handle';
  if (binding.includes('cable_')) return 'cable_handle';
  if (binding.includes('landmine')) return 'landmine_lever';
  if (binding.includes('trap_bar')) return 'trap_bar';
  if (binding.includes('kettlebell')) return 'kettlebell';
  if (binding.includes('band_')) return 'resistance_band';
  if (binding.includes('bodyweight_station')) return 'bodyweight_station';
  return 'none';
}

function identityPart(binding, candidates, fallback) {
  return candidates.find((candidate) => binding.includes(candidate)) ?? fallback;
}

const FAMILY_DEFAULT_POSTURE = {
  M01: 'standing_free', M02: 'chest_supported', M03: 'seated_unsupported', M04: 'standing_free',
  M05: 'bodyweight_station', M06: 'seated_supported', M07: 'standing_free', M08: 'standing_free',
  M09: 'machine_supported', M10: 'split_stance', M11: 'standing_free', M12: 'standing_free',
  M13: 'supine_supported', M14: 'prone_supported', M15: 'supine_bench', M16: 'seated_backrest',
  M17: 'supine_bench', M18: 'bodyweight_station', M19: 'seated_backrest', M20: 'standing_free',
  M21: 'seated_backrest', M22: 'standing_free', M23: 'standing_free', M24: 'standing_free',
  M25: 'standing_free', M26: 'standing_free', M27: 'seated_supported', M28: 'standing_free',
  M29: 'supine_floor', M30: 'standing_free',
};

const POSTURE_TOKENS = [
  'standing_free', 'seated_backrest', 'seated_supported', 'seated_unsupported', 'supine_bench',
  'supine_floor', 'incline_bench', 'decline_bench', 'prone_pad', 'kneeling', 'split_stance',
  'side_lying', 'chest_supported', 'floor_support', 'fixed_hand_support', 'fixed_foot_support',
  'bodyweight_station',
];

function exactPosture(actionId, binding, familyId) {
  const declared = POSTURE_TOKENS.find((candidate) => binding.includes(candidate));
  if (declared) return declared;
  if (actionId.includes('incline_')) return 'incline_bench';
  if (actionId.includes('decline_')) return 'decline_bench';
  if (actionId.includes('seated_')) return familyId === 'M22' ? 'seated_unsupported' : 'seated_supported';
  if (actionId.includes('standing_')) return 'standing_free';
  if (actionId.includes('prone_')) return 'prone_supported';
  if (actionId.includes('lying_')) return 'supine_bench';
  return FAMILY_DEFAULT_POSTURE[familyId];
}

function exactLaterality(actionId, binding, equipmentTopology) {
  if ([
    'walking_lunge',
    'alternating_forward_lunge',
    'alternating_reverse_lunge',
    'march_in_place',
    'single_load_weighted_march_in_place',
    'double_dumbbell_weighted_march_in_place',
    'alternating_knee_raise',
    'high_knees',
    'step_jack',
  ].includes(actionId)) return 'alternating';
  if (binding.includes('alternating') || actionId.includes('alternating_')) return 'alternating';
  if (binding.includes('unilateral') || actionId.includes('single_arm_') || actionId.includes('single_leg_')) return 'unilateral';
  if (binding.includes('independent_bilateral') || binding.includes('dual_free_load') || binding.includes('independent_machine')) return 'independent_bilateral';
  if (binding.includes('bilateral_rigid') || equipmentTopology === 'free_rigid_barbell' || equipmentTopology === 'smith_guided_bar' || equipmentTopology === 'trap_bar') return 'bilateral_rigid';
  return 'bilateral_synchronous';
}

function exactSupport(posture, binding, equipmentTopology) {
  const explicit = identityPart(binding, ['chest_supported', 'seated_backrest', 'seated_supported', 'floor_support', 'fixed_hand_support', 'fixed_foot_support', 'prone_pad', 'supine_bench', 'incline_bench', 'decline_bench'], null);
  if (explicit) return explicit;
  if (equipmentTopology === 'constrained_machine_handle') return 'machine_support';
  if (posture === 'bodyweight_station') return 'bodyweight_station';
  if (posture.includes('seated')) return 'seat';
  if (posture.includes('supine')) return 'floor_or_bench';
  if (posture.includes('prone')) return 'prone_support';
  return 'self_supported';
}

function repConsensus(laterality, equipmentTopology) {
  const mode = equipmentTopology === 'free_rigid_barbell' || equipmentTopology === 'smith_guided_bar'
    ? 'shared_rigid'
    : laterality === 'independent_bilateral'
      ? 'independent_bilateral'
      : laterality === 'unilateral'
        ? 'unilateral'
        : laterality === 'alternating'
          ? 'alternating'
          : 'bilateral_synchronous';
  const requiredSides = mode === 'independent_bilateral' || mode === 'bilateral_synchronous'
    ? ['left', 'right']
    : mode === 'unilateral' || mode === 'alternating'
      ? ['one_stable_active_side']
      : ['shared'];
  return {
    mode,
    requiredPrimaryTracks: ['task_primary_track'],
    requiredSides,
    minimumObservedFrames: 3,
    conflictPolicy: 'reject_confirmed_rep',
  };
}

const ALL_CAPTURE_VIEWS = [
  'front',
  'rear',
  'left_side',
  'right_side',
  'front_left_45',
  'front_right_45',
  'rear_left_45',
  'rear_right_45',
];

const SDK_TRACKED_EQUIPMENT = new Set([
  'free_rigid_barbell',
  'smith_guided_bar',
  'independent_dumbbell',
  'constrained_machine_handle',
]);

function requiredMotionForAction(actionId, familyId, family) {
  if (family.required_motion) return family.required_motion;
  if (familyId === 'M23') {
    return actionId.includes('upright_row')
      ? '器械上升、肘屈曲与肩外展共同发生；肘和负载高度关系变化后返回。'
      : '肩水平外展使真实负载向两侧展开后返回；肘角相对稳定。';
  }
  if (familyId === 'M27') {
    return actionId.includes('extension')
      ? '膝从屈曲端伸展；踝或滚轮垫沿机器弧线抬起后返回。'
      : '膝从伸展端屈曲；踝或滚轮垫沿姿态特定机器弧线移动后返回。';
  }
  if (familyId === 'M29') {
    return actionId.includes('crunch')
      ? '肩中点离开支撑并返回，同时髋角变化保持受限。'
      : '躯干—大腿夹角显著缩小后恢复，肩中点相对髋中点抬起并前移后返回。';
  }
  if (familyId === 'M30') {
    if (actionId.includes('jack')) {
      return '肩与髋外展/内收以及腕踝开合形成一次闭合—展开—闭合周期；是否腾空由叶级变式声明。';
    }
    if (actionId.includes('side_step') || actionId.includes('lateral_walk')) {
      return '髋外展与踝横向分离—合拢构成一步；脚部顺序由叶级变式声明。';
    }
    return '左右髋屈曲与膝抬高交替发生，支撑侧保持站立并按叶级节奏返回。';
  }
  throw new Error(`missing required motion semantics for ${actionId} / ${familyId}`);
}

function repBoundaryForAction(actionId, familyId, family) {
  if (familyId === 'M23') {
    return actionId.includes('upright_row')
      ? '器械下端 → 上拉端反转 → 返回下端'
      : '负载闭合端 → 肩水平外展端反转 → 返回闭合端';
  }
  if (familyId === 'M27') {
    return actionId.includes('extension')
      ? '膝屈曲端 → 伸展端反转 → 返回屈曲端'
      : '膝伸展端 → 屈曲端反转 → 返回伸展端';
  }
  if (familyId === 'M29') {
    return actionId.includes('crunch')
      ? '肩背支撑端 → 卷曲端反转 → 返回肩背支撑端'
      : '仰卧展开端 → 完整起身端反转 → 返回展开端';
  }
  if (familyId === 'M30') {
    if (actionId.includes('jack')) return '手脚闭合端 → 展开端反转 → 返回闭合端';
    if (actionId.includes('side_step') || actionId.includes('lateral_walk')) {
      return '双脚中心端 → 横向分离端 → 回收或进入下一步';
    }
    return '活动侧落地端 → 对侧膝抬高端 → 返回并切换活动侧';
  }
  return family.rep_boundary ?? 'declared_effort_endpoint_reversal';
}

// These are semantic action-family defaults materialized into every exact
// action × view asset. They intentionally live in generated data rather than
// a Rust action-name switch. Values are provisional candidate parameters,
// not quality standards; the replay/acceptance protocol owns their tuning.
const LOCOMOTION_STEP_ACTIONS = new Set([
  'walking_lunge',
  'alternating_forward_lunge',
  'alternating_reverse_lunge',
  'side_step_touch',
  'resistance_band_lateral_walk',
  'crossover_side_step',
]);
const MULTI_STAGE_ACTIONS = new Set(['box_squat']);
const PROJECTED_AXIAL_ROTATION_FAMILIES = new Set(['M21', 'M24']);
const KNEE_RAISE_ACTIONS = new Set([
  'march_in_place',
  'single_load_weighted_march_in_place',
  'double_dumbbell_weighted_march_in_place',
  'alternating_knee_raise',
  'high_knees',
]);
const JACK_ACTIONS = new Set(['step_jack', 'jumping_jack']);

function topologyParameters(actionId, familyId, laterality, equipmentTopology, viewId) {
  const lowerBody = ['M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14'].includes(familyId);
  const smallArmPath = ['M22', 'M23', 'M24', 'M25', 'M26', 'M28', 'M29'].includes(familyId);
  const topologyId = LOCOMOTION_STEP_ACTIONS.has(actionId)
    ? 'locomotion_step_cycle/v1'
    : MULTI_STAGE_ACTIONS.has(actionId)
      ? 'multi_stage_cycle/v1'
      : laterality === 'alternating'
    ? 'alternating_cycle/v1'
    : laterality === 'unilateral'
      ? 'unilateral_cycle/v1'
      : laterality === 'independent_bilateral'
        ? 'independent_bilateral_cycle/v1'
        : equipmentTopology === 'none' || equipmentTopology === 'bodyweight_station'
          ? 'pose_primary_cycle/v1'
          : 'bilateral_synchronous_cycle/v1';
  let base = lowerBody
    ? { start: 45, excursion: 130, hysteresis: 45, return: 85, ready: 35, dwell: 300, gap: 900, minDuration: 500, maxDuration: 9000 }
    : smallArmPath
      ? { start: 35, excursion: 100, hysteresis: 35, return: 70, ready: 28, dwell: 250, gap: 650, minDuration: 350, maxDuration: 6500 }
      : { start: 50, excursion: 140, hysteresis: 50, return: 80, ready: 35, dwell: 300, gap: 750, minDuration: 400, maxDuration: 8000 };
  if (actionId === 'high_knees') {
    base = { start: 35, excursion: 100, hysteresis: 30, return: 65, ready: 25, dwell: 100, gap: 350, minDuration: 180, maxDuration: 1800 };
  }
  const depthSensitive = ['left_side', 'right_side'].includes(viewId);
  const oblique = viewId.includes('45');
  const adjustment = depthSensitive ? -5 : oblique ? -3 : 0;
  const algorithmModuleIds = [
    'pose_relation',
    'local_coordinate',
    ...(SDK_TRACKED_EQUIPMENT.has(equipmentTopology)
      ? ['equipment_observation', 'equipment_fusion']
      : []),
    'rep_topology',
    'candidate_admission',
    'boundary_refinement',
    'post_seal_feature',
    'quality_rule',
  ];
  return {
    topologyId,
    primaryRelationId: 'task_primary',
    algorithmModuleIds,
    directionPolicy: 'sign_invariant',
    startThresholdMilli: base.start + adjustment,
    minimumExcursionMilli: base.excursion + adjustment,
    turnaroundHysteresisMilli: base.hysteresis + adjustment,
    returnToleranceMilli: base.return,
    maximumConstrainedPathDeviationMilli: equipmentTopology === 'smith_guided_bar' ? 120 : 1000,
    readyToleranceMilli: base.ready,
    minimumPhaseDwellMs: base.dwell,
    maximumGapMs: base.gap,
    minimumRepDurationMs: base.minDuration,
    maximumRepDurationMs: base.maxDuration,
  };
}

// Product-entry camera default. This is explicit action asset data, never a
// runtime view guess. The UI may offer the other executable views before the
// recognition session is started and frozen.
function recommendedView(familyId) {
  if (['M15', 'M16', 'M17', 'M18', 'M19', 'M20', 'M21', 'M22', 'M23', 'M24', 'M25', 'M26'].includes(familyId)) {
    return 'front';
  }
  return 'front_left_45';
}

function preparationToEffortDirection(actionId, familyId, viewId) {
  if (
    ['M03', 'M04'].includes(familyId)
    && ['left_side', 'right_side'].includes(viewId)
  ) return 'preparation_to_effort_right';
  if (
    familyId === 'M24'
    || actionId.includes('fly')
    || /(^|_)lateral_/.test(actionId)
    || actionId.includes('side_step')
    || actionId.includes('lateral_walk')
    || actionId.includes('crossover_side_step')
  ) return 'preparation_to_effort_right';
  if (['M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14'].includes(familyId)) {
    return 'preparation_to_effort_down';
  }
  return 'preparation_to_effort_up';
}

function viewObservationPlan(actionId, viewId, relations, familyId, laterality, equipmentTopology) {
  const sideView = ['left_side', 'right_side'].includes(viewId);
  const frontOrRearView = ['front', 'rear'].includes(viewId);
  const oblique = viewId.includes('45');
  const taskPrimary = relations.find((candidate) => candidate.role === 'task_primary');
  if (!taskPrimary) throw new Error(`missing task primary for view plan ${viewId}`);
  const primaryUsesRigidAxis = taskPrimary.inputs.some((input) => input.source === 'equipment_axis_center');
  const primaryUsesPairedIndependentLoads = taskPrimary.inputs.some((input) => input.source === 'dumbbell_center')
    && ['bilateral_synchronous', 'independent_bilateral'].includes(laterality);
  const primaryUsesPairedMachineHandles = taskPrimary.inputs.some((input) => input.source === 'machine_handle_center')
    && ['bilateral_synchronous', 'independent_bilateral'].includes(laterality);
  const primaryUsesProjectedAxialRotation = taskPrimary.operatorId === 'projected_shoulder_rotation';
  const primaryUsesFrontalTranslation = familyId === 'M24'
    || actionId.includes('fly')
    || /(^|_)lateral_/.test(actionId)
    || actionId.includes('side_step')
    || actionId.includes('lateral_walk')
    || actionId.includes('crossover_side_step')
    || JACK_ACTIONS.has(actionId);
  const primaryUsesSagittalLocomotion = [
    'walking_lunge',
    'alternating_forward_lunge',
    'alternating_reverse_lunge',
  ].includes(actionId);
  // A bilateral primary relation may designate a left landmark as its stable
  // representation while still be observed through its right counterpart.
  // That naming convention is not evidence that a right-side camera cannot
  // observe the relation. Only a truly unilateral, named-side primary has no
  // declared mirrored counterpart to use in that projection.
  const primaryUsesContralateralNamedJoint = laterality === 'unilateral'
    && viewId === 'right_side'
    && taskPrimary.inputs.some((input) => input.source.startsWith('left_'));
  // This is a geometric observation contract, not a maturity label. A
  // camera looking down the bar axis cannot express its required 2-D axis
  // displacement; a side-on paired-dumbbell view cannot establish both
  // independent load centers. The caller receives a typed exact-context
  // refusal instead of running a pose/wrist substitute.
  const primaryVisible = !(sideView && (
    primaryUsesRigidAxis
    || primaryUsesPairedIndependentLoads
    || primaryUsesPairedMachineHandles
    || primaryUsesContralateralNamedJoint
    || primaryUsesProjectedAxialRotation
    || primaryUsesFrontalTranslation
  )) && !(frontOrRearView && primaryUsesSagittalLocomotion);
  const visibleRelationIds = relations
    .filter((candidate) => {
      if (candidate.relationId === taskPrimary.relationId) return primaryVisible;
      return !sideView || candidate.role !== 'substitution_guard';
    })
    .map((candidate) => candidate.relationId);
  const prohibitedRelationIds = relations
    .filter((candidate) => !visibleRelationIds.includes(candidate.relationId))
    .map((candidate) => candidate.relationId);
  const risks = [
    ...(sideView ? ['contralateral_joint_occlusion', 'depth_foreshortening'] : []),
    ...(!primaryVisible ? ['identity_primary_projection_collapse'] : []),
    ...(frontOrRearView && primaryUsesSagittalLocomotion ? ['sagittal_step_depth_foreshortening'] : []),
    ...(oblique ? ['asymmetric_projective_scale'] : []),
    ...(['free_rigid_barbell', 'smith_guided_bar'].includes(equipmentTopology) ? ['equipment_background_confusion'] : []),
  ];
  return {
    viewId,
    visibleRelationIds,
    prohibitedRelationIds,
    prohibitedSignalSources: primaryVisible ? [] : taskPrimary.inputs.map((input) => input.source),
    occlusionRisks: risks,
    primaryRelationCandidates: primaryVisible ? [taskPrimary.relationId] : [],
    sideObservability: sideView
      ? 'near_side_projected'
      : laterality === 'bilateral_rigid' || laterality === 'independent_bilateral'
        ? 'bilateral_projected'
        : 'selected_side_projected',
    equipmentObservability: SDK_TRACKED_EQUIPMENT.has(equipmentTopology)
      ? 'independent_visual_observation_required'
      : equipmentTopology === 'none'
        ? 'not_applicable'
        : 'declared_optional_provider_unavailable',
    supportObservability: sideView ? 'partial_projected' : 'projected',
    localAxisPolicy: `action_local_sign_invariant_round_trip:${preparationToEffortDirection(actionId, familyId, viewId)}`,
    preparationToEffortDirection: preparationToEffortDirection(actionId, familyId, viewId),
    dimensionAvailability: visibleRelationIds,
    repTopology: topologyParameters(actionId, familyId, laterality, equipmentTopology, viewId),
  };
}

function phasesForAction(actionId) {
  if (actionId === 'box_squat') return [
    { phaseId: 'descent', from: 'start', to: 'bottom_pause_entry' },
    { phaseId: 'visible_bottom_pause', from: 'bottom_pause_entry', to: 're_ascent' },
    { phaseId: 'ascent', from: 're_ascent', to: 'standing_return' },
  ];
  if (actionId === 'walking_lunge') return [
    { phaseId: 'step_placement', from: 'start', to: 'lead_foot_plant' },
    { phaseId: 'descent', from: 'lead_foot_plant', to: 'bottom' },
    { phaseId: 'rise', from: 'bottom', to: 'standing_transfer' },
    { phaseId: 'forward_continuation', from: 'standing_transfer', to: 'next_step_ready' },
  ];
  if (['alternating_forward_lunge', 'alternating_reverse_lunge'].includes(actionId)) return [
    { phaseId: 'step_placement', from: 'start', to: 'lead_foot_plant' },
    { phaseId: 'descent', from: 'lead_foot_plant', to: 'bottom' },
    { phaseId: 'rise', from: 'bottom', to: 'standing_transfer' },
    { phaseId: 'step_recovery', from: 'standing_transfer', to: 'center_ready' },
  ];
  if (LOCOMOTION_STEP_ACTIONS.has(actionId)) return [
    { phaseId: 'step_departure', from: 'start', to: 'foot_departure' },
    { phaseId: 'step_placement', from: 'foot_departure', to: 'foot_placement' },
    { phaseId: 'step_recovery', from: 'foot_placement', to: 'next_step_ready' },
  ];
  return [
    { phaseId: 'outbound', from: 'start', to: 'turnaround' },
    { phaseId: 'return', from: 'turnaround', to: 'return' },
  ];
}

function allowedClaimsForAction(equipmentTopology, relations) {
  return [
    'task_completion',
    'observation_confidence',
    ...(relations.some((candidate) => ['joint_angle', 'projected_shoulder_rotation'].includes(candidate.operatorId)) ? ['joint_motion_facts'] : []),
    ...(SDK_TRACKED_EQUIPMENT.has(equipmentTopology) ? ['equipment_trajectory_facts'] : []),
  ];
}

function bodyPrimarySource(familyId) {
  if (['M01', 'M02', 'M03', 'M04', 'M06', 'M07'].includes(familyId)) return 'left_wrist';
  if (familyId === 'M05') return 'shoulder_midpoint';
  if (['M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14', 'M30'].includes(familyId)) return 'hip_midpoint';
  if (['M15', 'M16', 'M17', 'M18', 'M19', 'M20', 'M21', 'M22', 'M23', 'M24', 'M25', 'M26'].includes(familyId)) return 'left_wrist';
  if (familyId === 'M27' || familyId === 'M28') return 'left_ankle';
  return 'shoulder_midpoint';
}

function primarySource(equipmentTopology, actionId, familyId) {
  if (actionId === 'band_assisted_pull_up') return 'shoulder_midpoint';
  if (actionId === 'resistance_band_lateral_walk') return 'hip_midpoint';
  if (equipmentTopology === 'free_rigid_barbell' || equipmentTopology === 'smith_guided_bar') return 'equipment_axis_center';
  if (equipmentTopology === 'independent_dumbbell') return 'dumbbell_center';
  if (equipmentTopology === 'constrained_machine_handle') return 'machine_handle_center';
  return bodyPrimarySource(familyId);
}

function isEquipmentSource(source) {
  return [
    'equipment',
    'dumbbell',
    'machine_handle',
    'cable_handle',
    'landmine',
    'trap_bar',
    'kettlebell',
    'band_attachment',
    'weight_plate',
    'single_load',
    'fixed_support',
  ].some((token) => source.includes(token));
}

function evidenceRationale(actionId, role, source, equipmentTopology) {
  if (role === 'task_primary') {
    if (SDK_TRACKED_EQUIPMENT.has(equipmentTopology)) {
      return `这是 ${actionId} 的身份主关系；真实器械轨迹定义 Rep 方向与端点，骨架只能独立佐证，缺失或冲突时不得确认 Rep。`;
    }
    if (equipmentTopology !== 'none' && equipmentTopology !== 'bodyweight_station') {
      return `这是 ${actionId} 当前版本的身份主关系；对应器械尚无独立 Provider，因此显式以骨架定义 Rep，器械轨迹保留为不可判维度且不得由手腕或骨架伪装。`;
    }
    return `这是 ${actionId} 的身份主关系；该身体轨迹定义 Rep 方向与端点，缺失时不能由其他可见关节替代确认。`;
  }
  if (role === 'coordinated_motion') {
    return `该数据为 ${actionId} 的独立协同证据，用于确认主运动与关节/负载在同一阶段发生，而不是单独计次。`;
  }
  if (role === 'stability_relation') {
    return `该数据用于区分 ${actionId} 的任务运动与支撑/躯干漂移；缺失只限制稳定性判断，不得反向制造 Rep。`;
  }
  if (role === 'substitution_guard') {
    return `该数据用于识别可能替代 ${actionId} 主关节任务的身体运动；只有与主运动同相且持续时才支持代偿解释。`;
  }
  return `该数据锚定 ${actionId} 的器械或支撑上下文；它约束解释范围，但不单独产生 Rep。`;
}

function expectedPattern(role, semanticStatement, repBoundary) {
  if (role === 'task_primary') return `${repBoundary}；主关系必须离开起点、在动作端点反转并返回起点走廊。`;
  if (role === 'coordinated_motion') return `${semanticStatement}；与 TaskPrimary 保持声明的阶段顺序，并在对应端点附近发生一致反转。`;
  if (role === 'stability_relation') return `${semanticStatement}；在动作局部坐标内保持在动作资产走廊，不能用画面绝对静止判断。`;
  if (role === 'substitution_guard') return `${semanticStatement}；仅在同相、持续且超过适用规则时形成代偿证据。`;
  return `${semanticStatement}；作为动作上下文锚点保留，不独立推进 Rep 状态。`;
}

function relation(relationId, role, semanticStatement, required, identityDefining, source, context) {
  return {
    relationId,
    role,
    operatorId: isEquipmentSource(source) ? 'equipment_axis_displacement' : 'point_displacement',
    inputs: [{ source, valueType: 'point2d', unit: 'normalized_image' }],
    outputType: 'scalar',
    unit: 'local_scale_ratio',
    scope: 'rep',
    required,
    identityDefining,
    semanticStatement: semanticStatement ?? '',
    evidenceRationale: evidenceRationale(context.actionId, role, source, context.equipmentTopology),
    expectedPattern: expectedPattern(role, semanticStatement ?? '', context.repBoundary),
  };
}

const OPTIONAL_EQUIPMENT_TRAJECTORIES = {
  independent_dumbbell: {
    source: 'dumbbell_center',
    statement: '左右哑铃中心必须保持独立测量并作为负载稳定性/协同证据；它们不能替代身体主关系计次。',
  },
  cable_handle: {
    source: 'cable_handle_center',
    statement: '真实绳索手柄中心应沿拉索约束方向运动，并与动作主骨架关系在端点附近一致反转。',
  },
  landmine_lever: {
    source: 'landmine_load_point',
    statement: '地雷管负载端应围绕固定支点形成弧形轨迹，不能被解释为自由直线负载。',
  },
  trap_bar: {
    source: 'trap_bar_center',
    statement: '陷阱杠刚体中心应在身体两侧保持共同运动，不能套用直杠相对小腿轨迹。',
  },
  kettlebell: {
    source: 'kettlebell_center',
    statement: '壶铃负载中心应与声明的活动侧或身体中线保持动作特定轨迹。',
  },
  resistance_band: {
    source: 'band_attachment_point',
    statement: '弹力带可见连接点与拉伸方向应作为助力/阻力上下文，不从骨架估算弹力。',
  },
  weight_plate: {
    source: 'weight_plate_center',
    statement: '杠铃片中心应作为单一自由负载独立追踪，并与主骨架关系同步反转。',
  },
  generic_single_free_load: {
    source: 'single_load_center',
    statement: '单一自由负载中心应相对活动侧关节或身体中线独立追踪。',
  },
  bodyweight_station: {
    source: 'fixed_support_anchor',
    statement: '固定横杆、双杠或支撑面应作为空间锚点；身体相对锚点运动，锚点本身不成为身体轨迹。',
  },
};

function optionalEquipmentRelation(actionId, equipmentTopology, repBoundary) {
  const declaration = OPTIONAL_EQUIPMENT_TRAJECTORIES[equipmentTopology];
  if (!declaration) return null;
  const role = equipmentTopology === 'bodyweight_station' ? 'context_anchor' : 'coordinated_motion';
  const value = relation(
    'declared_equipment_trajectory',
    role,
    declaration.statement,
    false,
    false,
    declaration.source,
    { actionId, equipmentTopology, repBoundary },
  );
  value.evidenceRationale = SDK_TRACKED_EQUIPMENT.has(equipmentTopology)
    ? `该轨迹由 Rust 选择的独立 Provider 观测，只佐证 ${actionId} 的负载协同/稳定性；缺失时保持 cannot_judge，不得绑架骨架主关系计次。`
    : `该轨迹保留 ${actionId} 的真实器械/支撑语义；当前无独立 Provider 时保持 unknown，不得由手腕或骨架伪装，也不阻断显式的骨架主关系计次。`;
  return value;
}

const point = (source) => ({ source, valueType: 'point2d', unit: 'normalized_image' });
const segment = (source) => ({ source, valueType: 'segment2d', unit: 'normalized_image' });
const roleSpec = (relationId, role, operatorId, inputs, unit) => ({
  relationId,
  role,
  operatorId,
  inputs,
  outputType: 'scalar',
  unit,
  scope: 'rep',
  required: false,
  identityDefining: false,
  requiredPhaseId: null,
  phaseAlignment: 'unconstrained',
  sidePolicy: 'declared',
  temporalPattern: 'round_trip',
  minimumMagnitudeMilli: 0,
});
const elbow = (prefix = 'left') => [point(`${prefix}_shoulder`), point(`${prefix}_elbow`), point(`${prefix}_wrist`)];
const knee = (prefix = 'left') => [point(`${prefix}_hip`), point(`${prefix}_knee`), point(`${prefix}_ankle`)];
const hip = (prefix = 'left') => [point(`${prefix}_shoulder`), point(`${prefix}_hip`), point(`${prefix}_knee`)];

function reviewedFamilyRoleSpecs(familyId) {
  if (['M01', 'M02', 'M03', 'M04'].includes(familyId)) return [
    roleSpec('elbow_flexion_coordination', 'coordinated_motion', 'joint_angle', elbow(), 'radians'),
    roleSpec('torso_angle_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('hip_drive_substitution', 'substitution_guard', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
  ];
  if (['M05', 'M06', 'M07'].includes(familyId)) return [
    roleSpec('elbow_or_shoulder_pull_coordination', 'coordinated_motion', 'joint_angle', elbow(), 'radians'),
    roleSpec('torso_swing_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('hip_swing_substitution', 'substitution_guard', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
  ];
  if (['M08', 'M09', 'M10'].includes(familyId)) return [
    roleSpec('knee_flexion_extension_coordination', 'coordinated_motion', 'joint_angle', knee(), 'radians'),
    roleSpec('torso_inclination_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('shoulder_path_substitution', 'substitution_guard', 'point_displacement', [point('shoulder_midpoint')], 'local_scale_ratio'),
  ];
  if (familyId === 'M11') return [
    roleSpec('hip_extension_coordination', 'coordinated_motion', 'joint_angle', hip(), 'radians'),
    roleSpec('knee_extension_coordination', 'coordinated_motion', 'joint_angle', knee(), 'radians'),
    roleSpec('torso_load_relation_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('shoulder_hip_timing_substitution', 'substitution_guard', 'relative_distance', [point('shoulder_midpoint'), point('hip_midpoint')], 'local_scale_ratio'),
  ];
  if (familyId === 'M12') return [
    roleSpec('hip_hinge_coordination', 'coordinated_motion', 'joint_angle', hip(), 'radians'),
    roleSpec('knee_angle_stability', 'stability_relation', 'joint_angle', knee(), 'radians'),
    roleSpec('shoulder_hip_timing_substitution', 'substitution_guard', 'relative_distance', [point('shoulder_midpoint'), point('hip_midpoint')], 'local_scale_ratio'),
  ];
  if (['M13', 'M14'].includes(familyId)) return [
    roleSpec('hip_extension_coordination', 'coordinated_motion', 'joint_angle', hip(), 'radians'),
    roleSpec('knee_angle_stability', 'stability_relation', 'joint_angle', knee(), 'radians'),
    roleSpec('shoulder_translation_substitution', 'substitution_guard', 'point_displacement', [point('shoulder_midpoint')], 'local_scale_ratio'),
  ];
  if (['M15', 'M16', 'M17', 'M18'].includes(familyId)) return [
    roleSpec('elbow_press_coordination', 'coordinated_motion', 'joint_angle', elbow(), 'radians'),
    roleSpec('torso_support_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('hip_bridge_substitution', 'substitution_guard', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
  ];
  if (familyId === 'M21') return [
    {
      ...roleSpec(
        'wrist_over_shoulder_coordination',
        'coordinated_motion',
        'relative_vertical_offset',
        [point('left_wrist'), point('left_shoulder')],
        'local_scale_ratio',
      ),
      required: true,
      identityDefining: true,
      requiredPhaseId: 'outbound',
      phaseAlignment: 'at_primary_turnaround',
    },
    roleSpec('torso_overhead_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('trunk_lean_substitution', 'substitution_guard', 'point_displacement', [point('shoulder_midpoint')], 'local_scale_ratio'),
  ];
  if (['M19', 'M20'].includes(familyId)) return [
    roleSpec('elbow_overhead_coordination', 'coordinated_motion', 'joint_angle', elbow(), 'radians'),
    roleSpec('torso_overhead_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('trunk_lean_substitution', 'substitution_guard', 'point_displacement', [point('shoulder_midpoint')], 'local_scale_ratio'),
  ];
  if (['M22', 'M23', 'M24'].includes(familyId)) return [
    roleSpec('shoulder_arm_coordination', 'coordinated_motion', 'joint_angle', [point('left_hip'), point('left_shoulder'), point('left_wrist')], 'radians'),
    roleSpec('torso_lateral_stability', 'stability_relation', 'segment_angle', [segment('shoulder_hip_axis')], 'radians'),
    roleSpec('trunk_sway_substitution', 'substitution_guard', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
  ];
  if (['M25', 'M26'].includes(familyId)) return [
    roleSpec('elbow_angle_task_coordination', 'coordinated_motion', 'joint_angle', elbow(), 'radians'),
    roleSpec('upper_arm_stability', 'stability_relation', 'segment_angle', [segment('upper_arm')], 'radians'),
    roleSpec('shoulder_swing_substitution', 'substitution_guard', 'point_displacement', [point('shoulder_midpoint')], 'local_scale_ratio'),
  ];
  if (familyId === 'M27') return [
    roleSpec('knee_angle_task_coordination', 'coordinated_motion', 'joint_angle', knee(), 'radians'),
    roleSpec('hip_position_stability', 'stability_relation', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
    roleSpec('torso_shift_substitution', 'substitution_guard', 'point_displacement', [point('shoulder_midpoint')], 'local_scale_ratio'),
  ];
  if (familyId === 'M28') return [
    roleSpec('ankle_chain_coordination', 'coordinated_motion', 'joint_angle', knee(), 'radians'),
    roleSpec('knee_position_stability', 'stability_relation', 'point_displacement', [point('left_knee')], 'local_scale_ratio'),
    roleSpec('hip_bounce_substitution', 'substitution_guard', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
  ];
  if (familyId === 'M29') return [
    roleSpec('trunk_flexion_coordination', 'coordinated_motion', 'joint_angle', hip(), 'radians'),
    roleSpec('pelvis_position_stability', 'stability_relation', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
    roleSpec('hip_flexor_substitution', 'substitution_guard', 'joint_angle', knee(), 'radians'),
  ];
  return [
    roleSpec('body_translation_coordination', 'coordinated_motion', 'point_displacement', [point('hip_midpoint')], 'local_scale_ratio'),
    roleSpec('shoulder_level_stability', 'stability_relation', 'segment_angle', [segment('shoulder_axis')], 'radians'),
    roleSpec('trunk_sway_substitution', 'substitution_guard', 'point_displacement', [point('shoulder_midpoint')], 'local_scale_ratio'),
  ];
}

const definitions = leafRows.map((row) => {
  const [, actionId, rawBinding, override] = row;
  const familyId = rawBinding.match(/M\d\d/)?.[0];
  const family = families.get(familyId);
  if (!family) throw new Error(`missing family for ${actionId}: ${rawBinding}`);
  const equipmentTopology = topology(rawBinding, actionId);
  const usesProjectedAxialRotation = PROJECTED_AXIAL_ROTATION_FAMILIES.has(familyId);
  const visibleEndpointSource = primarySource(equipmentTopology, actionId, familyId);
  const sourceName = visibleEndpointSource;
  const posture = exactPosture(actionId, rawBinding, familyId);
  const laterality = exactLaterality(actionId, rawBinding, equipmentTopology);
  const support = exactSupport(posture, rawBinding, equipmentTopology);
  const supportedViews = ALL_CAPTURE_VIEWS;
  const familyRoleSpecs = reviewedFamilyRoleSpecs(familyId).map((spec) =>
    ['walking_lunge', 'alternating_forward_lunge', 'alternating_reverse_lunge'].includes(actionId)
      && spec.relationId === 'knee_flexion_extension_coordination'
      ? {
        ...spec,
        required: true,
        identityDefining: true,
        requiredPhaseId: 'descent',
        phaseAlignment: 'after_primary_turnaround',
        sidePolicy: 'active_lead_side',
      }
      : spec
  );
  if (JACK_ACTIONS.has(actionId)) {
    familyRoleSpecs.push({
      ...roleSpec(
        'wrist_opening_coordination',
        'coordinated_motion',
        'relative_distance',
        [point('left_wrist'), point('right_wrist')],
        'local_scale_ratio',
      ),
      required: true,
      identityDefining: true,
      requiredPhaseId: 'outbound',
      phaseAlignment: 'at_primary_turnaround',
    });
  }
  if (['single_leg_hip_thrust', 'single_leg_glute_bridge'].includes(actionId)) {
    familyRoleSpecs.push({
      ...roleSpec(
        'single_leg_visible_height_asymmetry',
        'context_anchor',
        'relative_vertical_offset',
        [point('left_ankle'), point('right_ankle')],
        'local_scale_ratio',
      ),
      required: true,
      identityDefining: true,
      temporalPattern: 'sustained_magnitude',
      minimumMagnitudeMilli: 120,
      semanticStatement: '左右踝必须在完整髋伸周期中保持可见高度不对称，作为单腿变式的二维代理。',
      evidenceRationale: `该静态关系只证明 ${actionId} 的可见单腿姿态，不声称足部接触或真实承重；双踝回到同高时不得确认单腿 Rep。`,
      expectedPattern: '完整 Rep 内左右踝归一化垂直差持续超过动作资产门槛；短暂抬脚或中途落回不成立。',
    });
  }
  const requiredMotion = requiredMotionForAction(actionId, familyId, family);
  const repBoundary = repBoundaryForAction(actionId, familyId, family);
  const relationContext = { actionId, equipmentTopology, repBoundary };
  const forcePosePrimary = KNEE_RAISE_ACTIONS.has(actionId)
    || LOCOMOTION_STEP_ACTIONS.has(actionId)
    || JACK_ACTIONS.has(actionId);
  const equipmentContextRelation = (!SDK_TRACKED_EQUIPMENT.has(equipmentTopology) || forcePosePrimary)
    ? optionalEquipmentRelation(actionId, equipmentTopology, repBoundary)
    : null;
  const visibleEndpointRelation = usesProjectedAxialRotation && SDK_TRACKED_EQUIPMENT.has(equipmentTopology)
    ? relation(
      'visible_equipment_endpoint_support',
      'coordinated_motion',
      '可见器械端点只记录过顶/绕肘协同阶段，不能替代肩轴向旋转身份关系。',
      false,
      false,
      visibleEndpointSource,
      relationContext,
    )
    : null;
  const taskPrimaryRelation = usesProjectedAxialRotation
    ? {
      relationId: 'task_primary',
      role: 'task_primary',
      operatorId: 'projected_shoulder_rotation',
      inputs: [point('left_shoulder'), point('left_elbow'), point('left_wrist'), point('left_hip')],
      outputType: 'scalar',
      unit: 'radians',
      scope: 'rep',
      required: true,
      identityDefining: true,
      semanticStatement: requiredMotion,
      evidenceRationale: `这是 ${actionId} 的身份主关系；Rust 使用肩—肘—腕相对躯干的投影旋转序列确认动作，单独腕位移或器械端点仍不能替代该关系。`,
      expectedPattern: `${repBoundary}；投影旋转关系必须离开起点、到达旋转端点、反向并返回起点走廊。`,
    }
    : KNEE_RAISE_ACTIONS.has(actionId)
      ? {
        relationId: 'task_primary',
        role: 'task_primary',
        operatorId: 'joint_angle',
        inputs: hip(),
        outputType: 'scalar',
        unit: 'radians',
        scope: 'rep',
        required: true,
        identityDefining: true,
        sidePolicy: 'active_lead_side',
        semanticStatement: requiredMotion,
        evidenceRationale: `这是 ${actionId} 的活动侧抬膝身份主关系；Rust 分别测量左右髋屈曲角并按活动侧封存，骨盆上下抖动不能产生 Rep。`,
        expectedPattern: `${repBoundary}；活动侧髋角必须离开准备端、到达抬膝端并返回，下一 Rep 必须切换活动侧。`,
      }
      : actionId === 'crossover_side_step'
        ? {
          relationId: 'task_primary',
          role: 'task_primary',
          operatorId: 'relative_horizontal_offset',
          inputs: [point('left_ankle'), point('right_ankle')],
          outputType: 'scalar',
          unit: 'local_scale_ratio',
          scope: 'rep',
          required: true,
          identityDefining: true,
          temporalPattern: 'cross_zero_round_trip',
          semanticStatement: requiredMotion,
          evidenceRationale: `这是 ${actionId} 的脚部越序身份主关系；带符号的左右踝横向偏移必须跨越零点并返回，单纯侧向分开不能代替交叉。`,
          expectedPattern: `${repBoundary}；左右踝横向顺序发生反转后再回到准备顺序。`,
        }
        : actionId === 'step_jack'
          ? {
            relationId: 'task_primary',
            role: 'task_primary',
            operatorId: 'relative_horizontal_offset',
            inputs: [point('left_ankle'), point('hip_midpoint')],
            outputType: 'scalar',
            unit: 'local_scale_ratio',
            scope: 'rep',
            required: true,
            identityDefining: true,
            sidePolicy: 'active_lead_side',
            semanticStatement: requiredMotion,
            evidenceRationale: `这是 ${actionId} 的活动侧踏出—回收身份主关系；Rust 分别测量左右踝相对骨盆的横向位移并按侧封存，双脚同步跳开不属于该 topology。`,
            expectedPattern: `${repBoundary}；单侧踝离开骨盆准备区后返回，下一 Rep 必须切换活动侧。`,
          }
        : LOCOMOTION_STEP_ACTIONS.has(actionId) || JACK_ACTIONS.has(actionId)
      ? {
        relationId: 'task_primary',
        role: 'task_primary',
        operatorId: 'relative_distance',
        inputs: [point('left_ankle'), point('right_ankle')],
        outputType: 'scalar',
        unit: 'local_scale_ratio',
        scope: 'rep',
        required: true,
        identityDefining: true,
        semanticStatement: requiredMotion,
        evidenceRationale: `这是 ${actionId} 的足部身份主关系；Rust 使用双踝分离—端点—回收关系形成候选，骨盆位移只能作为协同证据。`,
        expectedPattern: `${repBoundary}；双踝相对距离必须依次离开准备区、到达落地端并进入下一步准备区。`,
      }
        : relation('task_primary', 'task_primary', requiredMotion, true, true, sourceName, relationContext);
  const relations = [
    taskPrimaryRelation,
    ...(equipmentTopology === 'smith_guided_bar' ? [{
      relationId: 'smith_guide_path',
      role: 'context_anchor',
      operatorId: 'constrained_path_deviation',
      inputs: [point('equipment_axis_center')],
      outputType: 'scalar',
      unit: 'local_scale_ratio',
      scope: 'rep',
      required: true,
      identityDefining: true,
      semanticStatement: 'the independently observed rigid-bar center remains inside the exact action-view constrained-path corridor',
      evidenceRationale: `史密斯约束路径是 ${actionId} 的可见身份佐证；Rust 只检查独立杠铃中心的二维路径走廊，不把骨架轨迹当成导轨，也不声称恢复了真实导轨几何。`,
      expectedPattern: '杠铃中心在 Rep 全程的横轴跨度不超过 action×view 声明的二维走廊；越界或缺失不得由骨架修补。',
    }] : []),
    ...familyRoleSpecs.map((spec) => ({
      ...spec,
      semanticStatement: spec.semanticStatement || (spec.role === 'coordinated_motion'
        ? (family.coordinated_motion ?? '')
        : spec.role === 'stability_relation'
          ? (family.stability_relations ?? '')
          : (family.substitution_relations ?? '')),
      evidenceRationale: spec.evidenceRationale
        || evidenceRationale(actionId, spec.role, spec.inputs[0].source, equipmentTopology),
      expectedPattern: spec.expectedPattern || expectedPattern(
        spec.role,
        spec.role === 'coordinated_motion'
          ? (family.coordinated_motion ?? '')
          : spec.role === 'stability_relation'
            ? (family.stability_relations ?? '')
            : (family.substitution_relations ?? ''),
        repBoundary,
      ),
    })),
    ...(equipmentContextRelation ? [equipmentContextRelation] : []),
    ...(visibleEndpointRelation ? [visibleEndpointRelation] : []),
  ].map((candidate) => ({
    relationId: candidate.relationId,
    role: candidate.role,
    operatorId: candidate.operatorId,
    inputs: candidate.inputs,
    outputType: candidate.outputType,
    unit: candidate.unit,
    scope: candidate.scope,
    required: candidate.required,
    identityDefining: candidate.identityDefining,
    requiredPhaseId: candidate.requiredPhaseId ?? null,
    phaseAlignment: candidate.phaseAlignment ?? 'unconstrained',
    sidePolicy: candidate.sidePolicy ?? 'declared',
    temporalPattern: candidate.temporalPattern ?? 'round_trip',
    minimumMagnitudeMilli: candidate.minimumMagnitudeMilli ?? 0,
    semanticStatement: candidate.semanticStatement,
    evidenceRationale: candidate.evidenceRationale,
    expectedPattern: candidate.expectedPattern,
  }));
  const taskPrimarySupport = relations
    .filter((candidate) => candidate.relationId === 'task_primary' || candidate.relationId === 'smith_guide_path')
    .map((candidate) => candidate.relationId);
  const poseSupport = relations
    .filter((candidate) => candidate.inputs.some((input) => !isEquipmentSource(input.source)))
    .map((candidate) => candidate.relationId);
  const primaryRequiresEquipment = taskPrimaryRelation.inputs.some((input) =>
    isEquipmentSource(input.source)
  );
  const definition = {
    schemaVersion: 'maxpower.action-motion-definition/v1',
    definitionId: `maxpower/action-motion/${actionId}/v1`,
    actionId,
    exactIdentity: { movementFamily: familyId, posture, support, equipmentTopology, laterality, setup: rawBinding.trim() },
    variantStatement: override.trim(),
    executableLeaf: true,
    relations,
    tracks: [
      {
        trackId: 'task_primary_track',
        source: usesProjectedAxialRotation
          ? 'pose_projected_shoulder_rotation'
          : KNEE_RAISE_ACTIONS.has(actionId)
            ? 'pose_active_hip_flexion'
          : actionId === 'crossover_side_step'
            ? 'pose_ankle_crossing'
          : actionId === 'step_jack'
            ? 'pose_active_ankle_offset'
          : LOCOMOTION_STEP_ACTIONS.has(actionId)
            ? 'pose_ankle_separation'
            : JACK_ACTIONS.has(actionId)
              ? 'pose_ankle_separation'
            : sourceName.replace('_center', ''),
        role: 'primary',
        required: true,
        identityDefining: true,
        sideScope: laterality,
        supportsRelationIds: taskPrimarySupport,
        evidenceRationale: usesProjectedAxialRotation
          ? `该轨迹只代表 ${actionId} 的二维投影肩旋转身份证据；它不声称恢复真实三维肱骨轴角，也不能由单独端点轨迹补齐。`
          : KNEE_RAISE_ACTIONS.has(actionId)
            ? `该轨迹只代表 ${actionId} 的左右髋屈曲角及活动侧切换；骨盆抖动和可选负载轨迹都不能替代该身体主关系。`
          : actionId === 'crossover_side_step'
            ? `该轨迹只代表 ${actionId} 的带符号双踝横向顺序；只有跨越零点并返回才能形成交叉步，普通分腿或并腿不能替代。`
          : actionId === 'step_jack'
            ? `该轨迹只代表 ${actionId} 的活动侧踝相对骨盆踏出与回收；双脚同步跳开不属于这条交替侧身份链。`
          : LOCOMOTION_STEP_ACTIONS.has(actionId)
            ? `该轨迹只代表 ${actionId} 的双踝分离与回收身份关系；骨盆平移或单脚抖动不能单独形成一步。`
          : evidenceRationale(actionId, 'task_primary', sourceName, equipmentTopology),
      },
      {
        trackId: 'pose_corroboration',
        source: 'pose',
        role: 'corroborating',
        required: false,
        identityDefining: false,
        sideScope: laterality,
        supportsRelationIds: poseSupport,
        evidenceRationale: `骨架轨迹提供 ${actionId} 的关节、身体与支撑关系；它只支持列出的 relation，不能伪装成任何器械观测。`,
      },
      ...(equipmentContextRelation ? [{
        trackId: 'declared_equipment_context',
        source: equipmentContextRelation.inputs[0].source.replace('_center', ''),
        role: 'corroborating',
        required: false,
        identityDefining: false,
        sideScope: laterality,
        supportsRelationIds: [equipmentContextRelation.relationId],
        evidenceRationale: `保留 ${actionId} 的真实器械/支撑语义；Provider 有独立观测时作为佐证，否则保持 unknown，不得由手腕或骨架伪装。`,
      }] : []),
      ...(visibleEndpointRelation ? [{
        trackId: 'visible_equipment_endpoint_support',
        source: visibleEndpointSource.replace('_center', ''),
        role: 'corroborating',
        required: false,
        identityDefining: false,
        sideScope: laterality,
        supportsRelationIds: [visibleEndpointRelation.relationId],
        evidenceRationale: `真实器械端点只佐证 ${actionId} 的可见阶段；它不能替代肩轴向旋转 TaskPrimary。`,
      }] : []),
    ],
    repConsensus: repConsensus(laterality, equipmentTopology),
    repBoundary: { activation: primaryRequiresEquipment ? 'grip_established' : 'pose_ready', start: 'declared_start_endpoint_departure', turnaround: repBoundary, return: 'declared_start_endpoint_return', release: primaryRequiresEquipment ? 'grip_released' : 'set_closure' },
    phases: phasesForAction(actionId),
    allowedClaims: allowedClaimsForAction(equipmentTopology, relations),
    limitedClaims: [
      family.limited_claims ?? override.trim(),
      'action、posture、equipment、laterality 与 camera view 是 set 前锁定的调用方上下文；Rust 只确认本定义中可观察的任务关系，不执行开放集动作分类，也不把未观测的上下文字段宣称为视觉验证通过。',
    ].filter(Boolean),
    recommendedView: recommendedView(familyId),
    supportedViews,
    viewObservationPlans: supportedViews.map((viewId) => viewObservationPlan(
      actionId,
      viewId,
      relations,
      familyId,
      laterality,
      equipmentTopology,
    )),
    contentHash: '',
  };
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(JSON.stringify(definition))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  definition.contentHash = hash.toString(16).padStart(16, '0');
  return definition;
});

const catalog = { schemaVersion: 'maxpower.action-motion-catalog/v1', catalogId: 'maxpower/installed-action-motion-leaves/v1', definitions };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ families: families.size, leaves: definitions.length, viewsPerLeaf: ALL_CAPTURE_VIEWS.length, outputPath }));
