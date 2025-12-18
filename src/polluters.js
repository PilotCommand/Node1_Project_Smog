/**
 * polluters.js — Emission sources ("who emits what, where")
 * 
 * Defines sources and generates emissions each timestep.
 * Owns: list of polluters/emitters, emission profiles
 */

// ============================================
// Pollutant Types
// ============================================

export const POLLUTANT_TYPES = {
  PM25: {
    id: 'PM25',
    name: 'PM2.5',
    color: 0xff6b35,       // Warm orange
    settlingRate: 0.15,    // How fast it falls
    disperseRate: 0.8,     // How much it spreads
    decayRate: 0.002,      // How fast it disappears
    size: 0.4
  },
  VOC: {
    id: 'VOC',
    name: 'VOCs',
    color: 0xa855f7,       // Purple
    settlingRate: 0.0,     // Doesn't settle (gas)
    disperseRate: 1.5,     // Disperses quickly
    decayRate: 0.005,      // Moderate decay
    size: 0.3
  },
  OZONE: {
    id: 'OZONE',
    name: 'O₃',
    color: 0x06b6d4,       // Cyan
    settlingRate: 0.0,     // Doesn't settle (gas)
    disperseRate: 1.2,     // Moderate dispersion
    decayRate: 0.008,      // Faster decay (reactive)
    size: 0.25
  }
};

// ============================================
// Emission Sources
// ============================================

const EMITTERS = [
  // Traffic corridors
  {
    id: 'highway101_sf',
    name: 'US-101 SF',
    type: 'traffic',
    position: { x: -12, z: -5 },
    height: 0.5,
    emissions: {
      PM25: 15,
      VOC: 10,
      OZONE: 0
    }
  },
  {
    id: 'highway880',
    name: 'I-880 Corridor',
    type: 'traffic',
    position: { x: 12, z: -10 },
    height: 0.5,
    emissions: {
      PM25: 20,
      VOC: 15,
      OZONE: 0
    }
  },
  {
    id: 'highway580',
    name: 'I-580',
    type: 'traffic',
    position: { x: 20, z: 5 },
    height: 0.5,
    emissions: {
      PM25: 12,
      VOC: 8,
      OZONE: 0
    }
  },
  
  // Industrial sources
  {
    id: 'richmond_refinery',
    name: 'Richmond Refinery',
    type: 'industrial',
    position: { x: -5, z: 25 },
    height: 3,
    plumeRise: 5,
    emissions: {
      PM25: 25,
      VOC: 40,
      OZONE: 5
    }
  },
  {
    id: 'oakland_port',
    name: 'Port of Oakland',
    type: 'industrial',
    position: { x: 10, z: 5 },
    height: 1,
    emissions: {
      PM25: 35,
      VOC: 20,
      OZONE: 0
    }
  },
  {
    id: 'martinez_refinery',
    name: 'Martinez Refinery',
    type: 'industrial',
    position: { x: 15, z: 30 },
    height: 3,
    plumeRise: 4,
    emissions: {
      PM25: 20,
      VOC: 35,
      OZONE: 5
    }
  },
  
  // Airport
  {
    id: 'sfo_airport',
    name: 'SFO Airport',
    type: 'airport',
    position: { x: -5, z: -10 },
    height: 0.5,
    emissions: {
      PM25: 30,
      VOC: 25,
      OZONE: 2
    }
  },
  {
    id: 'oak_airport',
    name: 'Oakland Airport',
    type: 'airport',
    position: { x: 12, z: -2 },
    height: 0.5,
    emissions: {
      PM25: 18,
      VOC: 15,
      OZONE: 1
    }
  },
  
  // Urban areas (diffuse emissions)
  {
    id: 'sf_urban',
    name: 'San Francisco Urban',
    type: 'urban',
    position: { x: -15, z: 5 },
    height: 0.5,
    spread: 5,
    emissions: {
      PM25: 10,
      VOC: 8,
      OZONE: 0
    }
  },
  {
    id: 'oakland_urban',
    name: 'Oakland Urban',
    type: 'urban',
    position: { x: 8, z: 8 },
    height: 0.5,
    spread: 4,
    emissions: {
      PM25: 12,
      VOC: 10,
      OZONE: 0
    }
  },
  {
    id: 'sanjose_urban',
    name: 'San Jose Urban',
    type: 'urban',
    position: { x: 15, z: -35 },
    height: 0.5,
    spread: 6,
    emissions: {
      PM25: 15,
      VOC: 12,
      OZONE: 0
    }
  }
];

// Store reference
let emitters = [];
let mapData = null;

// ============================================
// Initialization
// ============================================

export function initPolluters(map) {
  console.log('🏭 Initializing polluters...');
  
  mapData = map;
  
  // Process emitters and add terrain heights
  emitters = EMITTERS.map(emitter => {
    const terrainHeight = map.getTerrainHeight(emitter.position.x, emitter.position.z);
    return {
      ...emitter,
      worldPosition: {
        x: emitter.position.x,
        y: terrainHeight + emitter.height + (emitter.plumeRise || 0),
        z: emitter.position.z
      }
    };
  });
  
  console.log(`  → ${emitters.length} emission sources configured`);
  
  return emitters;
}

// ============================================
// Emission Generation
// ============================================

export function emit(dt, settings) {
  const events = [];
  
  if (!emitters.length) return events;
  
  const rateMultiplier = settings.emissionRate * dt;
  
  emitters.forEach(emitter => {
    // Check each pollutant type
    Object.entries(emitter.emissions).forEach(([pollutantId, baseRate]) => {
      // Skip if this pollutant type is disabled
      if (pollutantId === 'PM25' && !settings.enablePM25) return;
      if (pollutantId === 'VOC' && !settings.enableVOC) return;
      if (pollutantId === 'OZONE' && !settings.enableOzone) return;
      
      // Calculate number of particles to emit
      const particlesToEmit = baseRate * rateMultiplier;
      
      // Stochastic emission (handle fractional particles)
      const wholeParticles = Math.floor(particlesToEmit);
      const fractionalChance = particlesToEmit - wholeParticles;
      
      let count = wholeParticles;
      if (Math.random() < fractionalChance) {
        count++;
      }
      
      // Generate emission events
      for (let i = 0; i < count; i++) {
        // Add some randomness to position (spread)
        const spread = emitter.spread || 1;
        const offsetX = (Math.random() - 0.5) * spread;
        const offsetZ = (Math.random() - 0.5) * spread;
        const offsetY = Math.random() * 0.5; // Slight vertical variation
        
        events.push({
          type: pollutantId,
          emitterId: emitter.id,
          x: emitter.worldPosition.x + offsetX,
          y: emitter.worldPosition.y + offsetY,
          z: emitter.worldPosition.z + offsetZ,
          amount: 1
        });
      }
    });
  });
  
  return events;
}

// ============================================
// Utility Functions
// ============================================

export function getEmitters() {
  return emitters;
}

export function getEmitterById(id) {
  return emitters.find(e => e.id === id);
}

export function setEmitterRate(id, pollutantId, rate) {
  const emitter = getEmitterById(id);
  if (emitter && emitter.emissions[pollutantId] !== undefined) {
    emitter.emissions[pollutantId] = rate;
  }
}

export function getPollutantConfig(pollutantId) {
  return POLLUTANT_TYPES[pollutantId];
}