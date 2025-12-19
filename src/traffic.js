/**
 * traffic.js - "Atmospheric traffic" transport field ("how air moves")
 * 
 * Provides the atmospheric motion model (advection + mixing).
 * Owns: velocity field function, wind parameters, turbulence
 */

import * as THREE from 'three';

// ============================================
// State
// ============================================

let mapData = null;
let currentTime = 0;

// Cache for performance
const _velocity = new THREE.Vector3();
const _noise = new THREE.Vector3();

// ============================================
// Initialization
// ============================================

export function initTraffic(map, settings) {
  console.log('ðŸ’¨ Initializing atmospheric transport...');
  mapData = map;
}

// ============================================
// Core Velocity Function
// ============================================

/**
 * Get the air velocity at a given position and time.
 * 
 * @param {number} x - World X position
 * @param {number} y - World Y position (height)
 * @param {number} z - World Z position
 * @param {number} t - Current simulation time
 * @param {object} settings - Global settings object
 * @returns {THREE.Vector3} - Velocity vector (units per second)
 */
export function getVelocityAt(x, y, z, t, settings) {
  _velocity.set(0, 0, 0);
  
  // ========================================
  // 1. Base prevailing wind
  // ========================================
  const windDir = settings.windDirection * (Math.PI / 180); // Convert to radians
  const windSpeed = settings.windSpeed;
  
  // Wind direction convention: 0° = from North, 90° = from East
  // So wind blowing TO is opposite direction
  const windX = Math.sin(windDir) * windSpeed;
  const windZ = Math.cos(windDir) * windSpeed;
  
  _velocity.x += windX;
  _velocity.z += windZ;
  
  // ========================================
  // 2. Height-dependent wind shear
  // ========================================
  // Wind typically stronger at height (logarithmic profile)
  const heightFactor = Math.log(Math.max(1, y + 1)) / Math.log(10);
  _velocity.x *= (0.5 + heightFactor * 0.7);
  _velocity.z *= (0.5 + heightFactor * 0.7);
  
  // ========================================
  // 3. Sea breeze effect (diurnal cycle)
  // ========================================
  // Simplified: during "day" (t mod 60 < 30), breeze comes from ocean (west)
  // During "night", land breeze goes to ocean
  const dayPhase = (t % 120) / 120; // 0-1 over 2 minute "day"
  const seaBreezeFactor = Math.sin(dayPhase * Math.PI * 2) * 0.3;
  
  // Bay is roughly to the west, so sea breeze adds eastward component
  _velocity.x += seaBreezeFactor * windSpeed * 0.3;
  
  // ========================================
  // 4. Terrain effects (simplified)
  // ========================================
  if (mapData) {
    // Check if we're near hills - wind deflects around them
    const terrainHeight = mapData.getTerrainHeight(x, z);
    
    // If particle is below terrain influence height, deflect
    if (y < terrainHeight + 5) {
      // East Bay hills deflect wind northward/southward
      if (x > 10 && x < 35) {
        const deflection = Math.sign(z) * 0.5 * (1 - y / (terrainHeight + 5));
        _velocity.z += deflection * windSpeed * 0.3;
      }
      
      // Channeling through Golden Gate
      if (x < -10 && z > 0 && z < 20) {
        // Accelerate through gap
        _velocity.x *= 1.3;
      }
    }
    
    // Updraft near hills (thermal/orographic)
    if (y < terrainHeight + 10) {
      const hilliness = terrainHeight / 5; // 0-1 based on terrain height
      _velocity.y += hilliness * 0.5 * (1 - y / (terrainHeight + 10));
    }
  }
  
  // ========================================
  // 5. Convergence/divergence near bay
  // ========================================
  // Air tends to converge over water during day (thermal low)
  const distFromBayCenter = Math.sqrt(x * x + z * z);
  if (distFromBayCenter < 30) {
    const convergeFactor = (1 - distFromBayCenter / 30) * 0.1 * Math.sin(dayPhase * Math.PI);
    // Pull toward center
    _velocity.x -= (x / distFromBayCenter) * convergeFactor * windSpeed;
    _velocity.z -= (z / distFromBayCenter) * convergeFactor * windSpeed;
    // Slight uplift over bay
    _velocity.y += convergeFactor * 0.5;
  }
  
  // ========================================
  // 6. Turbulent mixing (random walk component)
  // ========================================
  const turbulence = settings.turbulence;
  if (turbulence > 0) {
    // Gaussian-ish random perturbation
    _noise.set(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );
    
    // Scale by turbulence and wind speed
    const turbScale = turbulence * windSpeed * 0.5;
    _velocity.x += _noise.x * turbScale;
    _velocity.y += _noise.y * turbScale * 0.3; // Less vertical turbulence
    _velocity.z += _noise.z * turbScale;
  }
  
  // ========================================
  // 7. Buoyancy (warm air rises)
  // ========================================
  // Near emission sources (hot stacks), add upward velocity
  // This is simplified - real plume rise is more complex
  if (y < 5) {
    _velocity.y += 0.5 * (1 - y / 5);
  }
  
  return _velocity.clone();
}

// ============================================
// Update (for time-varying fields)
// ============================================

export function updateTraffic(dt) {
  currentTime += dt;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get wind vector for display/arrows
 */
export function getWindVector(settings) {
  const windDir = settings.windDirection * (Math.PI / 180);
  const windSpeed = settings.windSpeed;
  
  return new THREE.Vector3(
    Math.sin(windDir) * windSpeed,
    0,
    Math.cos(windDir) * windSpeed
  );
}

/**
 * Get a human-readable wind direction
 */
export function getWindDirectionName(degrees) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Sample velocity field at multiple points (for visualization)
 */
export function sampleVelocityField(bounds, resolution, height, settings) {
  const samples = [];
  const stepX = bounds.width / resolution;
  const stepZ = bounds.depth / resolution;
  
  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const x = -bounds.width / 2 + i * stepX;
      const z = -bounds.depth / 2 + j * stepZ;
      const vel = getVelocityAt(x, height, z, currentTime, settings);
      
      samples.push({
        position: new THREE.Vector3(x, height, z),
        velocity: vel
      });
    }
  }
  
  return samples;
}