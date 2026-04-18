#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { WatershedStack } from "../lib/watershed-stack";

const app = new App();
new WatershedStack(app, "WatershedStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
