"""Deploy model.joblib to a SageMaker ml.t3.medium endpoint.

Endpoint name is exported from CDK as SAGEMAKER_ENDPOINT and consumed by
the tick-propagator Lambda at invocation time.
"""
import boto3


def main() -> None:
    raise NotImplementedError("package model.joblib, upload, create endpoint config, deploy")


if __name__ == "__main__":
    main()
