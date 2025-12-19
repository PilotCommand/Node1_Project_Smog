/**
 * main.js ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Bootstrap + render loop
 * 
 * Creates the Three.js core and wires all modules together.
 * Uses fixed timestep from TimeManager for deterministic simulation.
 * 
 * RENDER LOOP PATTERN:
 * 1. Get real delta time from clock
 * 2. TimeManager.update() returns number of fixed steps to run
 * 3. Run simulation N times with fixed dt (frame-rate independent)
 * 4. Render once per frame (can interpolate for smoothness)
 */

import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { initMap, disposeMap, getTerrainMesh, createHighwayRibbons, getLandmarkMeshes, setHoveredLandmark } from './map.js';
import { initControls, updateControls } from './controls.js';
import { initHUD, updateHUD } from './hud.js';
import { initPolluters } from './polluters.js';
import { initTraffic } from './traffic.js';
import { initOrchestrator, stepOrchestrator, resetOrchestrator, setPaused, getParticleCount, getParticles } from './orchestrator.js';
import { TimeManager, initSky, setTimeOfDay, updateSky, getTimeLabel } from './chronograph.js';
import { initContours, toggleContours, areContoursVisible } from './contours.js';
import { initCounties, updatePollutionFromParticles, toggleCounties as toggleCountyRegions, areCountiesVisible } from './county.js';

// ============================================
// Global App State
// ============================================
export const appState = {
  paused: false,
  contoursInitialized: false,
  highwaysInitialized: false,
  countiesInitialized: false
};

export const settings = {
  // Wind / Transport
  windDirection: 120,    // degrees (0 = North, 90 = East, etc.)
  windSpeed: 4.0,        // m/s
  turbulence: 0.3,       // 0-1 mixing strength
  
  // Emissions
  emissionRate: 0.2,     // multiplier
  
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
  timeScale: 1.0,        // simulation speed multiplier
  
  // Contours
  showContours: false
};

// ============================================
// Three.js Core
// ============================================
let scene, camera, renderer;
let clock;
let stats;
let raycaster, mouse;
let isMouseOverCanvas = false;

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
  
  // Raycaster for hover detection
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  
  // Mouse move listener for landmark hover
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mouseenter', () => { isMouseOverCanvas = true; });
  renderer.domElement.addEventListener('mouseleave', () => { 
    isMouseOverCanvas = false;
    setHoveredLandmark(null);
  });
}

/**
 * Handle mouse movement for landmark hover detection
 */
function onMouseMove(event) {
  // Calculate normalized device coordinates (-1 to +1)
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

/**
 * Check if mouse is hovering over a landmark and show/hide labels
 */
function checkLandmarkHover() {
  if (!isMouseOverCanvas) {
    return;
  }
  
  // Update raycaster with camera and mouse position
  raycaster.setFromCamera(mouse, camera);
  
  // Get landmark meshes
  const landmarks = getLandmarkMeshes();
  if (!landmarks || landmarks.length === 0) {
    return;
  }
  
  // Collect all meshes from landmark groups for intersection
  const meshesToTest = [];
  landmarks.forEach(group => {
    group.traverse(child => {
      if (child.isMesh && child.userData.type !== 'label') {
        child.userData.parentLandmark = group;
        meshesToTest.push(child);
      }
    });
  });
  
  // Perform raycast
  const intersects = raycaster.intersectObjects(meshesToTest, false);
  
  if (intersects.length > 0) {
    // Find the parent landmark group
    const hitMesh = intersects[0].object;
    const landmarkGroup = hitMesh.userData.parentLandmark;
    
    if (landmarkGroup) {
      setHoveredLandmark(landmarkGroup);
      document.body.style.cursor = 'pointer';
    }
  } else {
    setHoveredLandmark(null);
    document.body.style.cursor = 'default';
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================
// Contour Initialization (waits for terrain)
// ============================================
function tryInitContours() {
  const terrain = getTerrainMesh();
  if (terrain && !appState.contoursInitialized) {
    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬â€Ã‚ÂºÃƒÂ¯Ã‚Â¸Ã‚Â Terrain ready, initializing contours...');
    initContours(terrain, scene);
    appState.contoursInitialized = true;
    
    // Show contours if setting is enabled
    if (settings.showContours) {
      toggleContours();
    }
  }
}

// ============================================
// Highway Initialization (waits for terrain)
// ============================================
function tryInitHighways() {
  const terrain = getTerrainMesh();
  if (terrain && !appState.highwaysInitialized) {
    console.log('Ã°Å¸â€ºÂ£Ã¯Â¸Â Terrain ready, initializing highways...');
    createHighwayRibbons(scene);
    appState.highwaysInitialized = true;
  }
}

// ============================================
// County Initialization (can init immediately)
// ============================================
function tryInitCounties() {
  if (!appState.countiesInitialized) {
    initCounties(scene);
    appState.countiesInitialized = true;
  }
}

// ============================================
// Initialization
// ============================================
async function init() {
  console.log('ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â Initializing Bay Area Air Quality Simulator...');
  
  // Initialize Three.js
  initThree();
  
  // Initialize TimeManager (fixed timestep system)
  TimeManager.init();
  TimeManager.setTimeScale(settings.timeScale);
  
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
      
      // Update time scale if changed
      if ('timeScale' in newSettings) {
        TimeManager.setTimeScale(newSettings.timeScale);
      }
      
      // Update sky if time or brightness changed
      if ('timeOfDay' in newSettings || 'brightness' in newSettings) {
        setTimeOfDay(settings.timeOfDay, scene, settings.brightness);
      }
      
      // Handle contour toggle
      if ('showContours' in newSettings) {
        if (appState.contoursInitialized) {
          const isVisible = areContoursVisible();
          if (newSettings.showContours !== isVisible) {
            toggleContours();
          }
        }
      }
    },
    onReset: () => {
      resetOrchestrator();
      TimeManager.reset();
    },
    onPauseToggle: () => {
      appState.paused = !appState.paused;
      TimeManager.setPaused(appState.paused);
      setPaused(appState.paused);
    },
    onToggleContours: () => {
      if (appState.contoursInitialized) {
        settings.showContours = toggleContours();
      } else {
        console.log('Contours not yet initialized (terrain still loading)');
      }
    }
  });
  
  console.log('ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Initialization complete. Starting simulation...');
  
  // Start animation loop
  animate();
}

