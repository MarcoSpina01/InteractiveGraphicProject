import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';


const simpleNoise = `
    float N (vec2 st) { 
        return fract( sin( dot( st.xy, vec2(12.9898,78.233 ) ) ) *  43758.5453123);
    }
    
    float smoothNoise( vec2 ip ){ 
    	vec2 lv = fract( ip );
      vec2 id = floor( ip );
      
      lv = lv * lv * ( 3. - 2. * lv );
      
      float bl = N( id );
      float br = N( id + vec2( 1, 0 ));
      float b = mix( bl, br, lv.x );
      
      float tl = N( id + vec2( 0, 1 ));
      float tr = N( id + vec2( 1, 1 ));
      float t = mix( tl, tr, lv.x );
      
      return mix( b, t, lv.y );
    }
  `;

function createFishMaterial(){
  let m = new THREE.MeshPhongMaterial({
    color: 0x446655,
    wireframe: false,
    // map: mapTex,
    onBeforeCompile: shader => {
      shader.uniforms.time = m.userData.uniforms.time;
      shader.uniforms.totalLength = m.userData.uniforms.totalLength;
      shader.uniforms.envMap = m.userData.uniforms.envMap; 

      shader.vertexShader = `
        uniform float time;
        uniform float totalLength;
        attribute float parts;
        varying float vParts;
        varying vec4 vPos;
        varying vec3 vN;
        
        float getWave(float x){
          float currX = mod(x - (time * 4.), 3.1415926535 * 2.);
          return sin(currX) * 0.375 * pow((x / totalLength), 2.);
        }
        float getAngle(float x){
          float d = 0.001;
          float dz = getWave(x + d) - getWave(x);
          return atan( dz, d );
        }
        mat4 rotationMatrix(vec3 axis, float angle) {
            axis = normalize(axis);
            float s = sin(angle);
            float c = cos(angle);
            float oc = 1.0 - c;

            return mat4(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                        oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                        oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                        0.0,                                0.0,                                0.0,                                1.0);
        }

        vec3 rotate(vec3 v, vec3 axis, float angle) {
          mat4 m = rotationMatrix(axis, angle);
          return (m * vec4(v, 1.0)).xyz;
        }
        /////////////////////////////////////////////////////////////////////
        ${shader.vertexShader}
      `.replace(
        `#include <beginnormal_vertex>`,
        `#include <beginnormal_vertex>
          float ang = getAngle(position.x);
          objectNormal = normalize(rotate(vec3(normal), vec3(0, 1, 0), ang));
          vN = objectNormal;
        `
      )
       .replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
          vParts = parts;
          transformed.z += getWave(position.x);
          vPos = modelMatrix * vec4(transformed, 1.0);
        `
      );

      shader.fragmentShader = `
        uniform float time;
        uniform samplerCube envMap;
        varying float vParts;
        varying vec4 vPos;
        varying vec3 vN;
        ${simpleNoise}
        ${shader.fragmentShader}
      `.replace(
        `vec4 diffuseColor = vec4( diffuse, opacity );`,
        `
          vec3 col = diffuse;
          float parts = floor(vParts + 0.01);
          if (parts == 0.){
            col = diffuse;
            float wave = sin(vUv.y * PI2 * 6.) * 0.5 + 0.5;
            col *= wave * 0.15 + 0.2;
            col = mix(diffuse, col, smoothstep(0.9, 0.5, abs(vUv.x - 0.5) * 2.));
            col = mix(col, diffuse * 0.25, smoothstep(0.2, 0.0, vUv.y));
            float head = abs(sin(vUv.x * PI2));
            head = head * 0.05 + 0.175;
            col = mix(diffuse * 0.25, col, smoothstep(1. - head, 1. - (head + 0.025), vUv.y));
            vec2 eyeUv = vUv;
            eyeUv.x = abs(vUv.x - 0.5) * 0.35;
            float eyeDist = distance(vec2(0.07, 0.875), eyeUv);
            float eye = smoothstep(0.02, 0.0175, eyeDist);
            col = mix(col, vec3(1, 1, 0) * 0.2, eye);
            eye = smoothstep(0.015, 0.0125, eyeDist);
            col = mix(col, vec3(0.05), eye);
            vec2 mouthUv = vUv;
            mouthUv.x = abs(vUv.x - 0.5) * 2.;
            mouthUv.x -= mouthUv.y * 0.25;
            float mouth = 1. - (cos(mouthUv.x * PI2) * 0.5 + 0.5);
            mouth = pow(mouth, 64.) * 0.05 + 0.001;
            mouth = 1. - mouth;
            col = mix(diffuse * 0.4, col, smoothstep(mouth, mouth - 0.001, mouthUv.y));
          }
          if (parts == 1.){
            col = (vec3(0.375, 0.1, 0.05) * 3.) * diffuse;
            float wave = sin(vUv.x * PI2 * 70.) * 0.5 + 0.5;
            wave *= sin(vUv.y * PI2 * 5.) * 0.5 + 0.5;
            col *= wave * 0.25 + 0.75;
            vec2 tailUv = vUv;
            tailUv.y -= 0.5;
            tailUv.y = abs(tailUv.y) * 2.;
            col = mix(diffuse * 0.25, col, smoothstep(1., 0.5, tailUv.y));
          }
          // Rim lighting
          vec3 norm = normalize(vN);
          vec3 viewDir = normalize(vPos.xyz - cameraPosition);
          float rim = pow(1.0 - dot(viewDir, norm), 2.0);
          // Reflection
          vec3 R = reflect(viewDir, norm);
          vec3 envColor = textureCube(envMap, R).rgb;
          col = mix(col, envColor, 0.13);
          col += rim * vec3(0.23, 0.17, 0.10);
          vec4 diffuseColor = vec4( col, opacity );
        `
      ).replace(
        `#include <dithering_fragment>`,
        `#include <dithering_fragment>
        // fake caustic
        vec2 cPos = vPos.xz - (1, 0.25) * vPos.y;
        vec2 cUv = (cPos - vec2(time * 1.5, 0.));
        float caustic = abs(smoothNoise(cUv) - 0.5);
        caustic = pow(smoothstep(0.5, 0., caustic), 2.);
        float causticFade = smoothNoise(cPos - vec2(time, 0.));
        caustic *= causticFade;
        float causticShade = clamp(dot(normalize(vec3(1, 1, 0.25)), vN), 0., 1.);
        caustic *= causticShade;
        gl_FragColor.rgb += vec3(caustic) * 0.25;
        `
      );
    }
  });
  m.defines = {"USE_UV" : " "};
  m.userData = {
    uniforms: {
      time: {value: 0},
      totalLength: {value: 0},
      envMap: { value: null }
    }
  }
  return m;
}

