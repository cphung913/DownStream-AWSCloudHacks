# DownStream

Watershed spill simulator. Drop a contamination event on a real river map,
configure hazard / timing / budget, watch the plume propagate downstream in
real time, and receive an EPA-style incident report authored by Claude via
Amazon Bedrock.

See [PLAN.md](./PLAN.md) for the full implementation plan.

## Layout

- `frontend/` — Vite + React + TypeScript (strict) + MapLibre + Zustand.
- `backend/graphql/schema.graphql` — AppSync schema (source of truth).
- `backend/step-functions/simulation-workflow.asl.json` — simulation state machine.
- `backend/lambdas/` — six Python 3.12 Lambdas.
- `infra/` — AWS CDK TypeScript stack (single `WatershedStack`).
- `ml/dispersion-model/` — SageMaker dispersion-coefficient regressor stub.
- `scripts/build_river_graph.py` — one-off NHD + StreamStats preprocessing.
- `data/` — basin GeoJSON drops (git-ignored; loaded out-of-band).

## Quick start

```bash
npm install
npm -w infra run synth
npm -w infra run deploy    # emits frontend/src/aws-exports.json
python ml/dispersion-model/deploy.py
aws s3 cp data/mississippi.geojson s3://$RIVER_GRAPHS_BUCKET/mississippi.geojson
npm -w frontend run dev
```

## Hard rules

- Never hardcode ARNs, account IDs, or endpoint URLs. All come from CDK env vars.
- TypeScript strict mode on everywhere.
- Python Lambdas are 3.12, type-hinted, ruff-clean.
- `prompts.py` must cite EPA 40 CFR Part 300.
