use maxpower_motion_sdk::{
    EquipmentObservationProvider, EquipmentProviderDescriptor, EquipmentProviderFrameEvidence,
    EquipmentProviderFrameInput, EquipmentProviderId, EquipmentProviderRegistry,
    EquipmentProviderRegistryError, EquipmentProviderTopology, VisualEquipmentError,
    standard_equipment_provider,
};

#[test]
fn standard_registry_resolves_only_installed_provider_implementations() {
    let registry = EquipmentProviderRegistry::standard();
    for (topology, expected) in [
        (
            EquipmentProviderTopology::RigidBarAxis,
            Some(EquipmentProviderId::VisualRigidBarAxisV1),
        ),
        (
            EquipmentProviderTopology::IndependentDumbbells,
            Some(EquipmentProviderId::VisualIndependentDumbbellsV1),
        ),
        (
            EquipmentProviderTopology::ConstrainedMachineHandle,
            Some(EquipmentProviderId::VisualMachineHandlesV1),
        ),
        (EquipmentProviderTopology::CableHandle, None),
        (EquipmentProviderTopology::Kettlebell, None),
        (EquipmentProviderTopology::TrapBar, None),
        (EquipmentProviderTopology::BodyOnly, None),
    ] {
        assert_eq!(standard_equipment_provider(topology), expected);
        assert_eq!(registry.resolve(topology), expected);
        if let Some(provider_id) = expected {
            assert_eq!(
                EquipmentProviderId::from_ffi_code(provider_id.ffi_code()),
                Some(provider_id)
            );
            assert_eq!(
                registry.descriptor(provider_id).unwrap().provider_id,
                provider_id
            );
        }
    }
}

#[test]
fn provider_registration_rejects_duplicate_identity_without_touching_the_engine() {
    let mut registry = EquipmentProviderRegistry::standard();
    let error = registry
        .register(Box::new(FakeProvider {
            descriptor: EquipmentProviderDescriptor {
                provider_id: EquipmentProviderId::VisualMachineHandlesV1,
                supported_topologies: vec![EquipmentProviderTopology::CableHandle],
                requires_luma: true,
                requires_pose_context: true,
            },
        }))
        .expect_err("duplicate provider identity must fail atomically");
    assert_eq!(
        error,
        EquipmentProviderRegistryError::DuplicateProvider(
            EquipmentProviderId::VisualMachineHandlesV1
        )
    );
    assert_eq!(
        registry.resolve(EquipmentProviderTopology::CableHandle),
        None
    );
}

struct FakeProvider {
    descriptor: EquipmentProviderDescriptor,
}

impl EquipmentObservationProvider for FakeProvider {
    fn descriptor(&self) -> &EquipmentProviderDescriptor {
        &self.descriptor
    }

    fn process_frame(
        &mut self,
        _input: EquipmentProviderFrameInput<'_>,
    ) -> Result<EquipmentProviderFrameEvidence, VisualEquipmentError> {
        Ok(EquipmentProviderFrameEvidence {
            provider_id: self.descriptor.provider_id,
            raw_observations: Vec::new(),
            display_axis: None,
        })
    }

    fn reset(&mut self) {}
}
