import * as path from "path";
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
  Expiration,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as location from "aws-cdk-lib/aws-location";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import * as amplify from "@aws-cdk/aws-amplify-alpha";

export class WatershedStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- DynamoDB ---
    const simulationStateTable = new dynamodb.TableV2(this, "SimulationStateTable", {
      partitionKey: { name: "simulationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "tickNumber", type: dynamodb.AttributeType.NUMBER },
      timeToLiveAttribute: "ttl",
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const townRiskLogTable = new dynamodb.TableV2(this, "TownRiskLogTable", {
      partitionKey: { name: "simulationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "townIdTickNumber", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- S3 ---
    const riverGraphsBucket = new s3.Bucket(this, "RiverGraphsBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3600,
        },
      ],
    });

    const simulationsBucket = new s3.Bucket(this, "SimulationsBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    new s3.Bucket(this, "ExportsBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{ expiration: Duration.days(1) }],
    });

    // --- Kinesis ---
    const tickStream = new kinesis.Stream(this, "TickStream", {
      shardCount: 1,
      retentionPeriod: Duration.hours(24),
      streamMode: kinesis.StreamMode.PROVISIONED,
      encryption: kinesis.StreamEncryption.MANAGED,
    });

    // --- EventBridge ---
    const riskEventBus = new events.EventBus(this, "RiskEventBus", {
      eventBusName: "watershed-risk-events",
    });

    // --- SNS ---
    const townAlertsTopic = new sns.Topic(this, "TownAlertsTopic", {
      topicName: "watershed-town-alerts",
    });

    // SMS subscription for New Orleans emergency alerts.
    // The phone number is read from the ALERT_PHONE_NUMBER environment variable
    // at synth time. It must be verified in the SNS sandbox before receiving
    // messages (run: aws sns verify-sms-sandbox-phone-number --phone-number <number>).
    // To move out of sandbox, request production SMS access in the AWS console.
    const alertPhoneNumber = process.env.ALERT_PHONE_NUMBER ?? "+15555550100";
    townAlertsTopic.addSubscription(
      new snsSubscriptions.SmsSubscription(alertPhoneNumber),
    );

    // EventBridge rule — filtered to ThresholdCrossed events for New Orleans only.
    // The content filter on detail.townName means only New Orleans crossings reach
    // the SNS topic, so the SMS fires exactly once per simulation that hits that town.
    new events.Rule(this, "ThresholdCrossedToSnsRule", {
      eventBus: riskEventBus,
      eventPattern: {
        source: ["watershed.simulation"],
        detailType: ["ThresholdCrossed"],
        detail: {
          townName: ["New Orleans"],
        },
      },
      targets: [
        new eventsTargets.SnsTopic(townAlertsTopic, {
          message: events.RuleTargetInput.fromText(
            "EMERGENCY ALERT: Hazardous contamination detected upstream of New Orleans. Immediate action required. — DownStream Alert System",
          ),
        }),
      ],
    });

    // --- Amazon Location Service ---
    const watershedMap = new location.CfnMap(this, "WatershedMap", {
      mapName: "watershed-map",
      configuration: { style: "VectorEsriStreets" },
      pricingPlan: "RequestBasedUsage",
    });

    const watershedPlaces = new location.CfnPlaceIndex(this, "WatershedPlaces", {
      indexName: "watershed-places",
      dataSource: "Esri",
      pricingPlan: "RequestBasedUsage",
    });

    // Location API key created manually in console (WSParticipantRole lacks geo:CreateKey)

    // --- AppSync ---
    const watershedApi = new appsync.GraphqlApi(this, "WatershedApi", {
      name: "WatershedApi",
      schema: appsync.SchemaFile.fromAsset(
        path.join(__dirname, "..", "..", "backend", "graphql", "schema.graphql"),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,
          apiKeyConfig: {
            expires: Expiration.after(Duration.days(90)),
          },
        },
        additionalAuthorizationModes: [
          { authorizationType: appsync.AuthorizationType.IAM },
        ],
      },
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
        retention: logs.RetentionDays.ONE_WEEK,
      },
      xrayEnabled: true,
    });

    // --- Shared Lambda env baseline (filled per function) ---
    const sagemakerEndpointParamName = "/downstream/sagemaker/dispersionEndpoint";

    const lambdaBaseEnv: Record<string, string> = {
      SIMULATION_STATE_TABLE: simulationStateTable.tableName,
      TOWN_RISK_LOG_TABLE: townRiskLogTable.tableName,
      RIVER_GRAPHS_BUCKET: riverGraphsBucket.bucketName,
      SIMULATIONS_BUCKET: simulationsBucket.bucketName,
      TICK_STREAM_NAME: tickStream.streamName,
      RISK_EVENT_BUS_NAME: riskEventBus.eventBusName,
      TOWN_ALERTS_TOPIC_ARN: townAlertsTopic.topicArn,
      SAGEMAKER_ENDPOINT_PARAM: sagemakerEndpointParamName,
      BEDROCK_MODEL_ID: "anthropic.claude-sonnet-4-5-20251001-v1:0",
      APPSYNC_API_URL: watershedApi.graphqlUrl,
    };

    const lambdaSrc = (name: string) =>
      path.join(__dirname, "..", "..", "backend", "lambdas", name);

    // --- Lambdas ---
    const spillInitializerFn = new PythonFunction(this, "SpillInitializerFn", {
      entry: lambdaSrc("spill-initializer"),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      index: "handler.py",
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: { ...lambdaBaseEnv },
    });

    const tickPropagatorFn = new PythonFunction(this, "TickPropagatorFn", {
      entry: lambdaSrc("tick-propagator"),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      index: "handler.py",
      timeout: Duration.seconds(120),
      memorySize: 1024,
      environment: { ...lambdaBaseEnv },
    });

    const thresholdCheckerFn = new PythonFunction(this, "ThresholdCheckerFn", {
      entry: lambdaSrc("threshold-checker"),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      index: "handler.py",
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: { ...lambdaBaseEnv },
    });

    const mitigationApplierFn = new PythonFunction(this, "MitigationApplierFn", {
      entry: lambdaSrc("mitigation-applier"),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      index: "handler.py",
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: { ...lambdaBaseEnv },
    });

    const reportGeneratorFn = new PythonFunction(this, "ReportGeneratorFn", {
      entry: lambdaSrc("report-generator"),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      index: "handler.py",
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: { ...lambdaBaseEnv },
    });

    const kinesisToAppSyncFn = new PythonFunction(this, "KinesisToAppSyncFn", {
      entry: lambdaSrc("kinesis-to-appsync"),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      index: "handler.py",
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: { ...lambdaBaseEnv },
    });

    // --- IAM grants ---
    simulationStateTable.grantReadWriteData(spillInitializerFn);
    simulationStateTable.grantReadWriteData(tickPropagatorFn);
    simulationStateTable.grantReadData(reportGeneratorFn);
    simulationStateTable.grantReadData(mitigationApplierFn);

    townRiskLogTable.grantReadWriteData(thresholdCheckerFn);
    townRiskLogTable.grantReadData(reportGeneratorFn);

    riverGraphsBucket.grantRead(spillInitializerFn);
    riverGraphsBucket.grantRead(tickPropagatorFn);
    riverGraphsBucket.grantRead(mitigationApplierFn);

    simulationsBucket.grantReadWrite(mitigationApplierFn);
    simulationsBucket.grantReadWrite(reportGeneratorFn);
    simulationsBucket.grantReadWrite(spillInitializerFn);
    simulationsBucket.grantRead(tickPropagatorFn);

    tickStream.grantWrite(tickPropagatorFn);
    tickStream.grantRead(kinesisToAppSyncFn);

    riskEventBus.grantPutEventsTo(thresholdCheckerFn);

    townAlertsTopic.grantPublish(thresholdCheckerFn);

    // SageMaker invoke + SSM param read for tick-propagator
    tickPropagatorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sagemaker:InvokeEndpoint"],
        resources: [
          `arn:aws:sagemaker:${this.region}:${this.account}:endpoint/watershed-dispersion*`,
        ],
      }),
    );
    tickPropagatorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${sagemakerEndpointParamName}`,
        ],
      }),
    );

    // Bedrock invoke for report-generator (pinned to specific Claude model)
    reportGeneratorFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-5-20251001-v1:0",
        ],
      }),
    );

    // --- Step Functions ---
    const asl = sfn.DefinitionBody.fromFile(
      path.join(
        __dirname,
        "..",
        "..",
        "backend",
        "step-functions",
        "simulation-workflow.asl.json",
      ),
    );

    const stateMachineLogGroup = new logs.LogGroup(this, "SimulationStateMachineLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const simulationStateMachine = new sfn.StateMachine(
      this,
      "SimulationStateMachine",
      {
        definitionBody: asl,
        definitionSubstitutions: {
          SpillInitializerFnArn: spillInitializerFn.functionArn,
          TickPropagatorFnArn: tickPropagatorFn.functionArn,
          ThresholdCheckerFnArn: thresholdCheckerFn.functionArn,
          ReportGeneratorFnArn: reportGeneratorFn.functionArn,
        },
        stateMachineType: sfn.StateMachineType.EXPRESS,
        tracingEnabled: true,
        logs: {
          destination: stateMachineLogGroup,
          level: sfn.LogLevel.ERROR,
          includeExecutionData: false,
        },
      },
    );

    spillInitializerFn.grantInvoke(simulationStateMachine);
    tickPropagatorFn.grantInvoke(simulationStateMachine);
    thresholdCheckerFn.grantInvoke(simulationStateMachine);
    reportGeneratorFn.grantInvoke(simulationStateMachine);

    // mitigation-applier needs to start new executions
    mitigationApplierFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [simulationStateMachine.stateMachineArn],
      }),
    );
    mitigationApplierFn.addEnvironment(
      "STATE_MACHINE_ARN",
      simulationStateMachine.stateMachineArn,
    );

    // --- AppSync resolvers ---
    const startSimulationDs = watershedApi.addHttpDataSource(
      "StartSimulationDs",
      `https://states.${this.region}.amazonaws.com`,
      {
        authorizationConfig: {
          signingRegion: this.region,
          signingServiceName: "states",
        },
      },
    );

    startSimulationDs.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [simulationStateMachine.stateMachineArn],
      }),
    );

    startSimulationDs.createResolver("StartSimulationResolver", {
      typeName: "Mutation",
      fieldName: "startSimulation",
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
{
  "version": "2018-05-29",
  "method": "POST",
  "resourcePath": "/",
  "params": {
    "headers": {
      "content-type": "application/x-amz-json-1.0",
      "x-amz-target": "AWSStepFunctions.StartExecution"
    },
    "body": $util.toJson({
      "stateMachineArn": "${simulationStateMachine.stateMachineArn}",
      "input": "$util.escapeJavaScript($util.toJson($ctx.args.input))"
    })
  }
}`),
      responseMappingTemplate: appsync.MappingTemplate.fromString(`
#if($ctx.error)
  $util.error($ctx.error.message, $ctx.error.type)
#end
#set($body = $util.parseJson($ctx.result.body))
{
  "simulationId": "$body.executionArn",
  "executionArn": "$body.executionArn"
}`),
    });

    // Lambda-backed resolvers
    const mitigationDs = watershedApi.addLambdaDataSource(
      "MitigationDs",
      mitigationApplierFn,
    );
    mitigationDs.createResolver("ApplyMitigationResolver", {
      typeName: "Mutation",
      fieldName: "applyMitigation",
    });

    const simulationQueryDs = watershedApi.addLambdaDataSource(
      "SimulationQueryDs",
      spillInitializerFn,
    );
    simulationQueryDs.createResolver("GetSimulationResolver", {
      typeName: "Query",
      fieldName: "getSimulation",
    });
    simulationQueryDs.createResolver("GetTickSnapshotResolver", {
      typeName: "Query",
      fieldName: "getTickSnapshot",
    });

    // getIcs208Url — routed to report-generator (presigned URL mode)
    const reportGeneratorDs = watershedApi.addLambdaDataSource(
      "ReportGeneratorDs",
      reportGeneratorFn,
    );
    reportGeneratorDs.createResolver("GetIcs208UrlResolver", {
      typeName: "Query",
      fieldName: "getIcs208Url",
    });

    // publishTickUpdate: NONE data source (local resolver) that just echoes input
    // — actual publishing is done by KinesisToAppSyncFn via SigV4 mutate call.
    const noneDs = watershedApi.addNoneDataSource("NoneDs");
    noneDs.createResolver("PublishTickUpdateResolver", {
      typeName: "Mutation",
      fieldName: "publishTickUpdate",
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
{
  "version": "2018-05-29",
  "payload": $util.toJson($ctx.args.update)
}`),
      responseMappingTemplate: appsync.MappingTemplate.fromString(
        `$util.toJson($ctx.result)`,
      ),
    });

    // --- Kinesis → Lambda trigger ---
    kinesisToAppSyncFn.addEventSource(
      new lambdaEventSources.KinesisEventSource(tickStream, {
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(1),
        startingPosition: lambda.StartingPosition.LATEST,
        retryAttempts: 3,
      }),
    );

    // AppSync IAM grant for kinesis-to-appsync (publishTickUpdate is @aws_iam)
    kinesisToAppSyncFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["appsync:GraphQL"],
        resources: [
          `${watershedApi.arn}/types/Mutation/fields/publishTickUpdate`,
        ],
      }),
    );

    // --- Amplify hosting ---
    const amplifyApp = new amplify.App(this, "AmplifyApp", {
      appName: "downstream-frontend",
      autoBranchDeletion: true,
    });
    amplifyApp.addBranch("main", { autoBuild: true, stage: "PRODUCTION" });

    // --- CloudFront distribution ---
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(
          riverGraphsBucket,
        ),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      comment: "DownStream river-graphs CDN",
    });

    // SSM parameter placeholder for SageMaker endpoint (populated post-deploy)
    new ssm.StringParameter(this, "SagemakerEndpointParam", {
      parameterName: sagemakerEndpointParamName,
      stringValue: "PENDING-DEPLOY",
      description: "SageMaker endpoint name for dispersion model",
    });

    // --- Outputs (also serve as aws-exports generator) ---
    new CfnOutput(this, "aws_appsync_graphqlEndpoint", {
      value: watershedApi.graphqlUrl,
    });
    // Intentionally NOT emitting the AppSync API key as a plaintext CloudFormation
    // output (H3). Retrieve it out-of-band via
    //   aws appsync list-api-keys --api-id <id>
    // and inject into the frontend build via CI secrets / SSM SecureString.
    new CfnOutput(this, "aws_appsync_apiId", { value: watershedApi.apiId });
    new CfnOutput(this, "aws_appsync_region", { value: this.region });
    new CfnOutput(this, "aws_appsync_authenticationType", {
      value: "API_KEY",
    });
    new CfnOutput(this, "aws_location_map_name", {
      value: watershedMap.mapName,
    });

    new CfnOutput(this, "aws_location_place_index", {
      value: watershedPlaces.indexName,
    });
    new CfnOutput(this, "aws_river_graphs_cdn", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "aws_state_machine_arn", {
      value: simulationStateMachine.stateMachineArn,
    });
    new CfnOutput(this, "aws_region", { value: this.region });
  }
}
