// Import Three.js from a CDN
import * as THREE from 'https://unpkg.com/three/build/three.module.js';

// --- SHADER CODE -----------------------------------

const vertexShader = `
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

// ** MODIFIED FRAGMENT SHADER **
// This is now two shaders in one, controlled by "u_is_deep_zoom"
const fragmentShader = `
  precision highp float; 

  // --- UNIFORMS ---
  uniform vec2 u_resolution;
  uniform int u_color_theme; 
  uniform int u_max_iterations; 
  uniform float u_reveal_progress;

  // Simple (32-bit) uniforms
  uniform float u_zoom;
  uniform vec2 u_offset;

  // Deep Zoom (64-bit emulated) uniforms
  uniform bool u_is_deep_zoom;
  uniform vec2 u_center_hi; // High 32 bits of center coord
  uniform vec2 u_center_lo; // Low 32 bits of center coord
  uniform float u_scale_hi;  // High 32 bits of scale
  uniform float u_scale_lo;  // Low 32 bits of scale

  // --- 64-BIT (DOUBLE-DOUBLE) MATH LIBRARY ---
  // (We use vec2 to store one 64-bit number: x=high, y=low)

  vec2 dd_add(vec2 a, vec2 b) {
    float t1 = a.x + b.x;
    float e = t1 - a.x;
    float t2 = ((b.x - e) + (a.x - (t1 - e))) + a.y + b.y;
    return vec2(t1 + t2, t2 - (t1 + t2 - t1));
  }

  vec2 dd_sub(vec2 a, vec2 b) {
    float t1 = a.x - b.x;
    float e = t1 - a.x;
    float t2 = ((-b.x - e) + (a.x - (t1 - e))) + a.y - b.y;
    return vec2(t1 + t2, t2 - (t1 + t2 - t1));
  }

  vec2 dd_mul(vec2 a, vec2 b) {
    float p1 = a.x * b.x;
    float p2 = a.x * b.y + a.y * b.x;
    float p3 = a.y * b.y;
    float t1 = p1 + p2;
    float e = t1 - p1;
    float t2 = ((p2 - e) + (p1 - (t1 - e))) + p3;
    return vec2(t1 + t2, t2 - (t1 + t2 - t1));
  }

  // Multiply a 64-bit (vec2) by a 32-bit (float)
  vec2 dd_mul_f(vec2 a, float b) {
    float p1 = a.x * b;
    float p2 = a.y * b;
    float t1 = p1 + p2;
    float e = t1 - p1;
    float t2 = (p2 - e) + (p1 - (t1 - e));
    return vec2(t1 + t2, t2 - (t1 + t2 - t1));
  }
  
  // --- COLOR HELPER ---
  vec3 hsv_to_rgb(float h, float s, float v) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(vec3(h) + K.xyz) * 6.0 - K.www);
    return v * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), s);
  }

  // --- MAIN SHADER LOGIC ---
  void main() {
    int iter_limit = int(floor(u_reveal_progress * float(u_max_iterations)));
    iter_limit = max(1, iter_limit);
    
    vec2 c; // The 32-bit coordinate
    int i; // Iteration counter

    if (u_is_deep_zoom) {
        // --- 64-BIT DEEP ZOOM PATH ---
        
        // 1. Calculate high-precision 'c'
        vec2 uv = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
        uv.x *= u_resolution.x / u_resolution.y;

        vec2 scale_dd = vec2(u_scale_hi, u_scale_lo);
        
        // c.x = (uv.x * scale) + center.x
        vec2 cx_dd = dd_add(
            dd_mul_f(scale_dd, uv.x),
            vec2(u_center_hi.x, u_center_lo.x)
        );
        // c.y = (uv.y * scale) + center.y
        vec2 cy_dd = dd_add(
            dd_mul_f(scale_dd, uv.y),
            vec2(u_center_hi.y, u_center_lo.y)
        );

        // 2. Run 64-bit iteration
        vec2 zx_dd = vec2(0.0);
        vec2 zy_dd = vec2(0.0);
        
        for(i = 0; i < iter_limit; i++) {
            // zx_new = (zx*zx - zy*zy) + cx
            // zy_new = (2*zx*zy) + cy
            vec2 zx2 = dd_mul(zx_dd, zx_dd);
            vec2 zy2 = dd_mul(zy_dd, zy_dd);
            vec2 zxzy = dd_mul(zx_dd, zy_dd);
            
            zx_dd = dd_add(dd_sub(zx2, zy2), cx_dd);
            zy_dd = dd_add(dd_mul_f(zxzy, 2.0), cy_dd);

            // 3. Check for escape (using only high bits is fast & good enough)
            float zx = zx_dd.x;
            float zy = zy_dd.x;
            if((zx * zx + zy * zy) > 4.0) {
                break;
            }
        }
    } else {
        // --- 32-BIT FAST PATH (Original) ---
        vec2 uv = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
        uv.x *= u_resolution.x / u_resolution.y; 
        c = (uv / u_zoom) + u_offset;

        vec2 z = vec2(0.0);
        for(i = 0; i < iter_limit; i++) {
            float x = (z.x * z.x - z.y * z.y) + c.x;
            float y = (2.0 * z.x * z.y) + c.y;
            z = vec2(x, y);
            if(length(z) > 4.0) { // Using 4.0 (length^2) is faster
                break;
            }
        }
    }

    // --- COLORING (Same for both paths) ---
    if(i == iter_limit) { 
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Black
    } else {
        float t = float(i) / float(iter_limit); 
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
let isBuilding = false;

const tourWaypoints = [
    { name: "Seahorse Valley", offset: new THREE.Vector2(-0.745, 0.1), startZoom: 20.0, durationFrames: 400 },
    { name: "Elephant Valley", offset: new THREE.Vector2(0.275, 0.008), startZoom: 20.0, durationFrames: 400 },
    { name: "Triple Spiral", offset: new THREE.Vector2(-0.088, 0.655), startZoom: 30.0, durationFrames: 400 }
];
const zoomSpeeds = [
    { name: 'Slow', value: 1.0025 },
    { name: 'Normal', value: 1.005 }, 
    { name: 'Fast', value: 1.01 }
];
let currentSpeedIndex = 1; 
let zoomSpeed = zoomSpeeds[currentSpeedIndex].value;

// --- NEW 64-BIT STATE ---
let isDeepZoom = false;
// Use 64-bit JS 'Number' for high-precision state
let deep_center_x = -0.5;
let deep_center_y = 0.0;
let deep_scale = 1.0; // 1.0 / zoom

// --- THREE.JS SETUP ------------------------------
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement; 

// ** MODIFIED UNIFORMS **
const uniforms = {
  u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  u_color_theme: { value: 0 },
  u_max_iterations: { value: 150 },
  u_reveal_progress: { value: 1.0 },

  // Simple uniforms
  u_zoom: { value: 1.0 },
  u_offset: { value: new THREE.Vector2(-0.5, 0.0) },

  // Deep zoom uniforms
  u_is_deep_zoom: { value: false },
  u_center_hi: { value: new THREE.Vector2(-0.5, 0.0) },
  u_center_lo: { value: new THREE.Vector2(0.0, 0.0) },
  u_scale_hi: { value: 1.0 },
  u_scale_lo: { value: 0.0 }
};

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

// Stop all animations
function stopAllAnimations() {
    isAutoZooming = false;
    isExploring = false;
    isBuilding = false;
    uniforms.u_reveal_progress.value = 1.0;
}

/**
 * Converts screen pixel coordinates to complex plane coordinates.
 * This is for 32-bit mode only.
 */
function screenToComplex_Simple(x, y) {
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

/**
 * Converts screen pixel coordinates to complex plane coordinates
 * using the 64-bit state variables.
 */
function screenToComplex_Deep(x, y) {
  let uv_x = (x / window.innerWidth) * 2.0 - 1.0;
  let uv_y = (y / window.innerHeight) * -2.0 + 1.0; 
  uv_x *= uniforms.u_resolution.value.x / uniforms.u_resolution.value.y;
  
  return {
      x: (uv_x * deep_scale) + deep_center_x,
      y: (uv_y * deep_scale) + deep_center_y
  };
}

// ** MODIFIED MOUSE HANDLERS **

canvas.addEventListener('mousedown', (e) => {
  stopAllAnimations();
  isDragging = true;
  lastMouse.set(e.clientX, e.clientY);
});

canvas.addEventListener('mouseup', () => {
  isDragging = false;
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  
  const currentMouse = new THREE.Vector2(e.clientX, e.clientY);
  
  if (isDeepZoom) {
      const complexPosNow = screenToComplex_Deep(currentMouse.x, currentMouse.y);
      const complexPosLast = screenToComplex_Deep(lastMouse.x, lastMouse.y);
      deep_center_x -= (complexPosNow.x - complexPosLast.x);
      deep_center_y -= (complexPosNow.y - complexPosLast.y);
  } else {
      const complexPosNow = screenToComplex_Simple(currentMouse.x, currentMouse.y);
      const complexPosLast = screenToComplex_Simple(lastMouse.x, lastMouse.y);
      uniforms.u_offset.value.x -= (complexPosNow.x - complexPosLast.x);
      uniforms.u_offset.value.y -= (complexPosNow.y - complexPosLast.y);
  }

  lastMouse.copy(currentMouse);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); 
  stopAllAnimations();
  
  const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1; // 0.9 = zoom in

  if (isDeepZoom) {
      const mouseComplex = screenToComplex_Deep(e.clientX, e.clientY);
      const old_scale = deep_scale;
      const new_scale = old_scale * zoomFactor;

      // new_center = mouse_complex - (mouse_uv * new_scale)
      // mouse_uv = (mouse_complex - old_center) / old_scale
      // new_center = mouse_complex - ((mouse_complex - old_center) * new_scale / old_scale)
      // new_center = mouse_complex - ((mouse_complex - old_center) * zoomFactor)
      
      deep_center_x = mouseComplex.x - (mouseComplex.x - deep_center_x) * zoomFactor;
      deep_center_y = mouseComplex.y - (mouseComplex.y - deep_center_y) * zoomFactor;
      deep_scale = new_scale;

  } else {
      const zoomFactor32 = e.deltaY < 0 ? 1.1 : 0.9; // 1.1 = zoom in
      const oldZoom = uniforms.u_zoom.value;
      const newZoom = oldZoom * zoomFactor32;
      const mouseComplex = screenToComplex_Simple(e.clientX, e.clientY);
      const oldOffset = uniforms.u_offset.value.clone();
      const newOffset = mouseComplex.clone().sub(
        mouseComplex.clone().sub(oldOffset).divideScalar(zoomFactor32)
      );
      uniforms.u_zoom.value = newZoom;
      uniforms.u_offset.value.copy(newOffset);
  }
});

// ** 3. NEW & MODIFIED BUTTON LISTENERS **
const btnSpeed = document.getElementById('btn-speed'); 
const btnDeepZoom = document.getElementById('btn-deep-zoom');

// NEW: Deep Zoom Toggle
btnDeepZoom.addEventListener('click', () => {
    isDeepZoom = !isDeepZoom;
    stopAllAnimations();

    if (isDeepZoom) {
        // Switching TO deep zoom
        btnDeepZoom.textContent = "Deep Zoom: ON";
        // Convert simple 32-bit state to 64-bit state
        deep_center_x = uniforms.u_offset.value.x;
        deep_center_y = uniforms.u_offset.value.y;
        deep_scale = 1.0 / uniforms.u_zoom.value;
    } else {
        // Switching FROM deep zoom
        btnDeepZoom.textContent = "Deep Zoom: OFF";
        // Convert 64-bit state back to 32-bit state
        uniforms.u_offset.value.x = deep_center_x;
        uniforms.u_offset.value.y = deep_center_y;
        uniforms.u_zoom.value = 1.0 / deep_scale;
    }
    uniforms.u_is_deep_zoom.value = isDeepZoom;
});

// Build the Set
document.getElementById('btn-build').addEventListener('click', () => {
    stopAllAnimations();
    // Reset view (works for both modes)
    uniforms.u_zoom.value = 1.0;
    uniforms.u_offset.value.set(-0.5, 0.0);
    deep_center_x = -0.5;
    deep_center_y = 0.0;
    deep_scale = 1.0;
    
    uniforms.u_reveal_progress.value = 0.0; // Start from 0
    isBuilding = true;
});

// All other buttons just call stopAllAnimations()
document.getElementById('btn-tour').addEventListener('click', () => {
    stopAllAnimations();
    isExploring = true;
    currentTourStop = 0;
    currentTourFrame = 0;
    let firstStop = tourWaypoints[0];
    
    // Set both coordinate systems
    uniforms.u_offset.value.copy(firstStop.offset);
    uniforms.u_zoom.value = firstStop.startZoom;
    deep_center_x = firstStop.offset.x;
    deep_center_y = firstStop.offset.y;
    deep_scale = 1.0 / firstStop.startZoom;
});

document.getElementById('btn-zoom').addEventListener('click', () => {
    stopAllAnimations();
    let loc = {x: -0.745, y: 0.1};
    let zoom = 20.0;
    uniforms.u_offset.value.set(loc.x, loc.y);
    uniforms.u_zoom.value = zoom;
    deep_center_x = loc.x;
    deep_center_y = loc.y;
    deep_scale = 1.0 / zoom;
    isAutoZooming = true;
});
// (Repeat for other zoom buttons)
document.getElementById('btn-elephant').addEventListener('click', () => {
    stopAllAnimations();
    let loc = {x: 0.275, y: 0.008};
    let zoom = 20.0;
    uniforms.u_offset.value.set(loc.x, loc.y);
    uniforms.u_zoom.value = zoom;
    deep_center_x = loc.x;
    deep_center_y = loc.y;
    deep_scale = 1.0 / zoom;
    isAutoZooming = true;
});
document.getElementById('btn-spiral').addEventListener('click', () => {
    stopAllAnimations();
    let loc = {x: -0.088, y: 0.655};
    let zoom = 30.0;
    uniforms.u_offset.value.set(loc.x, loc.y);
    uniforms.u_zoom.value = zoom;
    deep_center_x = loc.x;
    deep_center_y = loc.y;
    deep_scale = 1.0 / zoom;
    isAutoZooming = true;
});

// (Speed and Reset)
btnSpeed.addEventListener('click', () => {
    currentSpeedIndex = (currentSpeedIndex + 1) % zoomSpeeds.length;
    let newSpeed = zoomSpeeds[currentSpeedIndex];
    zoomSpeed = newSpeed.value;
    btnSpeed.textContent = `Zoom Speed: ${newSpeed.name}`;
});
document.getElementById('btn-reset').addEventListener('click', () => {
    stopAllAnimations();
    uniforms.u_zoom.value = 1.0;
    uniforms.u_offset.value.set(-0.5, 0.0);
    deep_center_x = -0.5;
    deep_center_y = 0.0;
    deep_scale = 1.0;
});
// (Colors)
document.getElementById('btn-color1').addEventListener('click', () => { uniforms.u_color_theme.value = 0; });
document.getElementById('btn-color2').addEventListener('click', () => { uniforms.u_color_theme.value = 1; });
document.getElementById('btn-color3').addEventListener('click', () => { uniforms.u_color_theme.value = 2; });

// (Window Resize)
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
  
  // Handle build animation
  if (isBuilding) {
      if (uniforms.u_reveal_progress.value < 1.0) {
          uniforms.u_reveal_progress.value += 0.001; 
      } else {
          uniforms.u_reveal_progress.value = 1.0;
          isBuilding = false; 
      }
  }

  // Handle auto-zoom
  if (isAutoZooming) {
    if (isDeepZoom) {
        deep_scale *= (2.0 - zoomSpeed); // (zoomSpeed is 1.005, so this is 0.995)
    } else {
        uniforms.u_zoom.value *= zoomSpeed;
    }
  }
  
  // Handle exploration
  if (isExploring) {
      const normalSpeed = zoomSpeeds[1].value; 
      if (isDeepZoom) {
          deep_scale *= (2.0 - normalSpeed);
      } else {
          uniforms.u_zoom.value *= normalSpeed;
      }
      currentTourFrame++;

      if (currentTourFrame >= tourWaypoints[currentTourStop].durationFrames) {
          currentTourStop++;
          if (currentTourStop >= tourWaypoints.length) {
              isExploring = false;
              // Reset
              uniforms.u_offset.value.set(-0.5, 0.0);
              uniforms.u_zoom.value = 1.0;
              deep_center_x = -0.5;
              deep_center_y = 0.0;
              deep_scale = 1.0;
          } else {
              currentTourFrame = 0;
              let nextStop = tourWaypoints[currentTourStop];
              // Set both states
              uniforms.u_offset.value.copy(nextStop.offset);
              uniforms.u_zoom.value = nextStop.startZoom;
              deep_center_x = nextStop.offset.x;
              deep_center_y = nextStop.offset.y;
              deep_scale = 1.0 / nextStop.startZoom;
          }
      }
  }

  // --- UPDATE UNIFORMS ---
  
  // Dynamically update max iterations
  let current_zoom = isDeepZoom ? (1.0 / deep_scale) : uniforms.u_zoom.value;
  let base_iter = 150.0;
  let zoom_iter = Math.max(0.0, Math.log(current_zoom) * 50.0);
  uniforms.u_max_iterations.value = Math.floor(base_iter + zoom_iter);

  // Update simple uniforms (for 32-bit mode)
  if (!isDeepZoom) {
      uniforms.u_offset.value.x = deep_center_x;
      uniforms.u_offset.value.y = deep_center_y;
      uniforms.u_zoom.value = 1.0 / deep_scale;
  }
  
  // Update deep uniforms (for 64-bit mode)
  // Split 64-bit JS numbers into 32-bit hi/lo for the shader
  uniforms.u_center_hi.value.x = Math.fround(deep_center_x);
  uniforms.u_center_hi.value.y = Math.fround(deep_center_y);
  uniforms.u_center_lo.value.x = deep_center_x - uniforms.u_center_hi.value.x;
  uniforms.u_center_lo.value.y = deep_center_y - uniforms.u_center_hi.value.y;
  
  uniforms.u_scale_hi.value = Math.fround(deep_scale);
  uniforms.u_scale_lo.value = deep_scale - uniforms.u_scale_hi.value;

  renderer.render(scene, camera);
}
animate();