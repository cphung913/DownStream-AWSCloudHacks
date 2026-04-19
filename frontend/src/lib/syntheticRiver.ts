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

// Hand-traced approximation of the Mississippi River from just above the
// Missouri confluence down to Head of Passes (~70 waypoints). Each LngLat
// is [lng, lat]. Accurate enough for a demo basemap — not survey grade.
const MISSISSIPPI: Basin = {
  mainStem: [
    [-90.200, 38.700],
    [-90.180, 38.630], // St. Louis / Missouri confluence
    [-90.020, 38.500],
    [-89.960, 38.380],
    [-89.900, 38.300],
    [-89.830, 38.100],
    [-89.830, 37.910], // Chester, IL
    [-89.630, 37.550],
    [-89.520, 37.310], // Cape Girardeau
    [-89.350, 37.130],
    [-89.180, 37.000], // Cairo, IL / Ohio confluence
    [-89.195, 36.880],
    [-89.260, 36.775],
    [-89.345, 36.720],
    [-89.435, 36.635],
    [-89.530, 36.595], // New Madrid
    [-89.590, 36.480],
    [-89.555, 36.340],
    [-89.475, 36.245],
    [-89.635, 36.105], // Caruthersville
    [-89.750, 35.990],
    [-89.895, 35.870],
    [-89.870, 35.700], // Osceola
    [-89.990, 35.555],
    [-90.050, 35.380],
    [-90.070, 35.250],
    [-90.060, 35.150], // Memphis, TN
    [-90.130, 35.000],
    [-90.210, 34.860],
    [-90.370, 34.770],
    [-90.580, 34.545], // Helena, AR
    [-90.790, 34.440],
    [-90.900, 34.320],
    [-90.950, 34.150],
    [-90.975, 33.985],
    [-91.020, 33.800], // Rosedale, MS
    [-91.055, 33.620], // Arkansas River confluence
    [-91.075, 33.415], // Greenville, MS
    [-91.205, 33.350],
    [-91.215, 33.185],
    [-91.170, 33.010],
    [-91.075, 32.815], // Lake Providence
    [-91.115, 32.640],
    [-91.220, 32.490],
    [-91.115, 32.400],
    [-90.905, 32.370],
    [-90.870, 32.350], // Vicksburg, MS / Yazoo confluence
    [-90.950, 32.200],
    [-91.105, 32.050],
    [-91.260, 31.890],
    [-91.380, 31.750],
    [-91.400, 31.555], // Natchez, MS
    [-91.475, 31.355],
    [-91.450, 31.155],
    [-91.385, 30.970],
    [-91.380, 30.780], // St. Francisville / Red-Atchafalaya
    [-91.270, 30.580],
    [-91.185, 30.460], // Baton Rouge, LA
    [-91.090, 30.400],
    [-91.005, 30.300],
    [-90.990, 30.105], // Donaldsonville
    [-90.885, 30.020],
    [-90.710, 29.980],
    [-90.540, 29.975],
    [-90.370, 29.910], // Luling
    [-90.245, 29.950],
    [-90.130, 29.945],
    [-90.075, 29.950], // New Orleans, LA
    [-89.970, 29.870],
    [-89.830, 29.710],
    [-89.650, 29.555],
    [-89.470, 29.390],
    [-89.370, 29.270],
    [-89.205, 29.180], // Head of Passes
  ],
  tributaries: [
    {
      name: "Ohio",
      coords: [
        [-85.000, 38.250],
        [-85.750, 38.250],
        [-86.500, 38.100],
        [-87.570, 37.970], // Evansville, IN
        [-88.100, 37.800],
        [-88.420, 37.470],
        [-88.620, 37.300], // Paducah, KY
        [-88.980, 37.080],
        [-89.180, 37.000], // junction at Cairo
      ],
    },
    {
      name: "Missouri",
      coords: [
        [-95.000, 39.200],
        [-94.580, 39.100], // Kansas City
        [-93.500, 39.000],
        [-92.330, 39.000], // Columbia, MO
        [-91.500, 38.850],
        [-90.700, 38.800],
        [-90.180, 38.630], // junction at St. Louis
      ],
    },
    {
      name: "Arkansas",
      coords: [
        [-94.500, 35.400],
        [-93.500, 35.000],
        [-92.500, 34.500],
        [-91.800, 34.000],
        [-91.400, 33.800],
        [-91.055, 33.620], // junction near Rosedale
      ],
    },
    {
      name: "Yazoo",
      coords: [
        [-90.200, 33.400],
        [-90.400, 33.200],
        [-90.600, 32.900],
        [-90.850, 32.450],
        [-90.870, 32.350], // junction at Vicksburg
      ],
    },
    {
      name: "Red/Atchafalaya",
      coords: [
        [-91.380, 30.780], // junction at St. Francisville
        [-91.700, 30.800],
        [-92.050, 30.900],
        [-92.400, 31.000],
        [-92.800, 31.200], // Alexandria, LA
      ],
    },
  ],
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
 * Plume-advection concentration at a river segment at tick T.
 * Rough pulse model — not physics, just enough to walk a coherent gradient
 * downstream over time. Segments with `distanceFromSource >= UNREACHED`
 * sit well beyond the front and stay clear forever.
 */
export function mockConcentrationAt(
  distanceFromSource: number,
  tick: number,
  speed = 2.4,
): number {
  const front = tick * speed;
  const leadingEdgeWidth = 8;

  if (distanceFromSource > front + leadingEdgeWidth) return 0;
  if (distanceFromSource > front) {
    const t = (front + leadingEdgeWidth - distanceFromSource) / leadingEdgeWidth;
    return Math.max(0, t * 0.55);
  }
  const pastFront = front - distanceFromSource;
  return Math.max(0.25, 1 - pastFront / 60);
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
