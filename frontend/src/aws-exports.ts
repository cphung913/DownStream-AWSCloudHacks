// Regenerated post-deploy by `cdk deploy --outputs-file ../frontend/src/aws-exports.json`.
// This TS shim lets the frontend compile before the first deploy.
export interface AwsExports {
  aws_appsync_graphqlEndpoint: string;
  aws_appsync_apiKey: string;
  aws_appsync_region: string;
  aws_appsync_authenticationType: "API_KEY" | "AWS_IAM";
  aws_location_map_name: string;
  aws_location_place_index: string;
  aws_location_api_key: string;
  aws_river_graphs_cdn: string;
  aws_state_machine_arn: string;
  aws_region: string;
}

export const awsExports: AwsExports = {
  aws_appsync_graphqlEndpoint: import.meta.env.VITE_APPSYNC_URL ?? "",
  aws_appsync_apiKey: import.meta.env.VITE_APPSYNC_API_KEY ?? "",
  aws_appsync_region: import.meta.env.VITE_AWS_REGION ?? "us-west-2",
  aws_appsync_authenticationType: "API_KEY",
  aws_location_map_name: import.meta.env.VITE_LOCATION_MAP ?? "watershed-map",
  aws_location_place_index:
    import.meta.env.VITE_LOCATION_PLACES ?? "watershed-places",
  aws_location_api_key: import.meta.env.VITE_LOCATION_API_KEY ?? "",
  aws_river_graphs_cdn: import.meta.env.VITE_CDN_URL ?? "",
  aws_state_machine_arn: import.meta.env.VITE_STATE_MACHINE_ARN ?? "",
  aws_region: import.meta.env.VITE_AWS_REGION ?? "us-west-2",
};
