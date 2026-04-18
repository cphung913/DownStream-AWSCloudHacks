# Dispersion coefficient model

Pre-trained scikit-learn regressor mapping `[flow_velocity, channel_width, temperature, spill_type_encoded]` → `D` (longitudinal dispersion coefficient, m²/s).

Artifact: `model.joblib` (not checked in until trained).

Runtime: SageMaker `ml.t3.medium` endpoint. Consumed by `tick-propagator` per timestep.
