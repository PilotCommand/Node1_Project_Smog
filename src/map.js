/**
 * map.js  Terrain + landmarks + coordinate conventions
 * 
 * Builds the Bay Area world representation using real elevation data from GeoTIFF.
 * Owns: terrain mesh, water plane, landmark meshes, coordinate mapping
 */

import * as THREE from 'three';
import { 
  LINE_EMITTERS, 
  POINT_EMITTERS, 
  getProfile, 
  geoToWorld as registryGeoToWorld 
} from './registry.js';

// ============================================
// Simple TIFF Parser (for uncompressed 32-bit float GeoTIFF)
// ============================================

async function parseGeoTIFF(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  
  // Check byte order (II = little-endian, MM = big-endian)
  const byteOrder = view.getUint16(0, true);
  const littleEndian = (byteOrder === 0x4949); // 'II'
  
  // Verify TIFF magic number
  const magic = view.getUint16(2, littleEndian);
  if (magic !== 42) throw new Error('Not a valid TIFF file');
  
  // Get IFD offset
  const ifdOffset = view.getUint32(4, littleEndian);
  
  // Read IFD entries
  const numEntries = view.getUint16(ifdOffset, littleEndian);
  
  let width = 0, height = 0, bitsPerSample = 0, stripOffsets = [], stripByteCounts = [];
  let rowsPerStrip = 0, sampleFormat = 1;
  
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = entryOffset + 8;
    
    // Read value based on type and count
    const getValue = () => {
      if (type === 3) return view.getUint16(valueOffset, littleEndian); // SHORT
      if (type === 4) return view.getUint32(valueOffset, littleEndian); // LONG
      return view.getUint32(valueOffset, littleEndian);
    };
    
    const getValues = (offset) => {
      const values = [];
      const actualOffset = count > 1 ? view.getUint32(valueOffset, littleEndian) : valueOffset;
      for (let j = 0; j < count; j++) {
        if (type === 3) values.push(view.getUint16(actualOffset + j * 2, littleEndian));
        else if (type === 4) values.push(view.getUint32(actualOffset + j * 4, littleEndian));
      }
      return values;
    };
    
    switch (tag) {
      case 256: width = getValue(); break;           // ImageWidth
      case 257: height = getValue(); break;          // ImageLength
      case 258: bitsPerSample = getValue(); break;   // BitsPerSample
      case 273: stripOffsets = getValues(); break;   // StripOffsets
      case 278: rowsPerStrip = getValue(); break;    // RowsPerStrip
      case 279: stripByteCounts = getValues(); break; // StripByteCounts
      case 339: sampleFormat = getValue(); break;    // SampleFormat (3 = float)
    }
  }
  
  console.log(`    TIFF: ${width}x${height}, ${bitsPerSample}-bit, format=${sampleFormat}`);
  
  // Read the raster data
  const pixelCount = width * height;
  const data = new Float32Array(pixelCount);
  
  if (bitsPerSample === 32 && sampleFormat === 3) {
    // 32-bit float
    let pixelIndex = 0;
    for (let s = 0; s < stripOffsets.length; s++) {
      const offset = stripOffsets[s];
      const byteCount = stripByteCounts[s];
      const floatCount = byteCount / 4;
      
      for (let i = 0; i < floatCount && pixelIndex < pixelCount; i++) {
        data[pixelIndex++] = view.getFloat32(offset + i * 4, littleEndian);
      }
    }
  } else {
    throw new Error(`Unsupported TIFF format: ${bitsPerSample}-bit, sampleFormat=${sampleFormat}`);
  }
  
  return { width, height, data };
}

// ============================================
// Constants & Configuration
// ============================================

// World scale: 1 unit = approx 1 km
const WORLD_SCALE = 1;

// Bay Area bounds (accurate to TIFF coverage)
const MAP_BOUNDS = {
  width: 151,   // 151 km east-west
  depth: 134,   // 134 km north-south
  maxHeight: 25 // max terrain height in world units
};

// Geographic coordinate bounds (WGS84)
const GEO_BOUNDS = {
  lonMin: -123.135223,  // West
  lonMax: -121.415863,  // East
  latMin: 37.182476,    // South
  latMax: 38.387867     // North
};

// Terrain configuration for GeoTIFF
const TERRAIN_CONFIG = {
  heightmapUrl: '/baymerge.tif',
  verticalScale: 0.008,  // 8x exaggeration for visible relief
  smoothingPasses: 2,    // Number of smoothing iterations (0 = none)
  waterLevel: 0.11,      // Y offset for water plane (adjust to tune coastlines)
};

// NOTE: Landmark positions now come from registry.js (POINT_EMITTERS)
// The old hardcoded LANDMARKS object has been removed.
// See registry.js for all emitter locations with real geographic coordinates.

// Store references
let terrain, water, landmarkMeshes = [], gridHelper;
let elevationData = null;  // Float32Array from GeoTIFF
let rasterWidth = 0;
let rasterHeight = 0;
let minElevation = Infinity;
let maxElevation = -Infinity;
let highwayGroup = null;  // Highway ribbon meshes

// ============================================
// Elevation Smoothing (Gaussian-like blur)
// ============================================

function smoothElevationData(data, width, height, passes = 1) {
  if (passes <= 0) return data;
  
  console.log(`    Smoothing elevation data (${passes} passes)...`);
  
  let current = new Float32Array(data);
  let next = new Float32Array(data.length);
  
  // 3x3 Gaussian-ish kernel weights
  const kernel = [
    1, 2, 1,
    2, 4, 2,
    1, 2, 1
  ];
  const kernelSum = 16;
  
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        // Check if this is a nodata pixel - don't smooth those
        if (current[idx] < -1000) {
          next[idx] = current[idx];
          continue;
        }
        
        let sum = 0;
        let weightSum = 0;
        
        // Sample 3x3 neighborhood
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nx = x + kx;
            const ny = y + ky;
            
            // Skip out of bounds
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            
            const nidx = ny * width + nx;
            const val = current[nidx];
            
            // Skip nodata neighbors
            if (val < -1000) continue;
            
            const weight = kernel[(ky + 1) * 3 + (kx + 1)];
            sum += val * weight;
            weightSum += weight;
          }
        }
        
        next[idx] = weightSum > 0 ? sum / weightSum : current[idx];
      }
    }
    
    // Swap buffers
    [current, next] = [next, current];
  }
  
  return current;
}

// ============================================
// Initialization
// ============================================

export function initMap(scene) {
  console.log('[Map] Building Bay Area map...');
  
  // Load GeoTIFF and create terrain
  loadGeoTIFFAndCreateTerrain(scene);
  createWater(scene);
  createGrid(scene);
  createAtmosphericEffects(scene);
  
  return {
    bounds: MAP_BOUNDS,
    getTerrainHeight,
    getLandmarkPositions,
    worldToScreen
  };
}

// ============================================
// GeoTIFF Loading
// ============================================

