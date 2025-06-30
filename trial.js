import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI }              from 'lil-gui';
import { createFish }       from './fish.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { PMREMGenerator } from 'three';   
import { Water } from 'three/addons/objects/Water2.js';

// --- Scene, camera, renderer ---
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight , 0.1, 1000);
camera.position.set(0, 2, -15);
camera.lookAt(0, 2, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight );

renderer.outputEncoding         = THREE.sRGBEncoding;
renderer.toneMapping            = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure    = 1;
renderer.physicallyCorrectLights= true;
renderer.shadowMap.enabled      = true;
renderer.shadowMap.type         = THREE.PCFSoftShadowMap;

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan     = false;
controls.enableDamping = true;
controls.maxPolarAngle = THREE.MathUtils.degToRad(120);
controls.minDistance   = 10;
controls.maxDistance   = 30;
controls.target.set(0, 2, 0);
controls.update();

// --- Global fog for underwater effect ---
scene.fog = new THREE.FogExp2(0x336688, 0.015);


// --- HDR environment map for sky and reflections ---
const pmremGenerator = new THREE.PMREMGenerator(renderer);
new RGBELoader()
  .setDataType(THREE.FloatType)
  .load('hdr/pine_picnic_4k.hdr', (hdrE) => {
    const envMap = pmremGenerator.fromEquirectangular(hdrE).texture;
    scene.environment = envMap;
    scene.background  = envMap;
    fishData.forEach(({ material }) => {
      material.envMap = envMap;
      material.needsUpdate = true;
    });
    hdrE.dispose();
    pmremGenerator.dispose();
  });


// --- Hemisphere light ---
const hemiLight = new THREE.HemisphereLight(0x88ccff, 0x223311, 0.4);
scene.add(hemiLight);

// --- Directional sunlight with shadows ---
const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.position.set(5, 10, 2);
sunLight.castShadow = true;
sunLight.shadow.camera.near    = 0.5;
sunLight.shadow.camera.far     = 50;
sunLight.shadow.camera.left    = -15;
sunLight.shadow.camera.right   = 15;
sunLight.shadow.camera.top     = 15;
sunLight.shadow.camera.bottom  = -15;
sunLight.shadow.mapSize.set(2048, 2048);
scene.add(sunLight);

// --- Underwater ambient fill ---
const blueAmbient = new THREE.AmbientLight(0x336688, 0.25);
scene.add(blueAmbient);

document.body.appendChild(renderer.domElement);


// --- Aquarium ---
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
aquarium.receiveShadow = true;            
scene.add(aquarium);

const textureLoader = new THREE.TextureLoader();

// --- Motion bounds ---
const margin = 1.1;
const halfX  = aqWidth/2  - margin;
const halfY  = aqHeight/2 - margin;
const halfZ  = aqDepth/2  - margin;



// --- Fish parameters management ---
let targets  = [];
export let fishData = [];

// --- GUI parameters ---
const params = {
  fishPushRadius: 1.8,  
  fishPushStrength: 16.0,   
  fishCount: 5,
  fishColor: '#ff8800',
  fishSpeed: 2,
  turnSpeed: 1.5,
  separationDist: 1.0,
  separationStrength: 2.0,
  alignmentStrength: 1.0, 
  cohesionStrength: 1.0,  
  flockRadius: 3.0,
  feedFish: () => {},      
};


// --- GUI setup ---
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
gui.add(params, 'feedFish').name('Feed Fish');
gui.add(params, 'fishPushRadius', 0.5, 5, 0.1).name('Fish Push Radius');
gui.add(params, 'fishPushStrength', 5, 20, 1).name('Fish Push Strength');


// --- Helpers ---
const forward = new THREE.Vector3(-1,0,0);
const dir     = new THREE.Vector3();
const clock   = new THREE.Clock();

// --- Resize window ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});



function pickNewTarget(i) {
  targets[i] = new THREE.Vector3(
    THREE.MathUtils.randFloat(-halfX, halfX),
    THREE.MathUtils.randFloat(-halfY, halfY),
    THREE.MathUtils.randFloat(-halfZ, halfZ)
  );
}

