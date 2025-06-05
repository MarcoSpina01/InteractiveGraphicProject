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
const camera   = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 1000);
camera.position.set(0, 2, -15);
camera.lookAt(0, 2, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
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
          material.userData.uniforms.envMap = { value: envMap };
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
  vec3 dx = dFdx(pos);
  vec3 dz = dFdz(pos);
  vNormal = normalize(cross(dx, dz));
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
  bubble.userData.speed = THREE.MathUtils.randFloat(0.25, 0.6);
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

function addPlants(scene) {
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x449944, roughness: 0.7, metalness: 0 });
  for (let i = 0; i < 14; i++) {
    const height = THREE.MathUtils.randFloat(1.2, 3);
    const px = THREE.MathUtils.randFloatSpread(sandWidth * 0.85);
    const pz = THREE.MathUtils.randFloatSpread(sandDepth * 0.85);
    // Get the surface Y at (px, pz)
    const py = getSandHeightAt(px, pz, sandGeom, sandWidth, sandDepth, sandHeight);

    const geo = new THREE.CylinderGeometry(0.05, 0.15, height, 6, 1);
    const plant = new THREE.Mesh(geo, plantMat.clone());
    plant.position.set(
      px,
      sand.position.y + py + height/2,
      pz
    );
    plant.castShadow = true;
    scene.add(plant);
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

  // Animate bubbles
  bubbles.forEach(bubble => {
    bubble.position.y += bubble.userData.speed * delta;
    if (bubble.position.y > aqHeight / 2 - 0.5) resetBubble(bubble);
  });

  // 3) Animate water shader
  waterUniforms.time.value = performance.now() * 0.001;
  waterUniforms.cameraPos.value.copy(camera.position);

  // 4) Update controls, render scene
  controls.update();
  composer.render();
});


