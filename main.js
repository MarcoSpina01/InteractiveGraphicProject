import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI }              from 'lil-gui';
import { createFish }       from './fish.js';
import { RGBELoader }       from 'three/examples/jsm/loaders/RGBELoader.js';
import { PMREMGenerator }   from 'three';
import { EffectComposer }   from 'three/examples/jsm/postprocessing/EffectComposer.js';      
import { RenderPass }       from 'three/examples/jsm/postprocessing/RenderPass.js';          

// Scene, camera, renderer
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight , 0.1, 1000);
camera.position.set(0, 2, -15);
camera.lookAt(0, 2, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight );
renderer.setClearColor(0x66775f);

// ⬅– ENABLE SHADOW MAPS
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

document.body.appendChild(renderer.domElement);

// HDR ENVIRONMENT (PMREM + RGBELoader)
const pmremGen = new PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();


new RGBELoader()
  .setDataType(THREE.HalfFloatType)  // <-- UnsignedByteType is more broadly supported than HalfFloatType!
  .load(
    'empty_play_room_4k.hdr',
    (hdrEquirect) => {
      const envMap = pmremGen.fromEquirectangular(hdrEquirect).texture;
      scene.environment = envMap;
      scene.background = envMap;
      waterUniforms.envMap.value = envMap;
      // Apply envMap to every fish as soon as HDR is ready
      fishData.forEach(({ material }) => {
        if (material.userData && material.userData.uniforms) {
            material.userData.uniforms.envMap.value = envMap;
        }
      });
      hdrEquirect.dispose();
      pmremGen.dispose();
    },
    undefined,
    (err) => { console.error('Error loading HDR:', err); }
  );

// Post-processing (Bloom) – OPTIONAL
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);


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
dirLight.position.set(1, 5, 2);
dirLight.castShadow = true;               // ⬅– ADD: light casts shadows
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -10;
dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10;
dirLight.shadow.camera.bottom = -10;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;

const ambLight = new THREE.AmbientLight(0xffffff, 0.3);
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
const aquarium = new THREE.Mesh(aquariumGeo, aquariumMat);
aquarium.receiveShadow = true;            // ⬅– ADD: aquarium walls/floor receive shadows
scene.add(aquarium);

// Optionally add a dedicated “floor” inside the tank for clearer shadows:
const floorMat = new THREE.ShadowMaterial({ opacity: 0.3 });
const floorPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(aqWidth - 0.1, aqDepth - 0.1),
  floorMat
);
floorPlane.rotation.x = -Math.PI / 2;
floorPlane.position.y = -aqHeight / 2 + 0.01;
floorPlane.receiveShadow = true;
scene.add(floorPlane);

const waterUniforms = {
  time:     { value: 0 },
  envMap:   { value: null }, // will be set after HDR load
  cameraPos: { value: new THREE.Vector3() }
};

const WATER_RES_X = 64;
const WATER_RES_Z = 64;
const waterHeights = [];
const waterVelocities = [];
for (let x = 0; x < WATER_RES_X; x++) {
  waterHeights[x] = [];
  waterVelocities[x] = [];
  for (let z = 0; z < WATER_RES_Z; z++) {
    waterHeights[x][z] = 0;
    waterVelocities[x][z] = 0;
  }
}

const WAVE_SPEED = 2.0; // Adjust for more/less "slosh"
const DAMPING = 0.995;  // Try 0.99-1.0

function updateWaterPhysics(delta) {
  for (let x = 1; x < WATER_RES_X - 1; x++) {
    for (let z = 1; z < WATER_RES_Z - 1; z++) {
      // Average of neighbors minus this cell = "curvature"
      let laplacian =
        (waterHeights[x-1][z] + waterHeights[x+1][z] +
         waterHeights[x][z-1] + waterHeights[x][z+1]) / 4
        - waterHeights[x][z];
      // Update velocity and height
      waterVelocities[x][z] += laplacian * WAVE_SPEED * delta;
      waterVelocities[x][z] *= DAMPING;
      waterHeights[x][z] += waterVelocities[x][z] * delta;
    }
  }
}

