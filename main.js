import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI }              from 'lil-gui';
import { createFish }       from './fish.js';

// Scene, camera, renderer
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 1000);
camera.position.set(0, 2, -15);
camera.lookAt(0, 2, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x66775f);
document.body.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan     = false;
controls.enableDamping = true;
controls.maxPolarAngle = THREE.MathUtils.degToRad(120);
controls.minDistance   = 10;
controls.maxDistance   = 30;
controls.target.set(0, 2, 0);
controls.update();



// Lights
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(1,1,0.25);
const ambLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(dirLight, ambLight);

// Aquarium
const aqWidth  = 20;
const aqHeight = 10;
const aqDepth  = 16;
const aquariumGeo = new THREE.BoxGeometry(aqWidth, aqHeight, aqDepth);
const aquariumMat = new THREE.MeshPhysicalMaterial({
  color:        0x88ccee,
  metalness:    0,
  roughness:    0,
  transmission: 0.6,
  thickness:    0.5,
  side:         THREE.BackSide,
  transparent:  true,
  opacity:      0.5
});
scene.add(new THREE.Mesh(aquariumGeo, aquariumMat));
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(aqWidth, aqDepth),
  aquariumMat.clone()
);
water.rotation.x = -Math.PI/2;
water.position.y = aqHeight/2 - 0.01;
scene.add(water);

// 1) Create a slightly smaller box to represent the water volume
const waterVolumeGeo = new THREE.BoxGeometry(
  aqWidth  - 0.1,   // shrink just a hair to avoid z-fighting
  aqHeight - 0.1,
  aqDepth  - 0.1
);

// 2) Give it a “water” material
const waterVolumeMat = new THREE.MeshPhysicalMaterial({
  color:        0x336688,   // deep blue tint
  metalness:    0,
  roughness:    0,
  transmission: 0.8,        // strong refraction
  thickness:    2,          // gives it some internal volume
  transparent:  true,
  opacity:      0.6,        // adjust how murky vs. clear
  side:         THREE.FrontSide
});

// 3) Put the box inside the tank
const waterVolume = new THREE.Mesh(waterVolumeGeo, waterVolumeMat);
scene.add(waterVolume);

// — optional: add underwater “fog” for depth attenuation — 
//    this will tint everything below the water surface
scene.fog = new THREE.FogExp2(0x336688, 0.02);
renderer.setClearColor(scene.fog.color);

// Motion bounds (inset from walls)
const margin = 2;
const halfX  = aqWidth/2  - margin;
const halfY  = aqHeight/2 - margin;
const halfZ  = aqDepth/2  - margin;

// Fish management
let targets  = [];
let fishData = [];

// GUI parameters
const params = {
  fishCount: 5,
  fishColor: '#ff8800',
  fishSpeed: 2,
  turnSpeed: 1.5,
  separationDist: 1.0,
  separationStrength: 2.0
};

// GUI setup
const gui = new GUI();
gui.add(params, 'fishCount', 0, 50, 1).name('Number of Fish').onChange(updateFishCount);
gui.addColor(params, 'fishColor').name('Fish Color').onChange(color => {
  fishData.forEach(({ material }) => material.color.set(color));
});
gui.add(params, 'fishSpeed', 0.1, 10, 0.1).name('Fish Speed');
gui.add(params, 'turnSpeed', 0.1, 5, 0.1).name('Turn Responsiveness');
gui.add(params, 'separationDist', 0.1, 5, 0.1).name('Separation Distance');
gui.add(params, 'separationStrength', 0.1, 5, 0.1).name('Separation Strength');

// Helpers
const forward = new THREE.Vector3(-1,0,0);
const dir     = new THREE.Vector3();
const clock   = new THREE.Clock();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Initialize fish
updateFishCount(params.fishCount);

function pickNewTarget(i) {
  targets[i] = new THREE.Vector3(
    THREE.MathUtils.randFloat(-halfX, halfX),
    THREE.MathUtils.randFloat(-halfY, halfY),
    THREE.MathUtils.randFloat(-halfZ, halfZ)
  );
}

function updateFishCount(count) {
  // Remove extra fish
  while (fishData.length > count) {
    const { mesh } = fishData.pop();
    scene.remove(mesh);
    targets.pop();
  }
  // Add new fish
  while (fishData.length < count) {
    const { mesh: fish, material: fishMat } = createFish(scene);
    fish.scale.set(0.2, 0.2, 0.2);
    fish.geometry.computeBoundingSphere();
    const radius = fish.geometry.boundingSphere.radius * fish.scale.x;
    const velocity = new THREE.Vector3(1,0,0).multiplyScalar(params.fishSpeed);
    fishMat.color.set(params.fishColor);
    scene.add(fish);
    fishData.push({ mesh: fish, material: fishMat, velocity, radius });
    pickNewTarget(fishData.length - 1);
  }
}

// Animation loop
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();

  // 1) Steering with separation, move & clamp
  fishData.forEach(({ mesh: fish, velocity: vel }, i) => {
    const pos = fish.position;
    // Desired direction toward target
    const desiredDir = dir.subVectors(targets[i], pos).normalize();
    // Separation vector
    const separation = new THREE.Vector3();
    fishData.forEach(({ mesh: otherFish }, j) => {
      if (i === j) return;
      const offset = new THREE.Vector3().subVectors(pos, otherFish.position);
      const dist = offset.length();
      if (dist < params.separationDist && dist > 0) {
        separation.add(offset.normalize().divideScalar(dist));
      }
    });
    separation.normalize().multiplyScalar(params.separationStrength);
    // Combine: desired + separation
    const steerDir = new THREE.Vector3().addVectors(desiredDir, separation).normalize();
    // Smooth steering
    vel.normalize()
       .lerp(steerDir, params.turnSpeed * delta)
       .normalize()
       .multiplyScalar(params.fishSpeed);
    // Move and clamp
    pos.addScaledVector(vel, delta);
    pos.x = THREE.MathUtils.clamp(pos.x, -halfX, halfX);
    pos.y = THREE.MathUtils.clamp(pos.y, -halfY, halfY);
    pos.z = THREE.MathUtils.clamp(pos.z, -halfZ, halfZ);
    // New target
    if (pos.distanceToSquared(targets[i]) < 0.25) pickNewTarget(i);
  });

  // 2) Orient & wiggle
  fishData.forEach(({ mesh: fish, material: fishMat, velocity: vel }) => {
    const dirNorm = vel.clone().normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(forward, dirNorm);
    fish.quaternion.slerp(quat, 0.1);
    fishMat.userData.uniforms.time.value += clock.getDelta() * 1.5;
  });

  // 3) Render
  controls.update();
  renderer.render(scene, camera);
});


