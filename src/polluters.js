/**
 * polluters.js — Emission generation system
 * 
 * Generates particles from point and line emitters each timestep.
 * Data comes from registry.js, this file handles the emission physics.
 * 
 * Point sources: cities, airports, refineries, ports, bridges, etc.
 * Line sources: highways (distributed emissions along route)
 */

import {
  EMITTER_PROFILES,
  POINT_EMITTERS,
  LINE_EMITTERS,
  geoToWorld,
  getProfile,
  calculateRouteLength,
  getRandomPointOnRoute,
  logRegistrySummary
} from './registry.js';

// ============================================
// POLLUTANT TYPES (Physics Properties)
// ============================================

/**
 * Physical properties of each pollutant type.
 * These control how particles behave after emission.
 */
export const POLLUTANT_TYPES = {
  PM25: {
    id: 'PM25',
    name: 'PM2.5',
    color: 0xff6b35,       // Warm orange
    settlingRate: 0.15,    // Falls to ground (m/s)
    disperseRate: 0.8,     // Horizontal spread rate
    decayRate: 0.002,      // Opacity fade rate
    size: 0.4              // Particle visual size
  },
  VOC: {
    id: 'VOC',
    name: 'VOCs',
    color: 0xa855f7,       // Purple
    settlingRate: 0.0,     // Gas - doesn't settle
    disperseRate: 1.5,     // Disperses quickly
    decayRate: 0.005,      // Moderate decay
    size: 0.3
  },
  OZONE: {
    id: 'OZONE',
    name: 'O₃',
    color: 0x06b6d4,       // Cyan
    settlingRate: 0.0,     // Gas - doesn't settle
    disperseRate: 1.2,     // Moderate dispersion
    decayRate: 0.008,      // Faster decay (reactive)
    size: 0.25
  }
};

// ============================================
// STATE
// ============================================

// Processed emitters with world coordinates
let processedPointEmitters = [];
let processedLineEmitters = [];

// Reference to map data (for terrain height queries)
let mapData = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the polluter system.
 * Processes all emitters from registry and converts coordinates.
 * 
 * @param {Object} map - Map data object with getTerrainHeight()
 * @returns {Object} Processed emitters for external use
 */
export function initPolluters(map) {
  console.log('🏭 Initializing polluters from registry...');
  
  mapData = map;
  
  // Log registry summary for debugging
  logRegistrySummary();
  
  // Process point emitters - convert geo coords to world positions
  processedPointEmitters = POINT_EMITTERS.map(emitter => {
    const profile = getProfile(emitter.profile);
    if (!profile) {
      console.warn(`  ⚠️ Unknown profile "${emitter.profile}" for emitter "${emitter.id}"`);
      return null;
    }
    
    const worldCoords = geoToWorld(emitter.coords.lon, emitter.coords.lat);
    const terrainHeight = map.getTerrainHeight(worldCoords.x, worldCoords.z);
    
    // Calculate emission height (terrain + structure + plume rise)
    const emissionHeight = terrainHeight + 
                          (profile.height || 0.5) + 
                          (profile.plumeRise || 0);
    
    return {
      ...emitter,
      profileData: profile,
      worldPosition: {
        x: worldCoords.x,
        y: emissionHeight,
        z: worldCoords.z
      },
      terrainHeight: terrainHeight
    };
  }).filter(e => e !== null);
  
  // Process line emitters - calculate route lengths
  processedLineEmitters = LINE_EMITTERS.map(emitter => {
    const profile = getProfile(emitter.profile);
    if (!profile) {
      console.warn(`  ⚠️ Unknown profile "${emitter.profile}" for line emitter "${emitter.id}"`);
      return null;
    }
    
    const length = calculateRouteLength(emitter.waypoints);
    
    return {
      ...emitter,
      profileData: profile,
      length: length
    };
  }).filter(e => e !== null);
  
  console.log(`  → ${processedPointEmitters.length} point emitters initialized`);
  console.log(`  → ${processedLineEmitters.length} line emitters (${Math.round(processedLineEmitters.reduce((s, e) => s + e.length, 0))} km of highways)`);
  
  return {
    pointEmitters: processedPointEmitters,
    lineEmitters: processedLineEmitters
  };
}

