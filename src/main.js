/**
 * main.js â€” Bootstrap + render loop
 * 
 * Creates the Three.js core and wires all modules together.
 * Owns: scene, camera, renderer, appState, animation loop
 */

import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { initMap, disposeMap } from './map.js';
import { initControls, updateControls } from './controls.js';
import { initHUD, updateHUD } from './hud.js';
import { initPolluters } from './polluters.js';
import { initTraffic } from './traffic.js';
import { initOrchestrator, stepOrchestrator, resetOrchestrator, setPaused, getParticleCount } from './orchestrator.js';
import { initSky, setTimeOfDay, updateSky, getTimeLabel } from './chronograph.js';

// ============================================
// Global App State
// ============================================
export const appState = {
  paused: false,
  simTime: 0,
  frameCount: 0
};

export const settings = {
  // Wind / Transport
  windDirection: 225,    // degrees (0 = North, 90 = East, etc.)
  windSpeed: 5.0,        // m/s
  turbulence: 0.3,       // 0-1 mixing strength
  
  // Emissions
  emissionRate: 1.0,     // multiplier
  
  // Pollutant toggles
  enablePM25: true,
  enableVOC: true,
  enableOzone: true,
  
  // Time of day
  timeOfDay: 10,         // 0-24 hour scale
  autoTime: false,       // Auto-cycle time
  autoTimeSpeed: 0.5,    // Hours per real second when auto
  brightness: 1.0,       // Lighting intensity multiplier
  
  // Simulation
  timeScale: 1.0         // simulation speed multiplier
};

// ============================================
// Three.js Core
// ============================================
let scene, camera, renderer;
let clock;
let stats;

function initThree() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a12);
  scene.fog = new THREE.Fog(0x0a0a12, 80, 250);
  
  // Camera
  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(40, 60, 80);
  camera.lookAt(0, 0, 0);
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    alpha: true
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  
  document.getElementById('canvas-container').appendChild(renderer.domElement);
  
  // Clock for delta time
  clock = new THREE.Clock();
  
  // Stats panel (FPS counter)
  stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb
  stats.dom.style.position = 'fixed';
  stats.dom.style.bottom = '20px';
  stats.dom.style.right = '20px';
  stats.dom.style.top = 'auto';
  stats.dom.style.left = 'auto';
  document.body.appendChild(stats.dom);
  
  // Handle resize
  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================
// Initialization
// ============================================
async function init() {
  console.log('ðŸŒ Initializing Bay Area Air Quality Simulator...');
  
  // Initialize Three.js
  initThree();
  
  // Initialize sky system (must be before map for proper lighting)
  initSky(scene);
  setTimeOfDay(settings.timeOfDay, scene, settings.brightness);
  
  // Initialize modules in order
  const mapData = initMap(scene);
  initControls(camera, renderer.domElement);
  initTraffic(mapData, settings);
  const polluters = initPolluters(mapData);
  initOrchestrator(scene, mapData, polluters, settings);
  
  // Initialize HUD with callbacks
  initHUD(settings, {
    onChangeSettings: (newSettings) => {
      Object.assign(settings, newSettings);
      // Update sky if time or brightness changed
      if ('timeOfDay' in newSettings || 'brightness' in newSettings) {
        setTimeOfDay(settings.timeOfDay, scene, settings.brightness);
      }
    },
    onReset: () => {
      resetOrchestrator();
      appState.simTime = 0;
    },
    onPauseToggle: () => {
      appState.paused = !appState.paused;
      setPaused(appState.paused);
    }
  });
  
  console.log('âœ… Initialization complete. Starting simulation...');
  
  // Start animation loop
  animate();
}

// ============================================
// Animation Loop
// ============================================
function animate() {
  requestAnimationFrame(animate);
  
  stats.begin();
  
  const dt = clock.getDelta();
  
  // Update controls
  updateControls(dt);
  
  // Auto time progression
  if (settings.autoTime && !appState.paused) {
    settings.timeOfDay += dt * settings.autoTimeSpeed;
    if (settings.timeOfDay >= 24) {
      settings.timeOfDay -= 24;
    }
    setTimeOfDay(settings.timeOfDay, scene, settings.brightness);
  }
  
  // Update sky
  updateSky(dt, settings.timeOfDay);
  
  // Step simulation if not paused
  if (!appState.paused) {
    const simDt = dt * settings.timeScale;
    appState.simTime += simDt;
    stepOrchestrator(simDt, settings);
  }
  
  // Update HUD
  updateHUD({
    particleCount: getParticleCount(),
    simTime: appState.simTime,
    paused: appState.paused,
    timeOfDay: settings.timeOfDay,
    timeLabel: getTimeLabel(settings.timeOfDay)
  });
  
  // Render
  renderer.render(scene, camera);
  
  stats.end();
  
  appState.frameCount++;
}

// ============================================
// Start Application
// ============================================
init().catch(err => {
  console.error('Failed to initialize:', err);
});

// Export for debugging
window.appState = appState;
window.settings = settings;