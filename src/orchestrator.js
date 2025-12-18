/**
 * orchestrator.js — Simulation brain + state owner
 * 
 * Owns the pollutant state and applies each step in the correct order.
 * Uses instanced rendering for performance.
 */

import * as THREE from 'three';
import { emit, POLLUTANT_TYPES, getPollutantConfig } from './polluters.js';
import { getVelocityAt } from './traffic.js';

// ============================================
// Configuration
// ============================================

const MAX_PARTICLES = 50000;  // Per pollutant type
const PARTICLE_LIFETIME = 60; // Seconds before forced removal

// ============================================
// State
// ============================================

let scene = null;
let mapData = null;
let polluters = null;
let paused = false;

// Particle storage per pollutant type
const particles = {
  PM25: [],
  VOC: [],
  OZONE: []
};

// Three.js instanced meshes per pollutant
const instancedMeshes = {};
const dummy = new THREE.Object3D();

// Temporary vectors for calculations
const _velocity = new THREE.Vector3();
const _position = new THREE.Vector3();

// ============================================
// Initialization
// ============================================

export function initOrchestrator(sceneRef, map, polluters_, settings) {
  console.log('🧠 Initializing orchestrator...');
  
  scene = sceneRef;
  mapData = map;
  polluters = polluters_;
  
  // Create instanced meshes for each pollutant type
  Object.entries(POLLUTANT_TYPES).forEach(([id, config]) => {
    createInstancedMesh(id, config);
  });
  
  console.log(`  → Particle system ready (max ${MAX_PARTICLES} per type)`);
}

// ============================================
// Instanced Mesh Creation
// ============================================

function createInstancedMesh(pollutantId, config) {
  // Particle geometry - small sphere
  const geometry = new THREE.SphereGeometry(config.size, 8, 6);
  
  // Material with emissive glow
  const material = new THREE.MeshStandardMaterial({
    color: config.color,
    emissive: config.color,
    emissiveIntensity: 0.5,
    roughness: 0.5,
    metalness: 0.2,
    transparent: true,
    opacity: 0.85
  });
  
  // Create instanced mesh
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0; // Start with no visible instances
  
  // Add to scene
  scene.add(mesh);
  instancedMeshes[pollutantId] = mesh;
}

// ============================================
// Main Simulation Step
// ============================================

export function stepOrchestrator(dt, settings) {
  if (paused) return;
  
  // 1. Get new emissions
  const emissions = emit(dt, settings);
  
  // 2. Inject new particles
  emissions.forEach(event => {
    addParticle(event.type, event.x, event.y, event.z);
  });
  
  // 3. Update existing particles
  Object.keys(particles).forEach(pollutantId => {
    updateParticles(pollutantId, dt, settings);
  });
  
  // 4. Update visual representation
  updateInstancedMeshes();
}

// ============================================
// Particle Management
// ============================================

function addParticle(pollutantId, x, y, z) {
  const particleArray = particles[pollutantId];
  if (!particleArray) return;
  
  // Enforce max particles (remove oldest if at limit)
  if (particleArray.length >= MAX_PARTICLES) {
    particleArray.shift();
  }
  
  particleArray.push({
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    age: 0,
    opacity: 1
  });
}

function updateParticles(pollutantId, dt, settings) {
  const particleArray = particles[pollutantId];
  const config = getPollutantConfig(pollutantId);
  if (!particleArray || !config) return;
  
  // Process particles in reverse (for safe removal)
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
    if (p.y <= terrainHeight + 0.1) {
      // Particle has deposited
      if (config.settlingRate > 0) {
        // PM deposits and is removed
        particleArray.splice(i, 1);
        continue;
      } else {
        // Gases bounce slightly
        p.y = terrainHeight + 0.2;
        p.vy = Math.abs(p.vy) * 0.3;
      }
    }
    
    // Apply decay
    p.age += dt;
    p.opacity = Math.max(0, 1 - config.decayRate * p.age);
    
    // Remove if too old or faded
    if (p.age > PARTICLE_LIFETIME || p.opacity <= 0) {
      particleArray.splice(i, 1);
      continue;
    }
    
    // Remove if out of bounds
    const bounds = mapData.bounds;
    if (Math.abs(p.x) > bounds.width / 2 + 20 ||
        Math.abs(p.z) > bounds.depth / 2 + 20 ||
        p.y > 50 || p.y < -5) {
      particleArray.splice(i, 1);
      continue;
    }
  }
}

// ============================================
// Visual Update
// ============================================

function updateInstancedMeshes() {
  Object.entries(instancedMeshes).forEach(([pollutantId, mesh]) => {
    const particleArray = particles[pollutantId];
    const config = getPollutantConfig(pollutantId);
    
    // Update instance count
    mesh.count = particleArray.length;
    
    // Update each instance's transform
    particleArray.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      
      // Scale based on opacity/age
      const scale = 0.5 + p.opacity * 0.5;
      dummy.scale.setScalar(scale);
      
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    
    // Flag for GPU update
    mesh.instanceMatrix.needsUpdate = true;
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
  
  // Update visuals
  updateInstancedMeshes();
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