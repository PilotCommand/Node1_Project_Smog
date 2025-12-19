/**
 * hud.js - UI overlay (HTML)
 * 
 * Provides user controls and feedback without touching simulation internals.
 * Owns: HTML overlay, event listeners, sliders/toggles
 */

let callbacks = {};
let elements = {};

// ============================================
// Initialization
// ============================================

export function initHUD(settings, cbs) {
  console.log('Initializing HUD...');
  
  callbacks = cbs;
  
  // Cache DOM elements
  elements = {
    // Time of day
    timeOfDay: document.getElementById('time-of-day'),
    timeValue: document.getElementById('time-value'),
    toggleAutoTime: document.getElementById('toggle-auto-time'),
    autoTimeSpeed: document.getElementById('auto-time-speed'),
    autoSpeedValue: document.getElementById('auto-speed-value'),
    autoSpeedGroup: document.getElementById('auto-speed-group'),
    
    // Brightness
    brightness: document.getElementById('brightness'),
    brightnessValue: document.getElementById('brightness-value'),
    
    // Sliders
    windDirection: document.getElementById('wind-direction'),
    windSpeed: document.getElementById('wind-speed'),
    turbulence: document.getElementById('turbulence'),
    emissionRate: document.getElementById('emission-rate'),
    
    // Value displays
    windDirValue: document.getElementById('wind-dir-value'),
    windSpeedValue: document.getElementById('wind-speed-value'),
    turbulenceValue: document.getElementById('turbulence-value'),
    emissionRateValue: document.getElementById('emission-rate-value'),
    
    // Toggles
    togglePM25: document.getElementById('toggle-pm25'),
    toggleVOC: document.getElementById('toggle-voc'),
    toggleOzone: document.getElementById('toggle-ozone'),
    toggleCounties: document.getElementById('toggle-counties'),
    
    // Buttons
    btnPause: document.getElementById('btn-pause'),
    btnReset: document.getElementById('btn-reset'),
    
    // Stats
    particleCount: document.getElementById('particle-count'),
    simTime: document.getElementById('sim-time')
  };
  
  // Set initial values from settings
  syncFromSettings(settings);
  
  // Attach event listeners
  attachListeners(settings);
}

// ============================================
// Sync UI from settings
// ============================================

function syncFromSettings(settings) {
  // Time of day
  if (elements.timeOfDay) {
    elements.timeOfDay.value = settings.timeOfDay;
    elements.timeValue.textContent = formatTimeOfDay(settings.timeOfDay);
  }
  
  if (elements.toggleAutoTime) {
    elements.toggleAutoTime.classList.toggle('active', settings.autoTime);
  }
  
  if (elements.autoTimeSpeed) {
    elements.autoTimeSpeed.value = settings.autoTimeSpeed;
    elements.autoSpeedValue.textContent = `${settings.autoTimeSpeed.toFixed(1)} hr/s`;
    elements.autoTimeSpeed.disabled = !settings.autoTime;
    elements.autoSpeedGroup.style.opacity = settings.autoTime ? '1' : '0.5';
  }
  
  if (elements.brightness) {
    elements.brightness.value = settings.brightness;
    elements.brightnessValue.textContent = `${Math.round(settings.brightness * 100)}%`;
  }
  
  if (elements.windDirection) {
    elements.windDirection.value = settings.windDirection;
    elements.windDirValue.textContent = `${settings.windDirection}°`;
  }
  
  if (elements.windSpeed) {
    elements.windSpeed.value = settings.windSpeed;
    elements.windSpeedValue.textContent = `${settings.windSpeed.toFixed(1)} m/s`;
  }
  
  if (elements.turbulence) {
    elements.turbulence.value = settings.turbulence;
    elements.turbulenceValue.textContent = settings.turbulence.toFixed(2);
  }
  
  if (elements.emissionRate) {
    elements.emissionRate.value = settings.emissionRate;
    elements.emissionRateValue.textContent = `${settings.emissionRate.toFixed(1)}x`;
  }
  
  // Toggles
  if (elements.togglePM25) {
    elements.togglePM25.classList.toggle('active', settings.enablePM25);
  }
  if (elements.toggleVOC) {
    elements.toggleVOC.classList.toggle('active', settings.enableVOC);
  }
  if (elements.toggleOzone) {
    elements.toggleOzone.classList.toggle('active', settings.enableOzone);
  }
  if (elements.toggleCounties) {
    elements.toggleCounties.classList.toggle('active', settings.showCounties !== false);
  }
}

// ============================================
// Event Listeners
// ============================================

