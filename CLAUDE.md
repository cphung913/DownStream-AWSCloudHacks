# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Watershed Spill Simulator** — AWS Hackathon (Environmental Track). Interactive real-time environmental hazard model: user drops a contamination event on a river map, configures spill parameters, and watches downstream propagation unfold over time. The demo's punchline is the **response-delay delta** — change the delay slider from 24h to 4h and re-run to see the difference in affected population.

Full project spec lives at `CONTEXT.md` (copy from `~/Downloads/CONTEXT.md` if not yet in repo). Read it before any non-trivial change.

The repository currently contains only `README.md` and `.gitignore`. Scaffolding has not been generated yet — the structure described below in **Repo Layout** is the target, not the current state.

## Architecture

Five-layer real-time pipeline:

```
React + MapLibre (frontend)
  ↕ GraphQL subscriptions (WebSocket)
AWS AppSync
  ↕ real-time push
Amazon Kinesis Data Streams (watershed-tick-events, 1 shard)
  ↑ published per tick
AWS Lambda (five single-purpose functions, Python 3.12)
  ↑ orchestrated by
AWS Step Functions (Express Workflow)
  ↕ reads/writes
Amazon DynamoDB (SimulationState, TownRiskLog) + S3
```

**Real-time loop:** Simulate click → Step Functions state machine (`VALIDATE_INPUT → LOAD_RIVER_GRAPH → INITIALIZE_STATE → RUN_TICKS loop → GENERATE_REPORT`) → `tick-propagator` Lambda runs one physics timestep, publishes to Kinesis, writes snapshot to DynamoDB → AppSync subscription pushes `onTickUpdate` to the browser → MapLibre repaints river segments.

**Mitigation re-simulation:** User drops a containment barrier → `mitigation-applier` re-weights the river-graph edges at that node and triggers a re-run from the current tick forward. The visible downstream delta is the core UX moment.

**Time slider is not video replay.** It queries DynamoDB historical tick snapshots directly — every tick is independently addressable by `(simulationId, tickNumber)`.

### Lambda responsibilities (single-purpose each)
- `spill-initializer` — seeds initial concentration on source node, writes initial DynamoDB state
- `tick-propagator` — **core physics**, one advection-diffusion timestep per invocation, publishes to Kinesis
- `threshold-checker` — evaluates town nodes against Monitor/Advisory/Danger thresholds, fires EventBridge `ThresholdCrossed`
- `mitigation-applier` — re-weights graph edges for user-placed barriers, enforces budget cap (returns 409 when exceeded)
- `report-generator` — calls Bedrock once per simulation, returns structured incident report JSON

## Simulation Physics (the contract)

1D advection-diffusion per river segment per timestep:

```
∂C/∂t = −v(∂C/∂x) + D(∂²C/∂x²) − kC
```

- `v` — flow velocity from USGS StreamStats (per-segment property)
- `D` — longitudinal dispersion coefficient, predicted by the **SageMaker scikit-learn endpoint** from `[flow_velocity, channel_width, temperature, spill_type_encoded]`
- `k` — first-order decay rate, spill-type dependent (industrial solvent 0.02–0.05/hr, agricultural 0.01–0.03/hr, oil 0.005–0.015/hr, heavy metals ~0)

River network is a directed graph (NetworkX). Default tick = 1hr; configurable 15min / 1hr / 6hr.

**This equation is the physics contract.** Do not simplify to linear interpolation — the model must be defensible to an environmental engineer.

## River Graph Data Contract

Every segment Feature in `data/*.geojson` must carry: `segment_id` (NHD ComID, stable), `flow_velocity`, `channel_width`, `mean_depth`, `flow_rate`, `downstream_ids[]`, `huc8`, and optional `town: { name, population, fips }`.

Failure modes if fields are missing:
- Missing `flow_velocity` → `tick-propagator` divide-by-zero, simulation crashes
- Missing `downstream_ids` → graph disconnected, contamination never propagates past source
- Missing `channel_width` → SageMaker returns garbage `D`, physics silently breaks
- Missing `town` → no threshold events fire, badges never appear (the most visible demo output disappears)

