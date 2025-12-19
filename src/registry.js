/**
 * registry.js — Central data registry for Bay Area network
 * 
 * Defines all point emitters (cities, airports, refineries, etc.)
 * and line emitters (highways) with their coordinates and profiles.
 * 
 * This is the "database" - other modules import from here.
 * 
 * Coordinate System:
 *   - Geographic: WGS84 (lon/lat in degrees)
 *   - World: X = East/West (-75.5 to 75.5), Z = North/South (+67 south to -67 north)
 *   - Y = elevation (terrain height + structure height)
 */

// ============================================
// COORDINATE SYSTEM CONSTANTS
// ============================================

// Geographic bounds (WGS84) - must match map.js
const GEO_BOUNDS = {
  lonMin: -123.135223,  // West edge
  lonMax: -121.415863,  // East edge
  latMin: 37.182476,    // South edge
  latMax: 38.387867     // North edge
};

const MAP_BOUNDS = {
  width: 151,   // km East-West
  depth: 134    // km North-South
};

// ============================================
// COORDINATE CONVERSION FUNCTIONS
// ============================================

/**
 * Convert geographic coordinates (lon/lat) to world coordinates (x/z)
 * @param {number} lon - Longitude in degrees (negative = West)
 * @param {number} lat - Latitude in degrees
 * @returns {{x: number, z: number}} World coordinates
 */
export function geoToWorld(lon, lat) {
  const x = ((lon - GEO_BOUNDS.lonMin) / (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin) - 0.5) * MAP_BOUNDS.width;
  const z = (0.5 - (lat - GEO_BOUNDS.latMin) / (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin)) * MAP_BOUNDS.depth;
  return { x, z };
}

/**
 * Convert world coordinates to geographic coordinates
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {{lon: number, lat: number}} Geographic coordinates
 */
export function worldToGeo(x, z) {
  const lon = GEO_BOUNDS.lonMin + ((x / MAP_BOUNDS.width) + 0.5) * (GEO_BOUNDS.lonMax - GEO_BOUNDS.lonMin);
  const lat = GEO_BOUNDS.latMin + (0.5 - (z / MAP_BOUNDS.depth)) * (GEO_BOUNDS.latMax - GEO_BOUNDS.latMin);
  return { lon, lat };
}

/**
 * Check if geographic coordinates are within map bounds
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @returns {boolean}
 */
export function isInBounds(lon, lat) {
  return lon >= GEO_BOUNDS.lonMin && lon <= GEO_BOUNDS.lonMax &&
         lat >= GEO_BOUNDS.latMin && lat <= GEO_BOUNDS.latMax;
}

/**
 * Get the geographic and map bounds
 */
export function getBounds() {
  return { geo: { ...GEO_BOUNDS }, map: { ...MAP_BOUNDS } };
}

// ============================================
// EMITTER PROFILE DEFINITIONS
// ============================================

/**
 * Base emission profiles by emitter type.
 * Individual emitters reference these by name and apply a scale multiplier.
 * 
 * emissions: particles per second at scale=1.0
 * emissionsPerKm: for line sources, particles per km per second
 */
