import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI }              from 'lil-gui';
import { createFish }       from './fish.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { PMREMGenerator } from 'three';   

// Scene, camera, renderer
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight , 0.1, 1000);
camera.position.set(0, 2, -15);
camera.lookAt(0, 2, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight );
renderer.setClearColor(0x66775f);

const pmremGenerator = new PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

new RGBELoader()
  .setDataType(THREE.FloatType) // important for HDR
  .load('hdr/pine_picnic_4k.hdr', function(hdrEquirect) {
    const envMap = pmremGenerator.fromEquirectangular(hdrEquirect).texture;
    scene.environment = envMap;     // for PBR reflections
    scene.background = envMap;      // as background image
    fishData.forEach(({ material }) => {
    material.userData.uniforms.envMap.value = envMap;
    });

    hdrEquirect.dispose();
    pmremGenerator.dispose();
  });

// ⬅– ENABLE SHADOW MAPS
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
scene.children.filter(obj => obj.isLight).forEach(light => scene.remove(light));

// Main "sunlight"
const dirLight = new THREE.DirectionalLight(0xbfdfff, 1.25);
dirLight.position.set(0, 20, 0); 
dirLight.castShadow = true;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -14;
dirLight.shadow.camera.right = 14;
dirLight.shadow.camera.top = 14;
dirLight.shadow.camera.bottom = -14;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;

// Underwater blue ambient
const ambLight = new THREE.AmbientLight(0x4887b4, 0.35);

// Subsurface blue point light
const blueLight = new THREE.PointLight(0x1c73bb, 1.1, 22);
blueLight.position.set(0, 2, 0);

// Add all lights to scene
scene.add(dirLight, ambLight, blueLight);

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

const textureLoader = new THREE.TextureLoader();

// Underwater “fog” for depth attenuation
//scene.fog = new THREE.FogExp2(0x336688, 0.02);
//renderer.setClearColor(scene.fog.color);

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
  separationStrength: 2.0,
  alignmentStrength: 1.0, 
  cohesionStrength: 1.0,  
  flockRadius: 3.0        
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
gui.add(params, 'alignmentStrength', 0.0, 5.0, 0.1).name('Alignment');
gui.add(params, 'cohesionStrength', 0.0, 5.0, 0.1).name('Cohesion');
gui.add(params, 'flockRadius', 0.5, 10, 0.1).name('Flock Radius');

// Helpers
const forward = new THREE.Vector3(-1,0,0);
const dir     = new THREE.Vector3();
const clock   = new THREE.Clock();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
    fish.scale.set(0.1, 0.1, 0.1);
    fish.geometry.computeBoundingSphere();
    const radius = fish.geometry.boundingSphere.radius * fish.scale.x;

    // Add mass, velocity, acceleration
    const velocity = new THREE.Vector3(1,0,0).multiplyScalar(params.fishSpeed);
    const acceleration = new THREE.Vector3();
    const mass = 1.0 + Math.random() * 0.2; // Give slight variation

    fishMat.color.set(params.fishColor);
    scene.add(fish);

    const phase = Math.random() * Math.PI * 2;
    fishData.push({ mesh: fish, material: fishMat, velocity, acceleration, mass, radius, phase});
    pickNewTarget(fishData.length - 1);
  }
}

// Bubble particles
const bubbleCount = 10;
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

// Set up 2nd UV channel for aoMap (for PBR materials)
sandGeom.setAttribute('uv2', new THREE.BufferAttribute(sandGeom.attributes.uv.array, 2));


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

const causticsTexture = textureLoader.load('caustics/caustics/caust00.png');
causticsTexture.wrapS = causticsTexture.wrapT = THREE.RepeatWrapping;
causticsTexture.repeat.set(4, 2); // tweak for your aquarium

