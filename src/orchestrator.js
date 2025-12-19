/**
 * orchestrator.js — Optimized pollution visualization
 * 
 * Uses spatial binning to render pollution as volumetric prisms.
 * Particles are tracked individually for physics but grouped
 * into grid cells for efficient rendering.
 * 
 * OPTIMIZATION STRATEGY:
 * - Track particles as lightweight data points (no individual meshes)
 * - Bin particles into a 3D spatial grid each frame
 * - Render one rectangular prism per occupied cell
 * - Prism size reflects local concentration (more particles = bigger prism)
 * - Result: ~1000-2000 prisms instead of 50,000+ sphere instances
 */

import * as THREE from 'three';
import { emit, POLLUTANT_TYPES, getPollutantConfig } from './polluters.js';
import { getVelocityAt } from './traffic.js';

// ============================================
// Configuration
// ============================================

// Particle physics (lightweight tracking)
const PARTICLE_CONFIG = {
  maxParticles: 12000,      // Total across all pollutant types
  lifetime: 45,             // Seconds before forced removal
  emissionScale: 0.5,       // Reduce emission rates for performance
};

// Spatial grid for visualization
// Map is 151km x 134km, we use ~2.5km cells for finer resolution
const GRID_CONFIG = {
  // Cell dimensions (in world units = km)
  cellSizeX: 2.5,
  cellSizeY: 3.0,           // Vertical cell height
  cellSizeZ: 2.5,
  
  // Grid bounds (slightly larger than map to catch edge particles)
  minX: -80,
  maxX: 80,
  minY: 0,
  maxY: 35,
  minZ: -72,
  maxZ: 72,
  
  // Prism appearance
  basePrismSize: 0.6,       // Base size when cell has few particles
  maxPrismSize: 2.2,        // Maximum size at high concentration
  minOpacity: 0.4,          // Minimum prism opacity
  maxOpacity: 0.8,          // Maximum prism opacity
  
  // Concentration thresholds (particles per cell)
  lowThreshold: 1,          // Below this, prism is at base size
  highThreshold: 20,        // Above this, prism is at max size
};

// Maximum prism instances per pollutant type
const MAX_INSTANCES = 1500;

// ============================================
// State
// ============================================

let scene = null;
let mapData = null;
let polluters = null;
let paused = false;

// Particle storage - flat array per type for cache efficiency
const particles = {
  PM25: [],
  VOC: [],
  OZONE: []
};

// Grid cell storage - reused each frame
// Key: "cellX,cellY,cellZ" -> { count, totalAge, centerX, centerY, centerZ }
const gridCells = {
  PM25: new Map(),
  VOC: new Map(),
  OZONE: new Map()
};

// Three.js instanced meshes per pollutant (prisms, not spheres)
const instancedMeshes = {};
const dummy = new THREE.Object3D();

// Reusable vectors
const _velocity = new THREE.Vector3();

// ============================================
// Initialization
// ============================================

export function initOrchestrator(sceneRef, map, polluters_, settings) {
  console.log('🧠 Initializing optimized orchestrator...');
  
  scene = sceneRef;
  mapData = map;
  polluters = polluters_;
  
  // Calculate grid dimensions for logging
  const gridDimsX = Math.ceil((GRID_CONFIG.maxX - GRID_CONFIG.minX) / GRID_CONFIG.cellSizeX);
  const gridDimsY = Math.ceil((GRID_CONFIG.maxY - GRID_CONFIG.minY) / GRID_CONFIG.cellSizeY);
  const gridDimsZ = Math.ceil((GRID_CONFIG.maxZ - GRID_CONFIG.minZ) / GRID_CONFIG.cellSizeZ);
  
  console.log(`  → Grid: ${gridDimsX}×${gridDimsY}×${gridDimsZ} cells (${GRID_CONFIG.cellSizeX}km cells)`);
  console.log(`  → Max particles: ${PARTICLE_CONFIG.maxParticles}, Max prisms: ${MAX_INSTANCES}/type`);
  
  // Create instanced prism meshes for each pollutant type
  Object.entries(POLLUTANT_TYPES).forEach(([id, config]) => {
    createInstancedPrismMesh(id, config);
  });
  
  console.log('  ✓ Particle system ready (spatial binning enabled)');
}

