/**
 * county.js - Bay Area County Regions with Real-Time Pollution Tracking
 * 
 * Each county/region has exactly ONE filled polygon mesh.
 * The fill uses the exact same vertices as the border.
 * Colors update every frame based on particle positions.
 */

import * as THREE from 'three';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  yOffset: 16.0,
  fillOpacity: 0.4,
  borderWidth: 0.35,
  borderOpacity: 0.8,
  borderColor: 0x1a2a3a,
  
  waterOpacity: 0.25,
  waterColor: 0x2266aa,
  waterBorderColor: 0x3388bb,
  
  labelY: 17.5,
  
  // Pollution colors
  cleanColor: new THREE.Color(0x22dd66),
  moderateColor: new THREE.Color(0x4499dd),
  pollutedColor: new THREE.Color(0xdd3322),
  
  // Thresholds
  moderateAt: 30,
  pollutedAt: 200,
};

// ============================================
// MAP BOUNDS (must match map.js exactly)
// ============================================

const GEO = {
  lonMin: -123.135223,
  lonMax: -121.415863,
  latMin: 37.182476,
  latMax: 38.387867
};

const MAP = { width: 151, depth: 134 };

// ============================================
// COORDINATE CONVERSION
// ============================================

function geoToWorld(lon, lat) {
  const x = ((lon - GEO.lonMin) / (GEO.lonMax - GEO.lonMin) - 0.5) * MAP.width;
  const z = (0.5 - (lat - GEO.latMin) / (GEO.latMax - GEO.latMin)) * MAP.depth;
  return [x, z];
}

function worldToGeo(x, z) {
  const lon = GEO.lonMin + ((x / MAP.width) + 0.5) * (GEO.lonMax - GEO.lonMin);
  const lat = GEO.latMin + (0.5 - (z / MAP.depth)) * (GEO.latMax - GEO.latMin);
  return [lon, lat];
}

// ============================================
// REGION DEFINITIONS
// All regions fit together like puzzle pieces.
// Shared borders use EXACT same coordinates.
// ============================================

// Shared vertex points (used by multiple regions)
const PTS = {
  // Map corners
  NW: [GEO.lonMin, GEO.latMax],
  NE: [GEO.lonMax, GEO.latMax],
  SE: [GEO.lonMax, GEO.latMin],
  SW: [GEO.lonMin, GEO.latMin],
  
  // Golden Gate
  GG_N: [-122.478, 37.835],
  GG_S: [-122.478, 37.812],
  
  // SF corners
  SF_SW: [-122.516, 37.708],
  SF_NW: [-122.516, 37.793],
  SF_SE: [-122.357, 37.708],
  SF_NE: [-122.390, 37.812],
  
  // SF Bay perimeter (clockwise from Golden Gate)
  BAY_MARIN: [-122.460, 37.875],
  BAY_RICHMOND: [-122.380, 37.925],
  BAY_BERKELEY: [-122.330, 37.882],
  BAY_OAKLAND: [-122.270, 37.810],
  BAY_ALAMEDA: [-122.240, 37.730],
  BAY_HAYWARD: [-122.130, 37.640],
  BAY_FREMONT: [-122.020, 37.490],
  BAY_ALVISO: [-122.100, 37.485],
  BAY_REDWOOD: [-122.180, 37.590],
  
  // San Pablo Bay perimeter (separate from SF Bay)
  SPB_SW: [-122.430, 37.950],      // Where it meets SF Bay/Marin
  SPB_MARIN: [-122.500, 38.020],   // Marin shore
  SPB_NAPA: [-122.400, 38.080],    // Napa shore  
  SPB_VALLEJO: [-122.270, 38.100], // Solano/Vallejo
  SPB_BENICIA: [-122.150, 38.050], // Solano/Benicia
  SPB_MARTINEZ: [-122.100, 38.020],// Contra Costa/Martinez
  SPB_SE: [-122.250, 37.960],      // SE corner back to Richmond
  
  // County border points (not on water)
  SM_SC: [-122.100, 37.380],       // San Mateo / Santa Clara
  SC_AL: [-121.920, 37.510],       // Santa Clara / Alameda  
  SC_AL2: [-121.750, 37.490],      // SC/AL east
  AL_CC: [-121.560, 37.760],       // Alameda / Contra Costa east
  AL_CC2: [-121.870, 37.790],      // AL/CC west (hills)
  AL_CC3: [-122.060, 37.882],      // AL/CC at bay
  CC_SO: [-121.560, 38.020],       // Contra Costa / Solano (east edge)
  NA_SO: [-122.150, 38.160],       // Napa / Solano border
  NA_MA: [-122.540, 38.110],       // Napa / Marin
  NA_SON: [-122.630, 38.210],      // Napa / Sonoma
  MA_SON: [-122.720, 38.030],      // Marin / Sonoma
  
  // Coast points
  COAST_MARIN_S: [-122.540, 37.850],
  COAST_MARIN_N: [-122.870, 38.070],
  COAST_SM: [-122.520, 37.490],
  COAST_SC: [-122.470, 37.182],
};

