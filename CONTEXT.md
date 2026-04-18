# Watershed Spill Simulator — Project Context

**AWS Hackathon · Environmental Track**

An interactive, real-time environmental hazard modeling tool. Users drop a contamination event on a river map, configure spill parameters, and watch downstream propagation unfold cinematically over time. The core value proposition is making the consequence of response delay viscerally visible — drop a spill on the Mississippi, set a 24-hour response delay, and watch red bleed through downstream towns in real time. Change the delay to 4 hours and re-run. The delta is the demo.

---

## The Concept & User Controls

The simulator exposes five control axes, each mapping to a real emergency management decision:

- **Location / Region** — river watershed selection (Mississippi, Ohio, Colorado basins pre-loaded) plus freeform pin drop on the map
- **Hazard Parameters** — spill type (industrial solvent, agricultural runoff, oil/petroleum, heavy metals), spill volume in gallons, ambient temperature modifier
- **Timing** — response delay slider from 0–72 hours; controls how long the spill propagates unchecked before containment begins
- **Mitigation Actions** — containment barrier placement on the river, boom deployment radius, bioremediation agent application, emergency diversion triggers
- **Budget / Resource Constraints** — total response budget cap that limits which mitigation options are simultaneously available; the backend enforces this, not just the UI

The output has three layers:

1. **Live Map Animation** — river segments illuminate downstream in sequence. Color gradient: yellow (Monitor) → orange (Advisory) → red (Danger). Tributary branches light up as the plume splits at confluences.
2. **Town Risk Badges** — downstream municipalities receive risk classifications with population-at-risk counts. These are driven by real NHD hydrological unit data, not fake coordinates.
3. **Bedrock Incident Report** — after simulation completes, Claude generates a plain-English incident briefing: affected population, estimated cleanup cost, regulatory notification requirements (EPA 40 CFR Part 300 citations), and mitigation priority order.

---

## Architecture Overview

The system has five logical layers:

```
Frontend (React + MapLibre)
    ↕ GraphQL subscriptions
AWS AppSync
    ↕ real-time push
Amazon Kinesis Data Streams
    ↑ publishes per tick
AWS Lambda (tick-propagator)
    ↑ orchestrated by
AWS Step Functions
    ↕ reads/writes
Amazon DynamoDB + S3
```

**The real-time loop in plain English:** The user hits Simulate → Step Functions kicks off the pipeline → Lambda runs the physics for each timestep and publishes the result to Kinesis → AppSync pushes that to the frontend via WebSocket subscription → MapLibre repaints the river segments. Every tick is also written to DynamoDB so the time slider can scrub historical states.

**Mitigation re-simulation:** When the user drops a containment barrier, the `mitigation-applier` Lambda re-weights the river graph edges at that node and triggers a re-run from the current tick forward. The delta in downstream risk is immediately visible.

---

## AWS Services & Their Roles

### Compute & Orchestration

**AWS Step Functions (Express Workflow)**
Owns the simulation lifecycle as a state machine: `VALIDATE_INPUT → LOAD_RIVER_GRAPH → INITIALIZE_STATE → RUN_TICKS (loop) → GENERATE_REPORT`. The execution ARN is used as the simulation session ID everywhere. Defined in `backend/step-functions/simulation-workflow.asl.json`.

**AWS Lambda**
Five functions, each with a single responsibility:
- `spill-initializer` — sets initial concentration on the source node, seeds DynamoDB state
- `tick-propagator` — core physics engine; reads current state, runs one advection-diffusion timestep, publishes to Kinesis
- `threshold-checker` — post-tick, evaluates town nodes against risk thresholds, fires EventBridge events on crossings
- `mitigation-applier` — re-weights graph edges when user places a barrier, triggers re-simulation from that tick
- `report-generator` — assembles simulation summary, calls Bedrock, returns structured JSON for the incident report UI

All Lambdas are Python 3.12. All AWS resource ARNs and endpoints come from environment variables set by CDK — nothing is hardcoded.

### Storage

