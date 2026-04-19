/**
 * Synthetic river generator.
 *
 * For `mississippi`, traces the real river from upstream of the Missouri
 * confluence (north of St. Louis) down past the delta to Head of Passes,
 * plus the Ohio, Missouri, Arkansas, Yazoo, and Red/Atchafalaya tributaries
 * at their real confluences. The user's pinned source is snapped to the
 * nearest main-stem vertex; only segments downstream of that vertex are
 * contaminated by the mock driver (tributaries stay clear, since they flow
 * INTO the main stem — physically correct for a downstream plume).
 *
 * For other regions, falls back to a procedural tree rooted at the pin
 * (keeps ohio/colorado demos functional until their real basins are traced).
 *
 * Pure — `useRiverGraph` and the simulation driver both call this with the
 * same arguments and get identical segment ids / distances.
 */
import type { LngLat, Region } from "@/types/simulation";
import mississippiBackbone from "./mississippi-backbone.json";

interface BackboneData {
  mainStem: LngLat[];
  tributaries: Array<{ name: string; coords: LngLat[] }>;
}

export interface SyntheticSegment {
  segmentId: string;
  index: number;
  /**
   * Graph distance from the pinned source, in segments. Upstream-of-source
   * segments and tributaries use UNREACHED so the mock concentration stays 0.
   */
  distanceFromSource: number;
  start: LngLat;
  end: LngLat;
  isMainStem: boolean;
}

export interface SyntheticTown {
  townId: string;
  name: string;
  population: number;
  segmentId: string;
  lngLat: LngLat;
  distanceFromSource: number;
}

export interface SyntheticRiver {
  featureCollection: GeoJSON.FeatureCollection;
  segments: SyntheticSegment[];
  towns: SyntheticTown[];
  maxDistance: number;
}

const UNREACHED = 99_999;

interface Basin {
  mainStem: LngLat[];
  tributaries: ReadonlyArray<{ name: string; coords: LngLat[] }>;
  towns: ReadonlyArray<{ name: string; population: number; lngLat: LngLat }>;
}

// Real Mississippi basin geometry, extracted from Natural Earth's 10m rivers
// dataset (nvkelso/natural-earth-vector) and downsampled per tributary. Main
// stem = 647 points from upstream of the Missouri confluence to Head of Passes.
// Tributaries: Ohio, Missouri, Arkansas, Red, White, Tennessee. Coordinates
// live in `./mississippi-backbone.json` so they're not inlined in source.
//
// The same data is also served as `/data/mississippi.geojson` from /public so
// `useRiverGraph`'s fetch path exercises the production code path.
const backbone = mississippiBackbone as BackboneData;

const MISSISSIPPI: Basin = {
  mainStem: backbone.mainStem,
  tributaries: backbone.tributaries,
  towns: [
    { name: "Cairo", population: 2100, lngLat: [-89.180, 37.000] },
    { name: "Memphis", population: 633000, lngLat: [-90.060, 35.150] },
    { name: "Greenville", population: 29000, lngLat: [-91.075, 33.415] },
    { name: "Vicksburg", population: 21000, lngLat: [-90.870, 32.350] },
    { name: "Baton Rouge", population: 221000, lngLat: [-91.185, 30.460] },
    { name: "New Orleans", population: 383000, lngLat: [-90.075, 29.950] },
  ],
};

const BASINS: Partial<Record<Region, Basin>> = {
  mississippi: MISSISSIPPI,
};

export function generateSyntheticRiver(source: LngLat, region: Region): SyntheticRiver {
  const basin = BASINS[region];
  if (basin) return buildFromBasin(basin, source);
  return buildProceduralFromSource(source);
}

function buildFromBasin(basin: Basin, source: LngLat): SyntheticRiver {
  const segments: SyntheticSegment[] = [];
  const features: GeoJSON.Feature[] = [];

  const sourceVertex = nearestVertexIndex(basin.mainStem, source);

  // Main stem
  for (let i = 0; i < basin.mainStem.length - 1; i++) {
    const start = basin.mainStem[i]!;
    const end = basin.mainStem[i + 1]!;
    const distance = i >= sourceVertex ? i - sourceVertex : UNREACHED;
    pushSegment(segments, features, start, end, distance, true);
  }

  // Tributaries (side flows — never contaminate, so distance = UNREACHED)
  for (const trib of basin.tributaries) {
    for (let i = 0; i < trib.coords.length - 1; i++) {
      pushSegment(segments, features, trib.coords[i]!, trib.coords[i + 1]!, UNREACHED, false);
    }
  }

  const towns: SyntheticTown[] = basin.towns.map((t, idx) => {
    const vertex = nearestVertexIndex(basin.mainStem, t.lngLat);
    const segIdx = Math.min(vertex, basin.mainStem.length - 2);
    const seg = segments[segIdx]!;
    const distance = vertex >= sourceVertex ? vertex - sourceVertex : UNREACHED;
    return {
      townId: `t${idx + 1}`,
      name: t.name,
      population: t.population,
      segmentId: seg.segmentId,
      lngLat: t.lngLat,
      distanceFromSource: distance,
    };
  });

  const maxDistance = Math.max(
    0,
    (basin.mainStem.length - 1) - sourceVertex - 1,
  );

  return {
    featureCollection: { type: "FeatureCollection", features },
    segments,
    towns,
    maxDistance,
  };
}

function nearestVertexIndex(vertices: ReadonlyArray<LngLat>, target: LngLat): number {
  let best = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const [lng, lat] = vertices[i]!;
    const dLng = lng - target[0];
    const dLat = lat - target[1];
    const dSq = dLng * dLng + dLat * dLat;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = i;
    }
  }
  return best;
}

