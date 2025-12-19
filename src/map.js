/**
 * map.js â€” Terrain + landmarks + coordinate conventions
 * 
 * Builds the Bay Area world representation using real elevation data from GeoTIFF.
 * Owns: terrain mesh, water plane, landmark meshes, coordinate mapping
 */

import * as THREE from 'three';

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
  
  console.log(`  â†’ TIFF: ${width}x${height}, ${bitsPerSample}-bit, format=${sampleFormat}`);
  
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

// World scale: 1 unit â‰ˆ 1 km
const WORLD_SCALE = 1;

// Bay Area bounds (accurate to TIFF coverage)
const MAP_BOUNDS = {
  width: 151,   // 151 km east-west
  depth: 134,   // 134 km north-south
  maxHeight: 25 // max terrain height in world units
};

// Terrain configuration for GeoTIFF
const TERRAIN_CONFIG = {
  heightmapUrl: '/baymerge.tif',
  verticalScale: 0.008,  // 8Ã— exaggeration for visible relief
  smoothingPasses: 2,    // Number of smoothing iterations (0 = none)
};

// Landmark positions (approximate, centered on SF Bay)
// Origin (0,0) is roughly center of the bay
const LANDMARKS = {
  sanFrancisco:  { x: -15, z: 5,   name: 'San Francisco', height: 3 },
  oakland:       { x: 8,   z: 8,   name: 'Oakland', height: 2 },
  berkeley:      { x: 6,   z: 15,  name: 'Berkeley', height: 1.5 },
  richmond:      { x: -2,  z: 25,  name: 'Richmond', height: 1 },
  sanJose:       { x: 15,  z: -35, name: 'San JosÃ©', height: 1.5 },
  fremont:       { x: 18,  z: -15, name: 'Fremont', height: 1 },
  hayward:       { x: 15,  z: -5,  name: 'Hayward', height: 1 },
  concord:       { x: 25,  z: 20,  name: 'Concord', height: 1 },
  sanMateo:      { x: 0,   z: -15, name: 'San Mateo', height: 1.5 },
  paloAlto:      { x: 5,   z: -25, name: 'Palo Alto', height: 1 },
  sfo:           { x: -5,  z: -10, name: 'SFO', height: 0.5, isAirport: true },
  oakland_port:  { x: 10,  z: 5,   name: 'Port of Oakland', height: 0.5, isPort: true },
  vallejo:       { x: 5,   z: 35,  name: 'Vallejo', height: 1 },
  sausalito:     { x: -18, z: 15,  name: 'Sausalito', height: 1 },
};

// Store references
let terrain, water, landmarkMeshes = [], gridHelper;
let elevationData = null;  // Float32Array from GeoTIFF
let rasterWidth = 0;
let rasterHeight = 0;
let minElevation = Infinity;
let maxElevation = -Infinity;

// ============================================
// Elevation Smoothing (Gaussian-like blur)
// ============================================

function smoothElevationData(data, width, height, passes = 1) {
  if (passes <= 0) return data;
  
  console.log(`  â†’ Smoothing elevation data (${passes} passes)...`);
  
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
  console.log('ðŸ—ºï¸ Building Bay Area map...');
  
  // Load GeoTIFF and create terrain
  loadGeoTIFFAndCreateTerrain(scene);
  createWater(scene);
  createGrid(scene);
  createAtmosphericEffects(scene);
  
  return {
    bounds: MAP_BOUNDS,
    landmarks: LANDMARKS,
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
    console.log('  â†’ Loading GeoTIFF...');
    
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
    
    console.log(`  â†’ GeoTIFF loaded: ${rasterWidth}x${rasterHeight}`);
    
    // Find min/max elevation for normalization info
    for (let i = 0; i < elevationData.length; i++) {
      const val = elevationData[i];
      if (Number.isFinite(val) && val > -1000) {
        if (val < minElevation) minElevation = val;
        if (val > maxElevation) maxElevation = val;
      }
    }
    
    console.log(`  â†’ Elevation range: ${minElevation.toFixed(1)}m to ${maxElevation.toFixed(1)}m`);
    
    // Create terrain mesh
    createTerrainFromGeoTIFF(scene);
    
    // Now create landmarks (need terrain heights)
    createLandmarks(scene);
    
  } catch (error) {
    console.error('  â†’ Failed to load GeoTIFF:', error);
    console.log('  â†’ Falling back to procedural terrain');
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
    const height = elevationToWorldY(elevation);
    
    positions.setY(i, height);
  }
  
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  
  // Terrain material
  const material = new THREE.MeshStandardMaterial({
    color: 0x2d4a3e,
    roughness: 0.85,
    metalness: 0.1,
    flatShading: false,
    vertexColors: false
  });
  
  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);
  
  console.log(`  â†’ Terrain created: ${rasterWidth}x${rasterHeight} vertices`);
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
  const elevation = top * (1 - fz) + bottom * fz;
  
  return elevation * TERRAIN_CONFIG.verticalScale;
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
    color: 0x2d4a3e,
    roughness: 0.9,
    metalness: 0.1,
    flatShading: false,
  });
  
  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);
}

// ============================================
// Water (Bay)
// ============================================