**Amazon DynamoDB**
Two tables:
- `SimulationState` — PK: `simulationId`, SK: `tickNumber`. Stores the full concentration vector per tick with 24hr TTL. The time slider reads directly from this table by querying historical ticks.
- `TownRiskLog` — PK: `simulationId`, SK: `townId#tickNumber`. Records threshold crossing events. Drives the town badge timeline.

**Amazon S3**
Three buckets:
- `watershed-river-graphs/` — pre-computed NHD GeoJSON per basin. Public read via CloudFront. Do not modify these files during development.
- `watershed-simulations/` — per-simulation snapshot JSONs. Private; presigned URLs for sharing.
- `watershed-exports/` — MediaConvert MP4 output. 24hr expiring presigned URLs.

### Real-Time

**Amazon Kinesis Data Streams**
One stream: `watershed-tick-events`. Partition key: `simulationId`. Each record payload: `{ simulationId, tick, segmentUpdates: [{ segmentId, concentration, riskLevel }] }`. Published by `tick-propagator` after every timestep.

**AWS AppSync (GraphQL)**
Three operations:
- `Query: getSimulation(id)` — returns simulation config and current state
- `Mutation: startSimulation(input)` — triggers Step Functions, returns `simulationId`
- `Subscription: onTickUpdate(simulationId)` — WebSocket push of segment updates from Kinesis to the frontend

The subscription is the critical piece. Every Kinesis publish fans out instantly to all connected clients. This is what makes the river illuminate in real time.

### AI

**Amazon Bedrock (Claude Sonnet)**
Called once per simulation by `report-generator`. System prompt: EPA emergency response coordinator role. User prompt includes spill type, volume, affected towns, time-to-threshold per town, and mitigation scenario delta. Output is structured JSON with: `executiveSummary`, `populationAtRisk`, `estimatedCleanupCost`, `regulatoryObligations`, `mitigationPriorityList`. Prompt is in `backend/lambdas/report-generator/prompts.py`. The regulatory citations (EPA 40 CFR Part 300) are what make the output feel real — do not remove them from the prompt.

**Amazon SageMaker**
Hosts a scikit-learn regression endpoint (`ml.t3.medium`). Input: `[flow_velocity, channel_width, temperature, spill_type_encoded]`. Output: `dispersion_coefficient_D`. Pre-trained on USGS historical plume data. Model artifact is in `ml/dispersion-model/model.joblib`. Do not retrain during the hackathon — treat it as a fixed artifact.

### Geospatial

**Amazon Location Service**
Provides base map tiles (Esri Street style) and geocoding for town/river search. Map resource: `watershed-map`. Place index: `watershed-places`.

### Alerting

**Amazon EventBridge**
Custom event bus: `watershed-risk-events`. `threshold-checker` publishes `ThresholdCrossed` events here when a town node crosses Monitor/Advisory/Danger. Targets: SNS for alert fanout, CloudWatch for metrics.

**Amazon SNS**
Topic: `watershed-town-alerts`. In the demo, subscriptions are simulated endpoints that log to the Alert Feed panel in the UI. Makes the alerting pipeline tangible without real infrastructure.

### Infrastructure

**AWS Amplify Gen 2** — hosts the React frontend with CI/CD from GitHub main.
**Amazon CloudFront** — CDN in front of Amplify. Cache policy: 1hr TTL for river graph GeoJSON, no-cache for simulation endpoints.
**AWS CDK (TypeScript)** — all infrastructure as code in a single stack at `infra/lib/watershed-stack.ts`.

---

## Simulation Physics

The propagation model uses a **1D advection-diffusion equation** applied per river segment per timestep. This is the same class of model used in real EPA spill response tools.

```
∂C/∂t = −v(∂C/∂x) + D(∂²C/∂x²) − kC
```

| Variable | Meaning |
|---|---|
| `C` | Contaminant concentration at a river segment |
| `v` | River flow velocity (m/s) — sourced from USGS StreamStats |
| `D` | Longitudinal dispersion coefficient — predicted by SageMaker |
| `k` | First-order decay rate — spill-type dependent (see table below) |