const REGIONS = {
  
  // ========== COUNTIES ==========
  
  san_francisco: {
    name: 'San Francisco',
    type: 'county',
    label: [-122.44, 37.76],
    coords: [
      PTS.SF_SW, PTS.SF_NW, PTS.GG_S, PTS.SF_NE, PTS.SF_SE, PTS.SF_SW
    ]
  },
  
  san_mateo: {
    name: 'San Mateo',
    type: 'county',
    label: [-122.38, 37.50],
    coords: [
      PTS.SF_SW, PTS.SF_SE, PTS.BAY_REDWOOD, PTS.BAY_ALVISO, PTS.SM_SC,
      [-122.100, GEO.latMin], PTS.COAST_SC, PTS.COAST_SM, PTS.SF_SW
    ]
  },
  
  santa_clara: {
    name: 'Santa Clara',
    type: 'county',
    label: [-121.82, 37.32],
    coords: [
      PTS.SM_SC, PTS.BAY_ALVISO, PTS.BAY_FREMONT, PTS.SC_AL, PTS.SC_AL2,
      [-121.560, 37.640], [GEO.lonMax, 37.640], PTS.SE,
      [-122.100, GEO.latMin], PTS.SM_SC
    ]
  },
  
  alameda: {
    name: 'Alameda',
    type: 'county',
    label: [-121.95, 37.70],
    coords: [
      PTS.BAY_BERKELEY, PTS.BAY_OAKLAND, PTS.BAY_ALAMEDA, PTS.BAY_HAYWARD,
      PTS.BAY_FREMONT, PTS.SC_AL, PTS.SC_AL2, [-121.560, 37.640],
      PTS.AL_CC, PTS.AL_CC2, PTS.AL_CC3, PTS.BAY_BERKELEY
    ]
  },
  
  contra_costa: {
    name: 'Contra Costa',
    type: 'county',
    label: [-121.92, 37.92],
    coords: [
      PTS.SPB_SE, PTS.BAY_BERKELEY, PTS.AL_CC3, PTS.AL_CC2,
      PTS.AL_CC, [-121.560, 37.640], [GEO.lonMax, 37.640], [GEO.lonMax, 38.020],
      PTS.CC_SO, PTS.SPB_MARTINEZ, PTS.SPB_SE
    ]
  },
  
  solano: {
    name: 'Solano',
    type: 'county',
    label: [-122.00, 38.20],
    coords: [
      PTS.SPB_BENICIA, PTS.SPB_VALLEJO, PTS.NA_SO, 
      [-122.150, GEO.latMax], [GEO.lonMax, GEO.latMax], [GEO.lonMax, 38.020],
      PTS.CC_SO, PTS.SPB_MARTINEZ, PTS.SPB_BENICIA
    ]
  },
  
  napa: {
    name: 'Napa',
    type: 'county',
    label: [-122.32, 38.30],
    coords: [
      PTS.SPB_NAPA, PTS.SPB_VALLEJO, PTS.NA_SO,
      [-122.150, GEO.latMax], [-122.500, GEO.latMax],
      PTS.NA_SON, PTS.NA_MA, PTS.SPB_MARIN, PTS.SPB_NAPA
    ]
  },
  
  marin: {
    name: 'Marin',
    type: 'county',
    label: [-122.58, 37.96],
    coords: [
      PTS.GG_N, PTS.COAST_MARIN_S, PTS.MA_SON, PTS.COAST_MARIN_N,
      PTS.NA_SON, [-122.500, GEO.latMax], PTS.NA_MA, 
      PTS.SPB_MARIN, PTS.SPB_SW, PTS.BAY_RICHMOND, PTS.BAY_MARIN, PTS.GG_N
    ]
  },
  
  sonoma: {
    name: 'Sonoma',
    type: 'county',
    label: [-122.88, 38.33],
    coords: [
      PTS.MA_SON, PTS.COAST_MARIN_S, [GEO.lonMin, 37.950],
      PTS.NW, [-122.500, GEO.latMax], PTS.NA_SON, PTS.COAST_MARIN_N, PTS.MA_SON
    ]
  },
  
  // ========== WATER ==========
  
  pacific: {
    name: 'Pacific Ocean',
    type: 'water',
    label: [-122.90, 37.55],
    coords: [
      PTS.SW, [GEO.lonMin, 37.950], PTS.COAST_MARIN_S, PTS.GG_N, PTS.GG_S,
      PTS.SF_NW, PTS.SF_SW, PTS.COAST_SM, PTS.COAST_SC, PTS.SW
    ]
  },
  
  sf_bay: {
    name: 'SF Bay',
    type: 'water',
    label: [-122.22, 37.72],
    coords: [
      PTS.GG_S, PTS.GG_N, PTS.BAY_MARIN, PTS.BAY_RICHMOND, PTS.SPB_SW,
      PTS.SPB_SE, PTS.BAY_BERKELEY, PTS.BAY_OAKLAND, PTS.BAY_ALAMEDA,
      PTS.BAY_HAYWARD, PTS.BAY_FREMONT, PTS.BAY_ALVISO,
      PTS.BAY_REDWOOD, PTS.SF_SE, PTS.SF_NE, PTS.GG_S
    ]
  },
  
  san_pablo_bay: {
    name: 'San Pablo Bay',
    type: 'water',
    label: [-122.35, 38.04],
    coords: [
      PTS.SPB_SW, PTS.SPB_MARIN, PTS.SPB_NAPA, PTS.SPB_VALLEJO,
      PTS.SPB_BENICIA, PTS.SPB_MARTINEZ, PTS.SPB_SE, PTS.SPB_SW
    ]
  },
};