function createWater(scene) {
  // Simple water plane for the bay
  const waterGeometry = new THREE.PlaneGeometry(60, 80, 32, 32);
  waterGeometry.rotateX(-Math.PI / 2);
  
  // Slightly wavy surface
  const positions = waterGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const wave = Math.sin(x * 0.2) * Math.cos(z * 0.15) * 0.2;
    positions.setY(i, wave);
  }
  waterGeometry.computeVertexNormals();
  
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a3a4a,
    roughness: 0.2,
    metalness: 0.6,
    transparent: true,
    opacity: 0.85,
  });
  
  water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.set(-2, 0.1, 0); // Slightly above sea level
  water.receiveShadow = true;
  scene.add(water);
  
  // Add subtle glow underneath
  const glowGeometry = new THREE.PlaneGeometry(65, 85);
  glowGeometry.rotateX(-Math.PI / 2);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x0066aa,
    transparent: true,
    opacity: 0.15,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.set(-2, -0.5, 0);
  scene.add(glow);
}

// ============================================
// Landmarks (Cities)
// ============================================

function createLandmarks(scene) {
  Object.entries(LANDMARKS).forEach(([key, data]) => {
    const group = new THREE.Group();
    const terrainH = getTerrainHeight(data.x, data.z);
    group.position.set(data.x, terrainH, data.z);
    group.userData = { key, ...data };
    
    // Base platform
    const baseGeometry = new THREE.CylinderGeometry(1.5, 2, 0.3, 6);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.8,
      metalness: 0.2
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 0.15;
    base.receiveShadow = true;
    group.add(base);
    
    // City indicator - stylized building cluster or icon
    if (data.isAirport) {
      // Airport icon
      const runwayGeo = new THREE.BoxGeometry(3, 0.1, 0.5);
      const runwayMat = new THREE.MeshStandardMaterial({ 
        color: 0x4a4a5a,
        emissive: 0x222233,
        emissiveIntensity: 0.3
      });
      const runway = new THREE.Mesh(runwayGeo, runwayMat);
      runway.position.y = 0.35;
      group.add(runway);
    } else if (data.isPort) {
      // Port icon - crane-like
      const craneGeo = new THREE.BoxGeometry(0.3, 2, 0.3);
      const craneMat = new THREE.MeshStandardMaterial({ 
        color: 0xff6b35,
        emissive: 0xff6b35,
        emissiveIntensity: 0.3
      });
      const crane = new THREE.Mesh(craneGeo, craneMat);
      crane.position.y = 1.3;
      group.add(crane);
      
      const armGeo = new THREE.BoxGeometry(1.5, 0.2, 0.2);
      const arm = new THREE.Mesh(armGeo, craneMat);
      arm.position.set(0.5, 2.2, 0);
      group.add(arm);
    } else {
      // City buildings - cluster of boxes
      const buildingCount = Math.ceil(data.height * 2);
      const buildingMat = new THREE.MeshStandardMaterial({
        color: 0x3a4a5a,
        roughness: 0.6,
        metalness: 0.4,
        emissive: 0x111122,
        emissiveIntensity: 0.2
      });
      
      for (let i = 0; i < buildingCount; i++) {
        const bHeight = data.height * (0.5 + Math.random() * 0.8);
        const bWidth = 0.3 + Math.random() * 0.4;
        const buildingGeo = new THREE.BoxGeometry(bWidth, bHeight, bWidth);
        const building = new THREE.Mesh(buildingGeo, buildingMat);
        building.position.set(
          (Math.random() - 0.5) * 1.5,
          bHeight / 2 + 0.3,
          (Math.random() - 0.5) * 1.5
        );
        building.castShadow = true;
        building.receiveShadow = true;
        group.add(building);
      }
      
      // Add glowing windows effect for major cities
      if (data.height >= 2) {
        const glowGeo = new THREE.SphereGeometry(0.8, 8, 8);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0xffaa44,
          transparent: true,
          opacity: 0.15
        });
        const cityGlow = new THREE.Mesh(glowGeo, glowMat);
        cityGlow.position.y = data.height * 0.5;
        cityGlow.scale.y = 0.5;
        group.add(cityGlow);
      }
    }
    
    scene.add(group);
    landmarkMeshes.push(group);
  });
}

// ============================================
// Grid Helper
// ============================================

function createGrid(scene) {
  // Subtle grid for reference
  gridHelper = new THREE.GridHelper(100, 20, 0x222233, 0x111122);
  gridHelper.position.y = 0.05;
  gridHelper.material.opacity = 0.3;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);
}

// ============================================
// Atmospheric Effects
// ============================================

function createAtmosphericEffects(scene) {
  // Horizon glow
  const horizonGeo = new THREE.RingGeometry(80, 200, 64);
  horizonGeo.rotateX(-Math.PI / 2);
  const horizonMat = new THREE.MeshBasicMaterial({
    color: 0x1a2a3a,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide
  });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  horizon.position.y = -2;
  scene.add(horizon);
  
  // Distant mountains silhouette (background)
  const mountainGeometry = new THREE.BufferGeometry();
  const mountainVertices = [];
  const mountainCount = 30;
  
  for (let i = 0; i < mountainCount; i++) {
    const angle = (i / mountainCount) * Math.PI * 2;
    const radius = 90 + Math.random() * 20;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const height = 5 + Math.random() * 15;
    
    // Triangle for each "peak"
    mountainVertices.push(
      x - 5, 0, z,
      x + 5, 0, z,
      x, height, z
    );
  }
  
  mountainGeometry.setAttribute('position', 
    new THREE.Float32BufferAttribute(mountainVertices, 3)
  );
  mountainGeometry.computeVertexNormals();
  
  const mountainMaterial = new THREE.MeshBasicMaterial({
    color: 0x0a0a15,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide
  });
  
  const mountains = new THREE.Mesh(mountainGeometry, mountainMaterial);
  scene.add(mountains);
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

export function getLandmarkPositions() {
  return { ...LANDMARKS };
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
}