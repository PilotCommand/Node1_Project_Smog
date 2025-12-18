/**
 * map.js — Terrain + landmarks + coordinate conventions
 * 
 * Builds the Bay Area world representation.
 * Owns: terrain mesh, water plane, landmark meshes, coordinate mapping
 */

import * as THREE from 'three';

// ============================================
// Constants & Configuration
// ============================================

// World scale: 1 unit ≈ 1 km
const WORLD_SCALE = 1;

// Bay Area bounds (simplified rectangle)
const MAP_BOUNDS = {
  width: 100,   // ~100km east-west
  depth: 120,   // ~120km north-south
  maxHeight: 8  // max terrain height
};

// Landmark positions (approximate, centered on SF Bay)
// Origin (0,0) is roughly center of the bay
const LANDMARKS = {
  sanFrancisco:  { x: -15, z: 5,   name: 'San Francisco', height: 3 },
  oakland:       { x: 8,   z: 8,   name: 'Oakland', height: 2 },
  berkeley:      { x: 6,   z: 15,  name: 'Berkeley', height: 1.5 },
  richmond:      { x: -2,  z: 25,  name: 'Richmond', height: 1 },
  sanJose:       { x: 15,  z: -35, name: 'San José', height: 1.5 },
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

// ============================================
// Initialization
// ============================================

export function initMap(scene) {
  console.log('🗺️ Building Bay Area map...');
  
  createTerrain(scene);
  createWater(scene);
  createLandmarks(scene);
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
// Terrain
// ============================================

function createTerrain(scene) {
  // Create terrain geometry with some topology
  const geometry = new THREE.PlaneGeometry(
    MAP_BOUNDS.width,
    MAP_BOUNDS.depth,
    128,
    128
  );
  
  // Rotate to XZ plane
  geometry.rotateX(-Math.PI / 2);
  
  // Apply height displacement for hills/mountains
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    
    // Base height from noise-like function
    let height = 0;
    
    // East Bay hills
    if (x > 5 && x < 35) {
      const hillFactor = Math.max(0, 1 - Math.abs(x - 20) / 15);
      height += hillFactor * 4 * (0.5 + 0.5 * Math.sin(z * 0.1));
    }
    
    // Marin headlands (northwest)
    if (x < -10 && z > 10) {
      const marinFactor = Math.max(0, 1 - Math.abs(x + 25) / 20) * Math.max(0, 1 - Math.abs(z - 25) / 20);
      height += marinFactor * 5;
    }
    
    // Santa Cruz mountains (southwest)
    if (x < 5 && z < -20) {
      const scFactor = Math.max(0, 1 - Math.abs(x + 10) / 20) * Math.max(0, 1 - Math.abs(z + 40) / 25);
      height += scFactor * 6;
    }
    
    // Depression for the bay itself
    const bayCenter = { x: 0, z: 0 };
    const distFromBay = Math.sqrt(
      Math.pow((x - bayCenter.x) / 15, 2) + 
      Math.pow((z - bayCenter.z) / 25, 2)
    );
    if (distFromBay < 1) {
      height -= (1 - distFromBay) * 3;
    }
    
    // Add some noise
    height += Math.sin(x * 0.3) * Math.cos(z * 0.3) * 0.5;
    
    positions.setY(i, Math.max(-1, height));
  }
  
  geometry.computeVertexNormals();
  
  // Terrain material - earthy with slight stylization
  const material = new THREE.MeshStandardMaterial({
    color: 0x2d4a3e,
    roughness: 0.9,
    metalness: 0.1,
    flatShading: false,
  });
  
  terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.position.y = 0;
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
  water.position.set(-2, -0.5, 0);
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
  glow.position.set(-2, -1, 0);
  scene.add(glow);
}

// ============================================
// Landmarks (Cities)
// ============================================

function createLandmarks(scene) {
  Object.entries(LANDMARKS).forEach(([key, data]) => {
    const group = new THREE.Group();
    group.position.set(data.x, getTerrainHeight(data.x, data.z), data.z);
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
  gridHelper.position.y = 0.01;
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
  // Simplified height lookup - in a real implementation,
  // this would raycast to the terrain or use the heightmap
  
  // East Bay hills
  let height = 0;
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