The river network is a directed graph. Each node is a river segment with attributes: flow rate (m³/s), channel width, mean depth, downstream connectivity. At each tick, `tick-propagator`:
1. Reads the current concentration vector from DynamoDB
2. Applies the advection-diffusion update for one timestep using NumPy
3. Publishes updated concentrations to Kinesis
4. Writes the new state snapshot back to DynamoDB

**Decay rate `k` by spill type:**

| Spill Type | k (hr⁻¹) | Notes |
|---|---|---|
| Industrial Solvent | 0.02–0.05 | EPA lookup table by solvent class |
| Agricultural Runoff | 0.01–0.03 | Lower in cold water; nutrient-driven |
| Oil / Petroleum | 0.005–0.015 | Very persistent; weathering modeled separately |
| Heavy Metals | ~0 | No decay — only dilution |

Tick resolution is configurable: 15min, 1hr, or 6hr. The default for demo is 1hr.

---

## River Graph Data Contract

The simulation engine is only as good as the data it runs on. Every GeoJSON segment in `mississippi.geojson` (and the other basin files) must carry the following attributes. If any are missing, `tick-propagator` has nothing to feed into the advection-diffusion equation.

**Required properties per segment feature:**

| Field | Type | Source | Description |
|---|---|---|---|
| `segment_id` | string | NHD `ComID` | Unique identifier. Stable across runs — do not regenerate. |
| `flow_velocity` | float (m/s) | USGS StreamStats | Mean annual flow velocity. Used as `v` in the physics equation. |
| `channel_width` | float (m) | USGS StreamStats | Bankfull width. Affects dispersion coefficient `D`. |
| `mean_depth` | float (m) | USGS StreamStats | Bankfull mean depth. Used in cross-sectional area calculations. |
| `flow_rate` | float (m³/s) | USGS StreamStats | Discharge. Sanity-check against velocity × width × depth. |
| `downstream_ids` | string[] | NHD flow table | Ordered list of `segment_id`s this segment drains into. What makes it a graph. |
| `huc8` | string | NHD | 8-digit Hydrological Unit Code. Used by Glue/Athena for calibration lookups. |
| `town` | object \| null | Manual join | If a municipality sits on this segment: `{ name, population, fips }`. Null otherwise. |

**How to generate this file:**

