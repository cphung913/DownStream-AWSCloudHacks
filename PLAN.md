# DownStream Watershed Spill Simulator — Implementation Plan

## Problem Statement
Emergency managers, environmental regulators, and hackathon judges need to viscerally see the consequences of response delay on a contaminant spill. The simulator turns an abstract advection-diffusion equation into a cinematic downstream propagation on a real river map: drop a spill, set a response delay, watch red bleed through downstream towns. Changing the delay and re-running produces a visible delta — that delta is the product.

## User Story
As an emergency response planner, when I drop a spill on a river segment and configure hazard, timing, and budget, I want to watch the contaminant propagate downstream in real time with town-level risk alerts and receive an AI-authored incident report, so that I can quantify the cost of response delay and compare mitigation strategies.

## Design Spec

### Surfaces
- **Web app** (React + MapLibre) — primary UI, hosted on Amplify Gen 2 behind CloudFront.
- **GraphQL API** (AppSync) — the only network boundary the frontend crosses.
- **Backend pipeline** (Step Functions → Lambda → Kinesis → AppSync subscription) — invisible to the user; produces per-tick updates that light up the map.

### Interaction Model
1. User loads app → Zustand `simulation` store boots empty, MapLibre renders basin GeoJSON from CloudFront.
2. User configures spill in `ControlPanel` (location pin, spill type, volume, temperature, response delay, mitigation actions, budget cap).
3. User clicks **Simulate** → `startSimulation` GraphQL mutation → AppSync invokes Step Functions → returns `simulationId`.
4. Frontend opens `onTickUpdate(simulationId)` subscription.
5. Each tick: `tick-propagator` publishes to Kinesis → Kinesis → AppSync subscription resolver fans out → `useSimulation` hook updates `segmentMap`/`townRiskMap` in Zustand → `useMapLayers` drives MapLibre paint properties → river segments recolor yellow/orange/red.
6. Threshold crossings push `AlertFeed` entries via EventBridge → SNS → AppSync.
7. On `RUN_TICKS` completion, `report-generator` calls Bedrock; the resulting structured JSON populates `IncidentReport` panel.
8. User can scrub a time slider — it queries DynamoDB `SimulationState` by `(simulationId, tickNumber)` directly (not a video replay).
9. User can place a barrier on a segment → `mitigation-applier` Lambda re-weights graph edges and triggers a re-simulation from the current tick; budget cap enforced server-side (409 on exceed).

