/**
 * chronograph.js — Central timing system + Dynamic sky and lighting
 * 
 * Provides frame-rate independent simulation timing using fixed timestep.
 * Also handles time-of-day transitions with changing sky colors,
 * sun/moon positioning, and atmospheric lighting.
 * 
 * FIXED TIMESTEP PATTERN:
 * - Simulation always advances in fixed increments (e.g., 1/60th second)
 * - At 30fps: runs 2 simulation steps per frame
 * - At 60fps: runs 1 simulation step per frame  
 * - At 120fps: runs 1 step every other frame (accumulates)
 * - Result: identical simulation output regardless of frame rate
 */

import * as THREE from 'three';

// ============================================
// FIXED TIMESTEP TIME MANAGER
// ============================================

export const TimeManager = {
  // Configuration
  fixedDeltaTime: 1 / 60,      // Fixed timestep: 60 updates per second (16.67ms)
  maxSubSteps: 8,              // Max simulation steps per frame (prevents spiral of death)
  
  // State
  accumulator: 0,              // Accumulated real time to be processed
  simulationTime: 0,           // Total simulation time elapsed (in fixed steps)
  paused: false,
  timeScale: 1.0,              // Speed multiplier (1.0 = normal)
  
  // Performance tracking
  avgFrameTime: 1/60,
  frameCount: 0,
  stepsThisFrame: 0,
  
  /**
   * Initialize the time manager
   */
  init() {
    this.accumulator = 0;
    this.simulationTime = 0;
    this.paused = false;
    this.timeScale = 1.0;
    this.avgFrameTime = this.fixedDeltaTime;
    this.frameCount = 0;
    this.stepsThisFrame = 0;
    console.log(`⏱️ TimeManager initialized (fixed dt: ${(this.fixedDeltaTime * 1000).toFixed(2)}ms = ${Math.round(1/this.fixedDeltaTime)} sim Hz)`);
  },
  
  /**
   * Call once per render frame with actual elapsed time.
   * Returns number of fixed simulation steps to run this frame.
   * 
   * @param {number} realDeltaTime - Actual seconds since last frame
   * @returns {number} Number of fixed steps to execute
   */
  update(realDeltaTime) {
    this.frameCount++;
    this.avgFrameTime = this.avgFrameTime * 0.95 + realDeltaTime * 0.05;
    
    if (this.paused) {
      this.stepsThisFrame = 0;
      return 0;
    }
    
    // Scale and accumulate time
    const scaledDelta = realDeltaTime * this.timeScale;
    this.accumulator += scaledDelta;
    
    // Cap to prevent spiral of death (when sim can't keep up)
    const maxAccumulator = this.fixedDeltaTime * this.maxSubSteps;
    if (this.accumulator > maxAccumulator) {
      this.accumulator = maxAccumulator;
    }
    
    // Count how many fixed steps fit in accumulated time
    let steps = 0;
    while (this.accumulator >= this.fixedDeltaTime) {
      this.accumulator -= this.fixedDeltaTime;
      this.simulationTime += this.fixedDeltaTime;
      steps++;
    }
    
    this.stepsThisFrame = steps;
    return steps;
  },
  
  /**
   * Get the fixed delta time - USE THIS IN ALL SIMULATION CODE
   * This value never changes, ensuring deterministic behavior
   */
  getDt() {
    return this.fixedDeltaTime;
  },
  
  /**
   * Get interpolation alpha (0-1) for smooth rendering between steps
   * Use to interpolate visual positions: lerp(prevPos, currPos, alpha)
   */
  getAlpha() {
    return this.accumulator / this.fixedDeltaTime;
  },
  
  /**
   * Get total simulation time elapsed
   */
  getTime() {
    return this.simulationTime;
  },
  
  /**
   * Pause/unpause simulation
   */
  setPaused(paused) {
    this.paused = paused;
    console.log(paused ? '⏸️ Simulation paused' : '▶️ Simulation resumed');
  },
  
  /**
   * Set time scale (1.0 = normal, 2.0 = 2x speed, 0.5 = half speed)
   */
  setTimeScale(scale) {
    this.timeScale = Math.max(0.1, Math.min(10, scale));
  },
  
  /**
   * Reset simulation time to zero
   */
  reset() {
    this.accumulator = 0;
    this.simulationTime = 0;
    console.log('🔄 TimeManager reset');
  },
  
  /**
   * Get performance/debug stats
   */
  getStats() {
    return {
      fps: Math.round(1 / this.avgFrameTime),
      simTime: this.simulationTime,
      stepsLastFrame: this.stepsThisFrame,
      timeScale: this.timeScale,
      paused: this.paused
    };
  }
};