// ============================================
// Instanced Prism Mesh Creation
// ============================================

function createInstancedPrismMesh(pollutantId, config) {
  // Use box geometry instead of sphere - more efficient and looks like volumetric clouds
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  
  // Material with emissive glow - slightly transparent for volumetric look
  const material = new THREE.MeshStandardMaterial({
    color: config.color,
    emissive: config.color,
    emissiveIntensity: 0.4,
    roughness: 0.7,
    metalness: 0.1,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,       // Allows proper transparency blending
  });
  
  // Create instanced mesh with pre-allocated instances
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;            // Start with no visible instances
  mesh.renderOrder = 20;     // Render after terrain/water
  
  // Initialize all instances to zero scale (hidden)
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_INSTANCES; i++) {
    mesh.setMatrixAt(i, zeroMatrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  
  scene.add(mesh);
  instancedMeshes[pollutantId] = mesh;
}

// ============================================
// Spatial Hashing Utilities
// ============================================

/**
 * Convert world position to grid cell indices
 */
function worldToCell(x, y, z) {
  const cellX = Math.floor((x - GRID_CONFIG.minX) / GRID_CONFIG.cellSizeX);
  const cellY = Math.floor((y - GRID_CONFIG.minY) / GRID_CONFIG.cellSizeY);
  const cellZ = Math.floor((z - GRID_CONFIG.minZ) / GRID_CONFIG.cellSizeZ);
  return { cellX, cellY, cellZ };
}

/**
 * Get cell center in world coordinates
 */
function cellToWorld(cellX, cellY, cellZ) {
  return {
    x: GRID_CONFIG.minX + (cellX + 0.5) * GRID_CONFIG.cellSizeX,
    y: GRID_CONFIG.minY + (cellY + 0.5) * GRID_CONFIG.cellSizeY,
    z: GRID_CONFIG.minZ + (cellZ + 0.5) * GRID_CONFIG.cellSizeZ
  };
}

/**
 * Create a cell key string from indices
 */
function cellKey(cellX, cellY, cellZ) {
  return `${cellX},${cellY},${cellZ}`;
}

// ============================================
// Main Simulation Step
// ============================================

export function stepOrchestrator(dt, settings) {
  if (paused) return;
  
  // 1. Get new emissions (scaled down for performance)
  const scaledSettings = {
    ...settings,
    emissionRate: settings.emissionRate * PARTICLE_CONFIG.emissionScale
  };
  const emissions = emit(dt, scaledSettings);
  
  // 2. Inject new particles
  emissions.forEach(event => {
    addParticle(event.type, event.x, event.y, event.z);
  });
  
  // 3. Update particle physics
  Object.keys(particles).forEach(pollutantId => {
    updateParticlePhysics(pollutantId, dt, settings);
  });
  
  // 4. Bin particles into grid cells
  binParticlesToGrid();
  
  // 5. Update visual representation (prisms from grid)
  updateInstancedPrisms();
}

// ============================================
// Particle Management
// ============================================

function addParticle(pollutantId, x, y, z) {
  const particleArray = particles[pollutantId];
  if (!particleArray) return;
  
  // Calculate total particles across all types
  const totalParticles = Object.values(particles).reduce((sum, arr) => sum + arr.length, 0);
  
  // Enforce global max (remove oldest from this type if over limit)
  if (totalParticles >= PARTICLE_CONFIG.maxParticles) {
    // Find the type with the most particles and remove from it
    let maxType = pollutantId;
    let maxCount = particleArray.length;
    Object.entries(particles).forEach(([id, arr]) => {
      if (arr.length > maxCount) {
        maxCount = arr.length;
        maxType = id;
      }
    });
    particles[maxType].shift();
  }
  
  // Add new particle - minimal data for efficiency
  particleArray.push({
    x, y, z,
    age: 0,
    mass: 1.0  // Could be used for weighted binning
  });
}

function updateParticlePhysics(pollutantId, dt, settings) {
  const particleArray = particles[pollutantId];
  const config = getPollutantConfig(pollutantId);
  if (!particleArray || !config) return;
  
  const bounds = mapData.bounds;
  const halfWidth = bounds.width / 2 + 15;
  const halfDepth = bounds.depth / 2 + 15;
  
  // Process in reverse for safe removal
  for (let i = particleArray.length - 1; i >= 0; i--) {
    const p = particleArray[i];
    
    // Get local air velocity
    _velocity.copy(getVelocityAt(p.x, p.y, p.z, 0, settings));
    
    // Apply advection (transport by wind)
    p.x += _velocity.x * dt;
    p.y += _velocity.y * dt;
    p.z += _velocity.z * dt;
    
    // Apply dispersion (random spreading)
    const disperseAmount = config.disperseRate * settings.turbulence * dt;
    p.x += (Math.random() - 0.5) * disperseAmount * 2;
    p.y += (Math.random() - 0.5) * disperseAmount;
    p.z += (Math.random() - 0.5) * disperseAmount * 2;
    
    // Apply settling (for PM)
    if (config.settlingRate > 0) {
      p.y -= config.settlingRate * dt;
    }
    
    // Check terrain collision / deposition
    const terrainHeight = mapData.getTerrainHeight(p.x, p.z);
    if (p.y <= terrainHeight + 0.15) {
      if (config.settlingRate > 0) {
        // PM deposits and is removed
        particleArray.splice(i, 1);
        continue;
      } else {
        // Gases stay just above terrain
        p.y = terrainHeight + 0.3;
      }
    }
    
    // Age particle
    p.age += dt;
    
    // Remove if too old
    if (p.age > PARTICLE_CONFIG.lifetime) {
      particleArray.splice(i, 1);
      continue;
    }
    
    // Remove if out of bounds
    if (Math.abs(p.x) > halfWidth ||
        Math.abs(p.z) > halfDepth ||
        p.y > 45 || p.y < -2) {
      particleArray.splice(i, 1);
      continue;
    }
  }
}

// ============================================
// Spatial Binning
// ============================================

function binParticlesToGrid() {
  // Clear all grid cells
  Object.values(gridCells).forEach(map => map.clear());
  
  // Bin each particle type
  Object.entries(particles).forEach(([pollutantId, particleArray]) => {
    const cellMap = gridCells[pollutantId];
    
    particleArray.forEach(p => {
      const { cellX, cellY, cellZ } = worldToCell(p.x, p.y, p.z);
      const key = cellKey(cellX, cellY, cellZ);
      
      if (!cellMap.has(key)) {
        // Initialize cell data
        cellMap.set(key, {
          cellX, cellY, cellZ,
          count: 0,
          totalAge: 0,
          totalMass: 0
        });
      }
      
      const cell = cellMap.get(key);
      cell.count++;
      cell.totalAge += p.age;
      cell.totalMass += p.mass;
    });
  });
}

// ============================================
// Prism Rendering from Grid
// ============================================

function updateInstancedPrisms() {
  Object.entries(instancedMeshes).forEach(([pollutantId, mesh]) => {
    const cellMap = gridCells[pollutantId];
    const config = getPollutantConfig(pollutantId);
    
    let instanceIndex = 0;
    
    cellMap.forEach((cell) => {
      if (instanceIndex >= MAX_INSTANCES) return;
      
      // Get cell center position
      const pos = cellToWorld(cell.cellX, cell.cellY, cell.cellZ);
      
      // Calculate prism size based on concentration
      const concentration = cell.count;
      let sizeFactor;
      
      if (concentration <= GRID_CONFIG.lowThreshold) {
        sizeFactor = GRID_CONFIG.basePrismSize;
      } else if (concentration >= GRID_CONFIG.highThreshold) {
        sizeFactor = GRID_CONFIG.maxPrismSize;
      } else {
        // Smooth interpolation between low and high thresholds
        const t = (concentration - GRID_CONFIG.lowThreshold) / 
                  (GRID_CONFIG.highThreshold - GRID_CONFIG.lowThreshold);
        // Use sqrt for more gradual growth
        sizeFactor = GRID_CONFIG.basePrismSize + 
                     (GRID_CONFIG.maxPrismSize - GRID_CONFIG.basePrismSize) * Math.sqrt(t);
      }
      
      // Calculate average age for opacity
      const avgAge = cell.totalAge / cell.count;
      const ageOpacityFactor = Math.max(0.3, 1 - (avgAge / PARTICLE_CONFIG.lifetime) * 0.5);
      
      // Slight random variation for organic look
      const variation = 0.9 + Math.random() * 0.2;
      
      // Apply size with slight asymmetry for more natural appearance
      dummy.position.set(pos.x, pos.y, pos.z);
      dummy.scale.set(
        sizeFactor * variation * 1.1,           // Slightly wider X
        sizeFactor * variation * 0.7,           // Flatter Y (horizontal spread)
        sizeFactor * variation * 1.1            // Slightly wider Z
      );
      
      // Slight random rotation for variety
      dummy.rotation.y = (cell.cellX + cell.cellZ) * 0.3;
      
      dummy.updateMatrix();
      mesh.setMatrixAt(instanceIndex, dummy.matrix);
      
      instanceIndex++;
    });
    
    // Hide unused instances by scaling to zero
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = instanceIndex; i < mesh.count; i++) {
      mesh.setMatrixAt(i, zeroMatrix);
    }
    
    mesh.count = instanceIndex;
    mesh.instanceMatrix.needsUpdate = true;
    
    // Update opacity based on overall concentration
    if (config) {
      const totalParticles = particles[pollutantId].length;
      const baseOpacity = GRID_CONFIG.minOpacity + 
        (GRID_CONFIG.maxOpacity - GRID_CONFIG.minOpacity) * 
        Math.min(1, totalParticles / 3000);
      mesh.material.opacity = baseOpacity;
    }
  });
}