export const EMITTER_PROFILES = {

  // ─────────────────────────────────────────
  // URBAN AREAS (diffuse area sources)
  // ─────────────────────────────────────────
  CITY_LARGE: {
    type: 'urban',
    height: 0.5,
    spread: 6,
    emissions: { PM25: 12, VOC: 10, OZONE: 0 },
    color: 0x4a90d9,
    description: 'Major metropolitan center'
  },
  CITY_MEDIUM: {
    type: 'urban',
    height: 0.5,
    spread: 4,
    emissions: { PM25: 8, VOC: 6, OZONE: 0 },
    color: 0x5a9ad9,
    description: 'Mid-size city'
  },
  CITY_SMALL: {
    type: 'urban',
    height: 0.5,
    spread: 2.5,
    emissions: { PM25: 5, VOC: 4, OZONE: 0 },
    color: 0x6aa4d9,
    description: 'Small city'
  },
  TOWN: {
    type: 'urban',
    height: 0.5,
    spread: 1.5,
    emissions: { PM25: 2, VOC: 1.5, OZONE: 0 },
    color: 0x7aaed9,
    description: 'Town or small community'
  },

  // ─────────────────────────────────────────
  // TRANSPORTATION NODES (point sources)
  // ─────────────────────────────────────────
  BRIDGE: {
    type: 'bridge',
    height: 1.0,
    spread: 1.5,
    emissions: { PM25: 12, VOC: 8, OZONE: 0 },
    color: 0xd4a574,
    description: 'Major bridge crossing'
  },
  INTERCHANGE: {
    type: 'interchange',
    height: 0.5,
    spread: 2.5,
    emissions: { PM25: 15, VOC: 10, OZONE: 0 },
    color: 0xc49464,
    description: 'Highway interchange/junction'
  },

  // ─────────────────────────────────────────
  // AIRPORTS
  // ─────────────────────────────────────────
  AIRPORT_INTERNATIONAL: {
    type: 'airport',
    height: 0.5,
    spread: 4,
    emissions: { PM25: 25, VOC: 22, OZONE: 2 },
    color: 0xe74c3c,
    description: 'International airport'
  },
  AIRPORT_REGIONAL: {
    type: 'airport',
    height: 0.5,
    spread: 2.5,
    emissions: { PM25: 15, VOC: 12, OZONE: 1 },
    color: 0xc0392b,
    description: 'Regional airport'
  },

  // ─────────────────────────────────────────
  // MILITARY
  // ─────────────────────────────────────────
  MILITARY_AIRBASE: {
    type: 'military',
    height: 0.5,
    spread: 5,
    emissions: { PM25: 20, VOC: 18, OZONE: 2 },
    color: 0x2c3e50,
    description: 'Military air base'
  },

  // ─────────────────────────────────────────
  // PORTS & HARBORS
  // ─────────────────────────────────────────
  PORT_MAJOR: {
    type: 'port',
    height: 2,
    spread: 5,
    emissions: { PM25: 30, VOC: 20, OZONE: 0 },
    color: 0x3498db,
    description: 'Major shipping port'
  },
  PORT_MINOR: {
    type: 'port',
    height: 1,
    spread: 2,
    emissions: { PM25: 10, VOC: 6, OZONE: 0 },
    color: 0x5dade2,
    description: 'Minor port or harbor'
  },
  MEMORIAL: {
    type: 'memorial',
    height: 0.5,
    spread: 1,
    emissions: { PM25: 0, VOC: 0, OZONE: 0 },
    color: 0x7f8c8d,
    description: 'Memorial site (no emissions)'
  },

  // ─────────────────────────────────────────
  // REFINERIES (tall stacks with plume rise)
  // ─────────────────────────────────────────
  REFINERY_LARGE: {
    type: 'refinery',
    height: 5,
    plumeRise: 8,
    spread: 3,
    emissions: { PM25: 25, VOC: 45, OZONE: 6 },
    color: 0xe67e22,
    description: 'Large petroleum refinery'
  },
  REFINERY_MEDIUM: {
    type: 'refinery',
    height: 4,
    plumeRise: 5,
    spread: 2,
    emissions: { PM25: 18, VOC: 32, OZONE: 4 },
    color: 0xd35400,
    description: 'Medium petroleum refinery'
  },

  // ─────────────────────────────────────────
  // HIGHWAYS (line sources - visual only, no emissions)
  // ─────────────────────────────────────────
  HIGHWAY_MAJOR: {
    type: 'highway',
    height: 0.5,
    spread: 0.6,
    emissionsPerKm: { PM25: 0, VOC: 0, OZONE: 0 },
    ribbonColor: 0x5566aa,
    ribbonWidth: 0.8,
    ribbonOpacity: 0.7,
    description: 'Major interstate highway'
  },
  HIGHWAY_MINOR: {
    type: 'highway',
    height: 0.5,
    spread: 0.4,
    emissionsPerKm: { PM25: 0, VOC: 0, OZONE: 0 },
    ribbonColor: 0x445588,
    ribbonWidth: 0.5,
    ribbonOpacity: 0.6,
    description: 'Minor highway or state route'
  }
};

// ============================================
// POINT EMITTERS (Network Nodes)
// ============================================

/**
 * All point-source emitters in the Bay Area network.
 * 
 * Each entry:
 *   id: unique identifier
 *   name: display name
 *   profile: key into EMITTER_PROFILES
 *   scale: multiplier for base emissions (1.0 = normal)
 *   coords: { lon, lat } in WGS84
 */
