import * as THREE from 'three';
import { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI }              from 'lil-gui';
import { createFish }       from './fish.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { PMREMGenerator } from 'three';   
import { Water } from 'three/addons/objects/Water2.js';
import { texture } from 'three/tsl';

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

// --- Resize window ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Global fog for underwater effect ---
scene.fog = new THREE.FogExp2(0x336688, 0.015);
// -----------------------------------------------

// --- HDR environment map for sky and reflections ---
const pmremGenerator = new THREE.PMREMGenerator(renderer);
new RGBELoader()
  .setDataType(THREE.FloatType)
  .load('hdr/pine_picnic_4k.hdr', (hdrE) => {
    const envMap = pmremGenerator.fromEquirectangular(hdrE).texture;
    scene.environment = envMap;
    scene.background  = envMap;
    hdrE.dispose();
    pmremGenerator.dispose();
  });
// -----------------------------------------------------------

scene.children.filter(obj => obj.isLight).forEach(light => scene.remove(light));

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

// --- Motion bounds ---
const margin = 1.1;
const halfX  = aqWidth/2  - margin;
const halfY  = aqHeight/2 - margin;
const halfZ  = aqDepth/2  - margin;

// --- Fish parameters management ---
let targets  = [];
let fishData = [];

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

function pickNewTarget(i) {
  targets[i] = new THREE.Vector3(
    THREE.MathUtils.randFloat(-halfX, halfX),
    THREE.MathUtils.randFloat(-halfY, halfY),
    THREE.MathUtils.randFloat(-halfZ, halfZ)
  );
}

// --- Update fish count function ---
export function updateFishCount(count) {

  // Remove excess fish
  while (fishData.length > count) {
    const { mesh } = fishData.pop();
    scene.remove(mesh);
    targets.pop();
  }
  
  // Add new fish if needed
  while (fishData.length < count) {
    const { mesh: fish, material: fishMat } = createFish(scene);
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



renderer.setAnimationLoop(() => {

  const delta = clock.getDelta();

  causticsTexture.offset.x -= 0.04 * delta;

  renderer.render(scene, camera);

  controls.update();
});