// ============================================
// Control Functions
// ============================================

export function resetOrchestrator() {
  console.log('🔄 Resetting simulation...');
  
  // Clear all particles
  Object.keys(particles).forEach(pollutantId => {
    particles[pollutantId] = [];
  });
  
  // Clear grid
  Object.values(gridCells).forEach(map => map.clear());
  
  // Update visuals
  updateInstancedPrisms();
}

export function setPaused(isPaused) {
  paused = isPaused;
  console.log(paused ? '⏸️ Simulation paused' : '▶️ Simulation resumed');
}

export function getParticleCount() {
  let total = 0;
  Object.values(particles).forEach(arr => {
    total += arr.length;
  });
  return total;
}

export function getParticleCountByType() {
  const counts = {};
  Object.entries(particles).forEach(([id, arr]) => {
    counts[id] = arr.length;
  });
  return counts;
}

export function getGridCellCount() {
  let total = 0;
  Object.values(gridCells).forEach(map => {
    total += map.size;
  });
  return total;
}

export function getParticles() {
  return particles;
}

// ============================================
// Debug / Stats
// ============================================

export function getOrchestratorStats() {
  const particleCounts = getParticleCountByType();
  const gridCounts = {};
  Object.entries(gridCells).forEach(([id, map]) => {
    gridCounts[id] = map.size;
  });
  
  return {
    particles: particleCounts,
    gridCells: gridCounts,
    totalParticles: getParticleCount(),
    totalCells: getGridCellCount()
  };
}

// ============================================
// Cleanup
// ============================================

export function disposeOrchestrator() {
  Object.values(instancedMeshes).forEach(mesh => {
    mesh.geometry.dispose();
    mesh.material.dispose();
    scene.remove(mesh);
  });
}