// ============================================
// SKY SYSTEM CONFIGURATION
// ============================================

const TIME_PERIODS = {
  NIGHT: { start: 0, end: 5 },
  DAWN: { start: 5, end: 7 },
  MORNING: { start: 7, end: 10 },
  MIDDAY: { start: 10, end: 14 },
  AFTERNOON: { start: 14, end: 17 },
  DUSK: { start: 17, end: 20 },
  EVENING: { start: 20, end: 24 }
};

// Sky color presets for different times
const SKY_PRESETS = {
  0: {  // Midnight
    skyTop: new THREE.Color(0x0a0a1a),
    skyBottom: new THREE.Color(0x1a1a2e),
    horizon: new THREE.Color(0x1a2a3a),
    fog: new THREE.Color(0x0a0a12),
    ambient: new THREE.Color(0x1a1a2e),
    ambientIntensity: 0.6,
    sunColor: new THREE.Color(0x4466aa),
    sunIntensity: 0.2,
    sunPosition: new THREE.Vector3(0, -50, 0)
  },
  5: {  // Pre-dawn
    skyTop: new THREE.Color(0x1a1a3a),
    skyBottom: new THREE.Color(0x2a2a4a),
    horizon: new THREE.Color(0x4a3a5a),
    fog: new THREE.Color(0x1a1a2a),
    ambient: new THREE.Color(0x2a2a3e),
    ambientIntensity: 0.8,
    sunColor: new THREE.Color(0x6688bb),
    sunIntensity: 0.4,
    sunPosition: new THREE.Vector3(-80, -20, 30)
  },
  6: {  // Dawn
    skyTop: new THREE.Color(0x2a3a5a),
    skyBottom: new THREE.Color(0x5a4a6a),
    horizon: new THREE.Color(0xff7744),
    fog: new THREE.Color(0x3a3a4a),
    ambient: new THREE.Color(0x4a4a5e),
    ambientIntensity: 1.0,
    sunColor: new THREE.Color(0xff8855),
    sunIntensity: 1.0,
    sunPosition: new THREE.Vector3(-80, 10, 30)
  },
  7: {  // Early morning
    skyTop: new THREE.Color(0x4a6a9a),
    skyBottom: new THREE.Color(0x8a7a9a),
    horizon: new THREE.Color(0xffaa66),
    fog: new THREE.Color(0x5a5a6a),
    ambient: new THREE.Color(0x6a6a7e),
    ambientIntensity: 1.2,
    sunColor: new THREE.Color(0xffaa77),
    sunIntensity: 1.5,
    sunPosition: new THREE.Vector3(-60, 30, 30)
  },
  9: {  // Morning
    skyTop: new THREE.Color(0x4488cc),
    skyBottom: new THREE.Color(0x88aacc),
    horizon: new THREE.Color(0xaaccee),
    fog: new THREE.Color(0x6688aa),
    ambient: new THREE.Color(0x8899aa),
    ambientIntensity: 1.4,
    sunColor: new THREE.Color(0xffeedd),
    sunIntensity: 1.8,
    sunPosition: new THREE.Vector3(-40, 60, 30)
  },
  12: { // Midday
    skyTop: new THREE.Color(0x3377bb),
    skyBottom: new THREE.Color(0x77aadd),
    horizon: new THREE.Color(0xaaddff),
    fog: new THREE.Color(0x5588bb),
    ambient: new THREE.Color(0x99aacc),
    ambientIntensity: 1.6,
    sunColor: new THREE.Color(0xffffee),
    sunIntensity: 2.2,
    sunPosition: new THREE.Vector3(0, 80, 30)
  },
  15: { // Afternoon
    skyTop: new THREE.Color(0x4488cc),
    skyBottom: new THREE.Color(0x88aacc),
    horizon: new THREE.Color(0xccddee),
    fog: new THREE.Color(0x6699bb),
    ambient: new THREE.Color(0x8899aa),
    ambientIntensity: 1.5,
    sunColor: new THREE.Color(0xffeedd),
    sunIntensity: 2.0,
    sunPosition: new THREE.Vector3(40, 60, 30)
  },
  17: { // Late afternoon
    skyTop: new THREE.Color(0x5588bb),
    skyBottom: new THREE.Color(0x9988aa),
    horizon: new THREE.Color(0xffcc88),
    fog: new THREE.Color(0x7788aa),
    ambient: new THREE.Color(0x8888aa),
    ambientIntensity: 1.3,
    sunColor: new THREE.Color(0xffcc88),
    sunIntensity: 1.6,
    sunPosition: new THREE.Vector3(60, 40, 30)
  },
  19: { // Dusk
    skyTop: new THREE.Color(0x3a4a6a),
    skyBottom: new THREE.Color(0x6a5a7a),
    horizon: new THREE.Color(0xff6633),
    fog: new THREE.Color(0x4a4a5a),
    ambient: new THREE.Color(0x5a5a6e),
    ambientIntensity: 1.0,
    sunColor: new THREE.Color(0xff7744),
    sunIntensity: 1.2,
    sunPosition: new THREE.Vector3(80, 10, 30)
  },
  20: { // Twilight
    skyTop: new THREE.Color(0x2a2a4a),
    skyBottom: new THREE.Color(0x4a3a5a),
    horizon: new THREE.Color(0x884466),
    fog: new THREE.Color(0x2a2a3a),
    ambient: new THREE.Color(0x3a3a4e),
    ambientIntensity: 0.8,
    sunColor: new THREE.Color(0x6666aa),
    sunIntensity: 0.6,
    sunPosition: new THREE.Vector3(80, -10, 30)
  },
  22: { // Night
    skyTop: new THREE.Color(0x0a0a1a),
    skyBottom: new THREE.Color(0x1a1a2e),
    horizon: new THREE.Color(0x2a2a3a),
    fog: new THREE.Color(0x0a0a12),
    ambient: new THREE.Color(0x1a1a2e),
    ambientIntensity: 0.6,
    sunColor: new THREE.Color(0x4466aa),
    sunIntensity: 0.3,
    sunPosition: new THREE.Vector3(0, -30, 0)
  }
};