function attachListeners(settings) {
  // Time of Day
  elements.timeOfDay?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    elements.timeValue.textContent = formatTimeOfDay(value);
    callbacks.onChangeSettings?.({ timeOfDay: value });
  });
  
  // Auto Time Toggle
  elements.toggleAutoTime?.addEventListener('click', () => {
    elements.toggleAutoTime.classList.toggle('active');
    const enabled = elements.toggleAutoTime.classList.contains('active');
    elements.autoTimeSpeed.disabled = !enabled;
    elements.autoSpeedGroup.style.opacity = enabled ? '1' : '0.5';
    callbacks.onChangeSettings?.({ autoTime: enabled });
  });
  
  // Auto Time Speed
  elements.autoTimeSpeed?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    elements.autoSpeedValue.textContent = `${value.toFixed(1)} hr/s`;
    callbacks.onChangeSettings?.({ autoTimeSpeed: value });
  });
  
  // Brightness
  elements.brightness?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    elements.brightnessValue.textContent = `${Math.round(value * 100)}%`;
    callbacks.onChangeSettings?.({ brightness: value });
  });
  
  // Time Preset Buttons
  document.querySelectorAll('.time-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const time = parseFloat(btn.dataset.time);
      elements.timeOfDay.value = time;
      elements.timeValue.textContent = formatTimeOfDay(time);
      callbacks.onChangeSettings?.({ timeOfDay: time });
    });
  });
  
  // Wind Direction
  elements.windDirection?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    elements.windDirValue.textContent = `${value}°`;
    callbacks.onChangeSettings?.({ windDirection: value });
  });
  
  // Wind Speed
  elements.windSpeed?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    elements.windSpeedValue.textContent = `${value.toFixed(1)} m/s`;
    callbacks.onChangeSettings?.({ windSpeed: value });
  });
  
  // Turbulence
  elements.turbulence?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    elements.turbulenceValue.textContent = value.toFixed(2);
    callbacks.onChangeSettings?.({ turbulence: value });
  });
  
  // Emission Rate
  elements.emissionRate?.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    elements.emissionRateValue.textContent = `${value.toFixed(1)}x`;
    callbacks.onChangeSettings?.({ emissionRate: value });
  });
  
  // Pollutant Toggles
  elements.togglePM25?.addEventListener('click', () => {
    elements.togglePM25.classList.toggle('active');
    const enabled = elements.togglePM25.classList.contains('active');
    callbacks.onChangeSettings?.({ enablePM25: enabled });
  });
  
  elements.toggleVOC?.addEventListener('click', () => {
    elements.toggleVOC.classList.toggle('active');
    const enabled = elements.toggleVOC.classList.contains('active');
    callbacks.onChangeSettings?.({ enableVOC: enabled });
  });
  
  elements.toggleOzone?.addEventListener('click', () => {
    elements.toggleOzone.classList.toggle('active');
    const enabled = elements.toggleOzone.classList.contains('active');
    callbacks.onChangeSettings?.({ enableOzone: enabled });
  });
  
  // County Toggle
  elements.toggleCounties?.addEventListener('click', () => {
    elements.toggleCounties.classList.toggle('active');
    const enabled = elements.toggleCounties.classList.contains('active');
    callbacks.onToggleCounties?.();
  });
  
  // Pause Button
  elements.btnPause?.addEventListener('click', () => {
    callbacks.onPauseToggle?.();
  });
  
  // Reset Button
  elements.btnReset?.addEventListener('click', () => {
    callbacks.onReset?.();
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; // Don't capture when typing
    
    switch (e.key.toLowerCase()) {
      case ' ':
        e.preventDefault();
        callbacks.onPauseToggle?.();
        break;
      case 'r':
        callbacks.onReset?.();
        break;
    }
  });
}

// ============================================
// Update HUD (called each frame)
// ============================================

export function updateHUD(state) {
  // Particle count
  if (elements.particleCount) {
    elements.particleCount.textContent = formatNumber(state.particleCount);
  }
  
  // Simulation time (format as MM:SS)
  if (elements.simTime) {
    const totalSeconds = Math.floor(state.simTime);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    elements.simTime.textContent = 
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  // Pause button text
  if (elements.btnPause) {
    elements.btnPause.textContent = state.paused ? 'Resume' : 'Pause';
  }
  
  // Time of day (update when auto-cycling)
  if (state.timeOfDay !== undefined && elements.timeOfDay) {
    elements.timeOfDay.value = state.timeOfDay;
    elements.timeValue.textContent = state.timeLabel || formatTimeOfDay(state.timeOfDay);
  }
}

// ============================================
// Utility Functions
// ============================================

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatTimeOfDay(hour) {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 || 12;
  return `${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
}

// Direction helper (for display)
export function getWindDirectionLabel(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}