function disturbWater(worldX, worldZ, strength = 0.3) {
  // Convert world coords to grid index
  let ix = Math.floor((worldX / aqWidth + 0.5) * WATER_RES_X);
  let iz = Math.floor((worldZ / aqDepth + 0.5) * WATER_RES_Z);
  if (ix > 0 && ix < WATER_RES_X-1 && iz > 0 && iz < WATER_RES_Z-1) {
    waterVelocities[ix][iz] += strength;
  }
}

function updateWaterMesh() {
  const posAttr = water.geometry.attributes.position;
  for (let x = 0; x < WATER_RES_X; x++) {
    for (let z = 0; z < WATER_RES_Z; z++) {
      let i = z + x * WATER_RES_Z;
      posAttr.setY(i, waterHeights[x][z]);
    }
  }
  posAttr.needsUpdate = true;
  water.geometry.computeVertexNormals();
}

const waterVertex = `
uniform float time;
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec3 pos = position;
  float freq = 2.0;
  float amp = 0.15;
  float phase = time * 0.7;
  pos.y += sin(pos.x * freq + phase) * amp;
  pos.y += sin(pos.z * freq * 1.3 - phase * 1.5) * amp * 0.6;
  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  // Approximate normal by cross product of local tangents
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
}
`;

const waterFragment = `
precision highp float;
uniform samplerCube envMap;
uniform vec3 cameraPos;
varying vec3 vWorldPos;
varying vec3 vNormal;

void main() {
  vec3 viewDir = normalize(vWorldPos - cameraPos);
  float fresnel = pow(1.0 - max(dot(viewDir, normalize(vNormal)), 0.0), 3.0);
  vec3 reflectColor = textureCube(envMap, reflect(viewDir, normalize(vNormal))).rgb;
  vec3 refractColor = vec3(0.1,0.2,0.4);
  vec3 col = mix(refractColor, reflectColor, fresnel);
  gl_FragColor = vec4(col, 0.6);
}
`;

const waterShaderMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  vertexShader: waterVertex,
  fragmentShader: waterFragment,
  transparent: true
});
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(aqWidth, aqDepth, 128, 128),
  waterShaderMat
);
water.rotation.x = -Math.PI / 2;
water.position.y = aqHeight/2 - 0.01;
scene.add(water);

// 1) Create a slightly smaller box to represent the water volume
const waterVolumeGeo = new THREE.BoxGeometry(
  aqWidth  - 0.1,
  aqHeight - 0.1,
  aqDepth  - 0.1
);

// 2) Give it a “water” material
const waterVolumeMat = new THREE.MeshPhysicalMaterial({
  color:        0x336688,
  metalness:    0,
  roughness:    0,
  transmission: 0.8,
  thickness:    2,
  transparent:  true,
  opacity:      0.6,
  side:         THREE.FrontSide
});
const waterVolume = new THREE.Mesh(waterVolumeGeo, waterVolumeMat);
scene.add(waterVolume);

// Underwater “fog” for depth attenuation
scene.fog = new THREE.FogExp2(0x336688, 0.02);
renderer.setClearColor(scene.fog.color);

// Motion bounds
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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);  // ⬅– ADD
});

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

    // Add mass, velocity, acceleration
    const velocity = new THREE.Vector3(1,0,0).multiplyScalar(params.fishSpeed);
    const acceleration = new THREE.Vector3();
    const mass = 1.0 + Math.random() * 0.2; // Give slight variation

    fishMat.color.set(params.fishColor);
    scene.add(fish);

    fishData.push({ mesh: fish, material: fishMat, velocity, acceleration, mass, radius });
    pickNewTarget(fishData.length - 1);
  }
}

// Bubble particles
const bubbleCount = 50;
const bubbleGeo = new THREE.SphereGeometry(0.07, 8, 8);
const bubbleMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.25,
  roughness: 0,
  metalness: 0,
  transmission: 0.9,
  thickness: 0.3
});
const bubbles = [];
for (let i = 0; i < bubbleCount; i++) {
  const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
  resetBubble(bubble);
  scene.add(bubble);
  bubbles.push(bubble);
}
function resetBubble(bubble) {
  bubble.position.set(
    THREE.MathUtils.randFloatSpread(aqWidth * 0.4),
    -aqHeight / 2 + 0.2,
    THREE.MathUtils.randFloatSpread(aqDepth * 0.4)
  );
  bubble.userData.speed = THREE.MathUtils.randFloat(0.15, 0.5);
}