export const POINT_EMITTERS = [

  // ═══════════════════════════════════════════
  // CITIES - Large (population > 200k)
  // ═══════════════════════════════════════════
  {
    id: 'san_francisco',
    name: 'San Francisco',
    profile: 'CITY_LARGE',
    scale: 1.2,
    coords: { lon: -122.4194, lat: 37.7749 }
  },
  {
    id: 'san_jose',
    name: 'San Jose',
    profile: 'CITY_LARGE',
    scale: 1.0,
    coords: { lon: -121.8863, lat: 37.3382 }
  },
  {
    id: 'oakland',
    name: 'Oakland',
    profile: 'CITY_LARGE',
    scale: 0.9,
    coords: { lon: -122.2712, lat: 37.8044 }
  },

  // ═══════════════════════════════════════════
  // CITIES - Medium (population 50k-200k)
  // ═══════════════════════════════════════════
  {
    id: 'berkeley',
    name: 'Berkeley',
    profile: 'CITY_MEDIUM',
    scale: 0.8,
    coords: { lon: -122.2727, lat: 37.8716 }
  },
  {
    id: 'fremont',
    name: 'Fremont',
    profile: 'CITY_MEDIUM',
    scale: 0.9,
    coords: { lon: -121.9886, lat: 37.5485 }
  },
  {
    id: 'concord',
    name: 'Concord',
    profile: 'CITY_MEDIUM',
    scale: 0.8,
    coords: { lon: -122.0311, lat: 37.9780 }
  },
  {
    id: 'richmond',
    name: 'Richmond',
    profile: 'CITY_MEDIUM',
    scale: 0.7,
    coords: { lon: -122.3477, lat: 37.9358 }
  },
  {
    id: 'sunnyvale',
    name: 'Sunnyvale',
    profile: 'CITY_MEDIUM',
    scale: 0.9,
    coords: { lon: -122.0363, lat: 37.3688 }
  },
  {
    id: 'san_mateo',
    name: 'San Mateo',
    profile: 'CITY_MEDIUM',
    scale: 0.7,
    coords: { lon: -122.3255, lat: 37.5630 }
  },
  {
    id: 'vallejo',
    name: 'Vallejo',
    profile: 'CITY_MEDIUM',
    scale: 0.6,
    coords: { lon: -122.2566, lat: 38.1041 }
  },

  // ═══════════════════════════════════════════
  // CITIES - Small (population 20k-50k)
  // ═══════════════════════════════════════════
  {
    id: 'palo_alto',
    name: 'Palo Alto',
    profile: 'CITY_SMALL',
    scale: 1.0,
    coords: { lon: -122.1430, lat: 37.4419 }
  },
  {
    id: 'antioch',
    name: 'Antioch',
    profile: 'CITY_SMALL',
    scale: 0.8,
    coords: { lon: -121.8058, lat: 38.0049 }
  },
  {
    id: 'livermore',
    name: 'Livermore',
    profile: 'CITY_SMALL',
    scale: 0.7,
    coords: { lon: -121.7681, lat: 37.6819 }
  },
  {
    id: 'san_rafael',
    name: 'San Rafael',
    profile: 'CITY_SMALL',
    scale: 0.8,
    coords: { lon: -122.5311, lat: 37.9735 }
  },
  {
    id: 'fairfield',
    name: 'Fairfield',
    profile: 'CITY_SMALL',
    scale: 0.6,
    coords: { lon: -122.0400, lat: 38.2494 }
  },
  {
    id: 'petaluma',
    name: 'Petaluma',
    profile: 'CITY_SMALL',
    scale: 0.5,
    coords: { lon: -122.6367, lat: 38.2324 }
  },
  {
    id: 'walnut_creek',
    name: 'Walnut Creek',
    profile: 'CITY_SMALL',
    scale: 0.9,
    coords: { lon: -122.0652, lat: 37.9101 }
  },

  // ═══════════════════════════════════════════
  // TOWNS (population < 20k or unincorporated)
  // ═══════════════════════════════════════════
  {
    id: 'alameda',
    name: 'Alameda',
    profile: 'TOWN',
    scale: 1.0,
    coords: { lon: -122.2416, lat: 37.7652 }
  },
  {
    id: 'sausalito',
    name: 'Sausalito',
    profile: 'TOWN',
    scale: 0.6,
    coords: { lon: -122.4853, lat: 37.8591 }
  },
  {
    id: 'tiburon',
    name: 'Tiburon',
    profile: 'TOWN',
    scale: 0.4,
    coords: { lon: -122.4567, lat: 37.8735 }
  },
  {
    id: 'los_gatos',
    name: 'Los Gatos',
    profile: 'TOWN',
    scale: 0.7,
    coords: { lon: -121.9746, lat: 37.2266 }
  },
  {
    id: 'marin',
    name: 'Marin County',
    profile: 'TOWN',
    scale: 0.3,
    coords: { lon: -122.7500, lat: 38.0500 }
  },

  // ═══════════════════════════════════════════
  // BRIDGES
  // ═══════════════════════════════════════════
  {
    id: 'bay_bridge',
    name: 'Bay Bridge (I-80)',
    profile: 'BRIDGE',
    scale: 1.2,
    coords: { lon: -122.3778, lat: 37.7983 }
  },
  {
    id: 'golden_gate',
    name: 'Golden Gate Bridge',
    profile: 'BRIDGE',
    scale: 1.0,
    coords: { lon: -122.4783, lat: 37.8199 },
    rotation: -60  // degrees counterclockwise (one hex angle left)
  },
  {
    id: 'richmond_bridge',
    name: 'Richmond-San Rafael Bridge (I-580)',
    profile: 'BRIDGE',
    scale: 0.8,
    coords: { lon: -122.4472, lat: 37.9361 }
  },
  {
    id: 'san_mateo_bridge',
    name: 'San Mateo-Hayward Bridge (CA-92)',
    profile: 'BRIDGE',
    scale: 0.9,
    coords: { lon: -122.2000, lat: 37.5877 }
  },
  {
    id: 'dumbarton_bridge',
    name: 'Dumbarton Bridge (CA-84)',
    profile: 'BRIDGE',
    scale: 0.7,
    coords: { lon: -122.0600, lat: 37.4900 }
  },
  {
    id: 'carquinez_bridge',
    name: 'Carquinez Bridge (I-80)',
    profile: 'BRIDGE',
    scale: 0.9,
    coords: { lon: -122.2261, lat: 38.0614 },
    rotation: -60  // degrees clockwise (one hex angle right)
  },

  // ═══════════════════════════════════════════
  // INTERCHANGES
  // ═══════════════════════════════════════════
  {
    id: 'interchange_580_680',
    name: 'I-580/I-680 Interchange',
    profile: 'INTERCHANGE',
    scale: 1.0,
    coords: { lon: -121.9350, lat: 37.7010 }
  },

  // ═══════════════════════════════════════════
  // AIRPORTS
  // ═══════════════════════════════════════════
  {
    id: 'sfo',
    name: 'San Francisco International Airport',
    profile: 'AIRPORT_INTERNATIONAL',
    scale: 1.0,
    coords: { lon: -122.3790, lat: 37.6213 }
  },
  {
    id: 'oak',
    name: 'Oakland International Airport',
    profile: 'AIRPORT_REGIONAL',
    scale: 1.0,
    coords: { lon: -122.2208, lat: 37.7213 }
  },
  {
    id: 'sjc',
    name: 'San Jose International Airport',
    profile: 'AIRPORT_REGIONAL',
    scale: 0.9,
    coords: { lon: -121.9289, lat: 37.3639 }
  },

  // ═══════════════════════════════════════════
  // MILITARY
  // ═══════════════════════════════════════════
  {
    id: 'travis_afb',
    name: 'Travis Air Force Base',
    profile: 'MILITARY_AIRBASE',
    scale: 1.0,
    coords: { lon: -121.9275, lat: 38.2627 }
  },

  // ═══════════════════════════════════════════
  // PORTS & HARBORS
  // ═══════════════════════════════════════════
  {
    id: 'port_oakland',
    name: 'Port of Oakland',
    profile: 'PORT_MAJOR',
    scale: 1.0,
    coords: { lon: -122.2789, lat: 37.7956 }
  },
  {
    id: 'sf_harbor',
    name: 'San Francisco Harbor',
    profile: 'PORT_MINOR',
    scale: 0.5,
    coords: { lon: -122.4100, lat: 37.8050 }
  },
  {
    id: 'port_chicago',
    name: 'Port Chicago Naval Magazine Memorial',
    profile: 'MEMORIAL',
    scale: 0,
    coords: { lon: -122.0289, lat: 38.0558 }
  },

  // ═══════════════════════════════════════════
  // REFINERIES
  // ═══════════════════════════════════════════
  {
    id: 'chevron_richmond',
    name: 'Chevron Richmond Refinery',
    profile: 'REFINERY_LARGE',
    scale: 1.0,
    coords: { lon: -122.3969, lat: 37.9314 }
  },
  {
    id: 'phillips66_rodeo',
    name: 'Phillips 66 San Francisco Refinery',
    profile: 'REFINERY_MEDIUM',
    scale: 0.9,
    coords: { lon: -122.2594, lat: 38.0344 }
  },
  {
    id: 'valero_benicia',
    name: 'Valero Benicia Refinery',
    profile: 'REFINERY_MEDIUM',
    scale: 0.85,
    coords: { lon: -122.1392, lat: 38.0569 }
  },
  {
    id: 'martinez_refinery',
    name: 'Martinez Refining Company',
    profile: 'REFINERY_MEDIUM',
    scale: 0.8,
    coords: { lon: -122.1142, lat: 38.0189 }
  }
];