async function loadGeoTIFFAndCreateTerrain(scene) {
  try {
    console.log('    Loading GeoTIFF...');
    
    // Fetch the TIFF file
    const response = await fetch(TERRAIN_CONFIG.heightmapUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // Parse with our simple TIFF parser
    const tiffData = await parseGeoTIFF(arrayBuffer);
    
    // Store the data
    rasterWidth = tiffData.width;
    rasterHeight = tiffData.height;
    
    // Apply smoothing to reduce jaggedness
    elevationData = smoothElevationData(
      tiffData.data, 
      rasterWidth, 
      rasterHeight, 
      TERRAIN_CONFIG.smoothingPasses
    );
    
    console.log(`    GeoTIFF loaded: ${rasterWidth}x${rasterHeight}`);
    
    // Find min/max elevation for normalization info
    for (let i = 0; i < elevationData.length; i++) {
      const val = elevationData[i];
      if (Number.isFinite(val) && val > -1000) {
        if (val < minElevation) minElevation = val;
        if (val > maxElevation) maxElevation = val;
      }
    }
    
    console.log(`    Elevation range: ${minElevation.toFixed(1)}m to ${maxElevation.toFixed(1)}m`);
    
    // Create terrain mesh
    createTerrainFromGeoTIFF(scene);
    
    // Now create landmarks (need terrain heights)
    createLandmarks(scene);
    
  } catch (error) {
    console.error('    Failed to load GeoTIFF:', error);
    console.log('    Falling back to procedural terrain');
    createProceduralTerrain(scene);
    createLandmarks(scene);
  }
}

// ============================================
// Terrain from GeoTIFF (direct vertex mapping)
// ============================================

function createTerrainFromGeoTIFF(scene) {
  // Create geometry with segments matching raster dimensions exactly
  // This gives us a 1:1 vertex-to-pixel correspondence
  const segmentsX = rasterWidth - 1;
  const segmentsZ = rasterHeight - 1;
  
  const geometry = new THREE.PlaneGeometry(
    MAP_BOUNDS.width,
    MAP_BOUNDS.depth,
    segmentsX,
    segmentsZ
  );
  
  // Rotate to XZ plane (Y = up)
  geometry.rotateX(-Math.PI / 2);
  
  const positions = geometry.attributes.position;
  
  // Delta basin elevation adjustment region
  // 121.8°W to 121.4°W AND 37.6°N to 38.4°N
  const deltaRegion = {
    lonMin: -121.8,
    lonMax: -121.4,
    latMin: 37.6,
    latMax: 38.4,
    elevationBoost: 0.01,  // 1% of max terrain height
    blendDistance: 0.1     // Degrees to blend at edges
  };
  
  // PlaneGeometry vertex order is row-major: (segmentsX+1) x (segmentsZ+1)
  // which equals rasterWidth x rasterHeight
  for (let i = 0; i < positions.count; i++) {
    // Get grid coordinates from vertex index
    const gridX = i % rasterWidth;
    const gridZ = Math.floor(i / rasterWidth);
    
    // Flip Y so north points to +Z (GeoTIFF row 0 is typically north)
    const srcZ = gridZ;
    const srcIndex = srcZ * rasterWidth + gridX;
    
    // Get elevation and convert to world height
    const elevation = elevationData[srcIndex];
    let height = elevationToWorldY(elevation);
    
    // Calculate geographic coordinates for this vertex
    const u = gridX / (rasterWidth - 1);  // 0 to 1 across width
    const v = gridZ / (rasterHeight - 1); // 0 to 1 across depth
    
    const lon = GEO_BOUNDS.lonMin + u * (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin);
    const lat = GEO_BOUNDS.latMax - v * (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin); // Flip for GeoTIFF
    
    // Apply elevation boost in delta region with smooth blending
    if (lon >= deltaRegion.lonMin - deltaRegion.blendDistance && 
        lon <= deltaRegion.lonMax + deltaRegion.blendDistance &&
        lat >= deltaRegion.latMin - deltaRegion.blendDistance && 
        lat <= deltaRegion.latMax + deltaRegion.blendDistance) {
      
      // Calculate blend factor for each edge (0 at edge, 1 fully inside)
      const blendLeft = Math.min(1, Math.max(0, (lon - (deltaRegion.lonMin - deltaRegion.blendDistance)) / deltaRegion.blendDistance));
      const blendRight = Math.min(1, Math.max(0, ((deltaRegion.lonMax + deltaRegion.blendDistance) - lon) / deltaRegion.blendDistance));
      const blendBottom = Math.min(1, Math.max(0, (lat - (deltaRegion.latMin - deltaRegion.blendDistance)) / deltaRegion.blendDistance));
      const blendTop = Math.min(1, Math.max(0, ((deltaRegion.latMax + deltaRegion.blendDistance) - lat) / deltaRegion.blendDistance));
      
      // Combine blend factors (smoothstep for smoother transition)
      const smoothstep = (t) => t * t * (3 - 2 * t);
      const blendFactor = smoothstep(blendLeft) * smoothstep(blendRight) * smoothstep(blendBottom) * smoothstep(blendTop);
      
      // Add blended boost
      const boost = MAP_BOUNDS.maxHeight * deltaRegion.elevationBoost * blendFactor;
      height += boost;
    }
    
    positions.setY(i, height);
  }
  
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  
  // Terrain material
  const material = new THREE.MeshStandardMaterial({
    color: 0x5a8a6e,
    roughness: 0.85,
    metalness: 0.1,
    flatShading: false,
    vertexColors: false
  });
  
  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);
  
  console.log(`    Terrain created: ${rasterWidth}x${rasterHeight} vertices`);
}

// Convert raw elevation (meters) to world Y coordinate
function elevationToWorldY(val) {
  // Handle nodata/invalid values
  if (!Number.isFinite(val) || val < -1000) {
    return 0; // Treat nodata as sea level
  }
  return val * TERRAIN_CONFIG.verticalScale;
}

// ============================================
// Sample Elevation (for runtime height queries)
// Used by particles, landmarks, etc. to get terrain height at any world position
// Uses bilinear interpolation for smooth results between grid points
// ============================================

function sampleElevation(worldX, worldZ) {
  if (!elevationData) return 0;
  
  // Convert world coordinates to UV (0-1)
  const u = (worldX + MAP_BOUNDS.width / 2) / MAP_BOUNDS.width;
  const v = (worldZ + MAP_BOUNDS.depth / 2) / MAP_BOUNDS.depth;
  
  // Clamp to valid range
  const clampedU = Math.max(0, Math.min(1, u));
  const clampedV = Math.max(0, Math.min(1, v));
  
  // Convert to pixel coordinates
  const px = clampedU * (rasterWidth - 1);
  // Direct mapping (no flip)
  const py = clampedV * (rasterHeight - 1);
  
  // Bilinear interpolation for smooth sampling
  const x0 = Math.floor(px);
  const z0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, rasterWidth - 1);
  const z1 = Math.min(z0 + 1, rasterHeight - 1);
  
  const fx = px - x0;
  const fz = py - z0;
  
  // Get 4 neighboring elevation values
  const getElev = (x, z) => {
    const idx = z * rasterWidth + x;
    const val = elevationData[idx];
    return (Number.isFinite(val) && val > -1000) ? val : 0;
  };
  
  const e00 = getElev(x0, z0);
  const e10 = getElev(x1, z0);
  const e01 = getElev(x0, z1);
  const e11 = getElev(x1, z1);
  
  // Bilinear interpolation
  const top = e00 * (1 - fx) + e10 * fx;
  const bottom = e01 * (1 - fx) + e11 * fx;
  let elevation = top * (1 - fz) + bottom * fz;
  
  let height = elevation * TERRAIN_CONFIG.verticalScale;
  
  // Apply delta basin elevation boost
  // Convert world coords to geographic
  const lon = GEO_BOUNDS.lonMin + clampedU * (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin);
  const lat = GEO_BOUNDS.latMax - clampedV * (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin);
  
  // Delta region: 121.8°W to 121.4°W AND 37.6°N to 38.4°N with smooth blending
  const deltaLonMin = -121.8, deltaLonMax = -121.4;
  const deltaLatMin = 37.6, deltaLatMax = 38.4;
  const blendDist = 0.1;
  
  if (lon >= deltaLonMin - blendDist && lon <= deltaLonMax + blendDist &&
      lat >= deltaLatMin - blendDist && lat <= deltaLatMax + blendDist) {
    
    // Calculate blend factor for each edge
    const blendLeft = Math.min(1, Math.max(0, (lon - (deltaLonMin - blendDist)) / blendDist));
    const blendRight = Math.min(1, Math.max(0, ((deltaLonMax + blendDist) - lon) / blendDist));
    const blendBottom = Math.min(1, Math.max(0, (lat - (deltaLatMin - blendDist)) / blendDist));
    const blendTop = Math.min(1, Math.max(0, ((deltaLatMax + blendDist) - lat) / blendDist));
    
    // Smoothstep for smoother transition
    const smoothstep = (t) => t * t * (3 - 2 * t);
    const blendFactor = smoothstep(blendLeft) * smoothstep(blendRight) * smoothstep(blendBottom) * smoothstep(blendTop);
    
    height += MAP_BOUNDS.maxHeight * 0.01 * blendFactor; // 1% boost with blend
  }
  
  return height;
}

// ============================================
// Procedural Terrain (Fallback)
// ============================================

