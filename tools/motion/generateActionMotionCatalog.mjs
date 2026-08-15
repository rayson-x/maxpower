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

// These are semantic action-family defaults materialized into every exact
// action × view asset. They intentionally live in generated data rather than
// a Rust action-name switch. Values are provisional candidate parameters,
// not quality standards; the replay/acceptance protocol owns their tuning.
function topologyParameters(familyId, laterality, equipmentTopology, viewId) {
  const lowerBody = ['M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14'].includes(familyId);
  const smallArmPath = ['M22', 'M23', 'M24', 'M25', 'M26', 'M28', 'M29'].includes(familyId);
  const topologyId = laterality === 'alternating'
    ? 'alternating_cycle/v1'
    : laterality === 'unilateral'
      ? 'unilateral_cycle/v1'
      : laterality === 'independent_bilateral'
        ? 'independent_bilateral_cycle/v1'
        : equipmentTopology === 'none' || equipmentTopology === 'bodyweight_station'
          ? 'pose_primary_cycle/v1'
          : 'bilateral_synchronous_cycle/v1';
  const base = lowerBody
    ? { start: 45, excursion: 130, hysteresis: 45, return: 85, ready: 35, dwell: 300, gap: 900, minDuration: 500, maxDuration: 9000 }
    : smallArmPath
      ? { start: 35, excursion: 100, hysteresis: 35, return: 70, ready: 28, dwell: 250, gap: 650, minDuration: 350, maxDuration: 6500 }
      : { start: 50, excursion: 140, hysteresis: 50, return: 80, ready: 35, dwell: 300, gap: 750, minDuration: 400, maxDuration: 8000 };
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
    readyToleranceMilli: base.ready,
    minimumPhaseDwellMs: base.dwell,
    maximumGapMs: base.gap,
    minimumRepDurationMs: base.minDuration,
    maximumRepDurationMs: base.maxDuration,
  };
}

function viewObservationPlan(viewId, relations, familyId, laterality, equipmentTopology) {
  const sideView = ['left_side', 'right_side'].includes(viewId);
  const oblique = viewId.includes('45');
  const taskPrimary = relations.find((candidate) => candidate.role === 'task_primary');
  if (!taskPrimary) throw new Error(`missing task primary for view plan ${viewId}`);
  const primaryUsesRigidAxis = taskPrimary.inputs.some((input) => input.source === 'equipment_axis_center');
  const primaryUsesPairedIndependentLoads = taskPrimary.inputs.some((input) => input.source === 'dumbbell_center')
    && ['bilateral_synchronous', 'independent_bilateral'].includes(laterality);
  const primaryUsesPairedMachineHandles = taskPrimary.inputs.some((input) => input.source === 'machine_handle_center')
    && ['bilateral_synchronous', 'independent_bilateral'].includes(laterality);
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
  ));
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
      : 'not_required_for_primary',
    supportObservability: sideView ? 'partial_projected' : 'projected',
    localAxisPolicy: 'action_local_sign_invariant_round_trip',
    dimensionAvailability: visibleRelationIds,
    repTopology: topologyParameters(familyId, laterality, equipmentTopology, viewId),
  };
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

function relation(relationId, role, semanticStatement, required, identityDefining, source, familyId) {
  return {
    relationId,
    role,
    operatorId: source.startsWith('equipment_') || source.includes('dumbbell') || source.includes('machine_handle') ? 'equipment_axis_displacement' : 'point_displacement',
    inputs: [{ source, valueType: 'point2d', unit: 'normalized_image' }],
    outputType: 'scalar',
    unit: 'local_scale_ratio',
    scope: 'rep',
    required,
    identityDefining,
    semanticStatement: semanticStatement ?? '',
  };
}

const point = (source) => ({ source, valueType: 'point2d', unit: 'normalized_image' });
const segment = (source) => ({ source, valueType: 'segment2d', unit: 'normalized_image' });
const roleSpec = (relationId, role, operatorId, inputs, unit) => ({ relationId, role, operatorId, inputs, outputType: 'scalar', unit, scope: 'rep', required: false, identityDefining: false });
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
  if (['M19', 'M20', 'M21'].includes(familyId)) return [
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
  const sourceName = primarySource(equipmentTopology, actionId, familyId);
  const posture = exactPosture(actionId, rawBinding, familyId);
  const laterality = exactLaterality(actionId, rawBinding, equipmentTopology);
  const support = exactSupport(posture, rawBinding, equipmentTopology);
  const supportedViews = ALL_CAPTURE_VIEWS;
  const familyRoleSpecs = reviewedFamilyRoleSpecs(familyId);
  const relations = [
    relation('task_primary', 'task_primary', `${family.required_motion ?? ''}；${override.trim()}`, true, true, sourceName, familyId),
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
      semanticStatement: 'the observed rigid bar center remains expressed relative to the declared Smith guide path',
    }] : []),
    ...familyRoleSpecs.map((spec) => ({
      ...spec,
      semanticStatement: spec.role === 'coordinated_motion'
        ? (family.coordinated_motion ?? '')
        : spec.role === 'stability_relation'
          ? (family.stability_relations ?? '')
          : (family.substitution_relations ?? ''),
    })),
  ];
  const definition = {
    schemaVersion: 'maxpower.action-motion-definition/v1',
    definitionId: `maxpower/action-motion/${actionId}/v1`,
    actionId,
    exactIdentity: { movementFamily: familyId, posture, support, equipmentTopology, laterality, setup: rawBinding.trim() },
    executableLeaf: true,
    relations,
    tracks: [
      { trackId: 'task_primary_track', source: sourceName.replace('_center', ''), role: 'primary', required: true, identityDefining: true, sideScope: laterality },
      { trackId: 'pose_corroboration', source: 'pose', role: 'corroborating', required: false, identityDefining: false, sideScope: laterality },
    ],
    repConsensus: repConsensus(laterality, equipmentTopology),
    repBoundary: { activation: SDK_TRACKED_EQUIPMENT.has(equipmentTopology) ? 'grip_established' : 'pose_ready', start: 'declared_start_endpoint_departure', turnaround: family.rep_boundary ?? 'declared_effort_endpoint_reversal', return: 'declared_start_endpoint_return', release: SDK_TRACKED_EQUIPMENT.has(equipmentTopology) ? 'grip_released' : 'set_closure' },
    phases: [{ phaseId: 'outbound', from: 'start', to: 'turnaround' }, { phaseId: 'return', from: 'turnaround', to: 'return' }],
    allowedClaims: ['task_completion', 'range_of_motion', 'phase_control', 'trajectory_control', 'support_stability', 'substitution_control'],
    supportedViews,
    viewObservationPlans: supportedViews.map((viewId) => viewObservationPlan(viewId, relations, familyId, laterality, equipmentTopology)),
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

const catalog = { schemaVersion: 'maxpower.action-motion-catalog/v1', catalogId: 'maxpower/reviewed-action-motion-leaves/v1', definitions };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ families: families.size, leaves: definitions.length, viewsPerLeaf: ALL_CAPTURE_VIEWS.length, outputPath }));