// ============================================
// EMISSION GENERATION
// ============================================

/**
 * Generate emission events for this timestep.
 * Called by orchestrator each simulation step.
 * 
 * @param {number} dt - Delta time in seconds
 * @param {Object} settings - Global settings (emissionRate, enable flags)
 * @returns {Array} Array of emission events { type, emitterId, x, y, z }
 */
export function emit(dt, settings) {
  const events = [];
  
  // Global rate multiplier from settings
  const rateMultiplier = settings.emissionRate * dt;
  
  // Emit from all point sources
  for (const emitter of processedPointEmitters) {
    const pointEvents = emitFromPoint(emitter, rateMultiplier, settings);
    if (pointEvents.length > 0) {
      events.push(...pointEvents);
    }
  }
  
  // Emit from all line sources (highways)
  for (const emitter of processedLineEmitters) {
    const lineEvents = emitFromLine(emitter, rateMultiplier, settings);
    if (lineEvents.length > 0) {
      events.push(...lineEvents);
    }
  }
  
  return events;
}

/**
 * Emit particles from a point source.
 * 
 * @param {Object} emitter - Processed point emitter
 * @param {number} rateMultiplier - dt * emissionRate
 * @param {Object} settings - Global settings
 * @returns {Array} Emission events
 */
function emitFromPoint(emitter, rateMultiplier, settings) {
  const events = [];
  const profile = emitter.profileData;
  
  // Skip if no emissions defined (e.g., memorial sites)
  if (!profile.emissions) return events;
  
  // Skip if scale is 0
  if (emitter.scale === 0) return events;
  
  // Process each pollutant type
  for (const [pollutantId, baseRate] of Object.entries(profile.emissions)) {
    // Skip disabled pollutants
    if (!isPollutantEnabled(pollutantId, settings)) continue;
    
    // Skip if base rate is 0
    if (baseRate === 0) continue;
    
    // Calculate particles to emit this step
    const scaledRate = baseRate * emitter.scale * rateMultiplier;
    const count = stochasticCount(scaledRate);
    
    // Generate particles with position spread
    const spread = profile.spread || 1;
    for (let i = 0; i < count; i++) {
      events.push({
        type: pollutantId,
        emitterId: emitter.id,
        x: emitter.worldPosition.x + (Math.random() - 0.5) * spread,
        y: emitter.worldPosition.y + Math.random() * 0.5,
        z: emitter.worldPosition.z + (Math.random() - 0.5) * spread
      });
    }
  }
  
  return events;
}

/**
 * Emit particles from a line source (highway).
 * Particles are distributed randomly along the route.
 * 
 * @param {Object} emitter - Processed line emitter
 * @param {number} rateMultiplier - dt * emissionRate
 * @param {Object} settings - Global settings
 * @returns {Array} Emission events
 */
