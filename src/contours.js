/**
 * contours.js — Topographical contour line generator for Bay Area terrain
 * Adapted from cartograph.js - uses triangle intersection for mathematically exact contours
 * Renders as ribbons for proper width control
 */

import * as THREE from 'three';

// ============================================================
// CONFIGURATION
// ============================================================

const CONTOUR_CONFIG = {
  // Elevation intervals (in world units - terrain scaled by 0.008)
  // Real elevation ~125m = 1 world unit, so:
  // minorInterval 0.4 ≈ 50m real elevation
  // majorInterval 2.0 ≈ 250m real elevation
  minorInterval: 0.4,
  majorInterval: 2.0,
  
  // Ribbon widths (world units)
  minorWidth: 0.15,
  majorWidth: 0.35,
  
  // Colors - subtle earth tones that work with the terrain
  minorColor: 0x5a7a6a,    // Muted green-gray
  majorColor: 0x3a5a4a,    // Darker green
  
  // Coastline contour (special single contour at water's edge)
  coastlineEnabled: true,
  coastlineElevation: 0.1,
  coastlineColor: 0xc2a366,  // Sand color
  coastlineWidth: 0.25,
  
  // Alternative: elevation-based coloring
  useElevationColors: false,
  elevationColorStops: [
    { elevation: 0, color: 0x2a5a4a },      // Sea level - dark teal
    { elevation: 1, color: 0x3a6a5a },      // Low - green
    { elevation: 3, color: 0x5a7a5a },      // Medium - lighter green
    { elevation: 6, color: 0x7a7a5a },      // Higher - yellow-green
    { elevation: 10, color: 0x8a7a6a },     // High - brown
    { elevation: 20, color: 0x9a8a7a },     // Peaks - tan
  ],
  
  // Rendering
  yOffset: 0.08,           // Height above terrain to prevent z-fighting
  opacity: 0.7,
  
  // Segment extension to prevent corner gaps (fraction of width)
  segmentExtension: 0.3,
  
  // Performance
  skipWaterContours: true, // Don't generate contours below water
  waterLevel: 0.15,        // Match TERRAIN_CONFIG.waterLevel from map.js
};

// ============================================================
// CONTOUR GENERATOR CLASS
// ============================================================

class ContourGenerator {
  constructor(terrainMesh, config = {}) {
    this.terrainMesh = terrainMesh;
    this.config = { ...CONTOUR_CONFIG, ...config };
    
    this.contourGroup = null;
    this.isVisible = false;
    this.scene = null;
    
    // Cache for extracted triangle data
    this.triangleCache = null;
    
    // Stats
    this.stats = {
      triangleCount: 0,
      segmentCount: 0,
      contourLevels: 0,
      generationTime: 0,
    };
  }
  
  // ============================================================
  // MAIN API
  // ============================================================
  
  /**
   * Generate all contour ribbons
   * Call this once after terrain is created
   */
  generate() {
    const startTime = performance.now();
    
    // Extract triangles from terrain mesh
    this.extractTriangles();
    
    // Find elevation range
    const { minElevation, maxElevation } = this.getElevationRange();
    console.log(`[Contours] Elevation range: ${minElevation.toFixed(2)} to ${maxElevation.toFixed(2)}`);
    
    // Generate contour levels
    const contourLevels = this.calculateContourLevels(minElevation, maxElevation);
    console.log(`[Contours] Generating ${contourLevels.length} contour levels`);
    
    // Find all contour segments via triangle intersection
    const allSegments = [];
    for (const level of contourLevels) {
      const segments = this.findContourSegments(level.elevation);
      for (const seg of segments) {
        seg.isMajor = level.isMajor;
        seg.isCoastline = level.isCoastline || false;
        seg.elevation = level.elevation;
        allSegments.push(seg);
      }
    }
    
    console.log(`[Contours] Found ${allSegments.length} contour segments`);
    
    // Store segments for external access
    this.allSegments = allSegments;
    
    // Build ribbon geometry
    this.contourGroup = new THREE.Group();
    this.contourGroup.name = 'contourLines';
    
    const ribbonMesh = this.buildRibbonMesh(allSegments);
    if (ribbonMesh) {
      this.contourGroup.add(ribbonMesh);
    }
    
    // Stats
    this.stats.segmentCount = allSegments.length;
    this.stats.contourLevels = contourLevels.length;
    this.stats.generationTime = performance.now() - startTime;
    
    console.log(`[Contours] Generation complete in ${this.stats.generationTime.toFixed(1)}ms`);
    console.log(`[Contours]   Triangles processed: ${this.stats.triangleCount}`);
    console.log(`[Contours]   Contour segments: ${this.stats.segmentCount}`);
    console.log(`[Contours]   Contour levels: ${this.stats.contourLevels}`);
    
    return this.contourGroup;
  }
  