function createProceduralTerrain(scene) {
  const geometry = new THREE.PlaneGeometry(
    MAP_BOUNDS.width,
    MAP_BOUNDS.depth,
    128,
    128
  );
  
  geometry.rotateX(-Math.PI / 2);
  
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    
    let height = 0;
    
    // East Bay hills
    if (x > 5 && x < 35) {
      const hillFactor = Math.max(0, 1 - Math.abs(x - 20) / 15);
      height += hillFactor * 4 * (0.5 + 0.5 * Math.sin(z * 0.1));
    }
    
    // Marin headlands
    if (x < -10 && z > 10) {
      const marinFactor = Math.max(0, 1 - Math.abs(x + 25) / 20) * Math.max(0, 1 - Math.abs(z - 25) / 20);
      height += marinFactor * 5;
    }
    
    // Santa Cruz mountains
    if (x < 5 && z < -20) {
      const scFactor = Math.max(0, 1 - Math.abs(x + 10) / 20) * Math.max(0, 1 - Math.abs(z + 40) / 25);
      height += scFactor * 6;
    }
    
    // Bay depression
    const distFromBay = Math.sqrt(Math.pow(x / 15, 2) + Math.pow(z / 25, 2));
    if (distFromBay < 1) {
      height -= (1 - distFromBay) * 3;
    }
    
    height += Math.sin(x * 0.3) * Math.cos(z * 0.3) * 0.5;
    
    positions.setY(i, Math.max(-1, height));
  }
  
  geometry.computeVertexNormals();
  
  const material = new THREE.MeshStandardMaterial({
    color: 0x5a8a6e,
    roughness: 0.9,
    metalness: 0.1,
    flatShading: false,
  });
  
  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);
}

// ============================================
// Water (Ocean/Bay)
// ============================================

function createWater(scene) {
  // Create water plane matching terrain dimensions exactly
  const waterGeometry = new THREE.PlaneGeometry(
    MAP_BOUNDS.width,
    MAP_BOUNDS.depth,
    64,
    64
  );
  waterGeometry.rotateX(-Math.PI / 2);
  
  // Add subtle wave displacement
  const positions = waterGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    // Gentle waves
    const wave = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 0.1;
    positions.setY(i, wave);
  }
  waterGeometry.computeVertexNormals();
  
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a8aaa,
    roughness: 0.1,
    metalness: 0.8,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide
  });
  
  water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.set(0, TERRAIN_CONFIG.waterLevel, 0);
  water.receiveShadow = true;
  scene.add(water);
  
  // Ocean depth glow effect (same size as terrain)
  const glowGeometry = new THREE.PlaneGeometry(
    MAP_BOUNDS.width,
    MAP_BOUNDS.depth
  );
  glowGeometry.rotateX(-Math.PI / 2);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x2288cc,
    transparent: true,
    opacity: 0.3,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.set(0, TERRAIN_CONFIG.waterLevel - 1, 0);
  scene.add(glow);
}

// ============================================
// Landmarks (Visual markers for emitters from registry)
// ============================================

// Store label sprites for landmarks
let landmarkLabels = [];

/**
 * Create visual markers and labels for all point emitters from registry
 */
function createLandmarks(scene) {
  console.log('🏙️ Creating landmarks from registry...');
  
  // Clear existing
  landmarkMeshes.forEach(mesh => {
    scene.remove(mesh);
    mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  });
  landmarkMeshes = [];
  landmarkLabels = [];
  
  let counts = { urban: 0, airport: 0, refinery: 0, port: 0, bridge: 0, other: 0 };
  
  POINT_EMITTERS.forEach(emitter => {
    const profile = getProfile(emitter.profile);
    if (!profile) return;
    
    // Convert geo coords to world coords
    const worldCoords = registryGeoToWorld(emitter.coords.lon, emitter.coords.lat);
    const terrainH = getTerrainHeight(worldCoords.x, worldCoords.z);
    
    // Create group for this landmark
    const group = new THREE.Group();
    group.position.set(worldCoords.x, terrainH, worldCoords.z);
    
    // Apply rotation if specified (in degrees)
    if (emitter.rotation) {
      group.rotation.y = emitter.rotation * (Math.PI / 180);
    }
    
    group.userData = { 
      id: emitter.id, 
      name: emitter.name,
      type: profile.type,
      profile: emitter.profile
    };
    
    // Create visual based on emitter type
    const type = profile.type;
    
    if (type === 'urban') {
      createCityVisual(group, emitter, profile);
      counts.urban++;
    } else if (type === 'airport' || type === 'military') {
      createAirportVisual(group, emitter, profile);
      counts.airport++;
    } else if (type === 'refinery') {
      createRefineryVisual(group, emitter, profile);
      counts.refinery++;
    } else if (type === 'port') {
      createPortVisual(group, emitter, profile);
      counts.port++;
    } else if (type === 'bridge') {
      createBridgeVisual(group, emitter, profile);
      counts.bridge++;
    } else if (type === 'interchange') {
      createInterchangeVisual(group, emitter, profile);
      counts.other++;
    } else if (type === 'memorial') {
      // Memorial - subtle marker, no emissions
      createMemorialVisual(group, emitter, profile);
      counts.other++;
    } else {
      // Default fallback
      createDefaultVisual(group, emitter, profile);
      counts.other++;
    }
    
    // Add label above the landmark (hidden by default)
    const label = createLandmarkLabel(emitter.name, profile.type);
    if (label) {
      // Position label above the visual
      const labelHeight = getLabelHeight(profile);
      label.position.set(0, labelHeight, 0);
      label.visible = false; // Hidden by default, shown on hover
      group.add(label);
      group.userData.label = label; // Store reference for hover system
      landmarkLabels.push(label);
    }
    
    scene.add(group);
    landmarkMeshes.push(group);
  });
  
  console.log(`  → Created ${landmarkMeshes.length} landmarks:`, counts);
}

/**
 * Get appropriate label height based on profile type
 */
function getLabelHeight(profile) {
  const type = profile.type;
  if (type === 'refinery') return (profile.height || 5) + (profile.plumeRise || 0) + 3;
  if (type === 'urban') return (profile.height || 0.5) + 4;
  if (type === 'port') return 5;
  if (type === 'bridge') return 4;
  return 3;
}

/**
 * Create a text label sprite matching HUD panel style
 * Canvas and sprite scale dynamically based on text length
 */
function createLandmarkLabel(text, type) {
  // Font settings - matching HUD style (Space Grotesk, not bold)
  const fontSize = 44;
  const fontFamily = '"Space Grotesk", Arial, sans-serif';
  const font = `${fontSize}px ${fontFamily}`;
  
  // Create temporary canvas to measure text
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = font;
  const textMetrics = measureCtx.measureText(text);
  const textWidth = textMetrics.width;
  
  // Generous padding to match HUD panel feel
  const paddingX = 48;
  const paddingY = 28;
  const canvasWidth = Math.max(160, textWidth + paddingX * 2 + 20);
  const canvasHeight = fontSize + paddingY * 2 + 20;
  
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  
  // Clear
  context.clearRect(0, 0, canvas.width, canvas.height);
  
  // Background panel dimensions
  const panelWidth = textWidth + paddingX * 2;
  const panelHeight = fontSize + paddingY * 2;
  const panelX = (canvas.width - panelWidth) / 2;
  const panelY = (canvas.height - panelHeight) / 2;
  const borderRadius = 12;
  
  // Drop shadow matching HUD: box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4)
  context.shadowColor = 'rgba(0, 0, 0, 0.4)';
  context.shadowBlur = 24;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 4;
  
  // Background matching HUD: rgba(10, 10, 20, 0.85)
  context.fillStyle = 'rgba(10, 10, 20, 0.85)';
  context.beginPath();
  context.roundRect(panelX, panelY, panelWidth, panelHeight, borderRadius);
  context.fill();
  
  // Reset shadow for border
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  
  // Colored border based on type
  const borderColors = {
    urban: '#4a90d9',
    airport: '#e74c3c',
    military: '#2c3e50',
    refinery: '#e67e22',
    port: '#3498db',
    bridge: '#d4a574',
    interchange: '#c49464',
    memorial: '#7f8c8d'
  };
  const borderColor = borderColors[type] || '#4ecdc4';
  context.strokeStyle = borderColor;
  context.lineWidth = 2;
  context.stroke();
  
  // Text - not bold, matching HUD text color
  context.fillStyle = 'rgba(255, 255, 255, 0.87)';
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  
  // Create sprite
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  
  const sprite = new THREE.Sprite(material);
  
  // Scale sprite proportionally to canvas size
  const scaleX = (canvasWidth / 256) * 10;
  const scaleY = (canvasHeight / 256) * 10;
  sprite.scale.set(scaleX, scaleY, 1);
  
  sprite.renderOrder = 100;
  sprite.userData.type = 'label';
  
  return sprite;
}

// ============================================
// Visual Creators by Type
// ============================================

/**
 * Create a hexagonal base platform for any landmark
 * Gives consistent "board game piece" aesthetic
 * 
 * @param {THREE.Group} group - Parent group to add base to
 * @param {number} size - Radius of the hexagon
 * @param {number} color - Accent color for the rim
 * @returns {number} The Y position of the top surface
 */