function emitFromLine(emitter, rateMultiplier, settings) {
  const events = [];
  const profile = emitter.profileData;
  
  // Skip if no per-km emissions defined
  if (!profile.emissionsPerKm) return events;
  
  // Skip if scale is 0 or route has no length
  if (emitter.scale === 0 || emitter.length === 0) return events;
  
  // Process each pollutant type
  for (const [pollutantId, baseRatePerKm] of Object.entries(profile.emissionsPerKm)) {
    // Skip disabled pollutants
    if (!isPollutantEnabled(pollutantId, settings)) continue;
    
    // Skip if base rate is 0
    if (baseRatePerKm === 0) continue;
    
    // Scale by route length and emitter scale
    const scaledRate = baseRatePerKm * emitter.length * emitter.scale * rateMultiplier;
    const count = stochasticCount(scaledRate);
    
    // Generate particles at random positions along the route
    const spread = profile.spread || 0.5;
    const height = profile.height || 0.5;
    
    for (let i = 0; i < count; i++) {
      // Get random point along the highway
      const point = getRandomPointOnRoute(emitter.waypoints);
      
      // Get terrain height at this point
      const terrainHeight = mapData.getTerrainHeight(point.x, point.z);
      
      events.push({
        type: pollutantId,
        emitterId: emitter.id,
        x: point.x + (Math.random() - 0.5) * spread,
        y: terrainHeight + height + Math.random() * 0.3,
        z: point.z + (Math.random() - 0.5) * spread
      });
    }
  }
  
  return events;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if a pollutant type is enabled in settings.
 * 
 * @param {string} pollutantId - 'PM25', 'VOC', or 'OZONE'
 * @param {Object} settings - Global settings
 * @returns {boolean}
 */
function isPollutantEnabled(pollutantId, settings) {
  switch (pollutantId) {
    case 'PM25': return settings.enablePM25 !== false;
    case 'VOC': return settings.enableVOC !== false;
    case 'OZONE': return settings.enableOzone !== false;
    default: return true;
  }
}

/**
 * Convert a fractional emission rate to an integer count.
 * Uses stochastic rounding to handle fractional particles.
 * 
 * Example: rate 2.7 → returns 2 (70% of time) or 3 (30% of time)
 * 
 * @param {number} rate - Expected particles (can be fractional)
 * @returns {number} Integer count
 */
function stochasticCount(rate) {
  const whole = Math.floor(rate);
  const frac = rate - whole;
  return whole + (Math.random() < frac ? 1 : 0);
}

// ============================================
// PUBLIC API - GETTERS
// ============================================

/**
 * Get all processed point emitters.
 * @returns {Array}
 */
export function getEmitters() {
  return processedPointEmitters;
}

/**
 * Get all processed line emitters (highways).
 * @returns {Array}
 */
export function getLineEmitters() {
  return processedLineEmitters;
}

/**
 * Get a specific point emitter by ID.
 * @param {string} id 
 * @returns {Object|undefined}
 */
export function getEmitterById(id) {
  return processedPointEmitters.find(e => e.id === id);
}

/**
 * Get a specific line emitter by ID.
 * @param {string} id 
 * @returns {Object|undefined}
 */
export function getLineEmitterById(id) {
  return processedLineEmitters.find(e => e.id === id);
}

/**
 * Get pollutant configuration by ID.
 * @param {string} pollutantId - 'PM25', 'VOC', or 'OZONE'
 * @returns {Object|undefined}
 */
export function getPollutantConfig(pollutantId) {
  return POLLUTANT_TYPES[pollutantId];
}

/**
 * Get all pollutant types.
 * @returns {Object}
 */
export function getAllPollutantTypes() {
  return POLLUTANT_TYPES;
}

// ============================================
// PUBLIC API - SETTERS (for runtime control)
// ============================================

/**
 * Set the emission scale for a specific point emitter.
 * @param {string} id - Emitter ID
 * @param {number} scale - New scale value (0 = disabled)
 */
export function setEmitterScale(id, scale) {
  const emitter = getEmitterById(id);
  if (emitter) {
    emitter.scale = Math.max(0, scale);
  }
}

/**
 * Set the emission scale for a specific line emitter.
 * @param {string} id - Line emitter ID
 * @param {number} scale - New scale value (0 = disabled)
 */
export function setLineEmitterScale(id, scale) {
  const emitter = getLineEmitterById(id);
  if (emitter) {
    emitter.scale = Math.max(0, scale);
  }
}

/**
 * Get emitters grouped by type.
 * @returns {Object} Map of type -> array of emitters
 */
export function getEmittersByType() {
  const grouped = {};
  
  for (const emitter of processedPointEmitters) {
    const type = emitter.profileData.type || 'unknown';
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type].push(emitter);
  }
  
  return grouped;
}

/**
 * Get summary statistics about active emitters.
 * @returns {Object}
 */
export function getEmitterStats() {
  const activePoint = processedPointEmitters.filter(e => e.scale > 0).length;
  const activeLine = processedLineEmitters.filter(e => e.scale > 0).length;
  const totalHighwayKm = processedLineEmitters
    .filter(e => e.scale > 0)
    .reduce((sum, e) => sum + e.length, 0);
  
  return {
    totalPoint: processedPointEmitters.length,
    activePoint,
    totalLine: processedLineEmitters.length,
    activeLine,
    activeHighwayKm: Math.round(totalHighwayKm)
  };
}