const causticsMat = new THREE.MeshBasicMaterial({
  map: causticsTexture,
  transparent: true,
  opacity: 0.3, // subtle!
  depthWrite: false
});
const causticsMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(aqWidth - 0.1, aqDepth - 0.1),
  causticsMat
);
causticsMesh.rotation.x = -Math.PI / 2;
causticsMesh.position.y = sand.position.y + sandHeight / 2 + 0.03; // just above sand
scene.add(causticsMesh);


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

const seaPlants = [];
const SEGMENTS = 12; 
const PLANT_COUNT = 10; 
const PLANT_LEN = 2.5; 

function createKelpRibbon(points, bladeWidth = 0.13) {
  const segs = points.length - 1;
  const pos = [];
  const norm = [];
  const idx = [];
  const uvs = [];

  for (let i = 0; i < segs; i++) {
    // For each segment, make two vertices: left and right of the segment line
    const pA = points[i];
    const pB = points[i + 1];
    // Direction of this segment
    const dir = pB.clone().sub(pA).normalize();
    // Find a "side" vector: world up crossed with segment direction
    const up = new THREE.Vector3(0, 1, 0);
    let side = new THREE.Vector3().crossVectors(up, dir).normalize();
    // If segment is vertical, fudge it
    if (side.length() < 0.0001) side.set(1, 0, 0);

    // Taper width toward tip (linear or exponential)
    const t = i / segs;
    const width = bladeWidth * (1 - t * 0.75);

    // Two vertices: left and right
    const left = pA.clone().add(side.clone().multiplyScalar(width * 0.5));
    const right = pA.clone().add(side.clone().multiplyScalar(-width * 0.5));

    pos.push(left.x, left.y, left.z);
    pos.push(right.x, right.y, right.z);

    // Flat normal: average segment direction crossed with side, or just up
    norm.push(0, 1, 0, 0, 1, 0);

    // UVs
    uvs.push(0, t, 1, t);
  }

  // Indices: make a triangle strip
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    // Two triangles per segment
    idx.push(a, b, c);
    idx.push(b, d, c);
  }

  // Build BufferGeometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals(); // ensure lighting works

  return geo;
}

// Remove your old addPlants()!
function addSeaPlants(scene) {
  for (let i = 0; i < PLANT_COUNT; i++) {
    const baseX = THREE.MathUtils.randFloatSpread(sandWidth * 0.85);
    const baseZ = THREE.MathUtils.randFloatSpread(sandDepth * 0.85);
    const baseY = getSandHeightAt(baseX, baseZ, sandGeom, sandWidth, sandDepth, sandHeight) + sand.position.y;
    const base = new THREE.Vector3(baseX, baseY, baseZ);

    // Chain of points from base upward
    const points = [];
    const velocities = [];
    for (let j = 0; j < SEGMENTS; j++) {
      points.push(new THREE.Vector3(
        base.x,
        base.y + (j / (SEGMENTS - 1)) * PLANT_LEN,
        base.z
      ));
      velocities.push(new THREE.Vector3(0, 0, 0));
    }

    const geo = createKelpRibbon(points, 0.18);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x388e3c,
      roughness: 0.7,
      metalness: 0.03,
      side: THREE.DoubleSide,     // flat ribbon
      transparent: true,
      opacity: 0.93
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    scene.add(mesh);

    seaPlants.push({ base, points, velocities, mesh });
  }
}
addSeaPlants(scene);