// ============================================
// Sky State
// ============================================

let scene = null;
let skyMesh = null;
let starField = null;
let sunLight = null;
let ambientLight = null;
let fillLight = null;
let sunMesh = null;
let moonMesh = null;

const currentColors = {
  skyTop: new THREE.Color(),
  skyBottom: new THREE.Color(),
  horizon: new THREE.Color(),
  fog: new THREE.Color(),
  ambient: new THREE.Color(),
  sunColor: new THREE.Color()
};

// ============================================
// Sky Initialization
// ============================================

export function initSky(sceneRef) {
  console.log('🌅 Initializing sky system...');
  scene = sceneRef;
  
  createSkyDome();
  createStarField();
  createCelestialBodies();
  createLighting();
  
  return {
    update: updateSky,
    setTimeOfDay
  };
}

// ============================================
// Sky Dome
// ============================================

function createSkyDome() {
  const geometry = new THREE.SphereGeometry(400, 32, 32);
  
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x0a0a1a) },
      bottomColor: { value: new THREE.Color(0x1a1a2e) },
      horizonColor: { value: new THREE.Color(0x1a2a3a) },
      offset: { value: 20 },
      exponent: { value: 0.6 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizonColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        
        vec3 color;
        if (h < 0.0) {
          color = bottomColor;
        } else if (h < 0.3) {
          float t = h / 0.3;
          color = mix(bottomColor, horizonColor, t);
        } else {
          float t = (h - 0.3) / 0.7;
          t = pow(t, exponent);
          color = mix(horizonColor, topColor, t);
        }
        
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false
  });
  
  skyMesh = new THREE.Mesh(geometry, material);
  scene.add(skyMesh);
}