Regeneration script is `scripts/build_river_graph.py`. **Do not run it during the hackathon** — USGS StreamStats rate limits will kill you. The GeoJSON files are treated as fixed artifacts.

## Hard Constraints (non-obvious, easy to violate)

- **`data/mississippi.geojson` is immutable.** 8,400 segments, primary demo asset. Segment IDs must stay stable — everything downstream depends on them.
- **Never hardcode ARNs or endpoint URLs in Lambda code.** All AWS resource references come from environment variables set by CDK (`infra/lib/watershed-stack.ts`).
- **Budget constraint enforcement lives in `mitigation-applier`, not the UI.** When cumulative mitigation cost exceeds the cap, Lambda returns 409 and the frontend greys out the action. UI-only enforcement is wrong.
- **Bedrock prompt must keep EPA 40 CFR Part 300 citations.** Lives in `backend/lambdas/report-generator/prompts.py`. The regulatory citations are what make the incident report feel real — don't remove them when iterating on the prompt.
- **SageMaker dispersion model is a fixed artifact.** `ml/dispersion-model/model.joblib` is pre-trained on USGS historical plume data. Do not retrain during the hackathon.
- **Zustand simulation store is the single source of truth** for map state. `frontend/src/stores/simulation.ts` owns `simulationId`, `tick`, `segmentMap`, `townRiskMap`. Components are pure renderers — do not let map components hold their own simulation state.
- **The Step Functions execution ARN is the simulation session ID everywhere.** Don't mint separate IDs.

## Repo Layout (target)

```
/frontend/src
  /components     Map, ControlPanel, AlertFeed, IncidentReport
  /stores         simulation.ts (SoT), ui.ts, alert.ts
  /hooks          useSimulation.ts, useMapLayers.ts (cinematic paint logic)
  /lib            appsync.ts, locationService.ts
/backend
  /lambdas/{spill-initializer,tick-propagator,threshold-checker,mitigation-applier,report-generator}/
  /step-functions/simulation-workflow.asl.json
  /graphql/schema.graphql         ← AppSync source of truth; generate frontend types from this
/ml/dispersion-model              model.joblib, train.py, deploy.py
/infra/lib/watershed-stack.ts     ← ALL AWS resources; single stack
/data                             mississippi.geojson, ohio.geojson, colorado.geojson
/scripts/build_river_graph.py     one-shot, don't re-run
```

### Read-first files when touching simulation behavior
1. `backend/lambdas/tick-propagator/handler.py` — physics contract
2. `backend/graphql/schema.graphql` — API contract
3. `frontend/src/stores/simulation.ts` — state contract
4. `infra/lib/watershed-stack.ts` — all ARNs flow from here

## Tech Stack

- **Frontend:** React 18 + TypeScript (strict mode), MapLibre GL JS 4.x, Zustand, Radix UI + Tailwind, Amplify DataStore for AppSync subscriptions
- **Backend:** Python 3.12 Lambdas, NumPy + SciPy for advection-diffusion, NetworkX for graph ops, linted with `ruff`, type hints required
- **AWS:** Step Functions (Express), Lambda, Kinesis Data Streams, AppSync (GraphQL), DynamoDB (on-demand), S3, Bedrock (`claude-sonnet-4-20250514`), SageMaker (`ml.t3.medium`), Amazon Location Service, EventBridge, SNS, MediaConvert (stretch), Amplify Gen 2, CloudFront
- **IaC:** AWS CDK (TypeScript), single stack

## Commands

No build/test/lint tooling exists yet — the codebase is unscaffolded. Conventions once scaffolded:

- **Python Lambdas:** linted with `ruff`, type hints required
- **TypeScript (frontend + infra):** strict mode on

Add build/test/lint commands to this file as tooling lands.
