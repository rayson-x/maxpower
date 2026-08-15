import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const sourcePath = resolve(root, 'docs/research/2026-08-15-expanded-action-motion-definitions.md');
const outputPath = resolve(root, 'rust/motion-sdk/assets/action-motion-catalog-v1.json');
const matrixOutputPath = resolve(root, 'rust/motion-sdk/assets/action-motion-capability-matrix-v1.json');
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

const FRONTAL_VIEWS = ['front', 'rear', 'front_left_45', 'front_right_45', 'rear_left_45', 'rear_right_45'];
const SAGITTAL_VIEWS = ['left_side', 'right_side', 'front_left_45', 'front_right_45', 'rear_left_45', 'rear_right_45'];
const FAMILY_CANDIDATE_VIEWS = {
  M01: SAGITTAL_VIEWS, M02: SAGITTAL_VIEWS, M03: SAGITTAL_VIEWS, M04: FRONTAL_VIEWS,
  M05: FRONTAL_VIEWS, M06: FRONTAL_VIEWS, M07: SAGITTAL_VIEWS,
  M08: ['front', ...SAGITTAL_VIEWS], M09: ['front', ...SAGITTAL_VIEWS],
  M10: ['front', ...SAGITTAL_VIEWS], M11: SAGITTAL_VIEWS, M12: SAGITTAL_VIEWS,
  M13: SAGITTAL_VIEWS, M14: SAGITTAL_VIEWS, M15: ['front', 'front_left_45', 'front_right_45'],
  M16: ['front', ...SAGITTAL_VIEWS], M17: ['front', ...FRONTAL_VIEWS], M18: SAGITTAL_VIEWS,
  M19: ['front', 'front_left_45', 'front_right_45'], M20: ['front', ...SAGITTAL_VIEWS],
  M21: ['front', 'front_left_45', 'front_right_45'], M22: FRONTAL_VIEWS, M23: FRONTAL_VIEWS,
  M24: ['front', ...SAGITTAL_VIEWS], M25: ['front', ...SAGITTAL_VIEWS],
  M26: ['front', ...SAGITTAL_VIEWS], M27: SAGITTAL_VIEWS,
  M28: ['front', 'rear', ...SAGITTAL_VIEWS], M29: SAGITTAL_VIEWS, M30: FRONTAL_VIEWS,
};

function primarySource(equipmentTopology, actionId) {
  if (actionId === 'band_assisted_pull_up') return 'shoulder_midpoint';
  if (actionId === 'resistance_band_lateral_walk') return 'hip_midpoint';
  if (equipmentTopology === 'free_rigid_barbell' || equipmentTopology === 'smith_guided_bar') return 'equipment_axis_center';
  if (equipmentTopology === 'independent_dumbbell') return 'dumbbell_center';
  if (equipmentTopology === 'constrained_machine_handle') return 'machine_handle_center';
  if (!['none', 'bodyweight_station'].includes(equipmentTopology)) return 'equipment_axis_center';
  return 'shoulder_midpoint';
}