// ============================================
// Star Field
// ============================================

function createStarField() {
  const starCount = 2000;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5;
    const radius = 350;
    
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) + 50;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    
    sizes[i] = Math.random() * 2 + 0.5;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  
  const material = new THREE.ShaderMaterial({
    uniforms: {
      opacity: { value: 1.0 },
      color: { value: new THREE.Color(0xffffff) }
    },
    vertexShader: `
      attribute float size;
      varying float vSize;
      void main() {
        vSize = size;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (200.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float opacity;
      uniform vec3 color;
      varying float vSize;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float alpha = opacity * (1.0 - d * 2.0);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  
  starField = new THREE.Points(geometry, material);
  scene.add(starField);
}

// ============================================
// Sun and Moon
// ============================================

function createCelestialBodies() {
  // Sun
  const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: 0xffdd88,
    transparent: true,
    opacity: 1.0
  });
  sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
  scene.add(sunMesh);
  
  // Sun glow
  const glowGeometry = new THREE.SphereGeometry(15, 32, 32);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.3,
    side: THREE.BackSide
  });
  const sunGlow = new THREE.Mesh(glowGeometry, glowMaterial);
  sunMesh.add(sunGlow);
  
  // Moon
  const moonGeometry = new THREE.SphereGeometry(5, 32, 32);
  const moonMaterial = new THREE.MeshBasicMaterial({
    color: 0xddeeff,
    transparent: true,
    opacity: 1.0
  });
  moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
  scene.add(moonMesh);
}

// ============================================
// Lighting
// ============================================

function createLighting() {
  scene.children = scene.children.filter(child => 
    !(child instanceof THREE.AmbientLight) && 
    !(child instanceof THREE.DirectionalLight)
  );
  
  ambientLight = new THREE.AmbientLight(0x1a1a2e, 0.5);
  scene.add(ambientLight);
  
  sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
  sunLight.position.set(50, 80, 30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 300;
  sunLight.shadow.camera.left = -100;
  sunLight.shadow.camera.right = 100;
  sunLight.shadow.camera.top = 100;
  sunLight.shadow.camera.bottom = -100;
  scene.add(sunLight);
  
  fillLight = new THREE.DirectionalLight(0x4488ff, 0.2);
  fillLight.position.set(-30, 40, -50);
  scene.add(fillLight);
}

// ============================================
// Time of Day Update
// ============================================

export function setTimeOfDay(hour, scene, brightness = 1.0) {
  const normalizedHour = ((hour % 24) + 24) % 24;
  
  const presetHours = Object.keys(SKY_PRESETS).map(Number).sort((a, b) => a - b);
  
  let lowerHour = presetHours[0];
  let upperHour = presetHours[presetHours.length - 1];
  
  for (let i = 0; i < presetHours.length; i++) {
    if (presetHours[i] <= normalizedHour) {
      lowerHour = presetHours[i];
    }
    if (presetHours[i] >= normalizedHour && upperHour === presetHours[presetHours.length - 1]) {
      upperHour = presetHours[i];
      break;
    }
  }
  
  if (upperHour <= lowerHour) {
    upperHour = presetHours[0] + 24;
  }
  
  let t = 0;
  if (upperHour !== lowerHour) {
    const adjustedHour = normalizedHour < lowerHour ? normalizedHour + 24 : normalizedHour;
    t = (adjustedHour - lowerHour) / (upperHour - lowerHour);
  }
  
  const lowerPreset = SKY_PRESETS[lowerHour];
  const upperPreset = SKY_PRESETS[upperHour % 24] || SKY_PRESETS[0];
  
  currentColors.skyTop.copy(lowerPreset.skyTop).lerp(upperPreset.skyTop, t);
  currentColors.skyBottom.copy(lowerPreset.skyBottom).lerp(upperPreset.skyBottom, t);
  currentColors.horizon.copy(lowerPreset.horizon).lerp(upperPreset.horizon, t);
  currentColors.fog.copy(lowerPreset.fog).lerp(upperPreset.fog, t);
  currentColors.ambient.copy(lowerPreset.ambient).lerp(upperPreset.ambient, t);
  currentColors.sunColor.copy(lowerPreset.sunColor).lerp(upperPreset.sunColor, t);
  
  const ambientIntensity = THREE.MathUtils.lerp(lowerPreset.ambientIntensity, upperPreset.ambientIntensity, t);
  const sunIntensity = THREE.MathUtils.lerp(lowerPreset.sunIntensity, upperPreset.sunIntensity, t);
  
  const sunPos = new THREE.Vector3().copy(lowerPreset.sunPosition).lerp(upperPreset.sunPosition, t);
  
  if (skyMesh) {
    skyMesh.material.uniforms.topColor.value.copy(currentColors.skyTop);
    skyMesh.material.uniforms.bottomColor.value.copy(currentColors.skyBottom);
    skyMesh.material.uniforms.horizonColor.value.copy(currentColors.horizon);
  }
  
  if (scene.fog) {
    scene.fog.color.copy(currentColors.fog);
  }
  scene.background = currentColors.fog.clone();
  
  if (ambientLight) {
    ambientLight.color.copy(currentColors.ambient);
    ambientLight.intensity = ambientIntensity * brightness;
  }
  
  if (sunLight) {
    sunLight.color.copy(currentColors.sunColor);
    sunLight.intensity = sunIntensity * brightness;
    sunLight.position.copy(sunPos);
  }
  
  if (fillLight) {
    fillLight.intensity = 0.2 * brightness;
  }
  
  if (sunMesh) {
    const sunDistance = 300;
    const sunAngle = ((normalizedHour - 6) / 12) * Math.PI;
    sunMesh.position.set(
      Math.cos(sunAngle) * sunDistance * 0.3,
      Math.sin(sunAngle) * sunDistance * 0.8,
      -50
    );
    
    const sunVisible = normalizedHour >= 5 && normalizedHour <= 20;
    sunMesh.visible = sunVisible;
    if (sunVisible) {
      const fadeIn = Math.min(1, (normalizedHour - 5) / 2);
      const fadeOut = Math.min(1, (20 - normalizedHour) / 2);
      sunMesh.material.opacity = Math.min(fadeIn, fadeOut);
    }
  }
  
  if (moonMesh) {
    const moonAngle = ((normalizedHour + 6) / 12) * Math.PI;
    const moonDistance = 280;
    moonMesh.position.set(
      -Math.cos(moonAngle) * moonDistance * 0.3,
      -Math.sin(moonAngle) * moonDistance * 0.6 + 100,
      50
    );
    
    const moonVisible = normalizedHour >= 19 || normalizedHour <= 6;
    moonMesh.visible = moonVisible;
    if (moonVisible) {
      const moonOpacity = normalizedHour >= 19 
        ? Math.min(1, (normalizedHour - 19) / 2)
        : Math.min(1, (6 - normalizedHour) / 2);
      moonMesh.material.opacity = Math.max(0.3, moonOpacity);
    }
  }
  
  if (starField) {
    let starOpacity = 0;
    if (normalizedHour >= 19) {
      starOpacity = Math.min(1, (normalizedHour - 19) / 2);
    } else if (normalizedHour <= 6) {
      starOpacity = Math.min(1, (6 - normalizedHour) / 2);
    }
    starField.material.uniforms.opacity.value = starOpacity;
  }
}

export function updateSky(dt, timeOfDay) {
  if (starField) {
    starField.rotation.y += dt * 0.001;
  }
}

// ============================================
// Utility
// ============================================

export function getTimeLabel(hour) {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 || 12;
  return `${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
}

export function disposeSky() {
  if (skyMesh) {
    skyMesh.geometry.dispose();
    skyMesh.material.dispose();
  }
  if (starField) {
    starField.geometry.dispose();
    starField.material.dispose();
  }
  if (sunMesh) {
    sunMesh.geometry.dispose();
    sunMesh.material.dispose();
  }
  if (moonMesh) {
    moonMesh.geometry.dispose();
    moonMesh.material.dispose();
  }
}