// ============================================
// STATE
// ============================================

let scene = null;
let countyGroup = null;
let fillMaterials = {};
let particleCounts = {};

Object.keys(REGIONS).forEach(id => { particleCounts[id] = 0; });

// ============================================
// MAIN INITIALIZATION
// ============================================

export function initCounties(sceneRef) {
  console.log('Initializing county regions...');
  
  scene = sceneRef;
  countyGroup = new THREE.Group();
  countyGroup.name = 'countyRegions';
  
  Object.entries(REGIONS).forEach(([id, region]) => {
    // Convert coords to world space once
    const worldCoords = region.coords.map(([lon, lat]) => geoToWorld(lon, lat));
    
    // Create ONE fill mesh
    const fill = createFill(id, region, worldCoords);
    if (fill) countyGroup.add(fill);
    
    // Create border using same coords
    const border = createBorder(id, region, worldCoords);
    if (border) countyGroup.add(border);
    
    // Create label
    const label = createLabel(region);
    if (label) countyGroup.add(label);
  });
  
  scene.add(countyGroup);
  
  const counties = Object.values(REGIONS).filter(r => r.type === 'county').length;
  const water = Object.values(REGIONS).filter(r => r.type === 'water').length;
  console.log(`  -> ${counties} counties, ${water} water bodies`);
  
  return countyGroup;
}

// ============================================
// CREATE FILL MESH (exactly matches border)
// ============================================

function createFill(id, region, worldCoords) {
  if (worldCoords.length < 3) return null;
  
  // Create 2D shape from world coords
  // Note: negate z because rotateX(-PI/2) flips the z axis
  const points = worldCoords.map(([x, z]) => new THREE.Vector2(x, -z));
  const shape = new THREE.Shape(points);
  const geometry = new THREE.ShapeGeometry(shape);
  
  // Rotate to XZ plane and position at Y offset
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, CONFIG.yOffset, 0);
  
  // Material
  const isWater = region.type === 'water';
  const material = new THREE.MeshBasicMaterial({
    color: isWater ? CONFIG.waterColor : CONFIG.cleanColor.clone(),
    transparent: true,
    opacity: isWater ? CONFIG.waterOpacity : CONFIG.fillOpacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  
  fillMaterials[id] = material;
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `fill_${id}`;
  mesh.renderOrder = 15;
  mesh.userData = { regionId: id };
  
  return mesh;
}

// ============================================
// CREATE BORDER RIBBON (uses same coords as fill)
// ============================================

function createBorder(id, region, worldCoords) {
  if (worldCoords.length < 3) return null;
  
  const isWater = region.type === 'water';
  const color = isWater ? CONFIG.waterBorderColor : CONFIG.borderColor;
  const hw = CONFIG.borderWidth / 2;
  const y = CONFIG.yOffset + 0.03;
  
  const positions = [];
  const indices = [];
  let vi = 0;
  
  for (let i = 0; i < worldCoords.length - 1; i++) {
    const [x1, z1] = worldCoords[i];
    const [x2, z2] = worldCoords[i + 1];
    
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx*dx + dz*dz);
    if (len < 0.001) continue;
    
    // Perpendicular
    const px = (-dz / len) * hw;
    const pz = (dx / len) * hw;
    
    positions.push(
      x1 - px, y, z1 - pz,
      x1 + px, y, z1 + pz,
      x2 - px, y, z2 - pz,
      x2 + px, y, z2 + pz
    );
    
    indices.push(vi, vi+1, vi+2, vi+1, vi+3, vi+2);
    vi += 4;
  }
  
  if (positions.length === 0) return null;
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  
  const material = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: CONFIG.borderOpacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `border_${id}`;
  mesh.renderOrder = 16;
  
  return mesh;
}