// --- Update fish count function ---
export function updateFishCount(count) {

  while (fishData.length > count) {
    const { mesh } = fishData.pop();
    scene.remove(mesh);
    targets.pop();
  }

  const envMap = scene.environment;
  while (fishData.length < count) {
    const { mesh: fish, material: fishMat } = createFish(scene, envMap);
    fish.scale.set(0.1, 0.1, 0.1);

    fish.geometry.computeBoundingSphere();
    const radius = fish.geometry.boundingSphere.radius * fish.scale.x;
    
    const velocity = new THREE.Vector3(1,0,0).multiplyScalar(params.fishSpeed);
    const acceleration = new THREE.Vector3();
    const mass = 1.0 + Math.random() * 0.2; 

    fishMat.color.set(params.fishColor);
    scene.add(fish);

    const phase = Math.random() * Math.PI * 2;

    fishData.push({ mesh: fish, material: fishMat, velocity, acceleration, mass, radius, phase});
    pickNewTarget(fishData.length - 1);
  }
}

// --- Create bubbles ---
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
    THREE.MathUtils.randFloatSpread(aqWidth * 0.8),
    -aqHeight / 2 + 0.2,
    THREE.MathUtils.randFloatSpread(aqDepth * 0.8)
  );
  bubble.userData.speed = THREE.MathUtils.randFloat(0.15, 0.5);
}

// --- Create initial fish ---
updateFishCount(params.fishCount);

// --- Create sand layer ---
const sandWidth  = aqWidth - 0.01;
const sandDepth  = aqDepth - 0.01;
const sandHeight = 0.8; 

const sandGeom = new THREE.BoxGeometry(sandWidth, sandHeight, sandDepth, 40, 6, 40);

sandGeom.setAttribute('uv2', new THREE.BufferAttribute(sandGeom.attributes.uv.array, 2));

const sandAlbedo    = textureLoader.load('gravelly_sand_4k.gltf/textures/gravelly_sand_diff_4k.jpg');
const sandNormal    = textureLoader.load('gravelly_sand_4k.gltf/textures/gravelly_sand_nor_gl_4k.jpg');
const sandARM       = textureLoader.load('gravelly_sand_4k.gltf/textures/gravelly_sand_arm_4k.jpg');

sandAlbedo.wrapS = sandAlbedo.wrapT =
sandNormal.wrapS = sandNormal.wrapT =
sandARM.wrapS    = sandARM.wrapT    = THREE.RepeatWrapping;
sandAlbedo.repeat.set(4,2); 
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
sand.position.y = -aqHeight / 2 + sandHeight / 2; 
sand.receiveShadow = true;
scene.add(sand);

const sandGrainGeo = new THREE.SphereGeometry(0.1, 0.1, 0.1);
const sandGrainMat = new THREE.MeshStandardMaterial({ color: 0xC2B280 });
const sandGrains   = [];
const gravity      = 9.8;

const sandSurfaceY = sand.position.y + sandHeight / 2;

function spraySand(x, z, count = 12) {
  for (let i = 0; i < count; i++) {
    const grain = new THREE.Mesh(sandGrainGeo, sandGrainMat);
    grain.scale.set(0.1, 0.1, 0,1)
    grain.position.set(x, sandSurfaceY + 0.02, z);
    grain.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 1.2,
      Math.random() * 1.0 + 0.3,
      (Math.random() - 0.5) * 1.2
    );
    grain.userData.life = 1.5; 
    scene.add(grain);
    sandGrains.push(grain);
  }
}

function updateSandGrains(delta) {
  for (let i = sandGrains.length - 1; i >= 0; i--) {
    const g = sandGrains[i];
    
    g.userData.velocity.y -= gravity * delta;
    
    g.position.addScaledVector(g.userData.velocity, delta);
    
    g.userData.life -= delta;
    
    if (g.userData.life <= 0 || g.position.y <= sandSurfaceY) {
      scene.remove(g);
      sandGrains.splice(i, 1);
    }
  }
}

