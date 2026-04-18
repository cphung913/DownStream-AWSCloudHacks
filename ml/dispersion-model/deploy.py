"""Deploy the dispersion coefficient regressor to a SageMaker endpoint.

If ``model.joblib`` is < 10 bytes (placeholder) a trivial stub sklearn model
that returns a constant ``D = 1.0`` per row is trained and uploaded instead.
The resulting endpoint name is written to SSM parameter
``/downstream/sagemaker/dispersionEndpoint`` for ``tick-propagator`` to read.
"""

from __future__ import annotations

import argparse
import os
import tarfile
import tempfile
from pathlib import Path

import boto3
import joblib
import numpy as np
import sagemaker
from sagemaker.sklearn.model import SKLearnModel
from sklearn.dummy import DummyRegressor

SSM_PARAM_NAME = "/downstream/sagemaker/dispersionEndpoint"
FRAMEWORK_VERSION = "1.4-1"


def deploy_endpoint(
    model_path: str = "model.joblib",
    endpoint_name: str = "downstream-dispersion-model",
    instance_type: str = "ml.t3.medium",
) -> str:
    path = Path(model_path)
    if not path.exists() or path.stat().st_size < 10:
        print(f"Placeholder detected at {path}; training stub DummyRegressor(constant=1.0).")
        stub = DummyRegressor(strategy="constant", constant=1.0)
        stub.fit(np.zeros((1, 4)), np.array([1.0]))
        joblib.dump(stub, path)

    sess = sagemaker.Session()
    bucket = sess.default_bucket()
    role = _resolve_sagemaker_role(sess)

    with tempfile.TemporaryDirectory() as tmp:
        tar_path = Path(tmp) / "model.tar.gz"
        inference_path = Path(tmp) / "inference.py"
        inference_path.write_text(_INFERENCE_SCRIPT)
        with tarfile.open(tar_path, "w:gz") as tf:
            tf.add(path, arcname="model.joblib")
            tf.add(inference_path, arcname="inference.py")
        model_s3 = sess.upload_data(str(tar_path), bucket=bucket, key_prefix="downstream/dispersion")

    model = SKLearnModel(
        model_data=model_s3,
        role=role,
        entry_point="inference.py",
        framework_version=FRAMEWORK_VERSION,
        sagemaker_session=sess,
    )
    predictor = model.deploy(
        initial_instance_count=1,
        instance_type=instance_type,
        endpoint_name=endpoint_name,
    )

    _write_ssm_param(endpoint_name)
    print(f"Deployed endpoint: {predictor.endpoint_name}")
    return predictor.endpoint_name


def _resolve_sagemaker_role(sess: sagemaker.Session) -> str:
    env_role = os.environ.get("SAGEMAKER_ROLE_ARN")
    if env_role:
        return env_role
    return sagemaker.get_execution_role(sess)


def _write_ssm_param(endpoint_name: str) -> None:
    ssm = boto3.client("ssm")
    ssm.put_parameter(
        Name=SSM_PARAM_NAME,
        Value=endpoint_name,
        Type="String",
        Overwrite=True,
    )


_INFERENCE_SCRIPT = '''
"""SageMaker sklearn container entry point for the dispersion regressor."""
from __future__ import annotations

import io
import os

import joblib
import numpy as np


def model_fn(model_dir: str):
    return joblib.load(os.path.join(model_dir, "model.joblib"))


def input_fn(body: bytes, content_type: str):
    if content_type == "text/csv":
        text = body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else body
        return np.loadtxt(io.StringIO(text), delimiter=",").reshape(-1, 4)
    raise ValueError(f"Unsupported content-type: {content_type}")


def predict_fn(data: np.ndarray, model) -> np.ndarray:
    return np.asarray(model.predict(data), dtype=float).reshape(-1)


def output_fn(prediction: np.ndarray, accept: str) -> bytes:
    return "\\n".join(f"{v:.6g}" for v in prediction).encode("utf-8")
'''


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", default="model.joblib")
    parser.add_argument("--endpoint-name", default="downstream-dispersion-model")
    parser.add_argument("--instance-type", default="ml.t3.medium")
    args = parser.parse_args()
    deploy_endpoint(args.model_path, args.endpoint_name, args.instance_type)