### Visual Description
- **Default state:** basin GeoJSON rendered in muted blue; no concentrations; `ControlPanel` collapsed on right; `AlertFeed` empty state "No active alerts"; `IncidentReport` hidden until simulation completes.
- **Active state:** segments colored by `riskLevel` (`none`→blue, `monitor`→yellow #F4D03F, `advisory`→orange #E67E22, `danger`→red #C0392B); town badges pulse when crossing a threshold; tick counter in header.
- **Complete state:** `IncidentReport` slides in from right with executive summary, population at risk, cleanup cost estimate, regulatory obligations, mitigation priority list.
- **Loading state:** skeleton placeholders on controls during initial basin fetch; running indicator next to tick counter during propagation.
- **Error state:** inline error banner for 4xx responses; 409 from mitigation budget cap shows as a toast "Mitigation exceeds budget by $X".

### Accessibility & Keyboard
- Tab order: location → spill type → volume → temp → delay → mitigation → budget → Simulate.
- All Radix UI primitives retain built-in ARIA.
- Risk colors supplemented with icons (monitor/advisory/danger) for colorblind users.
- Time slider is arrow-key navigable.

### Explicit Non-Goals
- No user auth in initial scaffold (AppSync API key auth only; Cognito is out of scope).
- No retraining of dispersion model; `model.joblib` is a fixed artifact.
- No MediaConvert MP4 export (stretch goal, stubbed bucket only).
- No multi-region, no cross-account.
- No real SNS endpoints beyond the simulated in-app AlertFeed.
- No edit-in-place of `mississippi.geojson` during development.

## Wireframe / Interaction Spec

### Layout
```
+---------------------------------------------------------------+
| [DownStream]  Basin: Mississippi v   Tick: 24/72   [Simulate] |
+------------------------------------------+--------------------+
|                                          |  Control Panel     |
|                                          |  [ ] Spill Type    |
|          MapLibre canvas                 |  [ ] Volume (gal)  |
|          (river segments)                |  [ ] Temperature   |
|          color: risk gradient            |  [ ] Delay 0-72hr  |
|                                          |  [ ] Mitigation    |
|                                          |  [ ] Budget cap    |
|                                          +--------------------+
|                                          |  Alert Feed        |
|                                          |  - Memphis MON     |
|                                          |  - St Louis ADV    |
+------------------------------------------+--------------------+
| Time slider: |----O---------|  24/72                          |
+---------------------------------------------------------------+
| Incident Report (collapsed until complete)                    |
+---------------------------------------------------------------+
```

### GraphQL Interaction Spec
```graphql
mutation Start {
  startSimulation(input: {
    basin: "mississippi",
    sourceSegmentId: "23456789",
    spillType: OIL_PETROLEUM,
    volumeGallons: 50000,
    temperatureCelsius: 12.0,
    responseDelayHours: 24,
    mitigations: [],
    budgetUsd: 2500000,
    tickResolutionMinutes: 60,
    totalTicks: 72
  }) { simulationId, executionArn }
}

subscription OnTick($id: ID!) {
  onTickUpdate(simulationId: $id) {
    simulationId, tick,
    segmentUpdates { segmentId, concentration, riskLevel }
  }
}
```

### Kinesis Record Shape
```json
{
  "simulationId": "arn:aws:states:us-west-2:275741385156:execution:...",
  "tick": 12,
  "segmentUpdates": [
    {"segmentId": "23456789", "concentration": 0.0421, "riskLevel": "advisory"}
  ]
}
```

## Technical Approach

- **Monorepo** with per-subtree tooling. Root has `package.json` (workspaces for `frontend` and `infra`) and no build script at root.
- **CDK** single stack (`WatershedStack`) deploys everything. All Lambda env vars derived from CDK constructs — no string literals for ARNs/table names.
- **Lambdas** are Python 3.12, bundled via CDK `PythonFunction` (aws-cdk-lib alpha `aws-lambda-python-alpha`). Each Lambda has its own `requirements.txt`.
- **AppSync** uses direct Lambda resolvers for Query/Mutation; Subscription uses enhanced subscription filters. Kinesis → AppSync fanout via a dedicated `kinesis-to-appsync` Lambda trigger that invokes a `publishTickUpdate` internal mutation.
- **Frontend** built with Vite + React + TS strict. Amplify DataStore wraps the AppSync client.
- **Environment wiring:** CDK outputs `aws-exports.json` at `frontend/src/aws-exports.json` post-deploy via a `BucketDeployment`-adjacent custom resource OR via `cdk deploy --outputs-file`.

### Files to Create

```
/Users/arjunvivek/downstream/
├── README.md                                   (keep)
├── .gitignore                                  (keep)
├── package.json                                (workspaces root)
├── PLAN.md                                     (this file)
├── frontend/
│   ├── package.json
│   ├── tsconfig.json                           (strict: true)
│   ├── vite.config.ts
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── aws-exports.ts                      (generated placeholder)
│       ├── components/
│       │   ├── Map.tsx
│       │   ├── ControlPanel.tsx
│       │   ├── AlertFeed.tsx
│       │   ├── IncidentReport.tsx
│       │   └── TimeSlider.tsx
│       ├── stores/
│       │   ├── simulation.ts                   (Zustand)
│       │   ├── ui.ts
│       │   └── alert.ts
│       ├── hooks/
│       │   ├── useSimulation.ts
│       │   └── useMapLayers.ts
│       ├── lib/
│       │   ├── appsync.ts
│       │   ├── locationService.ts
│       │   └── graphql.ts                      (generated ops)
│       └── styles/
│           └── index.css                       (Tailwind)
├── backend/
│   ├── graphql/
│   │   └── schema.graphql
│   ├── step-functions/
│   │   └── simulation-workflow.asl.json
│   └── lambdas/
│       ├── spill-initializer/
│       │   ├── handler.py
│       │   ├── requirements.txt
│       │   └── ruff.toml
│       ├── tick-propagator/
│       │   ├── handler.py
│       │   ├── physics.py
│       │   ├── graph_io.py
│       │   ├── requirements.txt
│       │   └── ruff.toml
│       ├── threshold-checker/
│       │   ├── handler.py
│       │   ├── requirements.txt
│       │   └── ruff.toml
│       ├── mitigation-applier/
│       │   ├── handler.py
│       │   ├── requirements.txt
│       │   └── ruff.toml
│       ├── report-generator/
│       │   ├── handler.py
│       │   ├── prompts.py
│       │   ├── requirements.txt
│       │   └── ruff.toml
│       └── kinesis-to-appsync/
│           ├── handler.py
│           └── requirements.txt
├── ml/
│   └── dispersion-model/
│       ├── model.joblib                        (zero-byte placeholder)
│       ├── deploy.py
│       └── requirements.txt
├── scripts/
│   └── build_river_graph.py
├── data/
│   └── .gitkeep                                (mississippi.geojson loaded out-of-band)
└── infra/
    ├── package.json
    ├── tsconfig.json                           (strict: true)
    ├── cdk.json
    ├── bin/
    │   └── app.ts
    └── lib/
        └── watershed-stack.ts
```

### CDK Construct Names (authoritative)

All constructs in `WatershedStack`:

| Logical ID                | Construct                         | Notes                                               |
|---------------------------|-----------------------------------|-----------------------------------------------------|
| `SimulationStateTable`    | `dynamodb.TableV2`                | PK `simulationId` S, SK `tickNumber` N, TTL `ttl`   |
| `TownRiskLogTable`        | `dynamodb.TableV2`                | PK `simulationId` S, SK `townIdTickNumber` S        |
| `RiverGraphsBucket`       | `s3.Bucket`                       | Public-read via CloudFront OAI                      |
| `SimulationsBucket`       | `s3.Bucket`                       | Private, presigned-url access                       |
| `ExportsBucket`           | `s3.Bucket`                       | Lifecycle: expire at 1 day                          |
| `TickStream`              | `kinesis.Stream`                  | 1 shard, 24hr retention                             |
| `RiskEventBus`            | `events.EventBus`                 | name: `watershed-risk-events`                       |
| `TownAlertsTopic`         | `sns.Topic`                       | name: `watershed-town-alerts`                       |
| `WatershedApi`            | `appsync.GraphqlApi`              | API key auth (90-day expiry)                        |
| `WatershedMap`            | `location.CfnMap`                 | name: `watershed-map`, Esri Street                  |
| `WatershedPlaces`         | `location.CfnPlaceIndex`          | name: `watershed-places`, data source `Esri`        |
| `SpillInitializerFn`      | `lambda_python.PythonFunction`    | handler: `handler.handler`                          |
| `TickPropagatorFn`        | `lambda_python.PythonFunction`    | timeout 120s, 1024MB, NumPy/SciPy layer             |
| `ThresholdCheckerFn`      | `lambda_python.PythonFunction`    | 256MB, 30s                                          |
| `MitigationApplierFn`     | `lambda_python.PythonFunction`    | 512MB, 60s                                          |
| `ReportGeneratorFn`       | `lambda_python.PythonFunction`    | 512MB, 120s (Bedrock call)                          |
| `KinesisToAppSyncFn`      | `lambda_python.PythonFunction`    | 256MB, Kinesis trigger                              |
| `SimulationStateMachine`  | `sfn.StateMachine`                | `StateMachineType.EXPRESS`, ASL from file          |
| `Distribution`            | `cloudfront.Distribution`         | origin RiverGraphsBucket, Amplify origin            |
| `AmplifyApp`              | `amplify_alpha.App`               | GitHub source, main branch auto-build               |

### Lambda Environment Variable Contract

Every Lambda receives (only the subset it needs):

- `SIMULATION_STATE_TABLE` — `SimulationStateTable.tableName`
- `TOWN_RISK_LOG_TABLE` — `TownRiskLogTable.tableName`
- `RIVER_GRAPHS_BUCKET` — `RiverGraphsBucket.bucketName`
- `SIMULATIONS_BUCKET` — `SimulationsBucket.bucketName`
- `TICK_STREAM_NAME` — `TickStream.streamName`
- `RISK_EVENT_BUS_NAME` — `RiskEventBus.eventBusName`
- `TOWN_ALERTS_TOPIC_ARN` — `TownAlertsTopic.topicArn`
- `SAGEMAKER_ENDPOINT_NAME` — SSM-parameterized (`/downstream/sagemaker/dispersionEndpoint`)
- `BEDROCK_MODEL_ID` — literal `anthropic.claude-sonnet-4-5-20251001-v1:0`
- `APPSYNC_API_URL` — `WatershedApi.graphqlUrl`
- `APPSYNC_API_KEY` — `WatershedApi.apiKey`
- `AWS_REGION` — `us-west-2` (Lambda-provided)

No ARN or name is ever a string literal inside Lambda code. Every reference goes through `os.environ[...]`.

## GraphQL Schema (`backend/graphql/schema.graphql`)

```graphql
enum SpillType { INDUSTRIAL_SOLVENT AGRICULTURAL_RUNOFF OIL_PETROLEUM HEAVY_METALS }
enum RiskLevel { NONE MONITOR ADVISORY DANGER }
enum Basin { MISSISSIPPI OHIO COLORADO }

type SegmentUpdate { segmentId: ID!, concentration: Float!, riskLevel: RiskLevel! }

type TickUpdate @aws_api_key {
  simulationId: ID!
  tick: Int!
  segmentUpdates: [SegmentUpdate!]!
}

type TownRisk { townId: ID!, townName: String!, population: Int!, riskLevel: RiskLevel!, crossedAtTick: Int! }

type IncidentReport {
  executiveSummary: String!
  populationAtRisk: Int!
  estimatedCleanupCost: Float!
  regulatoryObligations: [String!]!
  mitigationPriorityList: [String!]!
}

type Simulation {
  simulationId: ID!
  executionArn: String!
  basin: Basin!
  sourceSegmentId: ID!
  spillType: SpillType!
  volumeGallons: Float!
  temperatureCelsius: Float!
  responseDelayHours: Int!
  budgetUsd: Float!
  tickResolutionMinutes: Int!
  totalTicks: Int!
  currentTick: Int!
  townRisks: [TownRisk!]!
  report: IncidentReport
}

input MitigationInput {
  kind: String!, segmentId: ID!, costUsd: Float!, radiusMeters: Float
}

input StartSimulationInput {
  basin: Basin!
  sourceSegmentId: ID!
  spillType: SpillType!
  volumeGallons: Float!
  temperatureCelsius: Float!
  responseDelayHours: Int!
  mitigations: [MitigationInput!]!
  budgetUsd: Float!
  tickResolutionMinutes: Int!
  totalTicks: Int!
}

type StartSimulationResult { simulationId: ID!, executionArn: String! }

type Mutation {
  startSimulation(input: StartSimulationInput!): StartSimulationResult!
  applyMitigation(simulationId: ID!, mitigation: MitigationInput!): Simulation!
  publishTickUpdate(update: TickUpdateInput!): TickUpdate! @aws_iam
}

input SegmentUpdateInput { segmentId: ID!, concentration: Float!, riskLevel: RiskLevel! }
input TickUpdateInput { simulationId: ID!, tick: Int!, segmentUpdates: [SegmentUpdateInput!]! }

type Query {
  getSimulation(simulationId: ID!): Simulation
  getTickSnapshot(simulationId: ID!, tick: Int!): TickUpdate
}

type Subscription {
  onTickUpdate(simulationId: ID!): TickUpdate
    @aws_subscribe(mutations: ["publishTickUpdate"])
}

schema { query: Query, mutation: Mutation, subscription: Subscription }
```

## Step Functions ASL (`backend/step-functions/simulation-workflow.asl.json`)

```json
{
  "Comment": "DownStream watershed spill simulation",
  "StartAt": "VALIDATE_INPUT",
  "States": {
    "VALIDATE_INPUT": {
      "Type": "Pass",
      "Parameters": {
        "input.$": "$",
        "simulationId.$": "$$.Execution.Id"
      },
      "Next": "LOAD_RIVER_GRAPH"
    },
    "LOAD_RIVER_GRAPH": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${SpillInitializerFnArn}",
        "Payload": { "phase": "load", "input.$": "$.input", "simulationId.$": "$.simulationId" }
      },
      "ResultPath": "$.graph",
      "Next": "INITIALIZE_STATE"
    },
    "INITIALIZE_STATE": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${SpillInitializerFnArn}",
        "Payload": { "phase": "init", "input.$": "$.input", "simulationId.$": "$.simulationId", "graph.$": "$.graph.Payload" }
      },
      "ResultPath": "$.state",
      "Next": "RUN_TICKS"
    },
    "RUN_TICKS": {
      "Type": "Map",
      "ItemsPath": "$.state.Payload.tickSequence",
      "MaxConcurrency": 1,
      "Parameters": {
        "simulationId.$": "$.simulationId",
        "input.$": "$.input",
        "tick.$": "$$.Map.Item.Value"
      },
      "Iterator": {
        "StartAt": "PROPAGATE",
        "States": {
          "PROPAGATE": {
            "Type": "Task",
            "Resource": "arn:aws:states:::lambda:invoke",
            "Parameters": {
              "FunctionName": "${TickPropagatorFnArn}",
              "Payload.$": "$"
            },
            "ResultPath": "$.propagation",
            "Next": "CHECK_THRESHOLDS"
          },
          "CHECK_THRESHOLDS": {
            "Type": "Task",
            "Resource": "arn:aws:states:::lambda:invoke",
            "Parameters": {
              "FunctionName": "${ThresholdCheckerFnArn}",
              "Payload": { "simulationId.$": "$.simulationId", "tick.$": "$.tick", "propagation.$": "$.propagation.Payload" }
            },
            "End": true
          }
        }
      },
      "ResultPath": "$.ticks",
      "Next": "GENERATE_REPORT"
    },
    "GENERATE_REPORT": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "${ReportGeneratorFnArn}",
        "Payload": { "simulationId.$": "$.simulationId", "input.$": "$.input" }
      },
      "End": true
    }
  }
}
```

CDK substitutes `${SpillInitializerFnArn}` etc. via `DefinitionBody.fromString` with `sfn.DefinitionBody.fromFile(...).substitutions`.

## Lambda Function Specs

### `spill-initializer/handler.py`
**Responsibility:** two phases (`load`, `init`) driven by `event.phase`.
- `load`: reads `{basin}.geojson` from `RIVER_GRAPHS_BUCKET`, returns `{ nodes: [...], edges: [...], sourceNodeIndex }`.
- `init`: seeds `SimulationState` row for `tick=0` with initial concentration at `sourceSegmentId`. Computes `tickSequence = list(range(1, totalTicks + 1))`.

**Signatures:**
```python
def handler(event: dict, context: object) -> dict: ...
def load_graph(basin: str) -> dict: ...
def seed_initial_state(simulation_id: str, graph: dict, input_: dict) -> dict: ...
```

**DynamoDB write (tick 0):**
```
Item = {
  simulationId: "<arn>",
  tickNumber: 0,
  concentrationVector: { "<segmentId>": <float> },  # only source has >0
  riskLevelVector: { "<segmentId>": "none" | "monitor" | ... },
  ttl: <epoch + 86400>
}
```

### `tick-propagator/handler.py`
**Responsibility:** run one advection-diffusion timestep for tick `N` given state at tick `N-1`.

**Core algorithm (`physics.py`):**
```python
def advection_diffusion_step(
    c_prev: np.ndarray,         # shape (num_segments,)
    v: np.ndarray,              # flow velocity per segment
    D: np.ndarray,              # dispersion coefficient per segment
    dx: np.ndarray,             # segment length per segment
    k: float,                   # decay rate (hr^-1)
    dt: float,                  # timestep in hours
    downstream_matrix: sp.csr_matrix,  # sparse graph adjacency (upstream→downstream)
) -> np.ndarray:
    """
    Solves ∂C/∂t = −v(∂C/∂x) + D(∂²C/∂x²) − kC using explicit Euler
    finite-difference on the directed river graph.
    Returns c_next.
    """
```

**Handler flow:**
1. Read input: `{ simulationId, input, tick }`.
2. Query `SimulationState` for `(simulationId, tick-1)`.
3. Load graph node attrs from cached S3 graph (passed through Step Functions payload OR re-read — prefer Step Functions passing `graphS3Key`, then Lambda lazy-loads and caches in `/tmp`).
4. Invoke SageMaker endpoint `SAGEMAKER_ENDPOINT_NAME` once with batched `[flow_velocity, channel_width, temperature, spill_type_encoded]` per segment → returns `D` vector.
5. Apply `advection_diffusion_step`.
6. Derive per-segment `riskLevel` via thresholds (concentration thresholds from `SPILL_TYPE_THRESHOLDS` table in `physics.py`).
7. `PutItem` into `SimulationState` for `(simulationId, tick)`.
8. `put_records` into Kinesis stream `TICK_STREAM_NAME` with partition key = `simulationId`, payload as defined above. Chunk into 500-record batches.
9. Return `{ tick, segmentUpdates }`.

**Risk thresholds (`physics.py`):**
```python
SPILL_TYPE_THRESHOLDS: dict[str, dict[str, float]] = {
    "INDUSTRIAL_SOLVENT": {"monitor": 0.001, "advisory": 0.01, "danger": 0.1},
    "AGRICULTURAL_RUNOFF": {"monitor": 0.005, "advisory": 0.05, "danger": 0.5},
    "OIL_PETROLEUM": {"monitor": 0.0005, "advisory": 0.005, "danger": 0.05},
    "HEAVY_METALS": {"monitor": 0.0001, "advisory": 0.001, "danger": 0.01},
}
DECAY_K: dict[str, float] = {
    "INDUSTRIAL_SOLVENT": 0.035,
    "AGRICULTURAL_RUNOFF": 0.02,
    "OIL_PETROLEUM": 0.01,
    "HEAVY_METALS": 0.0,
}
```

### `threshold-checker/handler.py`
**Responsibility:** after each tick, scan `segmentUpdates` for segments that are town-bearing (from cached graph node attrs), detect crossings vs. prior-tick state, and emit EventBridge events.

**Signature:**
```python
def handler(event: dict, context: object) -> dict:
    """event = { simulationId, tick, propagation: { segmentUpdates: [...] } }"""
```

**EventBridge event shape:**
```json
{
  "Source": "watershed.simulation",
  "DetailType": "ThresholdCrossed",
  "EventBusName": "<RISK_EVENT_BUS_NAME>",
  "Detail": {
    "simulationId": "...",
    "tick": 24,
    "townId": "...",
    "townName": "Memphis",
    "population": 633104,
    "priorRiskLevel": "monitor",
    "newRiskLevel": "advisory",
    "concentration": 0.0412
  }
}
```

Also `PutItem` into `TownRiskLogTable`:
```
Item = {
  simulationId: "<arn>",
  townIdTickNumber: "<townId>#<tick>",
  townId: "...", townName: "...", population: <int>,
  riskLevel: "...", concentration: <float>, ts: <iso>
}
```

### `mitigation-applier/handler.py`
**Responsibility:** apply mitigation to graph edges, enforce budget, trigger re-simulation.

**Signature:**
```python
def handler(event: dict, context: object) -> dict:
    """event = { simulationId, mitigation: {kind, segmentId, costUsd, radiusMeters}, fromTick: int }"""
```

**Budget check:**
```python
total_spent = sum prior mitigations for simulationId  # read from SimulationsBucket/S3 manifest
if total_spent + mitigation.costUsd > budgetUsd:
    return { "statusCode": 409, "body": { "error": "BUDGET_EXCEEDED", "over": ... } }
```

**Edge reweight:**
- `containment_barrier`: set `downstream_multiplier[segmentId] = 0.0` for the target segment (blocks flow).
- `boom`: reduce `D` by 50% within `radiusMeters` downstream.
- `bioremediation`: increase `k` by +0.05 for segments within radius.
- `diversion`: swap `downstream_ids` per a pre-baked diversion table.

Persist the updated graph overlay to `SIMULATIONS_BUCKET/{simulationId}/graph-overlay.json`, start a new Step Functions execution from `fromTick` forward, return the new execution ARN.

### `report-generator/handler.py`
**Responsibility:** aggregate simulation outcome, call Bedrock, return structured JSON.

**Signature:**
```python
def handler(event: dict, context: object) -> dict: ...
```

**Flow:**
1. Query `TownRiskLogTable` for all `(simulationId, *)` entries.
2. Query `SimulationState` for final tick.
3. Compose user prompt with: spill type, volume, affected towns + time-to-threshold per town, mitigation delta (if any).
4. Call Bedrock `InvokeModel` with `BEDROCK_MODEL_ID` using Anthropic Messages API schema.
5. Parse JSON out of model response; validate against Pydantic `IncidentReport` schema.
6. `PutObject` result to `SIMULATIONS_BUCKET/{simulationId}/report.json`.
7. Return the parsed dict.

**`prompts.py` requirements:**
- `SYSTEM_PROMPT` assigns the model the role of "EPA emergency response coordinator with 15 years of inland spill incident experience".
- **Must** include the instruction: `"Every recommendation in 'regulatoryObligations' must cite the specific subpart of EPA 40 CFR Part 300 (National Contingency Plan) that applies. At minimum cite 40 CFR § 300.125 (notification), 40 CFR § 300.305 (phase I — discovery/notification), and 40 CFR § 300.415 (removal action) where relevant."`
- Output schema instruction requires JSON:
```json
{
  "executiveSummary": "string, ≤ 400 words",
  "populationAtRisk": 0,
  "estimatedCleanupCost": 0,
  "regulatoryObligations": ["40 CFR § 300.xxx — ..."],
  "mitigationPriorityList": ["..."]
}
```

### `kinesis-to-appsync/handler.py`
**Responsibility:** Kinesis stream trigger (batch size 100, max batching window 500ms). For each record, decodes the payload and issues a signed GraphQL `publishTickUpdate` mutation to `APPSYNC_API_URL` using SigV4 (IAM auth on that field).

## Frontend Spec

### `stores/simulation.ts` (Zustand)
```ts
type SegmentState = { segmentId: string; concentration: number; riskLevel: RiskLevel };
type TownRisk = { townId: string; townName: string; population: number; riskLevel: RiskLevel; crossedAtTick: number };

interface SimulationStore {
  simulationId: string | null;
  tick: number;
  totalTicks: number;
  segmentMap: Map<string, SegmentState>;
  townRiskMap: Map<string, TownRisk>;
  report: IncidentReport | null;
  setSimulationId: (id: string) => void;
  ingestTick: (update: TickUpdate) => void;
  ingestTownRisk: (risk: TownRisk) => void;
  setReport: (r: IncidentReport) => void;
  reset: () => void;
}
```

### `hooks/useMapLayers.ts`
Subscribes to `segmentMap` and, on change, calls `map.setPaintProperty('river-segments', 'line-color', [expression])` — the expression is a `match` on `segmentId` → color. No component ever mutates MapLibre state outside this hook.

### `hooks/useSimulation.ts`
Opens `onTickUpdate` subscription when `simulationId` is set; tears down on `reset`. Pipes each update through `ingestTick`.

### `components/Map.tsx`
- Renders `<MapLibreMap>` with style from Amazon Location Service.
- Adds a GeoJSON source for the basin (from CloudFront URL).
- Adds a `line` layer `river-segments` with initial blue paint.
- Delegates all paint mutations to `useMapLayers`.

### `components/ControlPanel.tsx`
- Radix UI `Select` for spill type and basin.
- Radix `Slider` for delay (0–72) and temperature (−5–35°C).
- Numeric input for volume (gallons) and budget cap (USD).
- Mitigation action chips; greyed when `costUsd > remainingBudget`.
- `Simulate` button issues `startSimulation` mutation.

### `components/AlertFeed.tsx`
Subscribes to `townRiskMap`. Renders badges with color + icon per risk level. Most recent at top.

### `components/IncidentReport.tsx`
Renders when `report != null`. Four sections: executive summary, pop at risk, cost, obligations (bulleted), mitigation priority (ordered).

### `components/TimeSlider.tsx`
On scrub, issues `getTickSnapshot(simulationId, tick)` query and replaces `segmentMap` without advancing subscription.

## ML Model Stub (`ml/dispersion-model/`)

### `model.joblib`
Zero-byte placeholder file. `deploy.py` detects size < 10 bytes and deploys a stub sklearn model that returns constant `D = 1.0` per row.

### `deploy.py`
```python
def deploy_endpoint(
    model_path: str = "model.joblib",
    endpoint_name: str = "downstream-dispersion-model",
    instance_type: str = "ml.t3.medium",
) -> str: ...
```
Uses `sagemaker.sklearn.SKLearnModel` (framework version `1.4-1`), creates the endpoint, writes the endpoint name to SSM parameter `/downstream/sagemaker/dispersionEndpoint`.

## River Graph Preprocessing Script (`scripts/build_river_graph.py`)

```python
def main(
    basin: str,                      # "mississippi" | "ohio" | "colorado"
    nhd_flowline_shapefile: Path,
    nhd_plusflow_table: Path,
    census_places_shapefile: Path,
    output_path: Path,
    streamstats_cache: Path,
) -> None: ...
```

Output FeatureCollection each `Feature.properties` must contain: `segment_id`, `flow_velocity`, `channel_width`, `mean_depth`, `flow_rate`, `downstream_ids`, `huc8`, `town`.

Missing-field validation is enforced at the end; script exits 1 if any segment lacks a required field.

## Implementation Steps (ordered)

1. Initialize root `package.json` with workspaces `["frontend", "infra"]`.
2. Scaffold `infra/` (`cdk init app --language typescript`, pin `aws-cdk-lib`, enable `strict: true`).
3. Scaffold `frontend/` (Vite React-TS template), enable `strict: true`, install MapLibre, Zustand, Radix UI, Tailwind, aws-amplify.
4. Write `backend/graphql/schema.graphql` exactly as specified.
5. Write `backend/step-functions/simulation-workflow.asl.json` with `${FnArn}` substitutions.
6. Write all five Lambda skeletons (`handler.py`, `requirements.txt`, `ruff.toml`) with correct signatures and TODOs for bodies.
7. Implement `physics.py` and `graph_io.py` in `tick-propagator` with the real NumPy/SciPy advection-diffusion step.
8. Implement `prompts.py` with the EPA coordinator system prompt including 40 CFR Part 300 citations.
9. Implement `kinesis-to-appsync/handler.py` with SigV4-signed GraphQL request.
10. Implement `watershed-stack.ts` end-to-end: DynamoDB, S3, Kinesis, SNS, EventBridge, AppSync, Step Functions, Lambdas (with env vars, IAM), Location Service, Amplify, CloudFront. Wire substitutions for ASL file.
11. Wire Kinesis → `KinesisToAppSyncFn` event source.
12. Grant `KinesisToAppSyncFn` IAM to call `publishTickUpdate` mutation on AppSync.
13. Implement frontend Zustand store, hooks, Map, ControlPanel, AlertFeed, IncidentReport, TimeSlider.
14. Generate GraphQL types via `@aws-amplify/cli-internal` codegen → `frontend/src/lib/graphql.ts`.
15. Write `scripts/build_river_graph.py` per spec.
16. Write `ml/dispersion-model/deploy.py` and create placeholder `model.joblib`.
17. Add `ruff` + `pyright`/`mypy` invocations to root npm scripts.
18. Run `cdk synth` — must succeed.
19. Run `cdk deploy --outputs-file frontend/src/aws-exports.json`.
20. Deploy SageMaker endpoint via `python ml/dispersion-model/deploy.py`.
21. Upload `data/mississippi.geojson` to `RiverGraphsBucket/mississippi.geojson`.
22. End-to-end smoke test: start simulation, observe tick updates in frontend, confirm Bedrock report.

## Edge Cases and Error Handling

| Case                                         | Handling                                                                 |
|----------------------------------------------|--------------------------------------------------------------------------|
| Source `segmentId` not in graph              | `spill-initializer` returns 400; Step Functions fails with `InvalidInput`|
| Missing required GeoJSON property            | `spill-initializer` logs + fails fast with the offending `segment_id`    |
| SageMaker endpoint cold/down                 | `tick-propagator` falls back to `D = channel_width / 10.0` with `logger.warning` |
| Bedrock returns non-JSON                     | `report-generator` retries once with stricter schema instruction; on second failure returns a minimal structured stub + `reportQuality: degraded` |
| Mitigation exceeds budget                    | `mitigation-applier` returns 409; frontend toasts; action chip disabled |
| Kinesis record > 1MB                         | `tick-propagator` chunks `segmentUpdates` into multiple records same partition key |
| AppSync subscription drops                   | `useSimulation` reconnects with exponential backoff (250ms, max 10s)    |
| Time-slider query for out-of-range tick      | AppSync returns null; UI shows last-known tick with "unavailable" tag    |
| DynamoDB TTL expired during long browse      | UI refuses scrub back further than 24hr; tooltip explains                |
| Step Functions payload exceeds 256KB         | Use `graphS3Key` reference pattern, not inline graph                     |

## Performance Considerations

- `tick-propagator` must complete in < 2s for an 8,400-segment basin. Use vectorized NumPy ops on a sparse CSR adjacency matrix; no Python-level loops over segments.
- Kinesis: 1 shard sufficient for demo (< 1 MB/s). If segment update payload > 1MB, chunk.
- AppSync subscription fan-out: default 1000 concurrent clients is fine for demo.
- Frontend: `segmentMap` updates must not trigger full React re-render. Keep Zustand selectors narrow. `useMapLayers` uses `useSyncExternalStore` and calls `setPaintProperty` imperatively.
- MapLibre style updates use a single `match` expression rather than per-feature `setFeatureState` for 8,400 segments.
- CloudFront cache for `mississippi.geojson`: 1hr TTL; simulation endpoints: `no-cache`.

## Testing Requirements

- **Unit:**
  - `physics.advection_diffusion_step` — mass conservation (± decay mass) on a synthetic 10-segment line; exact match for `k=0, D=0` (pure advection).
  - `threshold-checker` — crossing detection on synthetic prior→current vectors.
  - `mitigation-applier` — returns 409 when `costUsd` + prior > budget; otherwise mutates overlay correctly.
  - `report-generator.prompts` — prompt string contains the substring `40 CFR § 300` (enforced test).
- **Integration:**
  - `cdk synth` produces a valid template (snapshot test).
  - Local Step Functions local-emulator run from fixture input through `RUN_TICKS` with 3 ticks.
- **E2E smoke:**
  - Deployed stack: start simulation, assert 72 tick DynamoDB rows written, assert `report.json` exists in bucket, assert AppSync subscription received ≥ 72 messages.
- **Frontend:**
  - Zustand store `ingestTick` merges by `segmentId`, preserves other segments.
  - `useMapLayers` computes a valid MapLibre `match` expression for a given `segmentMap`.

## Accessibility and Platform Conventions

- WCAG AA color contrast on all control labels and risk badges.
- All interactive Radix elements must have visible focus rings.
- Risk levels conveyed by both color and an icon (`Eye`, `AlertTriangle`, `OctagonAlert`).
- Keyboard: `Space` starts simulation when focus is on Simulate button; arrow keys scrub time slider.
- Respect `prefers-reduced-motion`: disable pulse animation on town badges.

## Out of Scope

- User authentication (Cognito, IAM federation).
- MediaConvert MP4 export pipeline (bucket exists; Lambda not implemented).
- Retraining the dispersion ML model.
- Mobile-responsive layout (desktop-first demo).
- Production Bedrock cost guardrails.
- Multi-basin simultaneous simulation.
- Cross-region replication of any resource.

## Open Questions

1. **Bedrock model ID string** — plan doc says `claude-sonnet-4-20250514`, user directive says `claude-sonnet-4-5-20251001`. Plan assumes `anthropic.claude-sonnet-4-5-20251001-v1:0` per the user directive. If the Bedrock region `us-west-2` doesn't yet offer that model ID, fall back to `anthropic.claude-sonnet-4-5-20250929-v1:0`.
2. **AppSync auth mode for subscriptions** — spec assumes API key (90-day rotating) for simplicity. If judges require IAM or Cognito, swap the `WatershedApi.authorizationConfig` mode.
3. **Step Functions Express 5-minute wall limit** — 72 ticks × 2s target is fine. If tick time blows out, switch `SimulationStateMachine` to Standard workflow (removes the 5-minute cap but costs more).
4. **Graph passing between Step Functions states** — plan uses an S3 key reference pattern (`graphS3Key`) to avoid the 256KB payload limit. An alternative is to have `tick-propagator` always re-fetch from S3 (simpler, slightly slower). Default to the S3 key pattern.
5. **Mitigation spend persistence** — plan writes a manifest to `SimulationsBucket/{simulationId}/spend.json`. Alternative: a third DynamoDB table. Default to S3 manifest unless contention emerges.
