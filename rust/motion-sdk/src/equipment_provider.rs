//! Extensible, cross-platform equipment observation provider seam.
//!
//! Action contracts select a provider id from equipment topology. Providers
//! own only same-frame visual observations; subject association, grip,
//! canonical fusion, Rep eligibility and quality remain downstream Rust
//! authorities. A provider must never manufacture equipment from pose.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::{
    BarbellAxisObservation, BarbellAxisVisualTracker, EquipmentObservation, PointEquipmentMode,
    PointEquipmentVisualTracker, PoseCandidate, PoseSchemaId, VisualEquipmentError,
};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EquipmentProviderId {
    VisualRigidBarAxisV1,
    VisualIndependentDumbbellsV1,
    VisualMachineHandlesV1,
}

impl EquipmentProviderId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::VisualRigidBarAxisV1 => "visual_rigid_bar_axis_v1",
            Self::VisualIndependentDumbbellsV1 => "visual_independent_dumbbells_v1",
            Self::VisualMachineHandlesV1 => "visual_machine_handles_v1",
        }
    }

    pub const fn ffi_code(self) -> u32 {
        match self {
            Self::VisualRigidBarAxisV1 => 1,
            Self::VisualIndependentDumbbellsV1 => 2,
            Self::VisualMachineHandlesV1 => 3,
        }
    }

    pub const fn from_ffi_code(code: u32) -> Option<Self> {
        match code {
            1 => Some(Self::VisualRigidBarAxisV1),
            2 => Some(Self::VisualIndependentDumbbellsV1),
            3 => Some(Self::VisualMachineHandlesV1),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EquipmentProviderTopology {
    RigidBarAxis,
    IndependentDumbbells,
    ConstrainedMachineHandle,
    CableHandle,
    UnilateralCableHandle,
    LandminePivot,
    TrapBar,
    Kettlebell,
    ResistanceBand,
    WeightPlate,
    FixedSupport,
    BodyOnly,
}

/// Stable provider selection used while compiling an action contract. Missing
/// provider support is represented by `None`; it is not an action capability
/// tier and never authorizes pose to masquerade as equipment.
pub const fn standard_equipment_provider(
    topology: EquipmentProviderTopology,
) -> Option<EquipmentProviderId> {
    match topology {
        EquipmentProviderTopology::RigidBarAxis => Some(EquipmentProviderId::VisualRigidBarAxisV1),
        EquipmentProviderTopology::IndependentDumbbells => {
            Some(EquipmentProviderId::VisualIndependentDumbbellsV1)
        }
        EquipmentProviderTopology::ConstrainedMachineHandle => {
            Some(EquipmentProviderId::VisualMachineHandlesV1)
        }
        EquipmentProviderTopology::CableHandle
        | EquipmentProviderTopology::UnilateralCableHandle
        | EquipmentProviderTopology::LandminePivot
        | EquipmentProviderTopology::TrapBar
        | EquipmentProviderTopology::Kettlebell
        | EquipmentProviderTopology::ResistanceBand
        | EquipmentProviderTopology::WeightPlate
        | EquipmentProviderTopology::FixedSupport
        | EquipmentProviderTopology::BodyOnly => None,
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EquipmentProviderDescriptor {
    pub provider_id: EquipmentProviderId,
    pub supported_topologies: Vec<EquipmentProviderTopology>,
    pub requires_luma: bool,
    pub requires_pose_context: bool,
}

pub struct EquipmentProviderFrameInput<'a> {
    pub schema: PoseSchemaId,
    pub luma: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub timestamp_ms: u64,
    /// Pose may restrict a broad subject ROI. Implementations must not use it
    /// to create, move, rotate, crop or promote measured equipment geometry.
    pub subjects: &'a [PoseCandidate],
}

#[derive(Clone, Debug, PartialEq)]
pub struct EquipmentProviderFrameEvidence {
    pub provider_id: EquipmentProviderId,
    pub raw_observations: Vec<EquipmentObservation>,
    /// Optional renderer-only rigid-axis continuity. Canonical fusion consumes
    /// only `raw_observations` and independently checks provenance.
    pub display_axis: Option<BarbellAxisObservation>,
}

pub trait EquipmentObservationProvider: Send {
    fn descriptor(&self) -> &EquipmentProviderDescriptor;

    fn process_frame(
        &mut self,
        input: EquipmentProviderFrameInput<'_>,
    ) -> Result<EquipmentProviderFrameEvidence, VisualEquipmentError>;

    fn reset(&mut self);
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EquipmentProviderRegistryError {
    DuplicateProvider(EquipmentProviderId),
    DuplicateTopology(EquipmentProviderTopology),
    UnknownProvider(EquipmentProviderId),
}

/// Stateful provider registry used by native and WASM hosts.
///
/// The interface is intentionally small: resolve topology, process one frame,
/// reset. Tracker selection and implementation-specific state stay private.
pub struct EquipmentProviderRegistry {
    providers: HashMap<EquipmentProviderId, Box<dyn EquipmentObservationProvider>>,
    topology_index: HashMap<EquipmentProviderTopology, EquipmentProviderId>,
}

impl EquipmentProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
            topology_index: HashMap::new(),
        }
    }

    pub fn standard() -> Self {
        let mut registry = Self::new();
        registry
            .register(Box::new(RigidBarProvider::new()))
            .expect("built-in rigid-bar provider registration is unique");
        registry
            .register(Box::new(PointProvider::new(
                EquipmentProviderId::VisualIndependentDumbbellsV1,
                EquipmentProviderTopology::IndependentDumbbells,
                PointEquipmentMode::Dumbbell,
            )))
            .expect("built-in dumbbell provider registration is unique");
        registry
            .register(Box::new(PointProvider::new(
                EquipmentProviderId::VisualMachineHandlesV1,
                EquipmentProviderTopology::ConstrainedMachineHandle,
                PointEquipmentMode::MachineHandle,
            )))
            .expect("built-in machine-handle provider registration is unique");
        registry
    }

    pub fn register(
        &mut self,
        provider: Box<dyn EquipmentObservationProvider>,
    ) -> Result<(), EquipmentProviderRegistryError> {
        let descriptor = provider.descriptor();
        if self.providers.contains_key(&descriptor.provider_id) {
            return Err(EquipmentProviderRegistryError::DuplicateProvider(
                descriptor.provider_id,
            ));
        }
        if let Some(topology) = descriptor
            .supported_topologies
            .iter()
            .find(|topology| self.topology_index.contains_key(topology))
        {
            return Err(EquipmentProviderRegistryError::DuplicateTopology(*topology));
        }
        for topology in &descriptor.supported_topologies {
            self.topology_index
                .insert(*topology, descriptor.provider_id);
        }
        self.providers.insert(descriptor.provider_id, provider);
        Ok(())
    }

    pub fn resolve(&self, topology: EquipmentProviderTopology) -> Option<EquipmentProviderId> {
        self.topology_index.get(&topology).copied()
    }

    pub fn descriptor(
        &self,
        provider_id: EquipmentProviderId,
    ) -> Option<&EquipmentProviderDescriptor> {
        self.providers
            .get(&provider_id)
            .map(|provider| provider.descriptor())
    }

    pub fn process_frame(
        &mut self,
        provider_id: EquipmentProviderId,
        input: EquipmentProviderFrameInput<'_>,
    ) -> Result<EquipmentProviderFrameEvidence, EquipmentProviderProcessError> {
        self.providers
            .get_mut(&provider_id)
            .ok_or(EquipmentProviderProcessError::UnknownProvider(provider_id))?
            .process_frame(input)
            .map_err(EquipmentProviderProcessError::Visual)
    }

    pub fn reset(&mut self) {
        for provider in self.providers.values_mut() {
            provider.reset();
        }
    }
}

impl Default for EquipmentProviderRegistry {
    fn default() -> Self {
        Self::standard()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EquipmentProviderProcessError {
    UnknownProvider(EquipmentProviderId),
    Visual(VisualEquipmentError),
}

struct RigidBarProvider {
    descriptor: EquipmentProviderDescriptor,
    tracker: BarbellAxisVisualTracker,
}

impl RigidBarProvider {
    fn new() -> Self {
        Self {
            descriptor: EquipmentProviderDescriptor {
                provider_id: EquipmentProviderId::VisualRigidBarAxisV1,
                supported_topologies: vec![EquipmentProviderTopology::RigidBarAxis],
                requires_luma: true,
                requires_pose_context: true,
            },
            tracker: BarbellAxisVisualTracker::default(),
        }
    }
}

impl EquipmentObservationProvider for RigidBarProvider {
    fn descriptor(&self) -> &EquipmentProviderDescriptor {
        &self.descriptor
    }

    fn process_frame(
        &mut self,
        input: EquipmentProviderFrameInput<'_>,
    ) -> Result<EquipmentProviderFrameEvidence, VisualEquipmentError> {
        let evidence = self.tracker.process_frame(
            input.schema,
            input.luma,
            input.width,
            input.height,
            input.timestamp_ms,
            input.subjects,
        )?;
        Ok(EquipmentProviderFrameEvidence {
            provider_id: self.descriptor.provider_id,
            raw_observations: evidence.raw_observations,
            display_axis: evidence.display_axis,
        })
    }

    fn reset(&mut self) {
        self.tracker.reset();
    }
}

struct PointProvider {
    descriptor: EquipmentProviderDescriptor,
    tracker: PointEquipmentVisualTracker,
}

impl PointProvider {
    fn new(
        provider_id: EquipmentProviderId,
        topology: EquipmentProviderTopology,
        mode: PointEquipmentMode,
    ) -> Self {
        Self {
            descriptor: EquipmentProviderDescriptor {
                provider_id,
                supported_topologies: vec![topology],
                requires_luma: true,
                requires_pose_context: true,
            },
            tracker: PointEquipmentVisualTracker::new(mode),
        }
    }
}

impl EquipmentObservationProvider for PointProvider {
    fn descriptor(&self) -> &EquipmentProviderDescriptor {
        &self.descriptor
    }

    fn process_frame(
        &mut self,
        input: EquipmentProviderFrameInput<'_>,
    ) -> Result<EquipmentProviderFrameEvidence, VisualEquipmentError> {
        let evidence = self.tracker.process_frame(
            input.schema,
            input.luma,
            input.width,
            input.height,
            input.timestamp_ms,
            input.subjects,
        )?;
        Ok(EquipmentProviderFrameEvidence {
            provider_id: self.descriptor.provider_id,
            raw_observations: evidence.raw_observations,
            display_axis: None,
        })
    }

    fn reset(&mut self) {
        self.tracker.reset();
    }
}