function getSandHeightAt(x, z, sandGeom, sandWidth, sandDepth, sandHeight) {
  const posAttr = sandGeom.attributes.position;
  const segmentsX = sandGeom.parameters.widthSegments;
  const segmentsZ = sandGeom.parameters.depthSegments;

  
  let closestDist = Infinity;
  let closestY = null;

  for (let i = 0; i < posAttr.count; i++) {
    let y = posAttr.getY(i);
    
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

// --- Add rocks ---
function addRocks(scene) {
  const rockGeo = new THREE.IcosahedronGeometry(0.5, 1);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x776655, roughness: 1, metalness: 0.3 });
  for (let i = 0; i < 10; i++) {
    const rx = THREE.MathUtils.randFloatSpread(sandWidth * 0.85); 
    const rz = THREE.MathUtils.randFloatSpread(sandDepth * 0.85);
    
    const ry = getSandHeightAt(rx, rz, sandGeom, sandWidth, sandDepth, sandHeight);

    const rock = new THREE.Mesh(rockGeo, rockMat.clone());
    rock.position.set(
      rx,
      sand.position.y + ry + 0.01, 
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

// --- Sea plants creation ---
const seaPlants = [];
const SEGMENTS = 6; 
const PLANT_COUNT = 10; 
const PLANT_LEN = 2.5; 

function createKelpRibbon(points, bladeWidth = 0.13) {
  const segs = points.length - 1;
  const pos = [];
  const norm = [];
  const idx = [];
  const uvs = [];

  for (let i = 0; i < segs; i++) {

    const pA = points[i];
    const pB = points[i + 1];
    const dir = pB.clone().sub(pA).normalize();

    const up = new THREE.Vector3(0, 1, 0);

    let side = new THREE.Vector3().crossVectors(up, dir).normalize();
    if (side.length() < 0.0001) side.set(1, 0, 0);

    const t = i / segs;
    const width = bladeWidth * (1 - t * 0.75);

    const left = pA.clone().add(side.clone().multiplyScalar(width * 0.5));
    const right = pA.clone().add(side.clone().multiplyScalar(-width * 0.5));

    pos.push(left.x, left.y, left.z);
    pos.push(right.x, right.y, right.z);

    norm.push(0, 1, 0, 0, 1, 0);

    uvs.push(0, t, 1, t);
  }

  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    
    idx.push(a, b, c);
    idx.push(b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals(); 

  return geo;
}

function addSeaPlants(scene) {
  for (let i = 0; i < PLANT_COUNT; i++) {
    const baseX = THREE.MathUtils.randFloatSpread(sandWidth * 0.85);
    const baseZ = THREE.MathUtils.randFloatSpread(sandDepth * 0.85);
    const baseY = getSandHeightAt(baseX, baseZ, sandGeom, sandWidth, sandDepth, sandHeight) + sand.position.y;
    const base = new THREE.Vector3(baseX, baseY, baseZ);

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
      side: THREE.DoubleSide,     
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

seaPlants.forEach(plant => {
  
  plant.height = PLANT_LEN * (0.75 + Math.random() * 0.5);
  
  plant.width  = 0.18 * (0.7  + Math.random() * 0.6);
  plant.swayDir = new THREE.Vector3(
  Math.random() * 2 - 1,   
  0,                       
  Math.random() * 2 - 1    
  ).normalize();
});

const RAMP_DURATION = 2.0; 

seaPlants.forEach(plant => {
  plant.elapsedTime = 0;
});

// === Pointer interaction: feed fish on click/tap ===
const raycaster = new THREE.Raycaster();
const ndc       = new THREE.Vector2();
const plane     = new THREE.Plane(new THREE.Vector3(0, 1, 0), -sandSurfaceY);

function onPointerDown ( event ) {
  ndc.x =  ( event.clientX / window.innerWidth  ) * 2 - 1;
  ndc.y = -( event.clientY / window.innerHeight ) * 2 + 1;

  raycaster.setFromCamera( ndc, camera );
  const hit = new THREE.Vector3();

  if ( raycaster.ray.intersectPlane( plane, hit ) ) {

    if ( Math.abs( hit.x ) > halfX || Math.abs( hit.z ) > halfZ ) return;

    spawnFood( 8, hit.x, hit.z );
  }
}

window.addEventListener('pointerdown', onPointerDown);

const foodPellets = [];

function spawnFood(count = 10, centerX = 0, centerZ = 0) {
  const pelletGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const pelletMat = new THREE.MeshStandardMaterial({ color: 0xffff66 });

  const pelletR   = pelletGeo.parameters.radius;
  const clusterR  = 0.75;                 
  const xmin = -halfX + pelletR;
  const xmax =  halfX - pelletR;
  const zmin = -halfZ + pelletR;
  const zmax =  halfZ - pelletR;

  centerX = THREE.MathUtils.clamp(centerX, xmin, xmax);
  centerZ = THREE.MathUtils.clamp(centerZ, zmin, zmax);

  for (let i = 0; i < count; i++) {
    const pellet = new THREE.Mesh(pelletGeo, pelletMat);

    const x = THREE.MathUtils.clamp(
      centerX + THREE.MathUtils.randFloatSpread(clusterR * 2),
      xmin, xmax
    );
    const z = THREE.MathUtils.clamp(
      centerZ + THREE.MathUtils.randFloatSpread(clusterR * 2),
      zmin, zmax
    );

    pellet.position.set(x, aqHeight / 2 - 0.5, z);
    pellet.userData.velocity = new THREE.Vector3(0, -0.5 - Math.random() * 0.5, 0);
    scene.add(pellet);
    foodPellets.push(pellet);
  }
}

params.feedFish = () => spawnFood(20);


// --- Water surface ---
const flowDirection = new THREE.Vector2( 1, 1 ).normalize(); 

const loader = new THREE.TextureLoader();
const normalMap0 = loader.load( 'textures/Water_1_M_Normal.jpg', tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
});
const normalMap1 = loader.load( 'textures/Water_2_M_Normal.jpg', tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
});

const water = new Water(
  new THREE.PlaneGeometry( aqWidth - 0.1, aqDepth - 0.1 ),
  {
    color:       0xffffff,
    scale:       4,
    flowDirection: flowDirection,
    textureWidth:  1024,
    textureHeight: 1024,
    normalMap0,    
    normalMap1,
    
    sunDirection: sunLight.position.clone().normalize(),
    sunColor:     sunLight.color,
    waterColor:   new THREE.Color( 0x3399ff ),
  }
);

water.receiveShadow = true;
water.rotation.x = - Math.PI / 2;
water.position.y = aqHeight/2 - 0.05; 

scene.add( water );


// --- Caustics effect ---
const causticsTexture = textureLoader.load('caustics/caustics/caust00.png');
causticsTexture.wrapS = causticsTexture.wrapT = THREE.RepeatWrapping;
causticsTexture.repeat.set(4, 2); 

const causticLight = new THREE.SpotLight(0xffffff, 0.8, 50, Math.PI/3, 0.5);
causticLight.position.set(0, aqHeight/2 + 0.1, 0);
causticLight.target.position.set(0, -aqHeight/2, 0);
causticLight.map = causticsTexture;
causticLight.castShadow = false;
scene.add(causticLight, causticLight.target);

const causticsMat = new THREE.MeshBasicMaterial({
  map: causticsTexture,
  transparent: true,
  opacity: 0.3, 
  depthWrite: false
});
const causticsMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(aqWidth - 0.1, aqDepth - 0.1),
  causticsMat
);
causticsMesh.rotation.x = -Math.PI / 2;
causticsMesh.position.y = sand.position.y + sandHeight / 2 + 0.03;
scene.add(causticsMesh);


// Animation loop
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();

  causticsTexture.offset.x -= 0.04 * delta; 

  //--- Food pellets ---
  
for (let i = foodPellets.length - 1; i >= 0; i--) {
  const pellet = foodPellets[i];
  pellet.position.addScaledVector(pellet.userData.velocity, delta);
  if (pellet.position.y < sandSurfaceY + pellet.geometry.parameters.radius) {
    pellet.position.y = sandSurfaceY + pellet.geometry.parameters.radius;
    pellet.userData.velocity.set(0, 0, 0);
    pellet.userData.onSand = true;
  }
}

  //--- Food target ---
  fishData.forEach((fish, i) => {
    let closest = null;
    let minDist = Infinity;
    foodPellets.forEach(p => {
      const d = fish.mesh.position.distanceToSquared(p.position);
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    });
    if (closest) {
      targets[i] = closest.position.clone();
      if (fish.mesh.position.distanceTo(closest.position) < fish.radius + 0.05) {
        scene.remove(closest);
        foodPellets.splice(foodPellets.indexOf(closest), 1);
      }
    }
  });

  // --- Separation, alignment, and cohesion ---
  fishData.forEach((fishA, i) => {
    fishA.acceleration.set(0, 0, 0);

    const posA = fishA.mesh.position;
    fishData.forEach((fishB, j) => {
      if (i === j) return;
      const posB = fishB.mesh.position;
      const offset = new THREE.Vector3().subVectors(posA, posB);
      const dist = offset.length();
      const minDist = params.separationDist;

      if (dist > 0 && dist < minDist) {
        const k = params.separationStrength;
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

      let avgVel = new THREE.Vector3();
      neighbors.forEach(n => avgVel.add(n.velocity));
      avgVel.divideScalar(neighbors.length).normalize();
      let alignment = avgVel.sub(fishA.velocity.clone().normalize())
                            .multiplyScalar(params.alignmentStrength);
      fishA.acceleration.add(alignment);

      let avgPos = new THREE.Vector3();
      neighbors.forEach(n => avgPos.add(n.mesh.position));
      avgPos.divideScalar(neighbors.length);
      let cohesion = avgPos.sub(fishA.mesh.position)
                           .normalize()
                           .multiplyScalar(params.cohesionStrength);
      fishA.acceleration.add(cohesion);
    }
  });

  // --- Update fish positions and orientations ---
  fishData.forEach((fish, i) => {
    const pos = fish.mesh.position;
    const vel = fish.velocity;

    const desiredDir = dir.subVectors(targets[i], pos).normalize();

    vel.add(fish.acceleration.clone().multiplyScalar(delta));

    vel.normalize()
       .lerp(desiredDir, params.turnSpeed * delta)
       .normalize()
       .multiplyScalar(params.fishSpeed);

    pos.addScaledVector(vel, delta);

    // --- Wall bounce logic ---
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
      vel.applyAxisAngle(
        new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
        THREE.MathUtils.randFloatSpread(Math.PI / 8)
      );
    }

    const dirNorm = vel.clone().normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(forward, dirNorm);
    fish.mesh.quaternion.slerp(quat, 0.1);

    fish.material.userData.uniforms.time.value = performance.now() * 0.001 * 1.5 + fish.phase;

    if (pos.distanceToSquared(targets[i]) < 0.25) pickNewTarget(i);
  });

//--- SeaPlants ---
const kelpSpring  = 30;
const kelpDamping = 12;

const up          = new THREE.Vector3(0, 1, 0);

seaPlants.forEach(plant => {
  const jointLength = plant.height / (SEGMENTS - 1);
  
  const delta = clock.getDelta();
  plant.elapsedTime += delta;
  const ramp = Math.min(1, plant.elapsedTime / RAMP_DURATION);

  plant.points[0].copy(plant.base);
  plant.velocities[0].set(0,0,0);

  //--- Fish push ---
  fishData.forEach(fish => {
    const fp = fish.mesh.position;            
    for (let j = 1; j < SEGMENTS; j++) {      
      const p     = plant.points[j];
      const toSeg = p.clone().sub(fp);        
      const dist  = toSeg.length();

      if (dist < params.fishPushRadius) {
        const falloff   = 1 - dist / params.fishPushRadius;
        const impulse   = toSeg.normalize()
                             .multiplyScalar(params.fishPushStrength * falloff * delta);
        plant.velocities[j].add(impulse);
      }
    }
  });

  // --- Lateral sway ---
  for (let j = 1; j < SEGMENTS; j++) {
    const prev  = plant.points[j - 1];
    const curr  = plant.points[j];
    const t     = j / (SEGMENTS - 1);
    const sway = Math.sin(performance.now() * 0.002) * 0.10;

    const dir  = curr.clone().sub(prev).normalize();
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    if (side.length() < 0.0001) side.set(1, 0, 0);

    const target = prev.clone()
      .add(up.clone().multiplyScalar(jointLength))
      .add(side.clone().multiplyScalar(sway));

    const diff = target.clone().sub(curr);
    plant.velocities[j].add(diff.multiplyScalar(kelpSpring * delta));
    plant.velocities[j].multiplyScalar(Math.exp(-kelpDamping * delta));
    curr.add(plant.velocities[j]);
  }

    for (let j = 1; j < SEGMENTS; j++) {
    const prev = plant.points[j - 1];
    const curr = plant.points[j];
    const dir  = curr.clone().sub(prev).normalize();
    curr.copy(prev.clone().add(dir.multiplyScalar(jointLength)));
  }

  // --- write back left+right verts ---
  const posArray = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const pA = plant.points[i];
    let nextDir;
    if (i < SEGMENTS - 1) {
      nextDir = plant.points[i+1].clone().sub(pA).normalize();
    } else {
      nextDir = pA.clone().sub(plant.points[i-1]).normalize();
    }
    const side = new THREE.Vector3().crossVectors(up, nextDir).normalize();
    if (side.length() < 0.0001) side.set(1, 0, 0);

    const tt    = i / (SEGMENTS - 1);
    const w     = plant.width * (1 - tt * 0.75);
    const left  = pA.clone().add(side.clone().multiplyScalar( w * 0.5 ));
    const right = pA.clone().add(side.clone().multiplyScalar(-w * 0.5 ));

    posArray.push(
      left.x, left.y, left.z,
      right.x, right.y, right.z
    );
  }

  const geo = plant.mesh.geometry;
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posArray, 3));
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  geo.attributes.normal.needsUpdate = true;
});


  //--- Bubbles ---
  bubbles.forEach(bubble => {
    bubble.position.y += bubble.userData.speed * delta;
    if (bubble.position.y > aqHeight / 2 - 0.5) resetBubble(bubble);
  });

   fishData.forEach(fish => {
    const y = fish.mesh.position.y;
    if (y - sandSurfaceY < fish.radius + 0.3) {
      spraySand(fish.mesh.position.x, fish.mesh.position.z);
    }
  });
  updateSandGrains(delta);

  renderer.render(scene, camera);

  controls.update();
});