const sandWidth  = aqWidth - 0.3;
const sandDepth  = aqDepth - 0.3;
const sandHeight = 0.8; // How thick you want your sand volume

// A box with many top vertices
const sandGeom = new THREE.BoxGeometry(sandWidth, sandHeight, sandDepth, 40, 6, 40);

// Deform only the top face vertices (where y is max)
const position = sandGeom.attributes.position;
const halffY = sandHeight / 2;
for (let i = 0; i < position.count; i++) {
  let y = position.getY(i);
  if (Math.abs(y - halffY) < 1e-3) { // Top surface
    let x = position.getX(i);
    let z = position.getZ(i);
    // Apply a mound with gentle variation
    let mound = Math.exp(-(x * x + z * z) / 45) * 0.3; // center mound
    let random = (Math.random() - 0.5) * 0.10; // random bumps
    position.setY(i, y + mound + random);
  }
}
sandGeom.computeVertexNormals();


// Set up 2nd UV channel for aoMap (for PBR materials)
sandGeom.setAttribute('uv2', new THREE.BufferAttribute(sandGeom.attributes.uv.array, 2));


const textureLoader = new THREE.TextureLoader();
const sandAlbedo    = textureLoader.load('gravelly_sand_4k.gltf/textures/gravelly_sand_diff_4k.jpg');
const sandNormal    = textureLoader.load('gravelly_sand_4k.gltf/textures/gravelly_sand_nor_gl_4k.jpg');
const sandARM       = textureLoader.load('gravelly_sand_4k.gltf/textures/gravelly_sand_arm_4k.jpg');

sandAlbedo.wrapS = sandAlbedo.wrapT =
sandNormal.wrapS = sandNormal.wrapT =
sandARM.wrapS    = sandARM.wrapT    = THREE.RepeatWrapping;
sandAlbedo.repeat.set(4,2); // Less repetition on the short side
sandNormal.repeat.set(4,2);
sandARM.repeat.set(4,2);

const sandMat = new THREE.MeshStandardMaterial({
  map: sandAlbedo,
  normalMap: sandNormal,
  aoMap: sandARM,
  roughnessMap: sandARM,
  metalnessMap: sandARM,
  roughness: 1,
  metalness: 0,
});

const sand = new THREE.Mesh(sandGeom, sandMat);
sand.position.y = -aqHeight / 2 + sandHeight / 2; // Sits on the bottom
sand.receiveShadow = true;
scene.add(sand);

function getSandHeightAt(x, z, sandGeom, sandWidth, sandDepth, sandHeight) {
  // sandGeom: BoxGeometry
  // sandWidth/sandDepth: as used to create sandGeom
  // sandHeight: as used to create sandGeom
  // Returns the Y (height) of the top surface at x, z (world coordinates relative to sand center)

  // Map world (x,z) to geometry local uv (from -width/2 ... +width/2)
  const posAttr = sandGeom.attributes.position;
  const segmentsX = sandGeom.parameters.widthSegments;
  const segmentsZ = sandGeom.parameters.depthSegments;

  // Find the closest top vertex:
  let closestDist = Infinity;
  let closestY = null;

  for (let i = 0; i < posAttr.count; i++) {
    let y = posAttr.getY(i);
    // Only consider vertices at the top surface
    if (Math.abs(y - sandHeight/2) > 0.4) continue;
    let vx = posAttr.getX(i);
    let vz = posAttr.getZ(i);

    let dist = (vx - x) ** 2 + (vz - z) ** 2;
    if (dist < closestDist) {
      closestDist = dist;
      closestY = y;
    }
  }
  return closestY;
}

const sandOrigY = [];
const posAttr = sand.geometry.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  sandOrigY[i] = posAttr.getY(i);
}