// Animation loop
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();

  causticsTexture.offset.x += 0.04 * delta; // horizontal movement
  causticsTexture.offset.y += 0.03 * delta; // vertical movement

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
    let neighbors = [];
    for (let j = 0; j < fishData.length; j++) {
      if (i === j) continue;
      if (fishA.mesh.position.distanceTo(fishData[j].mesh.position) < params.flockRadius) {
        neighbors.push(fishData[j]);
      }
    }
    if (neighbors.length > 0) {
      // ALIGNMENT
      let avgVel = new THREE.Vector3();
      neighbors.forEach(n => avgVel.add(n.velocity));
      avgVel.divideScalar(neighbors.length).normalize();
      let alignment = avgVel.sub(fishA.velocity.clone().normalize())
                            .multiplyScalar(params.alignmentStrength);
      fishA.acceleration.add(alignment);

      // COHESION
      let avgPos = new THREE.Vector3();
      neighbors.forEach(n => avgPos.add(n.mesh.position));
      avgPos.divideScalar(neighbors.length);
      let cohesion = avgPos.sub(fishA.mesh.position)
                           .normalize()
                           .multiplyScalar(params.cohesionStrength);
      fishA.acceleration.add(cohesion);
    }
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

    fish.material.userData.uniforms.time.value = performance.now() * 0.001 * 1.5 + fish.phase;

    // If close to target, pick new target
    if (pos.distanceToSquared(targets[i]) < 0.25) pickNewTarget(i);
  });

const kelpSpring = 60;   // Higher: stiffer
const kelpDamping = 7.2; // Higher: less "wiggle"
const jointLength = PLANT_LEN / (SEGMENTS - 1);

seaPlants.forEach(plant => {
  // 1. Fixed base
  plant.points[0].copy(plant.base);
  plant.velocities[0].set(0, 0, 0);

  // 2. Fish interaction: if any segment is close, push it sideways
  fishData.forEach(fish => {
    for (let j = 1; j < SEGMENTS; j++) {
      const dist = plant.points[j].distanceTo(fish.mesh.position);
      if (dist < 0.55) {
        // Push away from fish, slightly up too (kelp is buoyant)
        const push = plant.points[j].clone().sub(fish.mesh.position).setY(0).normalize().multiplyScalar(0.09);
        push.y = 0.04; // encourage tip to wave up
        plant.velocities[j].add(push);
      }
    }
  });

  // 3. Spring and water current idle movement
  for (let j = 1; j < SEGMENTS; j++) {
    // Idle "wave" based on time and segment
    const t = j / (SEGMENTS - 1);
    const sway = Math.sin(performance.now() * 0.0007 + plant.base.x * 0.2 + t * 2.2) * 0.0002 * (0.5 + t);

    // Target: straight above prev, plus gentle wave offset
    const prev = plant.points[j - 1];
    const curr = plant.points[j];
    const target = prev.clone().add(new THREE.Vector3(sway, jointLength, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), sway * 2));
    // Spring toward target
    const diff = target.clone().sub(curr);
    plant.velocities[j].add(diff.multiplyScalar(kelpSpring * clock.getDelta()));
    // Damping
    plant.velocities[j].multiplyScalar(Math.exp(-kelpDamping * clock.getDelta()));
    // Integrate
    curr.add(plant.velocities[j]);
  }

  // 4. Length constraint pass: enforce segment length (to prevent "exploding" ropes)
  for (let j = 1; j < SEGMENTS; j++) {
    const prev = plant.points[j - 1];
    const curr = plant.points[j];
    const dir = curr.clone().sub(prev).normalize();
    curr.copy(prev.clone().add(dir.multiplyScalar(jointLength)));
  }

  // 5. Update geometry (with kelp radius function)
  const curve = new THREE.CatmullRomCurve3(plant.points);
  plant.mesh.geometry.dispose();
  plant.mesh.geometry = createKelpRibbon(plant.points, 0.18);
  });

  


  // Animate bubbles
  bubbles.forEach(bubble => {
  bubble.position.y += bubble.userData.speed * delta;
  bubble.position.x += Math.sin(performance.now() * 0.001 + bubble.position.z) * 0.01;
  bubble.position.z += Math.cos(performance.now() * 0.0015 + bubble.position.x) * 0.01;
  if (bubble.position.y > aqHeight / 2 - 0.5) resetBubble(bubble);
  });

  // 4) Update controls, render scene
  renderer.render(scene, camera);

  controls.update();
});