// ============================================
// CREATE LABEL
// ============================================

function createLabel(region) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  ctx.font = 'bold 22px Arial';
  const tw = ctx.measureText(region.name).width;
  
  canvas.width = tw + 16;
  canvas.height = 30;
  
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.strokeStyle = region.type === 'water' ? '#4488cc' : '#44cc88';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width-2, canvas.height-2);
  
  ctx.font = 'bold 22px Arial';
  ctx.fillStyle = region.type === 'water' ? '#88ccff' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(region.name, canvas.width/2, canvas.height/2);
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  
  const sprite = new THREE.Sprite(material);
  const [wx, wz] = geoToWorld(region.label[0], region.label[1]);
  sprite.position.set(wx, CONFIG.labelY, wz);
  sprite.scale.set(canvas.width/10, canvas.height/10, 1);
  sprite.renderOrder = 100;
  
  return sprite;
}

// ============================================
// POLLUTION COLOR
// ============================================

function getPollutionColor(count) {
  if (count <= CONFIG.moderateAt) {
    const t = count / CONFIG.moderateAt;
    return CONFIG.cleanColor.clone().lerp(CONFIG.moderateColor, t);
  } else if (count <= CONFIG.pollutedAt) {
    const t = (count - CONFIG.moderateAt) / (CONFIG.pollutedAt - CONFIG.moderateAt);
    return CONFIG.moderateColor.clone().lerp(CONFIG.pollutedColor, t);
  }
  return CONFIG.pollutedColor.clone();
}

// ============================================
// POINT IN POLYGON
// ============================================

function pointInPolygon(lon, lat, coords) {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const [xi, yi] = coords[i];
    const [xj, yj] = coords[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function getRegionAt(x, z) {
  const [lon, lat] = worldToGeo(x, z);
  
  // Check counties first
  for (const [id, region] of Object.entries(REGIONS)) {
    if (region.type === 'water') continue;
    if (pointInPolygon(lon, lat, region.coords)) return id;
  }
  
  // Then water
  for (const [id, region] of Object.entries(REGIONS)) {
    if (region.type !== 'water') continue;
    if (pointInPolygon(lon, lat, region.coords)) return id;
  }
  
  return null;
}

// ============================================
// REAL-TIME PARTICLE UPDATE (call each frame)
// ============================================

export function updatePollutionFromParticles(particles) {
  // Reset
  Object.keys(particleCounts).forEach(id => { particleCounts[id] = 0; });
  
  // Count particles per region
  Object.values(particles).forEach(arr => {
    arr.forEach(p => {
      const id = getRegionAt(p.x, p.z);
      if (id) particleCounts[id]++;
    });
  });
  
  // Update colors (all regions including water)
  Object.entries(particleCounts).forEach(([id, count]) => {
    const mat = fillMaterials[id];
    if (mat) {
      const color = getPollutionColor(count);
      // Water gets a blue tint blended with pollution
      if (REGIONS[id]?.type === 'water') {
        color.lerp(CONFIG.waterColor, 0.5);
      }
      mat.color.copy(color);
    }
  });
}

// ============================================
// VISIBILITY
// ============================================

export function toggleCounties() {
  if (countyGroup) {
    countyGroup.visible = !countyGroup.visible;
    return countyGroup.visible;
  }
  return false;
}

export function areCountiesVisible() {
  return countyGroup?.visible ?? false;
}

export function setCountiesVisible(v) {
  if (countyGroup) countyGroup.visible = v;
}

// ============================================
// DEBUG
// ============================================

export function getParticleCounts() {
  return { ...particleCounts };
}

export function getRegions() {
  return REGIONS;
}

// ============================================
// CLEANUP
// ============================================

export function disposeCounties() {
  if (countyGroup && scene) {
    scene.remove(countyGroup);
    countyGroup.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    });
  }
  countyGroup = null;
  fillMaterials = {};
}

export { CONFIG, REGIONS };