  /**
   * Show contours in scene
   */
  show(scene) {
    if (!this.contourGroup) {
      console.warn('[Contours] No contours generated. Call generate() first.');
      return;
    }
    
    this.scene = scene;
    
    if (!this.isVisible) {
      scene.add(this.contourGroup);
      this.isVisible = true;
      console.log('[Contours] Contours shown');
    }
  }
  
  /**
   * Hide contours from scene
   */
  hide() {
    if (this.isVisible && this.scene && this.contourGroup) {
      this.scene.remove(this.contourGroup);
      this.isVisible = false;
      console.log('[Contours] Contours hidden');
    }
  }
  
  /**
   * Toggle visibility
   */
  toggle(scene) {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show(scene);
    }
    return this.isVisible;
  }
  
  /**
   * Dispose of all resources
   */
  dispose() {
    if (this.contourGroup) {
      this.contourGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      
      if (this.scene) {
        this.scene.remove(this.contourGroup);
      }
      
      this.contourGroup = null;
    }
    
    this.triangleCache = null;
    this.isVisible = false;
  }
  
  // ============================================================
  // TRIANGLE EXTRACTION
  // ============================================================
  
  /**
   * Extract all triangles from the terrain mesh
   * PlaneGeometry uses indexed triangles
   */
  extractTriangles() {
    const geometry = this.terrainMesh.geometry;
    const positions = geometry.attributes.position;
    const indices = geometry.index;
    
    this.triangleCache = [];
    
    if (indices) {
      // Indexed geometry
      const indexArray = indices.array;
      for (let i = 0; i < indexArray.length; i += 3) {
        const i0 = indexArray[i];
        const i1 = indexArray[i + 1];
        const i2 = indexArray[i + 2];
        
        this.triangleCache.push({
          v0: new THREE.Vector3(
            positions.getX(i0),
            positions.getY(i0),
            positions.getZ(i0)
          ),
          v1: new THREE.Vector3(
            positions.getX(i1),
            positions.getY(i1),
            positions.getZ(i1)
          ),
          v2: new THREE.Vector3(
            positions.getX(i2),
            positions.getY(i2),
            positions.getZ(i2)
          ),
        });
      }
    } else {
      // Non-indexed geometry
      for (let i = 0; i < positions.count; i += 3) {
        this.triangleCache.push({
          v0: new THREE.Vector3(
            positions.getX(i),
            positions.getY(i),
            positions.getZ(i)
          ),
          v1: new THREE.Vector3(
            positions.getX(i + 1),
            positions.getY(i + 1),
            positions.getZ(i + 1)
          ),
          v2: new THREE.Vector3(
            positions.getX(i + 2),
            positions.getY(i + 2),
            positions.getZ(i + 2)
          ),
        });
      }
    }
    
    this.stats.triangleCount = this.triangleCache.length;
    console.log(`[Contours] Extracted ${this.triangleCache.length} triangles`);
  }
  
  /**
   * Get min/max elevation from cached triangles
   */
  getElevationRange() {
    let minElevation = Infinity;
    let maxElevation = -Infinity;
    
    for (const tri of this.triangleCache) {
      minElevation = Math.min(minElevation, tri.v0.y, tri.v1.y, tri.v2.y);
      maxElevation = Math.max(maxElevation, tri.v0.y, tri.v1.y, tri.v2.y);
    }
    
    return { minElevation, maxElevation };
  }
  
  /**
   * Calculate which contour levels to generate
   */
  calculateContourLevels(minElev, maxElev) {
    const levels = [];
    const { minorInterval, majorInterval, skipWaterContours, waterLevel, 
            coastlineEnabled, coastlineElevation } = this.config;
    
    // Add coastline contour if enabled
    if (coastlineEnabled && coastlineElevation >= minElev && coastlineElevation <= maxElev) {
      levels.push({ elevation: coastlineElevation, isMajor: false, isCoastline: true });
    }
    
    // Start from first interval above water (or min elevation)
    const effectiveMin = skipWaterContours ? Math.max(minElev, waterLevel) : minElev;
    const startElev = Math.ceil(effectiveMin / minorInterval) * minorInterval;
    const endElev = Math.ceil(maxElev / minorInterval) * minorInterval;
    
    for (let elev = startElev; elev <= endElev; elev += minorInterval) {
      // Skip water contours if configured
      if (skipWaterContours && elev < waterLevel) {
        continue;
      }
      
      // Skip if too close to coastline (avoid duplicate)
      if (coastlineEnabled && Math.abs(elev - coastlineElevation) < 0.05) {
        continue;
      }
      
      // Check if this is a major contour (use small epsilon for float comparison)
      const isMajor = Math.abs(elev % majorInterval) < 0.001 || 
                      Math.abs(elev % majorInterval - majorInterval) < 0.001;
      levels.push({ elevation: elev, isMajor, isCoastline: false });
    }
    
    return levels;
  }
  
  // ============================================================
  // TRIANGLE INTERSECTION (Core Algorithm)
  // ============================================================
  
  /**
   * Find all contour segments at a given elevation
   * Uses triangle intersection - mathematically exact
   */
  findContourSegments(elevation) {
    const segments = [];
    
    for (const tri of this.triangleCache) {
      const segment = this.intersectTriangle(tri, elevation);
      if (segment) {
        segments.push(segment);
      }
    }
    
    return segments;
  }
  
  /**
   * Intersect a single triangle with a horizontal plane at given elevation
   * Returns a line segment {p1, p2} or null if no intersection
   */
  intersectTriangle(tri, elevation) {
    const { v0, v1, v2 } = tri;
    
    // Check which vertices are above/below the contour elevation
    const above0 = v0.y > elevation;
    const above1 = v1.y > elevation;
    const above2 = v2.y > elevation;
    
    // Count how many are above
    const aboveCount = (above0 ? 1 : 0) + (above1 ? 1 : 0) + (above2 ? 1 : 0);
    
    // No intersection if all above or all below
    if (aboveCount === 0 || aboveCount === 3) {
      return null;
    }
    
    // Find the two edges that cross the elevation
    const crossings = [];
    
    // Edge v0 -> v1
    if (above0 !== above1) {
      const point = this.interpolateEdge(v0, v1, elevation);
      if (point) crossings.push(point);
    }
    
    // Edge v1 -> v2
    if (above1 !== above2) {
      const point = this.interpolateEdge(v1, v2, elevation);
      if (point) crossings.push(point);
    }
    
    // Edge v2 -> v0
    if (above2 !== above0) {
      const point = this.interpolateEdge(v2, v0, elevation);
      if (point) crossings.push(point);
    }
    
    // Should have exactly 2 crossings
    if (crossings.length !== 2) {
      return null;
    }
    
    return { p1: crossings[0], p2: crossings[1] };
  }
  
  /**
   * Interpolate along an edge to find where it crosses the elevation
   */
  interpolateEdge(vA, vB, elevation) {
    const elevA = vA.y;
    const elevB = vB.y;
    
    // Avoid division by zero
    if (Math.abs(elevB - elevA) < 0.0001) {
      return null;
    }
    
    // Calculate interpolation factor
    const t = (elevation - elevA) / (elevB - elevA);
    
    // Clamp to [0, 1] for safety
    if (t < 0 || t > 1) {
      return null;
    }
    
    // Interpolate position
    return new THREE.Vector3(
      vA.x + t * (vB.x - vA.x),
      elevation,  // Use exact elevation
      vA.z + t * (vB.z - vA.z)
    );
  }
  
  // ============================================================
  // RIBBON GEOMETRY BUILDER
  // ============================================================
  
  /**
   * Build ribbon mesh from contour segments
   */
  buildRibbonMesh(segments) {
    if (segments.length === 0) {
      return null;
    }
    
    const positions = [];
    const colors = [];
    const indices = [];
    
    let vertexIndex = 0;
    
    for (const seg of segments) {
      const { p1, p2, isMajor, isCoastline, elevation } = seg;
      
      // Get width based on type (coastline, major, or minor)
      let halfWidth;
      if (isCoastline) {
        halfWidth = this.config.coastlineWidth / 2;
      } else if (isMajor) {
        halfWidth = this.config.majorWidth / 2;
      } else {
        halfWidth = this.config.minorWidth / 2;
      }
      
      // Get color
      const color = this.getContourColor(elevation, isMajor, isCoastline);
      
      // Calculate ribbon direction
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const length = dir.length();
      
      if (length < 0.001) continue;  // Skip degenerate segments
      
      dir.normalize();
      
      // Extend segment slightly to prevent corner gaps
      const extension = dir.clone().multiplyScalar(halfWidth * this.config.segmentExtension);
      const extP1 = p1.clone().sub(extension);
      const extP2 = p2.clone().add(extension);
      
      // Perpendicular vector in XZ plane (for horizontal ribbon)
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(halfWidth);
      
      // Y offset to prevent z-fighting
      const yOffset = this.config.yOffset;
      
      // Four corners of the ribbon quad
      const v0 = new THREE.Vector3(
        extP1.x - perp.x,
        extP1.y + yOffset,
        extP1.z - perp.z
      );
      const v1 = new THREE.Vector3(
        extP1.x + perp.x,
        extP1.y + yOffset,
        extP1.z + perp.z
      );
      const v2 = new THREE.Vector3(
        extP2.x - perp.x,
        extP2.y + yOffset,
        extP2.z - perp.z
      );
      const v3 = new THREE.Vector3(
        extP2.x + perp.x,
        extP2.y + yOffset,
        extP2.z + perp.z
      );
      
      // Add vertices
      positions.push(
        v0.x, v0.y, v0.z,
        v1.x, v1.y, v1.z,
        v2.x, v2.y, v2.z,
        v3.x, v3.y, v3.z
      );
      
      // Add colors for all 4 vertices
      for (let i = 0; i < 4; i++) {
        colors.push(color.r, color.g, color.b);
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
      opacity: this.config.opacity,
      depthWrite: false,
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'contourRibbons';
    mesh.renderOrder = 10;
    
    return mesh;
  }
  
  /**
   * Get color for a contour at given elevation
   */
  getContourColor(elevation, isMajor, isCoastline = false) {
    // Coastline gets special color
    if (isCoastline) {
      return new THREE.Color(this.config.coastlineColor);
    }
    
    if (this.config.useElevationColors) {
      return this.getElevationColor(elevation);
    }
    
    return new THREE.Color(isMajor ? this.config.majorColor : this.config.minorColor);
  }
  
  /**
   * Get color based on elevation (gradient)
   */
  getElevationColor(elevation) {
    const stops = this.config.elevationColorStops;
    
    if (elevation <= stops[0].elevation) {
      return new THREE.Color(stops[0].color);
    }
    
    if (elevation >= stops[stops.length - 1].elevation) {
      return new THREE.Color(stops[stops.length - 1].color);
    }
    
    for (let i = 0; i < stops.length - 1; i++) {
      if (elevation >= stops[i].elevation && elevation <= stops[i + 1].elevation) {
        const t = (elevation - stops[i].elevation) / (stops[i + 1].elevation - stops[i].elevation);
        const color = new THREE.Color(stops[i].color);
        color.lerp(new THREE.Color(stops[i + 1].color), t);
        return color;
      }
    }
    
    return new THREE.Color(this.config.minorColor);
  }
  
  // ============================================================
  // UTILITY METHODS
  // ============================================================
  
  setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
  
  getStats() {
    return { ...this.stats };
  }
  
  getIsVisible() {
    return this.isVisible;
  }
}

// ============================================================
// MODULE API
// ============================================================

let contourGenerator = null;
let currentScene = null;

/**
 * Initialize the contour system with a terrain mesh
 * @param {THREE.Mesh} terrainMesh - The terrain mesh from map.js
 * @param {THREE.Scene} scene - The Three.js scene
 * @param {Object} config - Optional configuration overrides
 */
export function initContours(terrainMesh, scene, config = {}) {
  if (!terrainMesh) {
    console.error('[Contours] No terrain mesh provided');
    return null;
  }
  
  if (!terrainMesh.geometry) {
    console.error('[Contours] Terrain mesh has no geometry');
    return null;
  }
  
  currentScene = scene;
  
  // Dispose of existing generator
  if (contourGenerator) {
    contourGenerator.dispose();
  }
  
  // Create new generator
  contourGenerator = new ContourGenerator(terrainMesh, config);
  
  // Generate contours
  contourGenerator.generate();
  
  console.log('[Contours] Initialized and ready');
  
  return contourGenerator;
}

/**
 * Toggle contour visibility
 * @returns {boolean} New visibility state
 */
export function toggleContours() {
  if (!contourGenerator || !currentScene) {
    console.warn('[Contours] Not initialized. Call initContours() first.');
    return false;
  }
  
  return contourGenerator.toggle(currentScene);
}

/**
 * Show contours
 */
export function showContours() {
  if (contourGenerator && currentScene) {
    contourGenerator.show(currentScene);
  }
}

/**
 * Hide contours
 */
export function hideContours() {
  if (contourGenerator) {
    contourGenerator.hide();
  }
}

/**
 * Check if contours are visible
 */
export function areContoursVisible() {
  return contourGenerator ? contourGenerator.getIsVisible() : false;
}

/**
 * Regenerate contours with new configuration
 */
export function regenerateContours(config = {}) {
  if (!contourGenerator) {
    console.warn('[Contours] Not initialized');
    return;
  }
  
  const wasVisible = contourGenerator.getIsVisible();
  
  contourGenerator.setConfig(config);
  contourGenerator.dispose();
  contourGenerator.generate();
  
  if (wasVisible && currentScene) {
    contourGenerator.show(currentScene);
  }
}

/**
 * Dispose of all contour resources
 */
export function disposeContours() {
  if (contourGenerator) {
    contourGenerator.dispose();
    contourGenerator = null;
  }
  currentScene = null;
}

/**
 * Get the ContourGenerator instance for advanced usage
 */
export function getContourGenerator() {
  return contourGenerator;
}

export { ContourGenerator, CONTOUR_CONFIG };