#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { WatershedStack } from "../lib/watershed-stack";

const app = new cdk.App();

new WatershedStack(app, "WatershedStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-west-2",
  },
  description: "DownStream watershed spill simulator — single-stack deployment",
});