function pushSegment(
  segments: SyntheticSegment[],
  features: GeoJSON.Feature[],
  start: LngLat,
  end: LngLat,
  distanceFromSource: number,
  isMainStem: boolean,
): SyntheticSegment {
  const index = segments.length;
  const segmentId = `seg-${index}`;
  const seg: SyntheticSegment = {
    segmentId,
    index,
    distanceFromSource,
    start,
    end,
    isMainStem,
  };
  segments.push(seg);
  features.push({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [start, end] },
    properties: {
      segment_id: segmentId,
      distance_from_source: distanceFromSource,
      is_main_stem: isMainStem,
    },
  });
  return seg;
}

/**
 * Plume-advection speed, in segments per tick. Tuned so a St. Louis → Gulf
 * run on the 647-vertex real Mississippi completes in ~25-30 seconds at the
 * default 500ms tick interval. Exported so `useSimulationDriver` can size its
 * `totalTicks` off the same number.
 */
export const PLUME_SPEED = 12;
const LEADING_EDGE_WIDTH = 30;
const TRAIL_DECAY_LENGTH = 240;

/**
 * Plume-advection concentration at a river segment at tick T.
 * Rough pulse model — not physics, just enough to walk a coherent gradient
 * downstream over time. Segments with `distanceFromSource >= UNREACHED`
 * sit well beyond the front and stay clear forever.
 *
 * `barrierMultiplier` is the product of all upstream mitigation pass-through
 * fractions (from MITIGATION_EFFECTIVENESS). 1.0 = no barriers.
 */
export function mockConcentrationAt(
  distanceFromSource: number,
  tick: number,
  speed = PLUME_SPEED,
  barrierMultiplier = 1.0,
): number {
  const front = tick * speed;

  if (distanceFromSource > front + LEADING_EDGE_WIDTH) return 0;
  let raw: number;
  if (distanceFromSource > front) {
    const t = (front + LEADING_EDGE_WIDTH - distanceFromSource) / LEADING_EDGE_WIDTH;
    raw = Math.max(0, t * 0.55);
  } else {
    const pastFront = front - distanceFromSource;
    raw = Math.max(0.25, 1 - pastFront / TRAIL_DECAY_LENGTH);
  }
  return raw * barrierMultiplier;
}

// -------- procedural fallback (ohio / colorado until real basins land) ----------

const MAIN_STEM_LENGTH = 140;
const BRANCH_LENGTHS = [26, 22, 18, 14];
const BRANCH_PARENT_INDICES = [32, 64, 92, 114];
const PROCEDURAL_TOWNS: ReadonlyArray<{ name: string; population: number; distance: number }> = [
  { name: "Riverton", population: 8400, distance: 8 },
  { name: "Fairbank", population: 42000, distance: 34 },
  { name: "Oakridge", population: 19000, distance: 58 },
  { name: "Westlake", population: 114000, distance: 86 },
  { name: "Gulfport", population: 71000, distance: 118 },
];

function buildProceduralFromSource(source: LngLat): SyntheticRiver {
  const segments: SyntheticSegment[] = [];
  const features: GeoJSON.Feature[] = [];
  let cursor: LngLat = source;
  const endByParent = new Map<number, { end: LngLat; distance: number }>();
  endByParent.set(-1, { end: source, distance: 0 });

  for (let i = 0; i < MAIN_STEM_LENGTH; i++) {
    const jLng = Math.sin(i * 0.7) * 0.018;
    const jLat = Math.cos(i * 0.9) * 0.014;
    const next: LngLat = [cursor[0] + 0.085 + jLng, cursor[1] - 0.062 + jLat];
    pushSegment(segments, features, cursor, next, i, true);
    endByParent.set(i, { end: next, distance: i });
    cursor = next;
  }

  const bearings: ReadonlyArray<LngLat> = [
    [0.092, -0.02],
    [-0.03, -0.09],
    [0.08, 0.03],
    [0.01, -0.09],
  ];
  BRANCH_PARENT_INDICES.forEach((parentIdx, branchNo) => {
    const len = BRANCH_LENGTHS[branchNo]!;
    const [dLng, dLat] = bearings[branchNo]!;
    const parent = endByParent.get(parentIdx);
    if (!parent) return;
    let bcursor: LngLat = parent.end;
    let bdist = parent.distance;
    for (let j = 0; j < len; j++) {
      const jLng = Math.sin(j * 1.1 + branchNo) * 0.02;
      const jLat = Math.cos(j * 1.3 + branchNo) * 0.018;
      const next: LngLat = [bcursor[0] + dLng + jLng, bcursor[1] + dLat + jLat];
      bdist += 1;
      pushSegment(segments, features, bcursor, next, bdist, false);
      bcursor = next;
    }
  });

  const towns: SyntheticTown[] = PROCEDURAL_TOWNS.map((t, idx) => {
    const seg = segments[Math.min(t.distance, MAIN_STEM_LENGTH - 1)]!;
    return {
      townId: `t${idx + 1}`,
      name: t.name,
      population: t.population,
      segmentId: seg.segmentId,
      lngLat: seg.end,
      distanceFromSource: seg.distanceFromSource,
    };
  });

  const maxDistance = segments.reduce(
    (m, s) => (s.distanceFromSource < UNREACHED ? Math.max(m, s.distanceFromSource) : m),
    0,
  );

  return {
    featureCollection: { type: "FeatureCollection", features },
    segments,
    towns,
    maxDistance,
  };
}