function createHexBase(group, size = 1.5, color = 0x4ecdc4) {
  // Main platform (hexagonal prism)
  const baseGeo = new THREE.CylinderGeometry(size, size * 1.1, 0.25, 6);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.7,
    metalness: 0.3
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.125;
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);
  
  // Accent rim (slightly larger, thinner hexagon underneath)
  const rimGeo = new THREE.CylinderGeometry(size * 1.15, size * 1.2, 0.08, 6);
  const rimMat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.4,
    metalness: 0.5,
    emissive: color,
    emissiveIntensity: 0.3
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.y = 0.04;
  rim.receiveShadow = true;
  group.add(rim);
  
  // Top surface indicator (subtle inner hexagon)
  const topGeo = new THREE.CylinderGeometry(size * 0.85, size * 0.85, 0.02, 6);
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a3e,
    roughness: 0.6,
    metalness: 0.2
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.y = 0.26;
  group.add(top);
  
  return 0.27; // Return top surface Y position
}

function createCityVisual(group, emitter, profile) {
  // Determine city size from profile and scale
  const baseHeight = profile.type === 'urban' ? 
    (profile.spread > 4 ? 3 : profile.spread > 2 ? 2 : 1) : 1;
  const height = baseHeight * (emitter.scale || 1);
  
  // Hex base platform
  const baseSize = Math.max(1.5, profile.spread * 0.4);
  const topY = createHexBase(group, baseSize, profile.color || 0x4a90d9);
  
  // Buildings cluster
  const buildingCount = Math.ceil(height * 2) + 2;
  const buildingMat = new THREE.MeshStandardMaterial({
    color: profile.color || 0x3a4a5a,
    roughness: 0.6,
    metalness: 0.4,
    emissive: 0x111122,
    emissiveIntensity: 0.2
  });
  
  for (let i = 0; i < buildingCount; i++) {
    const bHeight = height * (0.4 + Math.random() * 0.8);
    const bWidth = 0.25 + Math.random() * 0.35;
    const buildingGeo = new THREE.BoxGeometry(bWidth, bHeight, bWidth);
    const building = new THREE.Mesh(buildingGeo, buildingMat);
    const spread = baseSize * 0.6;
    building.position.set(
      (Math.random() - 0.5) * spread,
      topY + bHeight / 2,
      (Math.random() - 0.5) * spread
    );
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);
  }
  
  // Glow for larger cities
  if (height >= 2) {
    const glowGeo = new THREE.SphereGeometry(baseSize * 0.5, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      transparent: true,
      opacity: 0.12
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = height * 0.4;
    glow.scale.y = 0.5;
    group.add(glow);
  }
}

function createAirportVisual(group, emitter, profile) {
  // Hex base platform
  const baseSize = 2.5;
  const topY = createHexBase(group, baseSize, profile.color || 0xe74c3c);
  
  // Runway
  const runwayLength = 3.5;
  const runwayGeo = new THREE.BoxGeometry(runwayLength, 0.08, 0.5);
  const runwayMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    roughness: 0.9,
    emissive: 0x111111,
    emissiveIntensity: 0.2
  });
  const runway = new THREE.Mesh(runwayGeo, runwayMat);
  runway.position.y = topY + 0.04;
  group.add(runway);
  
  // Runway markings
  const markingGeo = new THREE.BoxGeometry(0.25, 0.09, 0.12);
  const markingMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = -1.2; i <= 1.2; i += 0.6) {
    const marking = new THREE.Mesh(markingGeo, markingMat);
    marking.position.set(i, topY + 0.05, 0);
    group.add(marking);
  }
  
  // Terminal building
  const terminalGeo = new THREE.BoxGeometry(1.0, 0.5, 0.6);
  const terminalMat = new THREE.MeshStandardMaterial({
    color: profile.color || 0xe74c3c,
    roughness: 0.5,
    emissive: profile.color || 0xe74c3c,
    emissiveIntensity: 0.3
  });
  const terminal = new THREE.Mesh(terminalGeo, terminalMat);
  terminal.position.set(0, topY + 0.25, 1.0);
  terminal.castShadow = true;
  group.add(terminal);
  
  // Control tower
  const towerGeo = new THREE.CylinderGeometry(0.12, 0.15, 1.0, 8);
  const tower = new THREE.Mesh(towerGeo, terminalMat);
  tower.position.set(0.6, topY + 0.5, 1.0);
  tower.castShadow = true;
  group.add(tower);
}

function createRefineryVisual(group, emitter, profile) {
  const height = profile.height || 5;
  const plumeRise = profile.plumeRise || 0;
  
  // Hex base platform
  const baseSize = 2.0;
  const topY = createHexBase(group, baseSize, profile.color || 0xe67e22);
  
  // Main stack
  const stackGeo = new THREE.CylinderGeometry(0.2, 0.3, height, 12);
  const stackMat = new THREE.MeshStandardMaterial({
    color: profile.color || 0xe67e22,
    roughness: 0.4,
    metalness: 0.6,
    emissive: profile.color || 0xe67e22,
    emissiveIntensity: 0.4
  });
  const stack = new THREE.Mesh(stackGeo, stackMat);
  stack.position.set(0, topY + height / 2, 0);
  stack.castShadow = true;
  group.add(stack);
  
  // Secondary stacks
  const stack2Geo = new THREE.CylinderGeometry(0.15, 0.22, height * 0.7, 8);
  const stack2 = new THREE.Mesh(stack2Geo, stackMat);
  stack2.position.set(-0.7, topY + height * 0.35, 0.3);
  stack2.castShadow = true;
  group.add(stack2);
  
  const stack3 = new THREE.Mesh(stack2Geo, stackMat);
  stack3.position.set(0.6, topY + height * 0.35, -0.2);
  stack3.castShadow = true;
  group.add(stack3);
  
  // Storage tanks
  const tankGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 16);
  const tankMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a5a,
    roughness: 0.5,
    metalness: 0.4
  });
  const tank1 = new THREE.Mesh(tankGeo, tankMat);
  tank1.position.set(-0.9, topY + 0.2, -0.5);
  group.add(tank1);
  
  const tank2 = new THREE.Mesh(tankGeo, tankMat);
  tank2.position.set(0.9, topY + 0.2, 0.5);
  group.add(tank2);
  
  // Emission plume glow at top
  const plumeGeo = new THREE.SphereGeometry(0.4, 8, 8);
  const plumeMat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.25
  });
  const plume = new THREE.Mesh(plumeGeo, plumeMat);
  plume.position.set(0, topY + height + plumeRise * 0.3, 0);
  plume.scale.set(1, 1.5, 1);
  group.add(plume);
}

function createPortVisual(group, emitter, profile) {
  // Hex base platform
  const baseSize = 2.2;
  const topY = createHexBase(group, baseSize, profile.color || 0x3498db);
  
  // Container cranes
  const craneMat = new THREE.MeshStandardMaterial({
    color: profile.color || 0xff6b35,
    roughness: 0.4,
    metalness: 0.5,
    emissive: profile.color || 0xff6b35,
    emissiveIntensity: 0.3
  });
  
  for (let i = -1; i <= 1; i += 2) {
    // Vertical post
    const postGeo = new THREE.BoxGeometry(0.15, 2.5, 0.15);
    const post = new THREE.Mesh(postGeo, craneMat);
    post.position.set(i * 1.0, topY + 1.25, 0);
    post.castShadow = true;
    group.add(post);
    
    // Horizontal arm
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 1.8);
    const arm = new THREE.Mesh(armGeo, craneMat);
    arm.position.set(i * 1.0, topY + 2.4, -0.4);
    group.add(arm);
  }
  
  // Containers (stacked boxes)
  const containerColors = [0x2980b9, 0xe74c3c, 0x27ae60, 0xf39c12];
  const containerGeo = new THREE.BoxGeometry(0.5, 0.3, 0.22);
  
  let colorIndex = 0;
  for (let x = -0.5; x <= 0.5; x += 0.55) {
    for (let y = 0; y < 2; y++) {
      const containerMat = new THREE.MeshStandardMaterial({
        color: containerColors[colorIndex % containerColors.length],
        roughness: 0.6
      });
      const container = new THREE.Mesh(containerGeo, containerMat);
      container.position.set(x, topY + 0.15 + y * 0.35, 0.6);
      group.add(container);
      colorIndex++;
    }
  }
}