// ============================================
// LINE EMITTERS (Network Edges / Highways)
// ============================================

/**
 * All line-source emitters (highways) in the Bay Area network.
 * Highways are visual only (no emissions) - landmarks handle emissions.
 * 
 * Each entry:
 *   id: unique identifier
 *   name: display name
 *   profile: key into EMITTER_PROFILES
 *   scale: multiplier (not used for emissions, kept for consistency)
 *   waypoints: array of { lon, lat, label } defining the route
 */
export const LINE_EMITTERS = [
  // ─────────────────────────────────────────
  // INTERSTATE 80 (SF → Fairfield via Bay Bridge)
  // ─────────────────────────────────────────
  {
    id: 'i80',
    name: 'Interstate 80',
    profile: 'HIGHWAY_MAJOR',
    scale: 1.0,
    waypoints: [
      { lon: -122.3937, lat: 37.7955, label: 'SF Embarcadero' },
      { lon: -122.3778, lat: 37.7983, label: 'Bay Bridge West' },
      { lon: -122.3180, lat: 37.8163, label: 'Bay Bridge East' },
      { lon: -122.2930, lat: 37.8388, label: 'Emeryville' },
      { lon: -122.2988, lat: 37.8665, label: 'Berkeley' },
      { lon: -122.3570, lat: 37.9260, label: 'Richmond' },
      { lon: -122.2990, lat: 37.9920, label: 'Pinole' },
      { lon: -122.2510, lat: 38.0170, label: 'Hercules' },
      { lon: -122.2170, lat: 38.0520, label: 'Crockett' },
      { lon: -122.2566, lat: 38.1041, label: 'Vallejo' },
      { lon: -122.0400, lat: 38.2494, label: 'Fairfield' }
    ]
  },

  // ─────────────────────────────────────────
  // INTERSTATE 880 (Oakland → San Jose)
  // ─────────────────────────────────────────
  {
    id: 'i880',
    name: 'Interstate 880',
    profile: 'HIGHWAY_MAJOR',
    scale: 1.0,
    waypoints: [
      { lon: -122.2712, lat: 37.8044, label: 'Oakland' },
      { lon: -122.1561, lat: 37.7249, label: 'San Leandro' },
      { lon: -122.0808, lat: 37.6688, label: 'Hayward' },
      { lon: -121.9886, lat: 37.5485, label: 'Fremont' },
      { lon: -121.8996, lat: 37.4323, label: 'Milpitas' },
      { lon: -121.8863, lat: 37.3382, label: 'San Jose' }
    ]
  },

  // ─────────────────────────────────────────
  // INTERSTATE 680 (San Jose → Concord)
  // ─────────────────────────────────────────
  {
    id: 'i680',
    name: 'Interstate 680',
    profile: 'HIGHWAY_MAJOR',
    scale: 0.9,
    waypoints: [
      { lon: -121.8500, lat: 37.3500, label: 'San Jose South' },
      { lon: -121.9060, lat: 37.4280, label: 'Milpitas' },
      { lon: -121.9600, lat: 37.5200, label: 'Fremont' },
      { lon: -121.8747, lat: 37.6624, label: 'Pleasanton' },
      { lon: -121.9358, lat: 37.7022, label: 'Dublin' },
      { lon: -121.9780, lat: 37.7799, label: 'San Ramon' },
      { lon: -122.0000, lat: 37.8216, label: 'Danville' },
      { lon: -122.0652, lat: 37.9101, label: 'Walnut Creek' },
      { lon: -122.0311, lat: 37.9780, label: 'Concord' }
    ]
  },

  // ─────────────────────────────────────────
  // INTERSTATE 580 (Oakland → Livermore)
  // ─────────────────────────────────────────
  {
    id: 'i580',
    name: 'Interstate 580',
    profile: 'HIGHWAY_MAJOR',
    scale: 0.85,
    waypoints: [
      { lon: -122.2500, lat: 37.8100, label: 'Oakland' },
      { lon: -122.0864, lat: 37.6940, label: 'Castro Valley' },
      { lon: -121.9358, lat: 37.7022, label: 'Dublin' },
      { lon: -121.8747, lat: 37.6624, label: 'Pleasanton' },
      { lon: -121.7681, lat: 37.6819, label: 'Livermore' }
    ]
  },

  // ─────────────────────────────────────────
  // INTERSTATE 580 WEST (Richmond-San Rafael Bridge)
  // ─────────────────────────────────────────
  {
    id: 'i580_bridge',
    name: 'I-580 (Richmond-San Rafael Bridge)',
    profile: 'HIGHWAY_MAJOR',
    scale: 0.8,
    waypoints: [
      { lon: -122.3570, lat: 37.9260, label: 'Richmond' },
      { lon: -122.4200, lat: 37.9350, label: 'Richmond Bridge West' },
      { lon: -122.4800, lat: 37.9450, label: 'San Quentin' },
      { lon: -122.5097, lat: 37.9735, label: 'San Rafael' }
    ]
  },

  // ─────────────────────────────────────────
  // US ROUTE 101 SOUTH (SF → San Jose)
  // ─────────────────────────────────────────
  {
    id: 'us101_south',
    name: 'US-101 South',
    profile: 'HIGHWAY_MAJOR',
    scale: 1.1,
    waypoints: [
      { lon: -122.4030, lat: 37.7870, label: 'SF Downtown' },
      { lon: -122.4020, lat: 37.7100, label: 'SF South' },
      { lon: -122.3790, lat: 37.6213, label: 'SFO' },
      { lon: -122.3255, lat: 37.5630, label: 'San Mateo' },
      { lon: -122.2364, lat: 37.4852, label: 'Redwood City' },
      { lon: -122.1430, lat: 37.4419, label: 'Palo Alto' },
      { lon: -122.0839, lat: 37.3861, label: 'Mountain View' },
      { lon: -122.0363, lat: 37.3688, label: 'Sunnyvale' },
      { lon: -121.8863, lat: 37.3382, label: 'San Jose' }
    ]
  },

  // ─────────────────────────────────────────
  // US ROUTE 101 NORTH (SF → Novato via Golden Gate)
  // ─────────────────────────────────────────
  {
    id: 'us101_north',
    name: 'US-101 North',
    profile: 'HIGHWAY_MAJOR',
    scale: 1.0,
    waypoints: [
      { lon: -122.4030, lat: 37.7870, label: 'SF Downtown' },
      { lon: -122.4383, lat: 37.8025, label: 'Marina' },
      { lon: -122.4750, lat: 37.8080, label: 'Presidio' },
      { lon: -122.4785, lat: 37.8199, label: 'Golden Gate Bridge South' },
      { lon: -122.4785, lat: 37.8324, label: 'Golden Gate Bridge North' },
      { lon: -122.4811, lat: 37.8500, label: 'Sausalito' },
      { lon: -122.4932, lat: 37.8882, label: 'Mill Valley' },
      { lon: -122.5180, lat: 37.9340, label: 'Corte Madera' },
      { lon: -122.5097, lat: 37.9735, label: 'San Rafael' },
      { lon: -122.5350, lat: 38.0180, label: 'Terra Linda' },
      { lon: -122.5697, lat: 38.1074, label: 'Novato' }
    ]
  },

  // ─────────────────────────────────────────
  // INTERSTATE 280 (SF → San Jose via Peninsula)
  // ─────────────────────────────────────────
  {
    id: 'i280',
    name: 'Interstate 280',
    profile: 'HIGHWAY_MINOR',
    scale: 0.7,
    waypoints: [
      { lon: -122.4520, lat: 37.7270, label: 'SF' },
      { lon: -122.4702, lat: 37.6879, label: 'Daly City' },
      { lon: -122.4350, lat: 37.6305, label: 'San Bruno' },
      { lon: -122.3800, lat: 37.5600, label: 'Hillsborough' },
      { lon: -122.2900, lat: 37.4800, label: 'Woodside' },
      { lon: -122.1800, lat: 37.4000, label: 'Los Altos Hills' },
      { lon: -122.0322, lat: 37.3230, label: 'Cupertino' },
      { lon: -121.9500, lat: 37.3200, label: 'San Jose' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 37 (Vallejo → Novato)
  // ─────────────────────────────────────────
  {
    id: 'ca37',
    name: 'Highway 37',
    profile: 'HIGHWAY_MINOR',
    scale: 0.5,
    waypoints: [
      { lon: -122.2566, lat: 38.1041, label: 'Vallejo' },
      { lon: -122.4500, lat: 38.1600, label: 'Sears Point' },
      { lon: -122.5697, lat: 38.1074, label: 'Novato' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 92 (San Mateo Bridge)
  // ─────────────────────────────────────────
  {
    id: 'ca92',
    name: 'Highway 92 (San Mateo Bridge)',
    profile: 'HIGHWAY_MINOR',
    scale: 0.6,
    waypoints: [
      { lon: -122.3255, lat: 37.5630, label: 'San Mateo' },
      { lon: -122.2800, lat: 37.5700, label: 'Foster City' },
      { lon: -122.2100, lat: 37.5800, label: 'Bridge West' },
      { lon: -122.1300, lat: 37.5900, label: 'Bridge East' },
      { lon: -122.0808, lat: 37.6688, label: 'Hayward' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 84 (Dumbarton Bridge)
  // ─────────────────────────────────────────
  {
    id: 'ca84',
    name: 'Highway 84 (Dumbarton Bridge)',
    profile: 'HIGHWAY_MINOR',
    scale: 0.6,
    waypoints: [
      { lon: -122.1430, lat: 37.4419, label: 'Palo Alto' },
      { lon: -122.1200, lat: 37.4700, label: 'Menlo Park' },
      { lon: -122.0700, lat: 37.4900, label: 'Bridge West' },
      { lon: -122.0200, lat: 37.5100, label: 'Bridge East' },
      { lon: -121.9886, lat: 37.5485, label: 'Fremont' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 1 (Pacific Coast Highway - Pacifica to SF)
  // ─────────────────────────────────────────
  {
    id: 'ca1_south',
    name: 'Highway 1 South',
    profile: 'HIGHWAY_MINOR',
    scale: 0.5,
    waypoints: [
      { lon: -122.4920, lat: 37.7749, label: 'SF (Great Highway)' },
      { lon: -122.5050, lat: 37.7200, label: 'Daly City Coast' },
      { lon: -122.4970, lat: 37.6500, label: 'Pacifica' },
      { lon: -122.4800, lat: 37.5700, label: 'Montara' },
      { lon: -122.4500, lat: 37.5050, label: 'Half Moon Bay' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 1 NORTH (SF through Marin)
  // ─────────────────────────────────────────
  {
    id: 'ca1_north',
    name: 'Highway 1 North',
    profile: 'HIGHWAY_MINOR',
    scale: 0.5,
    waypoints: [
      { lon: -122.4920, lat: 37.7749, label: 'SF (Great Highway)' },
      { lon: -122.4785, lat: 37.8324, label: 'Golden Gate Bridge North' },
      { lon: -122.5200, lat: 37.8600, label: 'Marin Headlands' },
      { lon: -122.5800, lat: 37.8900, label: 'Muir Beach' },
      { lon: -122.6200, lat: 37.9200, label: 'Stinson Beach' },
      { lon: -122.6800, lat: 37.9600, label: 'Bolinas' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 24 (Oakland → Walnut Creek through Caldecott Tunnel)
  // ─────────────────────────────────────────
  {
    id: 'ca24',
    name: 'Highway 24',
    profile: 'HIGHWAY_MINOR',
    scale: 0.6,
    waypoints: [
      { lon: -122.2500, lat: 37.8100, label: 'Oakland' },
      { lon: -122.2100, lat: 37.8400, label: 'Piedmont' },
      { lon: -122.1700, lat: 37.8600, label: 'Orinda' },
      { lon: -122.1200, lat: 37.8800, label: 'Lafayette' },
      { lon: -122.0652, lat: 37.9101, label: 'Walnut Creek' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 4 (Concord → Antioch)
  // ─────────────────────────────────────────
  {
    id: 'ca4',
    name: 'Highway 4',
    profile: 'HIGHWAY_MINOR',
    scale: 0.5,
    waypoints: [
      { lon: -122.0311, lat: 37.9780, label: 'Concord' },
      { lon: -121.9500, lat: 37.9800, label: 'Pittsburg' },
      { lon: -121.8000, lat: 38.0000, label: 'Antioch' },
      { lon: -121.6200, lat: 38.0100, label: 'Brentwood' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 17 (San Jose → Santa Cruz)
  // ─────────────────────────────────────────
  {
    id: 'ca17',
    name: 'Highway 17',
    profile: 'HIGHWAY_MINOR',
    scale: 0.5,
    waypoints: [
      { lon: -121.9500, lat: 37.3200, label: 'San Jose' },
      { lon: -121.9800, lat: 37.2600, label: 'Los Gatos' },
      { lon: -122.0200, lat: 37.2000, label: 'Summit' },
      { lon: -122.0300, lat: 37.1000, label: 'Scotts Valley' }
    ]
  },

  // ─────────────────────────────────────────
  // INTERSTATE 880 / HIGHWAY 17 CONNECTOR (Oakland to Hayward)
  // ─────────────────────────────────────────
  {
    id: 'ca238',
    name: 'Highway 238',
    profile: 'HIGHWAY_MINOR',
    scale: 0.4,
    waypoints: [
      { lon: -122.0864, lat: 37.6940, label: 'Castro Valley' },
      { lon: -122.0808, lat: 37.6688, label: 'Hayward' }
    ]
  },

  // ─────────────────────────────────────────
  // INTERSTATE 980 (Oakland Downtown Connector)
  // ─────────────────────────────────────────
  {
    id: 'i980',
    name: 'Interstate 980',
    profile: 'HIGHWAY_MINOR',
    scale: 0.4,
    waypoints: [
      { lon: -122.2712, lat: 37.8044, label: 'Oakland (I-880)' },
      { lon: -122.2750, lat: 37.8150, label: 'Downtown Oakland' },
      { lon: -122.2650, lat: 37.8250, label: 'Oakland (I-580)' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 87 (San Jose Downtown)
  // ─────────────────────────────────────────
  {
    id: 'ca87',
    name: 'Highway 87',
    profile: 'HIGHWAY_MINOR',
    scale: 0.4,
    waypoints: [
      { lon: -121.8863, lat: 37.3382, label: 'San Jose (US-101)' },
      { lon: -121.8900, lat: 37.3100, label: 'Downtown San Jose' },
      { lon: -121.8950, lat: 37.2800, label: 'San Jose South' }
    ]
  },

  // ─────────────────────────────────────────
  // HIGHWAY 85 (Cupertino to Mountain View loop)
  // ─────────────────────────────────────────
  {
    id: 'ca85',
    name: 'Highway 85',
    profile: 'HIGHWAY_MINOR',
    scale: 0.5,
    waypoints: [
      { lon: -122.0839, lat: 37.3861, label: 'Mountain View' },
      { lon: -122.0500, lat: 37.3500, label: 'Sunnyvale' },
      { lon: -122.0322, lat: 37.3230, label: 'Cupertino' },
      { lon: -122.0100, lat: 37.2900, label: 'Saratoga' },
      { lon: -121.9800, lat: 37.2600, label: 'Los Gatos' }
    ]
  }
];

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get a point emitter by ID
 * @param {string} id 
 * @returns {Object|undefined}
 */
export function getPointEmitter(id) {
  return POINT_EMITTERS.find(e => e.id === id);
}

/**
 * Get a line emitter by ID
 * @param {string} id 
 * @returns {Object|undefined}
 */
export function getLineEmitter(id) {
  return LINE_EMITTERS.find(e => e.id === id);
}

/**
 * Get an emitter profile by name
 * @param {string} profileName 
 * @returns {Object|undefined}
 */
export function getProfile(profileName) {
  return EMITTER_PROFILES[profileName];
}

/**
 * Get all point emitters of a specific type
 * @param {string} type - e.g., 'urban', 'refinery', 'airport'
 * @returns {Array}
 */
export function getEmittersByType(type) {
  return POINT_EMITTERS.filter(e => {
    const profile = EMITTER_PROFILES[e.profile];
    return profile && profile.type === type;
  });
}

/**
 * Get all point emitters using a specific profile
 * @param {string} profileName 
 * @returns {Array}
 */
export function getEmittersByProfile(profileName) {
  return POINT_EMITTERS.filter(e => e.profile === profileName);
}

// ============================================
// ROUTE CALCULATION FUNCTIONS
// ============================================

/**
 * Calculate the total length of a route in kilometers
 * Uses Haversine approximation for small distances
 * @param {Array} waypoints - Array of { lon, lat }
 * @returns {number} Length in km
 */
export function calculateRouteLength(waypoints) {
  let totalLength = 0;
  
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    
    // Simplified Haversine for small distances
    const dLon = (p2.lon - p1.lon) * Math.cos((p1.lat + p2.lat) / 2 * Math.PI / 180);
    const dLat = p2.lat - p1.lat;
    const dist = Math.sqrt(dLon * dLon + dLat * dLat) * 111; // ~111 km per degree
    
    totalLength += dist;
  }
  
  return totalLength;
}

/**
 * Get a random point along a route (for distributed line emissions)
 * @param {Array} waypoints - Array of { lon, lat }
 * @returns {{x: number, z: number}} World coordinates
 */
export function getRandomPointOnRoute(waypoints) {
  if (waypoints.length < 2) {
    const world = geoToWorld(waypoints[0].lon, waypoints[0].lat);
    return world;
  }
  
  // Calculate cumulative distances along route
  const distances = [0];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const dLon = (p2.lon - p1.lon) * Math.cos((p1.lat + p2.lat) / 2 * Math.PI / 180);
    const dLat = p2.lat - p1.lat;
    const dist = Math.sqrt(dLon * dLon + dLat * dLat);
    distances.push(distances[i] + dist);
  }
  
  const totalLength = distances[distances.length - 1];
  const targetDist = Math.random() * totalLength;
  
  // Find which segment contains this distance
  let segmentIndex = 0;
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] >= targetDist) {
      segmentIndex = i - 1;
      break;
    }
  }
  
  // Interpolate within the segment
  const segmentStart = distances[segmentIndex];
  const segmentEnd = distances[segmentIndex + 1];
  const t = segmentEnd > segmentStart 
    ? (targetDist - segmentStart) / (segmentEnd - segmentStart)
    : 0;
  
  const p1 = waypoints[segmentIndex];
  const p2 = waypoints[segmentIndex + 1];
  
  const lon = p1.lon + t * (p2.lon - p1.lon);
  const lat = p1.lat + t * (p2.lat - p1.lat);
  
  return geoToWorld(lon, lat);
}

/**
 * Convert all waypoints of a route to world coordinates
 * @param {Array} waypoints - Array of { lon, lat }
 * @returns {Array} Array of { x, z }
 */
export function getRouteWorldCoords(waypoints) {
  return waypoints.map(wp => geoToWorld(wp.lon, wp.lat));
}

/**
 * Get segment lengths for a route (for weighted random sampling)
 * @param {Array} waypoints 
 * @returns {Array} Array of segment lengths in km
 */
export function getSegmentLengths(waypoints) {
  const lengths = [];
  
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const dLon = (p2.lon - p1.lon) * Math.cos((p1.lat + p2.lat) / 2 * Math.PI / 180);
    const dLat = p2.lat - p1.lat;
    const dist = Math.sqrt(dLon * dLon + dLat * dLat) * 111;
    lengths.push(dist);
  }
  
  return lengths;
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get summary statistics about the registry
 * @returns {Object}
 */
export function getRegistryStats() {
  const pointsByType = {};
  POINT_EMITTERS.forEach(e => {
    const profile = EMITTER_PROFILES[e.profile];
    const type = profile ? profile.type : 'unknown';
    pointsByType[type] = (pointsByType[type] || 0) + 1;
  });
  
  const totalHighwayLength = LINE_EMITTERS.reduce((sum, line) => {
    return sum + calculateRouteLength(line.waypoints);
  }, 0);
  
  return {
    totalPointEmitters: POINT_EMITTERS.length,
    totalLineEmitters: LINE_EMITTERS.length,
    pointsByType,
    totalHighwayLengthKm: Math.round(totalHighwayLength),
    totalWaypoints: LINE_EMITTERS.reduce((sum, l) => sum + l.waypoints.length, 0)
  };
}

// ============================================
// DEBUG / DEVELOPMENT HELPERS
// ============================================

/**
 * Validate all emitters have valid profiles and coordinates
 * @returns {Array} Array of validation errors (empty if valid)
 */
export function validateRegistry() {
  const errors = [];
  
  POINT_EMITTERS.forEach(e => {
    if (!EMITTER_PROFILES[e.profile]) {
      errors.push(`Point emitter "${e.id}" has invalid profile "${e.profile}"`);
    }
    if (!isInBounds(e.coords.lon, e.coords.lat)) {
      errors.push(`Point emitter "${e.id}" is outside map bounds`);
    }
  });
  
  LINE_EMITTERS.forEach(e => {
    if (!EMITTER_PROFILES[e.profile]) {
      errors.push(`Line emitter "${e.id}" has invalid profile "${e.profile}"`);
    }
    e.waypoints.forEach((wp, i) => {
      if (!isInBounds(wp.lon, wp.lat)) {
        errors.push(`Line emitter "${e.id}" waypoint ${i} is outside map bounds`);
      }
    });
  });
  
  return errors;
}

/**
 * Log registry summary to console
 */
export function logRegistrySummary() {
  const stats = getRegistryStats();
  console.log('📊 Registry Summary:');
  console.log(`   Point emitters: ${stats.totalPointEmitters}`);
  Object.entries(stats.pointsByType).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });
  console.log(`   Line emitters: ${stats.totalLineEmitters}`);
  console.log(`   Total highway length: ${stats.totalHighwayLengthKm} km`);
  console.log(`   Total waypoints: ${stats.totalWaypoints}`);
  
  const errors = validateRegistry();
  if (errors.length > 0) {
    console.warn('⚠️ Registry validation errors:');
    errors.forEach(err => console.warn(`   - ${err}`));
  } else {
    console.log('✅ Registry validation passed');
  }
}