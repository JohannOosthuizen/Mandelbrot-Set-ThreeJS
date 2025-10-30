// Import Three.js from a CDN
import * as THREE from 'https://unpkg.com/three/build/three.module.js';

// --- SHADER CODE -----------------------------------

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// ** MODIFIED FRAGMENT SHADER **
// Now uses u_reveal_progress to "build" the set
const fragmentShader = `
  precision highp float; 

  uniform vec2 u_resolution;
  uniform float u_zoom;
  uniform vec2 u_offset;
  uniform int u_color_theme; 
  uniform int u_max_iterations; 
  uniform float u_reveal_progress; // <-- NEW: 0.0 to 1.0

  vec3 hsv_to_rgb(float h, float s, float v) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(vec3(h) + K.xyz) * 6.0 - K.www);
    return v * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), s);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
    uv.x *= u_resolution.x / u_resolution.y; 
    vec2 c = (uv / u_zoom) + u_offset;
    vec2 z = vec2(0.0);
    int i; 

    // NEW: Calculate the iteration limit for this frame
    int iter_limit = int(floor(u_reveal_progress * float(u_max_iterations)));
    iter_limit = max(1, iter_limit); // Ensure it's at least 1

    for(i = 0; i < iter_limit; i++) { // <-- Use new limit
      float x = (z.x * z.x - z.y * z.y) + c.x;
      float y = (2.0 * z.x * z.y) + c.y;
      z = vec2(x, y);
      if(length(z) > 2.0) {
        break; 
      }
    }

    if(i == iter_limit) { // <-- Check against new limit
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Black
    } else {
        float t = float(i) / float(iter_limit); // <-- Normalize by new limit
        if (u_color_theme == 0) {
            gl_FragColor = vec4(hsv_to_rgb(t, 1.0, 1.0), 1.0);
        } else if (u_color_theme == 1) {
            gl_FragColor = vec4(t, t, t, 1.0);
        } else if (u_color_theme == 2) {
            float r = sin(t * 10.0 + 0.5) * 0.5 + 0.5;
            float g = sin(t * 15.0 + 1.0) * 0.5 + 0.5;
            float b = sin(t * 20.0 + 1.5) * 0.5 + 0.5;
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    }
  }
`;

// --- GLOBAL STATE ----------------------------------
let isDragging = false;
let isAutoZooming = false; 
let lastMouse = new THREE.Vector2();

let isExploring = false;
let currentTourStop = 0;
let currentTourFrame = 0;
const tourWaypoints = [
    { name: "Seahorse Valley", offset: new THREE.Vector2(-0.745, 0.1), startZoom: 20.0, durationFrames: 400 },
    { name: "Elephant Valley", offset: new THREE.Vector2(0.275, 0.008), startZoom: 20.0, durationFrames: 400 },
    { name: "Triple Spiral", offset: new THREE.Vector2(-0.088, 0.655), startZoom: 30.0, durationFrames: 400 }
];

const zoomSpeeds = [
    { name: 'Slow', value: 1.0005 },
    { name: 'Normal', value: 1.005 }, 
    { name: 'Fast', value: 1.01 }
];
let currentSpeedIndex = 1; 
let zoomSpeed = zoomSpeeds[currentSpeedIndex].value;

let isBuilding = false; // <-- NEW state for build animation

// --- THREE.JS SETUP ------------------------------
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement; 

// ** MODIFIED UNIFORMS **
const uniforms = {
  u_resolution: { 
    value: new THREE.Vector2(window.innerWidth, window.innerHeight) 
  },
  u_zoom: { value: 1.0 },
  u_offset: { value: new THREE.Vector2(-0.5, 0.0) },
  u_color_theme: { value: 0 },
  u_max_iterations: { value: 150 },
  u_reveal_progress: { value: 1.0 } // <-- NEW uniform, start at 1.0 (fully revealed)
};

// Create geometry and material
const geometry = new THREE.PlaneGeometry(2, 2);
const material = new THREE.ShaderMaterial({
  uniforms: uniforms,
  vertexShader: vertexShader,
  fragmentShader: fragmentShader
});

const plane = new THREE.Mesh(geometry, material);
scene.add(plane);
camera.position.z = 1;

// --- INTERACTIVITY -----------------------------------

// (Helper function: screenToComplex - no change)
function screenToComplex(x, y) {
  const uv = new THREE.Vector2(
    (x / window.innerWidth) * 2.0 - 1.0,
    (y / window.innerHeight) * -2.0 + 1.0 
  );
  uv.x *= uniforms.u_resolution.value.x / uniforms.u_resolution.value.y;
  return new THREE.Vector2(
    (uv.x / uniforms.u_zoom.value) + uniforms.u_offset.value.x,
    (uv.y / uniforms.u_zoom.value) + uniforms.u_offset.value.y
  );
}

// ** MODIFIED MOUSE/WHEEL HANDLERS **
// (Now stop all auto-modes and set reveal to 1.0)

canvas.addEventListener('mousedown', (e) => {
  isAutoZooming = false; 
  isExploring = false;
  isBuilding = false; // <-- Stop build
  uniforms.u_reveal_progress.value = 1.0; // <-- Show full set
  isDragging = true;
  lastMouse.set(e.clientX, e.clientY);
});
canvas.addEventListener('mouseup', () => {
  isDragging = false;
});
canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const currentMouse = new THREE.Vector2(e.clientX, e.clientY);
  const complexPosNow = screenToComplex(currentMouse.x, currentMouse.y);
  const complexPosLast = screenToComplex(lastMouse.x, lastMouse.y);
  const delta = complexPosNow.clone().sub(complexPosLast);
  uniforms.u_offset.value.sub(delta);
  lastMouse.copy(currentMouse);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); 
  isAutoZooming = false; 
  isExploring = false;
  isBuilding = false; // <-- Stop build
  uniforms.u_reveal_progress.value = 1.0; // <-- Show full set
  
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9; 
  const oldZoom = uniforms.u_zoom.value;
  const newZoom = oldZoom * zoomFactor;
  const mouseComplex = screenToComplex(e.clientX, e.clientY);
  const oldOffset = uniforms.u_offset.value.clone();
  const newOffset = mouseComplex.clone().sub(
    mouseComplex.clone().sub(oldOffset).divideScalar(zoomFactor)
  );
  uniforms.u_zoom.value = newZoom;
  uniforms.u_offset.value.copy(newOffset);
});