function createBridgeVisual(group, emitter, profile) {
  // Hex base platform
  const baseSize = 2.0;
  const topY = createHexBase(group, baseSize, profile.color || 0xd4a574);
  
  // Bridge deck
  const deckGeo = new THREE.BoxGeometry(3, 0.12, 0.6);
  const deckMat = new THREE.MeshStandardMaterial({
    color: profile.color || 0xd4a574,
    roughness: 0.6,
    metalness: 0.3,
    emissive: profile.color || 0xd4a574,
    emissiveIntensity: 0.2
  });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.y = topY + 0.8;
  group.add(deck);
  
  // Towers
  const towerGeo = new THREE.BoxGeometry(0.12, 1.8, 0.12);
  const tower1 = new THREE.Mesh(towerGeo, deckMat);
  tower1.position.set(-0.9, topY + 0.9, 0);
  tower1.castShadow = true;
  group.add(tower1);
  
  const tower2 = new THREE.Mesh(towerGeo, deckMat);
  tower2.position.set(0.9, topY + 0.9, 0);
  tower2.castShadow = true;
  group.add(tower2);
  
  // Cables (simplified as thin boxes)
  const cableGeo = new THREE.BoxGeometry(2.0, 0.025, 0.025);
  const cable1 = new THREE.Mesh(cableGeo, deckMat);
  cable1.position.set(0, topY + 1.6, 0.15);
  cable1.rotation.z = 0.08;
  group.add(cable1);
  
  const cable2 = new THREE.Mesh(cableGeo, deckMat);
  cable2.position.set(0, topY + 1.6, -0.15);
  cable2.rotation.z = -0.08;
  group.add(cable2);
}

function createInterchangeVisual(group, emitter, profile) {
  // Hex base platform
  const baseSize = 2.0;
  const topY = createHexBase(group, baseSize, profile.color || 0xc49464);
  
  // Cloverleaf-style visual - central elevated section
  const centerGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.15, 16);
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a5a,
    roughness: 0.9
  });
  const center = new THREE.Mesh(centerGeo, roadMat);
  center.position.y = topY + 0.4;
  group.add(center);
  
  // Road segments extending out (curved ramps)
  const roadGeo = new THREE.BoxGeometry(1.8, 0.08, 0.4);
  for (let angle = 0; angle < 4; angle++) {
    const road = new THREE.Mesh(roadGeo, roadMat);
    const dist = 0.9;
    road.position.set(
      Math.cos(angle * Math.PI / 2) * dist,
      topY + 0.2 + Math.sin(angle * Math.PI / 2 + 1) * 0.1,
      Math.sin(angle * Math.PI / 2) * dist
    );
    road.rotation.y = angle * Math.PI / 2;
    group.add(road);
  }
  
  // Support pillars
  const pillarGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8);
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    roughness: 0.7
  });
  for (let angle = 0; angle < 4; angle++) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(
      Math.cos(angle * Math.PI / 2 + Math.PI / 4) * 1.2,
      topY + 0.2,
      Math.sin(angle * Math.PI / 2 + Math.PI / 4) * 1.2
    );
    group.add(pillar);
  }
}

function createMemorialVisual(group, emitter, profile) {
  // Hex base platform (smaller, more solemn)
  const baseSize = 1.2;
  const topY = createHexBase(group, baseSize, 0x7f8c8d);
  
  // Monument obelisk
  const monumentGeo = new THREE.CylinderGeometry(0.08, 0.2, 1.2, 4);
  const monumentMat = new THREE.MeshStandardMaterial({
    color: 0x95a5a6,
    roughness: 0.4,
    metalness: 0.3
  });
  const monument = new THREE.Mesh(monumentGeo, monumentMat);
  monument.position.y = topY + 0.6;
  monument.rotation.y = Math.PI / 4; // Rotate to diamond orientation
  monument.castShadow = true;
  group.add(monument);
  
  // Subtle eternal flame glow
  const flameGeo = new THREE.SphereGeometry(0.1, 8, 8);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.4
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.y = topY + 1.3;
  group.add(flame);
}

function createDefaultVisual(group, emitter, profile) {
  // Hex base platform
  const baseSize = 1.3;
  const topY = createHexBase(group, baseSize, profile.color || 0x4ecdc4);
  
  // Generic marker sphere
  const markerGeo = new THREE.SphereGeometry(0.4, 16, 16);
  const markerMat = new THREE.MeshStandardMaterial({
    color: profile.color || 0x4ecdc4,
    roughness: 0.4,
    metalness: 0.3,
    emissive: profile.color || 0x4ecdc4,
    emissiveIntensity: 0.3
  });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.position.y = topY + 0.5;
  marker.castShadow = true;
  group.add(marker);
}


// ============================================
// Grid Helper with Geographic Labels (Ribbon-based)
// ============================================

let gridGroup = null;
let gridLabels = [];

function createGrid(scene) {
  gridGroup = new THREE.Group();
  gridGroup.name = 'coordinateGrid';
  
  const halfWidth = MAP_BOUNDS.width / 2;
  const halfDepth = MAP_BOUNDS.depth / 2;
  const gridY = 5.0; // Elevated grid for better visibility
  
  // Ribbon widths
  const minorRibbonWidth = 0.3;
  const majorRibbonWidth = 0.6;
  const borderRibbonWidth = 0.8;
  
  // Grid spacing in degrees
  const lonStep = 0.2;
  const latStep = 0.2;
  
  // Label offset from grid edge
  const labelOffset = 5;
  
  // Colors
  const minorColor = 0x334455;
  const majorColor = 0x4a5a6a;
  const borderColor = 0x5a6a7a;
  
  // Small epsilon for floating point comparisons
  const epsilon = 0.0001;
  
  // Convert geo to world coordinates
  // Note: Z is flipped so that higher latitudes (north) are at negative Z (top of map in typical view)
  const geoToWorldLocal = (lon, lat) => {
    const x = ((lon - GEO_BOUNDS.lonMin) / (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin) - 0.5) * MAP_BOUNDS.width;
    const z = (0.5 - (lat - GEO_BOUNDS.latMin) / (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin)) * MAP_BOUNDS.depth;
    return { x, z };
  };
  
  // Round to avoid floating point display issues
  const roundStep = (val, step) => Math.round(val / step) * step;
  
  // Collect all ribbon segments
  const ribbonSegments = [];
  
  // Calculate longitude grid lines
  // For negative numbers: ceil gives us the first line INSIDE the bounds (less negative)
  // floor gives us the last line INSIDE the bounds (more negative for max)
  const lonStart = Math.ceil((GEO_BOUNDS.lonMin - epsilon) / lonStep) * lonStep;
  const lonEnd = Math.floor((GEO_BOUNDS.lonMax + epsilon) / lonStep) * lonStep;
  
  console.log(`[Grid] Longitude range: ${lonStart.toFixed(2)} to ${lonEnd.toFixed(2)} (bounds: ${GEO_BOUNDS.lonMin.toFixed(2)} to ${GEO_BOUNDS.lonMax.toFixed(2)})`);
  
  // Generate longitude lines using integer iteration to avoid floating point accumulation
  const lonCount = Math.round((lonEnd - lonStart) / lonStep) + 1;
  for (let i = 0; i < lonCount; i++) {
    const lon = roundStep(lonStart + i * lonStep, lonStep);
    
    // Skip if outside bounds (safety check)
    if (lon < GEO_BOUNDS.lonMin - epsilon || lon > GEO_BOUNDS.lonMax + epsilon) continue;
    
    const isMajor = Math.abs(roundStep(lon, 0.5) - lon) < epsilon;
    const { x } = geoToWorldLocal(lon, GEO_BOUNDS.latMin);
    
    ribbonSegments.push({
      p1: new THREE.Vector3(x, gridY, -halfDepth),
      p2: new THREE.Vector3(x, gridY, halfDepth),
      width: isMajor ? majorRibbonWidth : minorRibbonWidth,
      color: isMajor ? majorColor : minorColor
    });
    
    // Format label
    const lonLabel = formatLongitude(lon);
    
    // Add label at south edge
    const labelSouth = createCoordLabel(lonLabel, x, gridY, -halfDepth - labelOffset, 'lon');
    if (labelSouth) gridGroup.add(labelSouth);
    
    // Add label at north edge
    const labelNorth = createCoordLabel(lonLabel, x, gridY, halfDepth + labelOffset, 'lon');
    if (labelNorth) gridGroup.add(labelNorth);
  }
  
  // Calculate latitude grid lines
  const latStart = Math.ceil((GEO_BOUNDS.latMin - epsilon) / latStep) * latStep;
  const latEnd = Math.floor((GEO_BOUNDS.latMax + epsilon) / latStep) * latStep;
  
  console.log(`[Grid] Latitude range: ${latStart.toFixed(2)} to ${latEnd.toFixed(2)} (bounds: ${GEO_BOUNDS.latMin.toFixed(2)} to ${GEO_BOUNDS.latMax.toFixed(2)})`);
  
  // Generate latitude lines using integer iteration
  const latCount = Math.round((latEnd - latStart) / latStep) + 1;
  for (let i = 0; i < latCount; i++) {
    const lat = roundStep(latStart + i * latStep, latStep);
    
    // Skip if outside bounds (safety check)
    if (lat < GEO_BOUNDS.latMin - epsilon || lat > GEO_BOUNDS.latMax + epsilon) continue;
    
    const isMajor = Math.abs(roundStep(lat, 0.5) - lat) < epsilon;
    const { z } = geoToWorldLocal(GEO_BOUNDS.lonMin, lat);
    
    ribbonSegments.push({
      p1: new THREE.Vector3(-halfWidth, gridY, z),
      p2: new THREE.Vector3(halfWidth, gridY, z),
      width: isMajor ? majorRibbonWidth : minorRibbonWidth,
      color: isMajor ? majorColor : minorColor
    });
    
    // Format label
    const latLabel = formatLatitude(lat);
    
    // Add label at west edge
    const labelWest = createCoordLabel(latLabel, -halfWidth - labelOffset, gridY, z, 'lat');
    if (labelWest) gridGroup.add(labelWest);
    
    // Add label at east edge
    const labelEast = createCoordLabel(latLabel, halfWidth + labelOffset, gridY, z, 'lat');
    if (labelEast) gridGroup.add(labelEast);
  }
  
  // Add border rectangle as 4 ribbon segments
  ribbonSegments.push(
    { p1: new THREE.Vector3(-halfWidth, gridY, -halfDepth), p2: new THREE.Vector3(halfWidth, gridY, -halfDepth), width: borderRibbonWidth, color: borderColor },
    { p1: new THREE.Vector3(halfWidth, gridY, -halfDepth), p2: new THREE.Vector3(halfWidth, gridY, halfDepth), width: borderRibbonWidth, color: borderColor },
    { p1: new THREE.Vector3(halfWidth, gridY, halfDepth), p2: new THREE.Vector3(-halfWidth, gridY, halfDepth), width: borderRibbonWidth, color: borderColor },
    { p1: new THREE.Vector3(-halfWidth, gridY, halfDepth), p2: new THREE.Vector3(-halfWidth, gridY, -halfDepth), width: borderRibbonWidth, color: borderColor }
  );
  
  // Build ribbon mesh from all segments
  const ribbonMesh = buildGridRibbonMesh(ribbonSegments);
  if (ribbonMesh) {
    gridGroup.add(ribbonMesh);
  }
  
  console.log(`[Grid] Created ${ribbonSegments.length} ribbon segments`);
  
  // Create compass rose in southwest corner
  createCompassRose(gridGroup, halfWidth, halfDepth, gridY);
  
  scene.add(gridGroup);
  gridHelper = gridGroup;
}