function deformSandAt(worldX, worldZ, depth = 0.12, radius = 0.5) {
  const sandPos = sand.position;
  const posAttr = sand.geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    let vx = posAttr.getX(i) + sandPos.x;
    let vz = posAttr.getZ(i) + sandPos.z;
    let dist = Math.sqrt((vx - worldX) ** 2 + (vz - worldZ) ** 2);
    if (dist < radius) {
      let factor = (1 - dist/radius);
      let origY = sandOrigY[i];
      posAttr.setY(i, origY - depth * factor);
    }
  }
  posAttr.needsUpdate = true;
  sand.geometry.computeVertexNormals();
}

function relaxSand(delta, speed = 0.2) {
  const posAttr = sand.geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    let currY = posAttr.getY(i);
    let origY = sandOrigY[i];
    posAttr.setY(i, currY + (origY - currY) * speed * delta);
  }
  posAttr.needsUpdate = true;
  sand.geometry.computeVertexNormals();
}


function addRocks(scene) {
  const rockGeo = new THREE.IcosahedronGeometry(0.5, 1);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x776655, roughness: 1, metalness: 0.3 });
  for (let i = 0; i < 10; i++) {
    const rx = THREE.MathUtils.randFloatSpread(sandWidth * 0.85); // stay inside the sand bounds
    const rz = THREE.MathUtils.randFloatSpread(sandDepth * 0.85);
    // Get the surface Y at (rx, rz)
    const ry = getSandHeightAt(rx, rz, sandGeom, sandWidth, sandDepth, sandHeight);

    const rock = new THREE.Mesh(rockGeo, rockMat.clone());
    rock.position.set(
      rx,
      sand.position.y + ry + 0.01, // add small offset to avoid z-fighting
      rz
    );
    rock.scale.setScalar(THREE.MathUtils.randFloat(0.2, 1));
    rock.rotation.y = Math.random() * Math.PI * 2;
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }
}
addRocks(scene);

const plants = []; // Store { mesh, angle, velocity, restAngle }

function addPlants(scene) {
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x449944, roughness: 0.7, metalness: 0 });
  for (let i = 0; i < 14; i++) {
    const height = THREE.MathUtils.randFloat(1.2, 3);
    const px = THREE.MathUtils.randFloatSpread(sandWidth * 0.85);
    const pz = THREE.MathUtils.randFloatSpread(sandDepth * 0.85);
    const py = getSandHeightAt(px, pz, sandGeom, sandWidth, sandDepth, sandHeight);

    const geo = new THREE.CylinderGeometry(0.05, 0.15, height, 6, 1);
    const plant = new THREE.Mesh(geo, plantMat.clone());
    plant.position.set(px, sand.position.y + py + height/2, pz);
    plant.castShadow = true;
    scene.add(plant);

    // Add physics data
    plants.push({
      mesh: plant,
      angle: 0,         // Current angle from vertical (radians)
      velocity: 0,      // Angular velocity
      restAngle: 0,     // Target angle (vertical = 0)
      stiffness: 10 + Math.random()*2,  // Spring constant (omega^2)
      damping: 4.5 + Math.random()     // Friction
    });
  }
}
addPlants(scene);


