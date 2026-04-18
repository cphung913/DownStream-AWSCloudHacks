"""Train the longitudinal dispersion coefficient regression model.

Features: [flow_velocity, channel_width, temperature, spill_type_encoded]
Target:   dispersion_coefficient_D (m^2/s)

Trained once on USGS historical plume data. Output artifact: model.joblib.
Do not retrain during the hackathon -- treat the artifact as fixed.
"""
import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor


def main() -> None:
    raise NotImplementedError("load USGS plume training set, fit, dump to model.joblib")


if __name__ == "__main__":
    main()