/**
 * Create a 3D compass rose mesh
 */
function createCompassRose(parentGroup, halfWidth, halfDepth, gridY) {
  const compassGroup = new THREE.Group();
  compassGroup.name = 'compassRose';
  
  // Convert geo coordinates to world position
  const geoToWorldLocal = (lon, lat) => {
    const x = ((lon - GEO_BOUNDS.lonMin) / (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin) - 0.5) * MAP_BOUNDS.width;
    const z = (0.5 - (lat - GEO_BOUNDS.latMin) / (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin)) * MAP_BOUNDS.depth;
    return { x, z };
  };
  
  // Position at 37.5°N, 122.8°W
  const compassPos = geoToWorldLocal(-122.8, 37.5);
  const compassX = compassPos.x;
  const compassZ = compassPos.z;
  const compassY = gridY + 0.5;
  
  // Compass dimensions
  const outerRadius = 8;
  const innerRadius = 3;
  const cardinalLength = outerRadius;
  const ordinalLength = outerRadius * 0.6;
  const arrowWidth = 1.2;
  const ordinalWidth = 0.8;
  const thickness = 0.3;
  
  // Colors
  const northColor = 0xcc3333;    // Red for North
  const southColor = 0xdddddd;    // White/light gray
  const eastWestColor = 0xdddddd; // White/light gray
  const ordinalColor = 0x888899;  // Gray for NE, SE, SW, NW
  const ringColor = 0x4a5a6a;     // Ring color
  const centerColor = 0x2a3a4a;   // Center disc
  
  // Helper to create an arrow/pointer shape
  const createArrow = (length, width, color, rotation) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, length);           // Tip
    shape.lineTo(-width / 2, 0);       // Bottom left
    shape.lineTo(0, length * 0.3);     // Inner notch
    shape.lineTo(width / 2, 0);        // Bottom right
    shape.closePath();
    
    const extrudeSettings = {
      depth: thickness,
      bevelEnabled: false
    };
    
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.rotateX(-Math.PI / 2); // Lay flat
    geometry.rotateY(rotation);     // Point in direction
    
    const material = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.5,
      metalness: 0.3,
      emissive: color,
      emissiveIntensity: 0.2
    });
    
    return new THREE.Mesh(geometry, material);
  };
  
  // Create cardinal direction arrows (N, S, E, W)
  // After rotateX(-PI/2), the arrow tip points toward -Z, so:
  // rotation = 0 â†’ -Z (North), rotation = PI â†’ +Z (South)
  // rotation = -PI/2 â†’ +X (East), rotation = PI/2 â†’ -X (West)
  
  // North (negative Z in world space = higher latitude)
  const northArrow = createArrow(cardinalLength, arrowWidth, northColor, 0);
  northArrow.position.y = 0.05; // Slight positive offset to sit above other arrows
  compassGroup.add(northArrow);
  
  // South (positive Z)
  const southArrow = createArrow(cardinalLength, arrowWidth, southColor, Math.PI);
  compassGroup.add(southArrow);
  
  // East (positive X)
  const eastArrow = createArrow(cardinalLength, arrowWidth, eastWestColor, -Math.PI / 2);
  compassGroup.add(eastArrow);
  
  // West (negative X)
  const westArrow = createArrow(cardinalLength, arrowWidth, eastWestColor, Math.PI / 2);
  compassGroup.add(westArrow);
  
  // Create ordinal direction arrows (NE, SE, SW, NW)
  // NE: -PI/4, SE: -3PI/4, SW: 3PI/4, NW: PI/4
  const neArrow = createArrow(ordinalLength, ordinalWidth, ordinalColor, -Math.PI / 4);
  neArrow.position.y = -0.05; // Slight offset to prevent z-fighting
  compassGroup.add(neArrow);
  
  const seArrow = createArrow(ordinalLength, ordinalWidth, ordinalColor, -3 * Math.PI / 4);
  seArrow.position.y = -0.05;
  compassGroup.add(seArrow);
  
  const swArrow = createArrow(ordinalLength, ordinalWidth, ordinalColor, 3 * Math.PI / 4);
  swArrow.position.y = -0.05;
  compassGroup.add(swArrow);
  
  const nwArrow = createArrow(ordinalLength, ordinalWidth, ordinalColor, Math.PI / 4);
  nwArrow.position.y = -0.05;
  compassGroup.add(nwArrow);
  
  // Center disc with negative Y offset to prevent z-fighting
  const centerGeometry = new THREE.CylinderGeometry(innerRadius, innerRadius, thickness, 32);
  const centerMaterial = new THREE.MeshStandardMaterial({
    color: centerColor,
    roughness: 0.4,
    metalness: 0.5
  });
  const centerDisc = new THREE.Mesh(centerGeometry, centerMaterial);
  centerDisc.position.y = -0.1; // Slight negative offset to prevent z-fighting
  compassGroup.add(centerDisc);
  
  // Outer octagon ring
  const octagonRadius = outerRadius + 1;
  const octagonThickness = 0.5;
  const octagonHeight = 0.4;
  
  // Create octagon shape
  const octagonShape = new THREE.Shape();
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 8; // Offset to align flat edge with directions
    const x = Math.cos(angle) * octagonRadius;
    const y = Math.sin(angle) * octagonRadius;
    if (i === 0) {
      octagonShape.moveTo(x, y);
    } else {
      octagonShape.lineTo(x, y);
    }
  }
  octagonShape.closePath();
  
  // Create inner hole for the octagon ring
  const innerOctagonPath = new THREE.Path();
  const innerOctagonRadius = octagonRadius - octagonThickness;
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 8;
    const x = Math.cos(angle) * innerOctagonRadius;
    const y = Math.sin(angle) * innerOctagonRadius;
    if (i === 0) {
      innerOctagonPath.moveTo(x, y);
    } else {
      innerOctagonPath.lineTo(x, y);
    }
  }
  innerOctagonPath.closePath();
  octagonShape.holes.push(innerOctagonPath);
  
  const octagonExtrudeSettings = {
    depth: octagonHeight,
    bevelEnabled: false
  };
  
  const octagonGeometry = new THREE.ExtrudeGeometry(octagonShape, octagonExtrudeSettings);
  octagonGeometry.rotateX(-Math.PI / 2); // Lay flat
  
  const octagonMaterial = new THREE.MeshStandardMaterial({
    color: ringColor,
    roughness: 0.5,
    metalness: 0.4
  });
  
  const octagonRing = new THREE.Mesh(octagonGeometry, octagonMaterial);
  octagonRing.position.y = 0;
  compassGroup.add(octagonRing);
  
  // Add direction labels
  const labelOffset = outerRadius + 3;
  const labelY = thickness + 0.5;
  
  // N label
  const labelN = createCoordLabel('N', 0, labelY, -labelOffset, 'compass');
  if (labelN) {
    labelN.material.color.setHex(0xff4444);
    compassGroup.add(labelN);
  }
  
  // S label
  const labelS = createCoordLabel('S', 0, labelY, labelOffset, 'compass');
  if (labelS) compassGroup.add(labelS);
  
  // E label
  const labelE = createCoordLabel('E', labelOffset, labelY, 0, 'compass');
  if (labelE) compassGroup.add(labelE);
  
  // W label
  const labelW = createCoordLabel('W', -labelOffset, labelY, 0, 'compass');
  if (labelW) compassGroup.add(labelW);
  
  // Position the compass group
  compassGroup.position.set(compassX, compassY, compassZ);
  
  parentGroup.add(compassGroup);
  
  console.log(`[Grid] Compass rose created at 37.5°N, 122.8°W (world: ${compassX.toFixed(1)}, ${compassY.toFixed(1)}, ${compassZ.toFixed(1)})`);
}