// Animation loop
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();

  // 1) Compute spring-based separation/repulsion forces (physics)
  fishData.forEach((fishA, i) => {
    fishA.acceleration.set(0, 0, 0); // Reset for each frame

    const posA = fishA.mesh.position;
    fishData.forEach((fishB, j) => {
      if (i === j) return;
      const posB = fishB.mesh.position;
      const offset = new THREE.Vector3().subVectors(posA, posB);
      const dist = offset.length();
      const minDist = params.separationDist;

      if (dist > 0 && dist < minDist) {
        // SPRING force: F = k * (minDist - dist)
        const k = params.separationStrength; // Spring constant
        const forceMag = k * (minDist - dist);
        const force = offset.normalize().multiplyScalar(forceMag);
        fishA.acceleration.add(force.divideScalar(fishA.mass));
      }
    });
  });

  // 2) Move fish, apply steering, orientation, wall bounce, and target
  fishData.forEach((fish, i) => {
    const pos = fish.mesh.position;
    const vel = fish.velocity;

    // Steering: desired direction toward target
    const desiredDir = dir.subVectors(targets[i], pos).normalize();

    // Add acceleration (from physics/separation)
    vel.add(fish.acceleration.clone().multiplyScalar(delta));

    // Smooth steering toward target (manual animation)
    vel.normalize()
       .lerp(desiredDir, params.turnSpeed * delta)
       .normalize()
       .multiplyScalar(params.fishSpeed);

    // Move
    pos.addScaledVector(vel, delta);

    // Wall bounce logic (reflect velocity if out of bounds)
    let bounced = false;
    if (pos.x < -halfX || pos.x > halfX) {
      vel.x *= -1;
      pos.x = THREE.MathUtils.clamp(pos.x, -halfX, halfX);
      bounced = true;
    }
    if (pos.y < -halfY || pos.y > halfY) {
      vel.y *= -1;
      pos.y = THREE.MathUtils.clamp(pos.y, -halfY, halfY);
      bounced = true;
    }
    if (pos.z < -halfZ || pos.z > halfZ) {
      vel.z *= -1;
      pos.z = THREE.MathUtils.clamp(pos.z, -halfZ, halfZ);
      bounced = true;
    }
    if (bounced) {
      // Add small random turn on bounce
      vel.applyAxisAngle(
        new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
        THREE.MathUtils.randFloatSpread(Math.PI / 8)
      );
    }

    // Orient fish toward velocity direction + update shader time
    const dirNorm = vel.clone().normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(forward, dirNorm);
    fish.mesh.quaternion.slerp(quat, 0.1);

    fish.material.userData.uniforms.time.value += delta * 1.5;

    // If close to target, pick new target
    if (pos.distanceToSquared(targets[i]) < 0.25) pickNewTarget(i);
  });

  // --- Plant physics (spring oscillator) ---
  plants.forEach(plantData => {
    // External force: random "water wind" + optional fish proximity
    let force = Math.sin(performance.now() * 0.0005 + plantData.mesh.position.x * 2) * 0.07;

    // If a fish is close, add a push
    fishData.forEach(fish => {
      const dist = plantData.mesh.position.distanceTo(fish.mesh.position);
      if (dist < 1.0) {
        force += (Math.random() - 0.5) * 0.5; // lower from 2.0
    }
    });

    // Damped spring physics (Euler integration)
    // theta'' + 2*damping*theta' + stiffness*theta = force
    plantData.velocity += (
      -2 * plantData.damping * plantData.velocity
      - plantData.stiffness * (plantData.angle - plantData.restAngle)
      + force
    ) * delta;
    plantData.velocity *= 0.98; // extra friction
    plantData.angle += plantData.velocity * delta;

    // Limit angle to avoid excessive bending
    plantData.angle = THREE.MathUtils.clamp(plantData.angle, -Math.PI/4, Math.PI/4);

    // Sway the plant: apply rotation around X or Z (randomize per plant)
    plantData.mesh.rotation.z = plantData.angle;
  });

  // Animate bubbles
  bubbles.forEach(bubble => {
  bubble.position.y += bubble.userData.speed * delta;
  bubble.position.x += Math.sin(performance.now() * 0.001 + bubble.position.z) * 0.01;
  bubble.position.z += Math.cos(performance.now() * 0.0015 + bubble.position.x) * 0.01;
  if (bubble.position.y > aqHeight / 2 - 0.5) resetBubble(bubble);
  });

  // 3) Animate water shader
  waterUniforms.time.value = performance.now() * 0.001;
  waterUniforms.cameraPos.value.copy(camera.position);

  fishData.forEach(fish => {
  if (Math.abs(fish.mesh.position.y - sand.position.y) < 0.5) {
    deformSandAt(fish.mesh.position.x, fish.mesh.position.z);
  }
  });
  relaxSand(delta);

  updateWaterPhysics(delta);
  updateWaterMesh();
  

  // 4) Update controls, render scene
  controls.update();
  composer.render();
});