1. Download the NHD Plus HR dataset for the Mississippi basin (HUC region 05–08) from the [USGS NHD website](https://www.usgs.gov/national-hydrography/national-hydrography-dataset)
2. Use the NHD `NHDFlowline` layer for geometry and the `NHDPlusFlow` table for downstream connectivity
3. Hit the USGS StreamStats Batch API (`https://streamstats.usgs.gov/streamstatsservices/`) per segment to get `flow_velocity`, `channel_width`, `mean_depth`, `flow_rate` — this is the slow step, run it once and cache
4. Join town data manually from Census TIGER/Line place boundaries against segment geometry
5. Output as a single GeoJSON FeatureCollection with the above properties on each Feature

The pre-processing script lives at `scripts/build_river_graph.py`. Run it once at setup. The output is what goes into S3. Do not run it again during the hackathon — StreamStats rate limits will kill you.

**What happens if fields are missing:**
- Missing `flow_velocity` → `tick-propagator` divides by zero computing advection term. Simulation crashes.
- Missing `downstream_ids` → graph is disconnected. Contamination never propagates past the source node.
- Missing `channel_width` → SageMaker dispersion model gets a null input, returns garbage `D`. Physics silently breaks.
- Missing `town` join → town risk badges never fire. EventBridge never gets threshold events. The demo's most visible output disappears.

---

## Tech Stack

| Category | Technology | Notes |
|---|---|---|
| Frontend Framework | React 18 + TypeScript | Strict mode on |
| Map Rendering | MapLibre GL JS 4.x | Open source; works with ALS tiles |
| State Management | Zustand | Simulation store is single source of truth |
| UI Components | Radix UI + Tailwind CSS | Custom dark theme |
| GraphQL Client | AWS Amplify DataStore | AppSync subscription management |
| Hosting | AWS Amplify Gen 2 | CI/CD from GitHub main |
| CDN | Amazon CloudFront | Edge-cached map tiles and GeoJSON |
| Backend Language | Python 3.12 | All Lambda functions |
| Simulation Math | NumPy + SciPy | Advection-diffusion per-tick compute |
| Graph Processing | NetworkX | River network directed graph operations |
| ML Runtime | scikit-learn 1.4 | Dispersion model on SageMaker |
| Orchestration | AWS Step Functions | Express Workflow, CDK-defined |
| Streaming | Amazon Kinesis Data Streams | 1 shard |
| API | AWS AppSync (GraphQL) | Real-time subscriptions via WebSocket |
| Database | Amazon DynamoDB | On-demand; two tables |
| Object Storage | Amazon S3 | Three buckets |
| Map / Geocoding | Amazon Location Service | Esri Street tiles |
| AI / NLG | Amazon Bedrock | claude-sonnet-4-20250514 |
| ML Inference | Amazon SageMaker | ml.t3.medium, pre-trained |
| Alerting | EventBridge + SNS | Custom event bus |
| Video Export | AWS Elemental MediaConvert | H.264 MP4 at 24fps (stretch goal) |
| IaC | AWS CDK (TypeScript) | Single stack |
| River Data | USGS NHD + StreamStats | Pre-processed into S3 at setup |

---

## Repo Structure

```
/watershed-spill-simulator
  /frontend
    /src
      /components        Map, ControlPanel, AlertFeed, IncidentReport
      /stores            simulation.ts, ui.ts, alert.ts
      /hooks             useSimulation.ts, useMapLayers.ts
      /lib               appsync.ts, locationService.ts
  /backend
    /lambdas
      spill-initializer/
      tick-propagator/       ← core physics, read this first
      threshold-checker/
      mitigation-applier/
      report-generator/
        prompts.py           ← Bedrock prompt, do not gut the regulatory citations
    /step-functions
      simulation-workflow.asl.json
    /graphql
      schema.graphql         ← source of truth for AppSync; generate types from this
  /ml
    /dispersion-model
      model.joblib           ← pre-trained artifact, do not retrain
      train.py
      deploy.py
  /infra
    /lib
      watershed-stack.ts     ← all AWS resource definitions live here
  /data
    mississippi.geojson      ← primary demo dataset, 8,400 segments, do not modify
    ohio.geojson
    colorado.geojson
  CONTEXT.md
  README.md
```

**Key file notes:**
- `frontend/src/stores/simulation.ts` — owns `simulationId`, `tick`, `segmentMap`, `townRiskMap`. Everything else reads from here.
- `frontend/src/hooks/useMapLayers.ts` — drives MapLibre layer paint properties from the simulation store. The cinematic lighting logic lives here.
- `backend/lambdas/tick-propagator/handler.py` — the physics contract. Read this before touching anything simulation-related.
- `infra/lib/watershed-stack.ts` — never hardcode ARNs anywhere. All resource references flow through CDK environment variables.

---

## Context Notes for Claude Code

- **The simulation is the product.** The UI is delivery. When in doubt, get `tick-propagator` correct before touching visual polish.
- **The advection-diffusion equation is the physics contract.** Do not simplify it to linear interpolation. The model must be defensible to someone with an environmental engineering background.
- **Never hardcode ARNs or endpoint URLs in Lambda code.** All AWS resource references come from environment variables set by CDK.
- **The MapLibre map state is driven entirely by the Zustand simulation store.** The store is the single source of truth. Components are pure renderers.
- **The time slider is not a video replay.** It reads DynamoDB tick snapshots directly. Every tick state is persisted and queryable independently.
- **Budget constraint enforcement happens in `mitigation-applier`.** When cumulative mitigation cost exceeds the cap, the Lambda returns a 409. The frontend greys out that action. Do not enforce this only in the UI.
- **`mississippi.geojson` is the primary demo asset.** Everything downstream depends on its segment IDs being stable. Do not modify it.
- **Bedrock output must include regulatory citations.** The `prompts.py` system prompt establishes the EPA coordinator role and instructs Claude to cite EPA 40 CFR Part 300. This is what makes the incident report feel real. Do not remove it.
- **TypeScript strict mode is on** across frontend and infra. Python Lambdas use type hints and are linted with `ruff`.