/**
 * Build a single mesh containing all grid ribbons
 */
function buildGridRibbonMesh(segments) {
  if (segments.length === 0) return null;
  
  const positions = [];
  const colors = [];
  const indices = [];
  
  let vertexIndex = 0;
  
  for (const seg of segments) {
    const { p1, p2, width, color } = seg;
    const halfWidth = width / 2;
    
    // Calculate ribbon direction
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const length = dir.length();
    
    if (length < 0.001) continue;
    
    dir.normalize();
    
    // Perpendicular vector in XZ plane (for horizontal ribbon)
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(halfWidth);
    
    // Four corners of the ribbon quad
    const v0 = new THREE.Vector3(p1.x - perp.x, p1.y, p1.z - perp.z);
    const v1 = new THREE.Vector3(p1.x + perp.x, p1.y, p1.z + perp.z);
    const v2 = new THREE.Vector3(p2.x - perp.x, p2.y, p2.z - perp.z);
    const v3 = new THREE.Vector3(p2.x + perp.x, p2.y, p2.z + perp.z);
    
    // Add vertices
    positions.push(
      v0.x, v0.y, v0.z,
      v1.x, v1.y, v1.z,
      v2.x, v2.y, v2.z,
      v3.x, v3.y, v3.z
    );
    
    // Convert color to RGB
    const threeColor = new THREE.Color(color);
    for (let i = 0; i < 4; i++) {
      colors.push(threeColor.r, threeColor.g, threeColor.b);
    }
    
    // Add indices for 2 triangles
    indices.push(
      vertexIndex, vertexIndex + 1, vertexIndex + 2,
      vertexIndex + 1, vertexIndex + 3, vertexIndex + 2
    );
    
    vertexIndex += 4;
  }
  
  // Create geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  // Create material
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'gridRibbons';
  mesh.renderOrder = 5;
  
  return mesh;
}

/**
 * Create a text label sprite for coordinates
 */
function createCoordLabel(text, x, y, z, type) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 128;
  canvas.height = 32;
  
  // Clear with transparent background
  context.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw text
  context.font = 'bold 18px monospace';
  context.fillStyle = '#8899aa';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  
  // Create sprite
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false
  });
  
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.position.set(x, y + 0.5, z);
  sprite.scale.set(8, 2, 1);
  
  gridLabels.push(sprite);
  return sprite;
}

/**
 * Format longitude for display
 */
function formatLongitude(lon) {
  // Round to 1 decimal place to avoid floating point artifacts
  const rounded = Math.round(lon * 10) / 10;
  const abs = Math.abs(rounded);
  const dir = rounded < 0 ? 'W' : 'E';
  return `${abs.toFixed(1)}°${dir}`;
}

/**
 * Format latitude for display
 */
function formatLatitude(lat) {
  // Round to 1 decimal place to avoid floating point artifacts
  const rounded = Math.round(lat * 10) / 10;
  const abs = Math.abs(rounded);
  const dir = rounded < 0 ? 'S' : 'N';
  return `${abs.toFixed(1)}°${dir}`;
}

/**
 * Convert world coordinates to geographic (lat/lon)
 */
export function worldToGeo(worldX, worldZ) {
  const lon = GEO_BOUNDS.lonMin + ((worldX / MAP_BOUNDS.width) + 0.5) * (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin);
  const lat = GEO_BOUNDS.latMin + (0.5 - (worldZ / MAP_BOUNDS.depth)) * (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin);
  return { lon, lat };
}

/**
 * Convert geographic coordinates to world
 */
export function geoToWorld(lon, lat) {
  const x = ((lon - GEO_BOUNDS.lonMin) / (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin) - 0.5) * MAP_BOUNDS.width;
  const z = (0.5 - (lat - GEO_BOUNDS.latMin) / (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin)) * MAP_BOUNDS.depth;
  return { x, z };
}

// ============================================
// Atmospheric Effects
// ============================================