// ** 3. NEW & MODIFIED BUTTON LISTENERS **
const btnSpeed = document.getElementById('btn-speed'); 

// NEW: Build the Set
document.getElementById('btn-build').addEventListener('click', () => {
    // Stop other animations
    isAutoZooming = false;
    isExploring = false;
    
    // Reset view
    uniforms.u_zoom.value = 1.0;
    uniforms.u_offset.value.set(-0.5, 0.0);
    
    // Start build animation
    uniforms.u_reveal_progress.value = 0.0; // Start from 0
    isBuilding = true;
});

// Exploration Tour (now cancels build)
document.getElementById('btn-tour').addEventListener('click', () => {
    isAutoZooming = false;
    isBuilding = false;
    uniforms.u_reveal_progress.value = 1.0;
    
    isExploring = true;
    currentTourStop = 0;
    currentTourFrame = 0;
    
    let firstStop = tourWaypoints[0];
    uniforms.u_offset.value.copy(firstStop.offset);
    uniforms.u_zoom.value = firstStop.startZoom;
});

// Preset Zoom Locations (now cancel build)
document.getElementById('btn-zoom').addEventListener('click', () => {
    isExploring = false;
    isBuilding = false;
    uniforms.u_reveal_progress.value = 1.0;
    
    uniforms.u_offset.value.set(-0.745, 0.1);
    uniforms.u_zoom.value = 20.0;
    isAutoZooming = true;
});

document.getElementById('btn-elephant').addEventListener('click', () => {
    isExploring = false;
    isBuilding = false;
    uniforms.u_reveal_progress.value = 1.0;
    
    uniforms.u_offset.value.set(0.275, 0.008);
    uniforms.u_zoom.value = 20.0; 
    isAutoZooming = true;
});

document.getElementById('btn-spiral').addEventListener('click', () => {
    isExploring = false;
    isBuilding = false;
    uniforms.u_reveal_progress.value = 1.0;
    
    uniforms.u_offset.value.set(-0.088, 0.655);
    uniforms.u_zoom.value = 30.0; 
    isAutoZooming = true;
});

// Speed Control (no changes)
btnSpeed.addEventListener('click', () => {
    currentSpeedIndex = (currentSpeedIndex + 1) % zoomSpeeds.length;
    let newSpeed = zoomSpeeds[currentSpeedIndex];
    zoomSpeed = newSpeed.value;
    btnSpeed.textContent = `Zoom Speed: ${newSpeed.name}`;
});

// Reset (now cancels build)
document.getElementById('btn-reset').addEventListener('click', () => {
    isAutoZooming = false;
    isExploring = false;
    isBuilding = false;
    uniforms.u_reveal_progress.value = 1.0;
    
    uniforms.u_zoom.value = 1.0;
    uniforms.u_offset.value.set(-0.5, 0.0);
});

// Color Themes (no changes)
document.getElementById('btn-color1').addEventListener('click', () => {
    uniforms.u_color_theme.value = 0;
});
document.getElementById('btn-color2').addEventListener('click', () => {
    uniforms.u_color_theme.value = 1;
});
document.getElementById('btn-color3').addEventListener('click', () => {
    uniforms.u_color_theme.value = 2;
});

// (Window Resize listener - no change)
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);
  camera.left = -1;
  camera.right = 1;
  camera.top = 1;
  camera.bottom = -1;
  camera.updateProjectionMatrix();
});

// ** MODIFIED RENDER LOOP **
function animate() {
  requestAnimationFrame(animate);
  
  // NEW: Handle build animation
  if (isBuilding) {
      if (uniforms.u_reveal_progress.value < 1.0) {
          uniforms.u_reveal_progress.value += 0.001; // This controls the build speed
      } else {
          uniforms.u_reveal_progress.value = 1.0;
          isBuilding = false; // Animation finished
      }
  }

  // (Auto-zoom logic)
  if (isAutoZooming) {
    uniforms.u_zoom.value *= zoomSpeed;
  }
  
  // (Exploration logic)
  if (isExploring) {
      const normalSpeed = zoomSpeeds[1].value; 
      uniforms.u_zoom.value *= normalSpeed;
      currentTourFrame++;

      if (currentTourFrame >= tourWaypoints[currentTourStop].durationFrames) {
          currentTourStop++;
          if (currentTourStop >= tourWaypoints.length) {
              isExploring = false;
              uniforms.u_offset.value.set(-0.5, 0.0);
              uniforms.u_zoom.value = 1.0;
          } else {
              currentTourFrame = 0;
              let nextStop = tourWaypoints[currentTourStop];
              uniforms.u_offset.value.copy(nextStop.offset);
              uniforms.u_zoom.value = nextStop.startZoom;
          }
      }
  }

  // Dynamically update max iterations based on zoom
  let base_iter = 150.0;
  let zoom_iter = Math.max(0.0, Math.log(uniforms.u_zoom.value) * 50.0);
  uniforms.u_max_iterations.value = Math.floor(base_iter + zoom_iter);

  renderer.render(scene, camera);
}
animate();