function createFishGeometry(){
  
  const divisions = 200;
  // shaping curves
  // top
  let topCurve = new THREE.CatmullRomCurve3(
    [
      [0, 0],
      [0.1, 0.15],
      [1, 0.75],
      [3.5, 1.5],
      [9, 0.5],
      [9.5, 0.45],
      [10, 0.55]
    ].map(p => {return new THREE.Vector3(p[0], p[1], 0)})
  );
  let topPoints = topCurve.getSpacedPoints(100);
  // bottom
  let bottomCurve = new THREE.CatmullRomCurve3(
    [
      [0, 0],
      [0.1, -0.15],
      [0.5, -0.35],
      [4.5, -1],
      [8, -0.6],
      [9.5, -0.45],
      [10, -0.55]
    ].map(p => {return new THREE.Vector3(p[0], p[1], 0)})
  );
  let bottomPoints = bottomCurve.getSpacedPoints(100);
  // side
  let sideCurve = new THREE.CatmullRomCurve3(
    [
      [0,   0, 0],
      [0.1, 0, 0.125],
      [1,   0, 0.375],
      [4,-0.25, 0.6],
      [8,   0, 0.25],
      [10,  0, 0.05]
    ].map(p => {return new THREE.Vector3(p[0], p[1], p[2])})
  );
  let sidePoints = sideCurve.getSpacedPoints(100);
  
  // frames
  let frames = computeFrames();
  //console.log(frames);
  // frames to geometry
  let pts = [];
  let parts = [];
  frames.forEach(f => {
    f.forEach(p => {
      pts.push(p.x, p.y, p.z);
      parts.push(0);
    })
  })
  
  
  // FINS
  // tail fin
  let tailCurve = new THREE.CatmullRomCurve3(
    [
      [11,   -1.],
      [12.5, -1.5],
      [12., 0],
      [12.5, 1.5],
      [11,   1.],
    ].map(p => {return new THREE.Vector3(p[0], p[1], p[2])})
  );
  let tailPoints = tailCurve.getPoints(divisions / 2);
  let tailPointsRev = tailPoints.map(p => {return p}).reverse();
  tailPointsRev.shift();
  let fullTailPoints = tailPoints.concat(tailPointsRev);

  let tailfinSlices = 5;
  let tailRatioStep = 1 / tailfinSlices;
  let vTemp = new THREE.Vector3();
  let tailPts = [];
  let tailParts = [];
  for(let i = 0; i <= tailfinSlices; i++){
    let ratio = i * tailRatioStep;
    frames[frames.length - 1].forEach( (p, idx) => {
      vTemp.lerpVectors(p, fullTailPoints[idx], ratio);
      tailPts.push(vTemp.x, vTemp.y, vTemp.z);
      tailParts.push(1);
    })
  }
  let gTail = new THREE.PlaneGeometry(1, 1, divisions, tailfinSlices);
  gTail.setAttribute("position", new THREE.Float32BufferAttribute(tailPts, 3));
  gTail.setAttribute("parts", new THREE.Float32BufferAttribute(tailParts, 1));
  gTail.computeVertexNormals();

  // dorsal
  let dorsalCurve = new THREE.CatmullRomCurve3(
    [
      [3, 1.45],
      [3.25, 2.25],
      [3.75, 3],
      [6, 2],
      [7, 1]
    ].map(p => {return new THREE.Vector3(p[0], p[1], 0)})
  );
  let dorsalPoints = dorsalCurve.getSpacedPoints(100);
  let gDorsal = createFin(topPoints, dorsalPoints, true);

  // rect
  let rectCurve = new THREE.CatmullRomCurve3(
    [
      [6, -0.9],
      [7.25, -1.5],
      [7.5, -0.75]
    ].map(p => {return new THREE.Vector3(p[0], p[1], 0)})
  );
  let rectPoints = rectCurve.getSpacedPoints(40);
  let gRect = createFin(bottomPoints, rectPoints, false);

  // pelvic
  let pelvicCurve = new THREE.CatmullRomCurve3(
    [
      [2.25, -0.7],
      [3.75, -2],
      [4, -1]
    ].map(p => {return new THREE.Vector3(p[0], p[1], 0)})
  );
  let pelvicPoints = pelvicCurve.getSpacedPoints(40);

  let gPelvic = createFin(bottomPoints, pelvicPoints, false);
  gPelvic.translate(0, 0.6, 0);
  let gPelvicL = gPelvic.clone();
  gPelvicL.rotateX(THREE.MathUtils.degToRad(-20));
  gPelvicL.translate(0, -0.6, 0);
  let gPelvicR = gPelvic.clone();
  gPelvicR.rotateX(THREE.MathUtils.degToRad(20));
  gPelvicR.translate(0, -0.6, 0);

  let bodyGeom = new THREE.PlaneGeometry(1, 1, divisions, frames.length - 1);
  bodyGeom.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  bodyGeom.setAttribute("parts", new THREE.Float32BufferAttribute(parts, 1));
  bodyGeom.computeVertexNormals();

  let mainGeom = BufferGeometryUtils.mergeGeometries([bodyGeom, gTail, gDorsal, gRect, gPelvicL, gPelvicR]);
  //console.log(mainGeom.attributes.position.count)
  return mainGeom;

  function createFin(basePoints, contourPoints, isTop){
    let basePts = [];
    let shift = 0.05;
    let shiftSign = isTop ? 1 : -1;
    let vAdd = new THREE.Vector3(0, -shift * shiftSign, 0);

    contourPoints.forEach((p, idx) => {
      basePts.push(getPoint(basePoints, p.x).add(vAdd));
    });

    let basePtsRev = basePts.map(p => {return p.clone()}).reverse();
    basePtsRev.shift();

    let contourPointsRev = contourPoints.map(p => {return p.clone()}).reverse();
    contourPointsRev.shift();

    basePts.forEach((p, idx, arr) => {
      if (idx > 0 && idx < arr.length - 1) p.setZ(shift * shiftSign)
    });
    basePtsRev.forEach((p, idx, arr) => {
      if (idx < arr.length - 1) p.setZ(-shift * shiftSign)
    });

    // console.log(contourPoints.length, contourPointsRev.length, basePts.length, basePtsRev.length);

    let fullPoints = [];
    fullPoints = fullPoints.concat(contourPoints, contourPointsRev, basePts, basePtsRev);

    let ps = [];
    let parts = [];
    fullPoints.forEach(p => {
      ps.push(p.x, p.y, p.z);
      parts.push(1);
    });

    let plane = new THREE.PlaneGeometry(1, 1, (contourPoints.length-1) * 2, 1);
    plane.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
    plane.setAttribute("parts", new THREE.Float32BufferAttribute(parts, 1));
    plane.computeVertexNormals();
    return plane;
  }

  function computeFrames(){
    let frames = [];
    let step = 0.05;
    frames.push(new Array(divisions + 1).fill(0).map(p => {return new THREE.Vector3()})); // first frame all 0
    for(let i = step; i < 10; i += step){
      frames.push(getFrame(i));
    }
    frames.push(getFramePoints(topPoints[100], bottomPoints[100], sidePoints[100])); // last frame at tail
    //console.log(frames[frames.length - 1]);
    return frames;
  }

  function getFrame(x){
    let top = getPoint(topPoints, x);
    let bottom = getPoint(bottomPoints, x);
    let side = getPoint(sidePoints, x);
    return getFramePoints(top, bottom, side);
  }

  function getFramePoints(top, bottom, side){
    let sideR = side;
    let sideL = sideR.clone().setZ(sideR.z * -1);
    let baseCurve = new THREE.CatmullRomCurve3([
      bottom,
      sideR,
      top,
      sideL
    ], true);

    let framePoints = baseCurve.getSpacedPoints(divisions);
    return framePoints;
  }

  function getPoint(curvePoints, x){
    let v = new THREE.Vector3();
    for(let i = 0; i < curvePoints.length - 1; i++){
      let i1 = curvePoints[i];
      let i2 = curvePoints[i+1];
      if (x >= i1.x && x <= i2.x){
        let a = (x - i1.x) / (i2.x - i1.x);
        return v.lerpVectors(i1, i2, a);
      }
    }
  }
}


export function createFish(scene) {
  const geom = createFishGeometry();
  const mat  = createFishMaterial();
  const bbox = new THREE.Box3().setFromBufferAttribute(geom.attributes.position);
  mat.userData.uniforms.totalLength.value = bbox.max.x;
  const fishMesh = new THREE.Mesh(geom, mat);

  fishMesh.castShadow = true;                 
  fishMesh.receiveShadow = false;            

  scene.add(fishMesh);
  return { mesh: fishMesh, material: mat };
}