function createAtmosphericEffects(scene) {
  // Ground disc - solid plane that sits below the terrain
  const discRadius = 250;
  
  const groundGeo = new THREE.CircleGeometry(discRadius, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshBasicMaterial({
    color: 0x2a4a5a,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -2;
  scene.add(ground);
}

// ============================================
// Utility Functions
// ============================================

export function getTerrainHeight(x, z) {
  // Use GeoTIFF elevation if available
  if (elevationData) {
    return sampleElevation(x, z);
  }
  
  // Fallback to procedural
  let height = 0;
  
  // East Bay hills
  if (x > 5 && x < 35) {
    const hillFactor = Math.max(0, 1 - Math.abs(x - 20) / 15);
    height += hillFactor * 4 * (0.5 + 0.5 * Math.sin(z * 0.1));
  }
  
  // Marin headlands
  if (x < -10 && z > 10) {
    const marinFactor = Math.max(0, 1 - Math.abs(x + 25) / 20) * Math.max(0, 1 - Math.abs(z - 25) / 20);
    height += marinFactor * 5;
  }
  
  // Santa Cruz mountains
  if (x < 5 && z < -20) {
    const scFactor = Math.max(0, 1 - Math.abs(x + 10) / 20) * Math.max(0, 1 - Math.abs(z + 40) / 25);
    height += scFactor * 6;
  }
  
  // Bay depression
  const distFromBay = Math.sqrt(Math.pow(x / 15, 2) + Math.pow(z / 25, 2));
  if (distFromBay < 1) {
    height -= (1 - distFromBay) * 3;
  }
  
  return Math.max(0, height);
}

/**
 * Get landmark positions from registry (for backwards compatibility)
 * Returns object keyed by emitter ID with world coordinates
 */
export function getLandmarkPositions() {
  const positions = {};
  POINT_EMITTERS.forEach(emitter => {
    const world = registryGeoToWorld(emitter.coords.lon, emitter.coords.lat);
    const profile = getProfile(emitter.profile);
    positions[emitter.id] = {
      x: world.x,
      z: world.z,
      name: emitter.name,
      height: profile ? (profile.height || 0.5) : 0.5,
      type: profile ? profile.type : 'unknown'
    };
  });
  return positions;
}

export function worldToScreen(position, camera, renderer) {
  const vector = position.clone();
  vector.project(camera);
  
  const widthHalf = renderer.domElement.clientWidth / 2;
  const heightHalf = renderer.domElement.clientHeight / 2;
  
  return {
    x: (vector.x * widthHalf) + widthHalf,
    y: -(vector.y * heightHalf) + heightHalf
  };
}

// ============================================
// Highway Ribbon Rendering
// ============================================

/**
 * Create visual ribbons for all highways from the registry.
 * Should be called after terrain is loaded.
 * 
 * @param {THREE.Scene} scene - The Three.js scene
 * @returns {THREE.Group} The highway group
 */
export function createHighwayRibbons(scene) {
  console.log('🛣️ Creating highway ribbons...');
  
  // Remove existing highway group if present
  if (highwayGroup) {
    scene.remove(highwayGroup);
    highwayGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  
  highwayGroup = new THREE.Group();
  highwayGroup.name = 'highways';
  
  let totalLength = 0;
  
  LINE_EMITTERS.forEach(highway => {
    const profile = getProfile(highway.profile);
    if (!profile) {
      console.warn(`  ⚠️ Unknown profile "${highway.profile}" for highway "${highway.id}"`);
      return;
    }
    
    const ribbon = createHighwayRibbon(highway, profile);
    if (ribbon) {
      highwayGroup.add(ribbon);
      totalLength += highway.waypoints.length - 1;
    }
  });
  
  scene.add(highwayGroup);
  console.log(`  → ${LINE_EMITTERS.length} highway ribbons created (${totalLength} segments)`);
  
  return highwayGroup;
}

/**
 * Create a single highway ribbon mesh
 * 
 * @param {Object} highway - Highway data from registry
 * @param {Object} profile - Profile data
 * @returns {THREE.Mesh|null}
 */
function createHighwayRibbon(highway, profile) {
  const waypoints = highway.waypoints;
  if (waypoints.length < 2) return null;
  
  // Convert waypoints to world coordinates with terrain height
  const points = waypoints.map(wp => {
    const world = registryGeoToWorld(wp.lon, wp.lat);
    const terrainY = getTerrainHeight(world.x, world.z);
    // Position slightly above terrain to prevent z-fighting
    return new THREE.Vector3(world.x, terrainY + 0.2, world.z);
  });
  
  // Get ribbon styling from profile
  const ribbonWidth = profile.ribbonWidth || 0.6;
  const ribbonColor = profile.ribbonColor || 0x5566aa;
  const ribbonOpacity = profile.ribbonOpacity || 0.7;
  
  // Build the ribbon geometry
  const { positions, indices } = buildRibbonGeometry(points, ribbonWidth);
  
  if (positions.length === 0) return null;
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  
  const material = new THREE.MeshBasicMaterial({
    color: ribbonColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: ribbonOpacity,
    depthWrite: false
  });
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = highway.id;
  mesh.userData = { 
    type: 'highway', 
    id: highway.id, 
    name: highway.name,
    profile: highway.profile
  };
  mesh.renderOrder = 6; // Render above terrain but below grid
  
  return mesh;
}

/**
 * Build ribbon geometry from a series of 3D points
 * Creates a flat ribbon that follows the terrain
 * 
 * @param {Array<THREE.Vector3>} points - Array of 3D points
 * @param {number} width - Ribbon width in world units
 * @returns {{positions: Array, indices: Array}}
 */
function buildRibbonGeometry(points, width) {
  const positions = [];
  const indices = [];
  const halfWidth = width / 2;
  
  if (points.length < 2) {
    return { positions, indices };
  }
  
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    
    // Calculate direction at this point
    let dir;
    if (i === 0) {
      // First point: use direction to next point
      dir = new THREE.Vector3().subVectors(points[1], points[0]).normalize();
    } else if (i === points.length - 1) {
      // Last point: use direction from previous point
      dir = new THREE.Vector3().subVectors(points[i], points[i - 1]).normalize();
    } else {
      // Interior points: average direction for smooth corners
      const d1 = new THREE.Vector3().subVectors(curr, points[i - 1]).normalize();
      const d2 = new THREE.Vector3().subVectors(points[i + 1], curr).normalize();
      dir = d1.add(d2).normalize();
      
      // Handle 180-degree turns (very rare)
      if (dir.length() < 0.001) {
        dir = d1;
      }
    }
    
    // Perpendicular vector in XZ plane (horizontal ribbon)
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(halfWidth);
    
    // Add left and right vertices
    positions.push(
      curr.x - perp.x, curr.y, curr.z - perp.z,  // Left vertex
      curr.x + perp.x, curr.y, curr.z + perp.z   // Right vertex
    );
    
    // Add quad indices (two triangles per segment)
    if (i < points.length - 1) {
      const idx = i * 2;
      // Triangle 1: left-bottom, right-bottom, left-top
      indices.push(idx, idx + 1, idx + 2);
      // Triangle 2: right-bottom, right-top, left-top
      indices.push(idx + 1, idx + 3, idx + 2);
    }
  }
  
  return { positions, indices };
}

/**
 * Get the highway group
 * @returns {THREE.Group|null}
 */
export function getHighwayGroup() {
  return highwayGroup;
}

/**
 * Set visibility of all highways
 * @param {boolean} visible
 */
export function setHighwaysVisible(visible) {
  if (highwayGroup) {
    highwayGroup.visible = visible;
  }
}

/**
 * Set visibility of a specific highway
 * @param {string} highwayId
 * @param {boolean} visible
 */
export function setHighwayVisible(highwayId, visible) {
  if (highwayGroup) {
    const mesh = highwayGroup.getObjectByName(highwayId);
    if (mesh) {
      mesh.visible = visible;
    }
  }
}

// ============================================
// Landmark Hover System
// ============================================

let currentHoveredLandmark = null;

/**
 * Get all landmark meshes for raycasting
 * @returns {Array} Array of landmark group meshes
 */
export function getLandmarkMeshes() {
  return landmarkMeshes;
}

/**
 * Show label for a specific landmark group
 * @param {THREE.Group} landmarkGroup - The landmark group to show label for
 */
export function showLandmarkLabel(landmarkGroup) {
  if (landmarkGroup && landmarkGroup.userData.label) {
    landmarkGroup.userData.label.visible = true;
  }
}

/**
 * Hide label for a specific landmark group
 * @param {THREE.Group} landmarkGroup - The landmark group to hide label for
 */
export function hideLandmarkLabel(landmarkGroup) {
  if (landmarkGroup && landmarkGroup.userData.label) {
    landmarkGroup.userData.label.visible = false;
  }
}

/**
 * Hide all landmark labels
 */
export function hideAllLandmarkLabels() {
  landmarkMeshes.forEach(group => {
    if (group.userData.label) {
      group.userData.label.visible = false;
    }
  });
  currentHoveredLandmark = null;
}

/**
 * Handle landmark hover - call this with raycast result
 * @param {THREE.Group|null} landmarkGroup - The hovered landmark or null if none
 */
export function setHoveredLandmark(landmarkGroup) {
  // If same as current, do nothing
  if (landmarkGroup === currentHoveredLandmark) {
    return;
  }
  
  // Hide previous label
  if (currentHoveredLandmark && currentHoveredLandmark.userData.label) {
    currentHoveredLandmark.userData.label.visible = false;
  }
  
  // Show new label
  if (landmarkGroup && landmarkGroup.userData.label) {
    landmarkGroup.userData.label.visible = true;
  }
  
  currentHoveredLandmark = landmarkGroup;
}

/**
 * Get the currently hovered landmark
 * @returns {THREE.Group|null}
 */
export function getHoveredLandmark() {
  return currentHoveredLandmark;
}

// ============================================
// Cleanup
// ============================================

export function disposeMap() {
  if (terrain) {
    terrain.geometry.dispose();
    terrain.material.dispose();
  }
  if (water) {
    water.geometry.dispose();
    water.material.dispose();
  }
  landmarkMeshes.forEach(mesh => {
    mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  });
  if (highwayGroup) {
    highwayGroup.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}

/**
 * Get the terrain mesh for external use (e.g., contour generation)
 * @returns {THREE.Mesh|null} The terrain mesh or null if not yet created
 */
export function getTerrainMesh() {
  return terrain;
}

/**
 * Get the geographic bounds
 */
export function getGeoBounds() {
  return { ...GEO_BOUNDS };
}

/**
 * Get the map bounds
 */
export function getMapBounds() {
  return { ...MAP_BOUNDS };
}