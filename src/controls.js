/**
 * controls.js — Camera control
 * 
 * Handles user navigation of the 3D scene.
 * Owns: OrbitControls, camera constraints
 */

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let controls = null;

// ============================================
// Initialization
// ============================================

export function initControls(camera, domElement) {
  console.log('🎮 Initializing camera controls...');
  
  controls = new OrbitControls(camera, domElement);
  
  // Smooth damping
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  
  // Zoom constraints
  controls.minDistance = 20;
  controls.maxDistance = 200;
  
  // Vertical angle constraints (prevent going underground)
  controls.minPolarAngle = 0.2;           // ~11 degrees from top
  controls.maxPolarAngle = Math.PI / 2.1; // ~86 degrees (nearly horizontal)
  
  // Pan constraints
  controls.enablePan = true;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;
  
  // Rotation
  controls.rotateSpeed = 0.5;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  
  // Target (look at center of bay)
  controls.target.set(0, 0, 0);
  
  // Touch controls
  controls.touches = {
    ONE: 0, // ROTATE
    TWO: 2  // DOLLY_PAN
  };
  
  return controls;
}

// ============================================
// Update (call each frame if damping enabled)
// ============================================

export function updateControls(dt) {
  if (controls) {
    controls.update();
  }
}

// ============================================
// Utility Functions
// ============================================

export function setAutoRotate(enabled, speed = 0.5) {
  if (controls) {
    controls.autoRotate = enabled;
    controls.autoRotateSpeed = speed;
  }
}

export function resetCamera(camera) {
  if (controls) {
    camera.position.set(40, 60, 80);
    controls.target.set(0, 0, 0);
    controls.update();
  }
}

export function focusOnPosition(position, camera) {
  if (controls) {
    controls.target.copy(position);
    controls.update();
  }
}

export function getControls() {
  return controls;
}