function relation(relationId, role, semanticStatement, required, identityDefining, source, familyId) {
  const axialRotation = identityDefining && (familyId === 'M21' || familyId === 'M24');
  return {
    relationId,
    role,
    operatorId: axialRotation ? 'axial_rotation' : source.startsWith('equipment_') || source.includes('dumbbell') || source.includes('machine_handle') ? 'equipment_axis_displacement' : 'point_displacement',
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
  if (['M11', 'M12'].includes(familyId)) return [
    roleSpec('hip_extension_coordination', 'coordinated_motion', 'joint_angle', hip(), 'radians'),
    roleSpec('knee_extension_relation', 'stability_relation', 'joint_angle', knee(), 'radians'),
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
  const sourceName = primarySource(equipmentTopology, actionId);
  const posture = exactPosture(actionId, rawBinding, familyId);
  const laterality = exactLaterality(actionId, rawBinding, equipmentTopology);
  const support = exactSupport(posture, rawBinding, equipmentTopology);
  const admittedViewsByAction = {
    flat_barbell_bench_press: ['front', 'front_left_45', 'front_right_45'],
    pronated_barbell_row: ['front', 'front_left_45', 'front_right_45', 'rear_left_45', 'rear_right_45'],
    seated_linked_machine_chest_press: ['front', 'front_right_45'],
    seated_barbell_shoulder_press: ['front'],
    standard_push_up: ['rear_right_45'],
    wide_pronated_lat_pulldown: ['rear', 'rear_left_45'],
    pronated_pull_up: ['rear_left_45'],
    seated_bilateral_cable_row: ['front_left_45', 'rear_left_45', 'right_side'],
    standing_straight_arm_pulldown: ['front_left_45', 'front_right_45'],
    standing_bilateral_dumbbell_lateral_raise: ['front'],
    linked_machine_rear_delt_row: ['front'],
    single_arm_cable_lateral_raise: ['front_left_45', 'rear_right_45'],
    seated_arnold_press: ['front'],
    standing_arnold_press: ['front'],
  };
  const admittedViews = admittedViewsByAction[actionId] ?? [];
  const supportedViews = [...new Set([...(FAMILY_CANDIDATE_VIEWS[familyId] ?? []), ...admittedViews])];
  const familyRoleSpecs = reviewedFamilyRoleSpecs(familyId);
  const definition = {
    schemaVersion: 'maxpower.action-motion-definition/v1',
    definitionId: `maxpower/action-motion/${actionId}/v1`,
    actionId,
    exactIdentity: { movementFamily: familyId, posture, support, equipmentTopology, laterality, setup: rawBinding.trim() },
    executableLeaf: true,
    relations: [
      relation('task_primary', 'task_primary', `${family.required_motion ?? ''}；${override.trim()}`, true, true, sourceName, familyId),
      { ...familyRoleSpecs[0], semanticStatement: family.coordinated_motion ?? '' },
      { ...familyRoleSpecs[1], semanticStatement: family.stability_relations ?? '' },
      { ...familyRoleSpecs[2], semanticStatement: family.substitution_relations ?? '' },
    ],
    tracks: [
      { trackId: 'task_primary_track', source: sourceName.replace('_center', ''), role: 'primary', required: true, identityDefining: true },
      { trackId: 'pose_corroboration', source: 'pose', role: 'corroborating', required: false, identityDefining: false },
    ],
    repBoundary: { activation: equipmentTopology === 'none' || equipmentTopology === 'bodyweight_station' ? 'pose_ready' : 'grip_established', start: 'declared_start_endpoint_departure', turnaround: family.rep_boundary ?? 'declared_effort_endpoint_reversal', return: 'declared_start_endpoint_return', release: equipmentTopology === 'none' || equipmentTopology === 'bodyweight_station' ? 'set_closure' : 'grip_released' },
    phases: [{ phaseId: 'outbound', from: 'start', to: 'turnaround' }, { phaseId: 'return', from: 'turnaround', to: 'return' }],
    allowedClaims: ['task_completion', 'range_of_motion', 'phase_control', 'trajectory_control', 'support_stability', 'substitution_control'],
    supportedViews,
    admittedViews,
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
const runtimeSupportedTopologies = new Set(['free_rigid_barbell', 'smith_guided_bar', 'none', 'bodyweight_station']);
const matrix = definitions.flatMap((definition) => definition.supportedViews.map((view) => {
  const primary = definition.tracks.find((track) => track.role === 'primary' && track.identityDefining);
  const requiredEquipment = primary && ['equipment_axis', 'machine_handle', 'dumbbell', 'bar_axis'].some((token) => primary.source.includes(token));
  const unsupportedEquipment = requiredEquipment && !runtimeSupportedTopologies.has(definition.exactIdentity.equipmentTopology);
  const admittedView = definition.admittedViews.includes(view);
  const missingIdentityOperator = definition.relations.some((relation) => relation.required && relation.identityDefining && relation.operatorId === 'axial_rotation');
  let capabilityState = 'full_plan_compiled';
  let refusalReason = null;
  if (unsupportedEquipment) {
    capabilityState = 'unsupported_equipment_catalog_only';
    refusalReason = `runtime adapter unavailable for ${definition.exactIdentity.equipmentTopology}`;
  } else if (!admittedView) {
    capabilityState = 'admissible_visual_refusal';
    refusalReason = 'exact view lacks admitted observability evidence';
  } else if (missingIdentityOperator) {
    capabilityState = 'admissible_visual_refusal';
    refusalReason = 'identity-defining axial rotation operator unavailable';
  }
  return {
    definitionId: definition.definitionId,
    definitionHash: definition.contentHash,
    actionId: definition.actionId,
    exactIdentity: definition.exactIdentity,
    captureView: view,
    viewAdmission: admittedView ? 'known_video_regression_context' : 'semantic_candidate_only',
    definitionComplete: true,
    capabilityState,
    planResult: capabilityState === 'full_plan_compiled' ? 'compiled_not_lifecycle_validated' : 'refused',
    repLifecycle: 'not_validated_for_this_exact_leaf_view',
    qualityDimensions: 'not_validated_for_this_exact_leaf_view',
    causalTrace: 'not_validated_for_this_exact_leaf_view',
    userOpen: false,
    refusalReason,
  };
}));
writeFileSync(matrixOutputPath, `${JSON.stringify({ schemaVersion: 'maxpower.action-motion-capability-matrix/v1', catalogId: catalog.catalogId, records: matrix }, null, 2)}\n`);
console.log(JSON.stringify({ families: families.size, leaves: definitions.length, matrixRecords: matrix.length, outputPath, matrixOutputPath }));