// ============================================
// Animation Loop (Fixed Timestep)
// ============================================
function animate() {
  requestAnimationFrame(animate);
  
  stats.begin();
  
  // Get real elapsed time since last frame
  const realDeltaTime = clock.getDelta();
  
  // Update controls (uses real time for smooth camera movement)
  updateControls(realDeltaTime);
  
  // Try to initialize contours if terrain is ready
  if (!appState.contoursInitialized) {
    tryInitContours();
  }
  
  // Try to initialize highway ribbons if terrain is ready
  if (!appState.highwaysInitialized) {
    tryInitHighways();
  }
  
  // Try to initialize county regions
  if (!appState.countiesInitialized) {
    tryInitCounties();
  }
  
  // ============================================
  // FIXED TIMESTEP SIMULATION
  // ============================================
  // TimeManager returns how many fixed steps to run this frame
  // This makes simulation deterministic regardless of frame rate
  const steps = TimeManager.update(realDeltaTime);
  const fixedDt = TimeManager.getDt();
  
  // Run simulation steps (may be 0, 1, 2, or more depending on frame rate)
  for (let i = 0; i < steps; i++) {
    // Auto time progression (uses fixed dt for consistency)
    if (settings.autoTime && !appState.paused) {
      settings.timeOfDay += fixedDt * settings.autoTimeSpeed;
      if (settings.timeOfDay >= 24) {
        settings.timeOfDay -= 24;
      }
    }
    
    // Step the particle simulation with fixed dt
    stepOrchestrator(fixedDt, settings);
  }
  
  // ============================================
  // VISUAL UPDATES (once per frame)
  // ============================================
  // These can use real delta time or be frame-based
  
  // Check for landmark hover
  checkLandmarkHover();
  
  // Update county pollution levels based on particle positions
  if (appState.countiesInitialized) {
    updatePollutionFromParticles(getParticles());
  }
  
  // Update sky visuals
  if (settings.autoTime && steps > 0) {
    setTimeOfDay(settings.timeOfDay, scene, settings.brightness);
  }
  updateSky(realDeltaTime, settings.timeOfDay);
  
  // Update HUD
  updateHUD({
    particleCount: getParticleCount(),
    simTime: TimeManager.getTime(),
    paused: appState.paused,
    timeOfDay: settings.timeOfDay,
    timeLabel: getTimeLabel(settings.timeOfDay),
    contoursVisible: areContoursVisible(),
    fps: TimeManager.getStats().fps
  });
  
  // Render
  renderer.render(scene, camera);
  
  stats.end();
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
window.TimeManager = TimeManager;
window.toggleContours = toggleContours;
window.toggleCounties = toggleCountyRegions;