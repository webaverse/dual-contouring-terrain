import metaversefile from 'metaversefile';
// import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
// import { terrainVertex, terrainFragment } from './shaders/terrainShader.js';
import biomeSpecs from './biomes.js';

const {useApp, useLocalPlayer, useScene, useRenderer, useFrame, useMaterials, useCleanup, usePhysics, useLoaders, useInstancing, useDcWorkerManager, useLodder} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localVector4 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();
// const localColor = new THREE.Color();
const localSphere = new THREE.Sphere();
const localBox = new THREE.Box3();

const zeroVector = new THREE.Vector3();

const dcWorkerManager = useDcWorkerManager();
const chunkWorldSize = dcWorkerManager.chunkSize;
const terrainSize = chunkWorldSize * 4;
const chunkRadius = Math.sqrt(chunkWorldSize * chunkWorldSize * 3);
const numLods = 1;
const bufferSize = 20 * 1024 * 1024;

// const textureLoader = new THREE.TextureLoader();
const abortError = new Error('chunk disposed');
const fakeMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
});
const lightTexSize = new THREE.Vector3(terrainSize, terrainSize, terrainSize);

const _copyArray3d = (dstArray, dstSize, dstPosition, srcArray, sourceBox) => {
  const sw = sourceBox.max.x - sourceBox.min.x + 1;
  const sh = sourceBox.max.y - sourceBox.min.y + 1;
  const sd = sourceBox.max.z - sourceBox.min.z + 1;
  
  for (let z = 0; z < sd; z++) {
    const sz = z + sourceBox.min.z;
    const dz = dstPosition.z + z;
    for (let y = 0; y < sh; y++) {
      const sy = y + sourceBox.min.y;
      const dy = dstPosition.y + y;
      let srcIndex = sourceBox.min.x + sy * sw + sz * sw * sh;
      let dstIndex = dstPosition.x + dy * dstSize.x + dz * dstSize.x * dstSize.y;
      for (let x = 0; x < sw; x++) {
        dstArray[dstIndex++] = srcArray[srcIndex++];
      }
    }
  }
};
const _copyArray3dWithin = (array, dstSize, dstPosition, sourceBox) => {
  // note that we need to pay attention to the copy direction
  // if the src < dst, we need to copy backwards
  const sw = sourceBox.max.x - sourceBox.min.x + 1;
  const sh = sourceBox.max.y - sourceBox.min.y + 1;
  const sd = sourceBox.max.z - sourceBox.min.z + 1;

  const flipX = sourceBox.min.x < dstPosition.x;
  const flipY = sourceBox.min.y < dstPosition.y;
  const flipZ = sourceBox.min.z < dstPosition.z;

  const startX = flipX ? sw - 1 : 0;
  const startY = flipY ? sh - 1 : 0;
  const startZ = flipZ ? sd - 1 : 0;

  const endX = flipX ? -1 : sw;
  const endY = flipY ? -1 : sh;
  const endZ = flipZ ? -1 : sd;

  const deltaX = flipX ? -1 : 1;
  const deltaY = flipY ? -1 : 1;
  const deltaZ = flipZ ? -1 : 1;

  for (let z = startZ; z !== endZ; z += deltaZ) {
    const sz = z + sourceBox.min.z;
    const dz = dstPosition.z + z;
    for (let y = startY; y !== endY; y += deltaY) {
      const sy = y + sourceBox.min.y;
      const dy = dstPosition.y + y;
      let srcIndex = startX + sourceBox.min.x + sy * dstSize.x + sz * dstSize.x * dstSize.y;
      let dstIndex = startX + dstPosition.x + dy * dstSize.x + dz * dstSize.x * dstSize.y;
      for (let x = 0; x < sw; x++) {
        array[dstIndex] = array[srcIndex];
        dstIndex += deltaX;
        srcIndex += deltaX;
      }
    }
  }
};
const _writeTex3d = (() => {
  const localVector = new THREE.Vector3();
  const localBox = new THREE.Box3();
  return (dstTex, dstSize, dstPosition, srcArray, sourceBox) => {
    const renderer = useRenderer();

    _copyArray3d(dstTex.image.data, dstSize, dstPosition, srcArray, sourceBox);

    const w = sourceBox.max.x - sourceBox.min.x + 1;
    const h = sourceBox.max.y - sourceBox.min.y + 1;
    const d = sourceBox.max.z - sourceBox.min.z + 1;

    const destinationBox = localBox.set(
      dstPosition,
      localVector.set(dstPosition.x + w - 1, dstPosition.y + h - 1, dstPosition.z + d - 1),
    );

    const level = 0;

    renderer.copyTextureToTexture3D(destinationBox, dstPosition, dstTex, dstTex, level);
  };
})();
const _writeTex3dWithin = (() => {
  const localVector = new THREE.Vector3();
  const localBox = new THREE.Box3();
  return (dstTex, dstSize, dstPosition, sourceBox) => {
    const renderer = useRenderer();

    _copyArray3dWithin(dstTex.image.data, dstSize, dstPosition, sourceBox);
    
    const w = sourceBox.max.x - sourceBox.min.x + 1;
    const h = sourceBox.max.y - sourceBox.min.y + 1;
    const d = sourceBox.max.z - sourceBox.min.z + 1;

    const destinationBox = localBox.set(
      dstPosition,
      localVector.set(dstPosition.x + w - 1, dstPosition.y + h - 1, dstPosition.z + d - 1),
    );

    const level = 0;

    renderer.copyTextureToTexture3D(destinationBox, dstPosition, dstTex, dstTex, level);
  };
})();

const mapNames = [
  'Base_Color',
  'Height',
  'Normal',
  'Roughness',
  'Emissive',
  'Ambient_Occlusion',
];
const biomesPngTexturePrefix = `/images/stylized-textures/png/`;
const biomesKtx2TexturePrefix = `/images/land-textures/`;
const neededTexturePrefixes = (() => {
  const neededTexturePrefixesSet = new Set();
  for (const biomeSpec of biomeSpecs) {
    const [name, colorHex, textureName] = biomeSpec;
    neededTexturePrefixesSet.add(textureName);
  }
  const neededTexturePrefixes = Array.from(neededTexturePrefixesSet);
  return neededTexturePrefixes;
})();
const texturesPerRow = Math.ceil(Math.sqrt(neededTexturePrefixes.length));

const loadImage = u => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    resolve(img);
  };
  img.onerror = err => {
    if (/Emissive/i.test(u)) {
      const blankCanvas = document.createElement('canvas');
      blankCanvas.width = 1;
      blankCanvas.height = 1;
      resolve(blankCanvas);
    } else {
      reject(err);
    }
  };
  img.crossOrigin = 'Anonymous';
  img.src = u;
});
function downloadFile(file, filename) {
  const blobURL = URL.createObjectURL(file);
  const tempLink = document.createElement('a');
  tempLink.style.display = 'none';
  tempLink.href = blobURL;
  tempLink.setAttribute('download', filename);

  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
}
// this method generates a deduplicted texture atlas for the texture sets used in the mesh
// the output can be used by ./scripts/build-megatexture-atlas.sh to turn it into a KTX2 texture atlas
const bakeBiomesAtlas = async ({
  size = 8 * 1024,
} = {}) => {
  const atlasTextures = [];
  const textureTileSize = size / texturesPerRow;
  const halfTextureTileSize = textureTileSize / 2;

  for (const mapName of mapNames) {
    const neededTextureNames = neededTexturePrefixes.map(prefix => `${prefix}${mapName}`);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    document.body.appendChild(canvas);
    canvas.style.cssText = `\
      position: fixed;
      top: 0;
      left: 0;
      z-index: 100;
      width: 1024px;
      height: 1024px;
    `;

    let index = 0;
    for (const textureName of neededTextureNames) {
      const x = index % texturesPerRow;
      const y = Math.floor(index / texturesPerRow);

      const u = biomesPngTexturePrefix + textureName + '.png';
      const img = await loadImage(u);
      console.log('load u', u, textureName, img.width, img.height);

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          ctx.drawImage(
            img,
            x * textureTileSize + halfTextureTileSize * dx,
            y * textureTileSize + halfTextureTileSize * dy,
            halfTextureTileSize,
            halfTextureTileSize
          );
        }
      }
      atlasTextures.push({
        name: textureName,
        uv: [
          x * textureTileSize / size,
          y * textureTileSize / size,
          (x + 1) * textureTileSize / size,
          (y + 1) * textureTileSize / size,
        ],
      });
    
      index++;
    }

    const canvasBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(resolve, 'image/png');
    });
    downloadFile(canvasBlob, `${mapName}.png`);

    document.body.removeChild(canvas);
  }

  // const atlasJson = {
  //   textures: atlasTextures,
  // };
  // const atlasJsonString = JSON.stringify(atlasJson, null, 2);
  // const atlasJsonBlob = new Blob([atlasJsonString], {type: 'application/json'});
  // downloadFile(atlasJsonBlob, `megatexture-atlas.json`);
};
// window.bakeBiomesAtlas = bakeBiomesAtlas;

const {BatchedMesh} = useInstancing();
class TerrainMesh extends BatchedMesh {
  constructor({
    physics,
    biomeUvDataTexture,
    atlasTextures,
  }) {
    const allocator = new dcWorkerManager.constructor.GeometryAllocator([
      {
        name: 'position',
        Type: Float32Array,
        itemSize: 3,
      },
      {
        name: 'normal',
        Type: Float32Array,
        itemSize: 3,
      },
      {
        name: 'biomes',
        Type: Int32Array,
        itemSize: 4,
      },
      {
        name: 'biomesWeights',
        Type: Float32Array,
        itemSize: 4,
      },
    ], {
      bufferSize,
      boundingType: 'sphere',
    });
    const {geometry} = allocator;

    /* const earthTexture = textureLoader.load(
      baseUrl + 'assets/textures/EarthBaseColor1.png'
    );
    earthTexture.wrapS = earthTexture.wrapT = THREE.RepeatWrapping;
    earthTexture.encoding = THREE.sRGBEncoding;
    const earthNormal = textureLoader.load(
      baseUrl + 'assets/textures/EarthNormal1.png'
    );
    earthNormal.wrapS = earthNormal.wrapT = THREE.RepeatWrapping;

    const grassTexture = textureLoader.load(
      baseUrl + 'assets/textures/GrassBaseColor1.png'
    );
    grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
    const grassNormal = textureLoader.load(
      baseUrl + 'assets/textures/GrassNormal1.png'
    )
    grassNormal.wrapS = grassNormal.wrapT = THREE.RepeatWrapping */

    const skylightData = new Uint8Array(lightTexSize.x * lightTexSize.y * lightTexSize.z)//.fill(1);
    const skylightTex = new THREE.DataTexture3D(skylightData, lightTexSize.x, lightTexSize.y, lightTexSize.z);
    skylightTex.format = THREE.RedFormat;
    skylightTex.type = THREE.UnsignedByteType;
    skylightTex.minFilter = THREE.LinearFilter;
    skylightTex.magFilter = THREE.LinearFilter;
    // skylightTex.minFilter = THREE.NearestFilter;
    // skylightTex.magFilter = THREE.NearestFilter;
    skylightTex.flipY = false;
    skylightTex.needsUpdate = true;
    skylightTex.generateMipmaps = false;

    const aoData = new Uint8Array(lightTexSize.x * lightTexSize.y * lightTexSize.z)//.fill(1);
    const aoTex = new THREE.DataTexture3D(aoData, lightTexSize.x, lightTexSize.y, lightTexSize.z);
    aoTex.format = THREE.RedFormat;
    aoTex.type = THREE.UnsignedByteType;
    aoTex.minFilter = THREE.LinearFilter;
    aoTex.magFilter = THREE.LinearFilter;
    // aoTex.minFilter = THREE.NearestFilter;
    // aoTex.magFilter = THREE.NearestFilter;
    aoTex.flipY = false;
    aoTex.needsUpdate = true;
    aoTex.generateMipmaps = false;

    const material = new THREE.MeshStandardMaterial({
      map: new THREE.Texture(),
      normalMap: new THREE.Texture(),
      emissiveMap: new THREE.Texture(),
      // normalScale: new THREE.Vector2(50, 50),
      // normalMapType: THREE.ObjectSpaceNormalMap,
      bumpMap: new THREE.Texture(),
      // bumpScale: 1,
      // roughness: 1,
      roughnessMap: new THREE.Texture(),
      aoMap: new THREE.Texture(),
      // transparent: true,
      onBeforeCompile: (shader) => {
        for (const k in material.uniforms) {
          shader.uniforms[k] = material.uniforms[k];
        }

        // vertex shader

        shader.vertexShader = shader.vertexShader.replace(`#include <uv_pars_vertex>`, `\
#ifdef USE_UV
	#ifdef UVS_VERTEX_ONLY
		vec2 vUv;
	#else
		varying vec2 vUv;
	#endif
	uniform mat3 uvTransform;
#endif

attribute ivec4 biomes;
attribute vec4 biomesWeights;
uniform vec3 uLightBasePosition;
uniform float uTerrainSize;
flat varying ivec4 vBiomes;
varying vec4 vBiomesWeights;
varying vec3 vPosition;
// varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
// varying vec3 vUvLight;
        `);
        shader.vertexShader = shader.vertexShader.replace(`#include <worldpos_vertex>`, `\
// #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION )
  vPosition = transformed;
  vec4 worldPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
  #endif
  worldPosition = modelMatrix * worldPosition;
// #endif

// vWorldPosition = worldPosition.xyz; // XXX use local position instead of world position?
vWorldNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
vBiomes = biomes;
vBiomesWeights = biomesWeights;
// vUvLight = (vPosition - uLightBasePosition); // / uTerrainSize;
        `);

        // fragment shader

        shader.fragmentShader = shader.fragmentShader.replace(`#include <map_pars_fragment>`, `\
#ifdef USE_MAP
  // uniform sampler2D map;
#endif

precision highp sampler3D;

uniform sampler2D Base_Color;
uniform sampler2D Emissive;
uniform sampler2D Normal;
uniform sampler2D Roughness;
uniform sampler2D Ambient_Occlusion;
uniform sampler2D Height;
uniform sampler2D biomeUvDataTexture;
uniform sampler3D uSkylightTex;
uniform sampler3D uAoTex;
uniform vec3 uLightBasePosition;
uniform float uTerrainSize;
flat varying ivec4 vBiomes;
varying vec4 vBiomesWeights;
varying vec3 vPosition;
varying vec3 vWorldNormal;
// varying vec3 vUvLight;

vec4 fourTapSample(
  sampler2D atlas,
  vec2 tileUV,
  vec2 tileOffset,
  vec2 tileSize
) {
  //Initialize accumulators
  vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
  float totalWeight = 0.0;

  for (int dx=0; dx<2; ++dx) {
    for (int dy=0; dy<2; ++dy) {
      //Compute coordinate in 2x2 tile patch
      vec2 tileCoord = 2.0 * fract(0.5 * (tileUV + vec2(dx,dy)));

      //Weight sample based on distance to center
      float w = pow(1.0 - max(abs(tileCoord.x-1.0), abs(tileCoord.y-1.0)), 16.0);

      //Compute atlas coord
      vec2 atlasUV = tileOffset + tileSize * tileCoord;

      //Sample and accumulate
      color += w * texture2D(atlas, atlasUV);
      totalWeight += w;
    }
  }

  return color / totalWeight;
}
vec4 triplanarMap(sampler2D Base_Color, vec3 position, vec3 normal) {
  // Triplanar mapping
  vec2 tx = position.yz;
  vec2 ty = position.zx;
  vec2 tz = position.xy;

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;

  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));

  vec4 cx = fourTapSample(Base_Color, tx, tileOffset, tileSize) * bf.x;
  vec4 cy = fourTapSample(Base_Color, ty, tileOffset, tileSize) * bf.y;
  vec4 cz = fourTapSample(Base_Color, tz, tileOffset, tileSize) * bf.z;
  
  vec4 color = cx + cy + cz;
  return color;
}
vec4 triplanarMapDx(sampler2D Base_Color, vec3 position, vec3 normal) {
  // Triplanar mapping
  vec2 tx = position.yz;
  vec2 ty = position.zx;
  vec2 tz = position.xy;

  vec2 txDx = dFdx(tx);
  vec2 tyDx = dFdx(ty);
  vec2 tzDx = dFdx(tz);

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;

  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));

  vec4 cx = fourTapSample(Base_Color, tx + txDx, tileOffset, tileSize) * bf.x;
  vec4 cy = fourTapSample(Base_Color, ty + tyDx, tileOffset, tileSize) * bf.y;
  vec4 cz = fourTapSample(Base_Color, tz + tzDx, tileOffset, tileSize) * bf.z;
  
  vec4 color = cx + cy + cz;
  return color;
}
vec4 triplanarMapDy(sampler2D Base_Color, vec3 position, vec3 normal) {
  // Triplanar mapping
  vec2 tx = position.yz;
  vec2 ty = position.zx;
  vec2 tz = position.xy;

  vec2 txDy = dFdy(tx);
  vec2 tyDy = dFdy(ty);
  vec2 tzDy = dFdy(tz);

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;

  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));

  vec4 cx = fourTapSample(Base_Color, tx + txDy, tileOffset, tileSize) * bf.x;
  vec4 cy = fourTapSample(Base_Color, ty + tyDy, tileOffset, tileSize) * bf.y;
  vec4 cz = fourTapSample(Base_Color, tz + tzDy, tileOffset, tileSize) * bf.z;
  
  vec4 color = cx + cy + cz;
  return color;
}
vec4 triplanarNormal(sampler2D Normal, vec3 position, vec3 normal) {
  // Tangent Reconstruction
  // Triplanar uvs
  vec2 uvX = position.zy;
  vec2 uvY = position.xz;
  vec2 uvZ = position.xy;

  vec2 tileOffset = texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
  const vec2 tileSize = vec2(1. / ${texturesPerRow.toFixed(8)}) * 0.5;
  
  vec3 bf = normalize(abs(normal));
  bf /= dot(bf, vec3(1.));
  
  vec4 cx = fourTapSample(Normal, uvX, tileOffset, tileSize);
  vec4 cy = fourTapSample(Normal, uvY, tileOffset, tileSize);
  vec4 cz = fourTapSample(Normal, uvZ, tileOffset, tileSize);

  cx = cx * 2. - 1.;
  cy = cy * 2. - 1.;
  cz = cz * 2. - 1.;

  cx *= bf.x;
  cy *= bf.y;
  cz *= bf.z;

  cx = (cx + 1.) / 2.;
  cy = (cy + 1.) / 2.;
  cz = (cz + 1.) / 2.;

  vec4 color = cx + cy + cz;
  return color;

  /* // Get the sign (-1 or 1) of the surface normal
  vec3 axis = sign(vNormal);

  // Construct tangent to world matrices for each axis
  vec3 tangentX = normalize(cross(vNormal, vec3(0.0, axis.x, 0.0)));
  vec3 bitangentX = normalize(cross(tangentX, vNormal)) * axis.x;
  mat3 tbnX = mat3(tangentX, bitangentX, vNormal);
  vec3 tangentY = normalize(cross(vNormal, vec3(0.0, 0.0, axis.y)));
  vec3 bitangentY = normalize(cross(tangentY, vNormal)) * axis.y;
  mat3 tbnY = mat3(tangentY, bitangentY, vNormal);
  vec3 tangentZ = normalize(cross(vNormal, vec3(0.0, -axis.z, 0.0)));
  vec3 bitangentZ = normalize(-cross(tangentZ, vNormal)) * axis.z;
  mat3 tbnZ = mat3(tangentZ, bitangentZ, vNormal);
  // Apply tangent to world matrix and triblend
  // Using clamp() because the cross products may be NANs
  vec3 worldNormal = normalize(
      clamp(tbnX * tx, -1.0, 1.0) * bf.x +
      clamp(tbnY * ty, -1.0, 1.0) * bf.y +
      clamp(tbnZ * tz, -1.0, 1.0) * bf.z
  );
  return vec4(worldNormal, 0.0); */
}

void setBiome(int biome, out vec4 diffuseSample){
  // uber shader for biomes
  if(biome == 4){
    // diffuseSample *= vec4(0, 0, 1, 1);
  }else{
    // diffuseSample = vec4(1, 0, 0, 1);
  }
}

vec4 blendBiomes(vec4 samples[4]) {
  vec4 a = samples[0];
  vec4 b = samples[1];
  vec4 c = samples[2];
  vec4 d = samples[3];
  float weightSum = vBiomesWeights.x + vBiomesWeights.y + vBiomesWeights.z + vBiomesWeights.w;
  return (a*vBiomesWeights.x + b*vBiomesWeights.y + c*vBiomesWeights.z + d*vBiomesWeights.w) / weightSum;
}

vec4 createBlendedBiome(vec4 diffuseSample){
  vec4 ds = diffuseSample;
  vec4 diffuseSamples[4];
  for (int i = 0; i < 4; i++) {
    diffuseSamples[i] = ds;
  }
  setBiome(vBiomes.x, diffuseSamples[0]);
  setBiome(vBiomes.y, diffuseSamples[1]);
  setBiome(vBiomes.z, diffuseSamples[2]);
  setBiome(vBiomes.w, diffuseSamples[3]);
  vec4 diffuseBlended = blendBiomes(diffuseSamples);
  ds *= diffuseBlended;
  return ds;
}

        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <bumpmap_pars_fragment>`, `\
#ifdef USE_BUMPMAP
	// uniform sampler2D bumpMap;
	uniform float bumpScale;
	// Bump Mapping Unparametrized Surfaces on the GPU by Morten S. Mikkelsen
	// https://mmikk.github.io/papers3d/mm_sfgrad_bump.pdf
	// Evaluate the derivative of the height w.r.t. screen-space using forward differencing (listing 2)
	vec2 dHdxy_fwd() {
		// vec2 dSTdx = dFdx( vUv );
		// vec2 dSTdy = dFdy( vUv );

		float Hll = bumpScale * triplanarMap( Normal, vPosition, vWorldNormal ).x;
		float dBx = bumpScale * triplanarMapDx( Normal, vPosition, vWorldNormal ).x - Hll;
		float dBy = bumpScale * triplanarMapDy( Normal, vPosition, vWorldNormal ).x - Hll;
    return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		// Workaround for Adreno 3XX dFd*( vec3 ) bug. See #9988
		vec3 vSigmaX = vec3( dFdx( surf_pos.x ), dFdx( surf_pos.y ), dFdx( surf_pos.z ) );
		vec3 vSigmaY = vec3( dFdy( surf_pos.x ), dFdy( surf_pos.y ), dFdy( surf_pos.z ) );
		vec3 vN = surf_norm;		// normalized
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <roughnessmap_fragment>`, `\
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = triplanarMap( Roughness, vPosition, vWorldNormal );
	// reads channel G, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
	roughnessFactor *= texelRoughness.g;
#endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <normal_fragment_maps>`, `\
#ifdef OBJECTSPACE_NORMALMAP
	normal = triplanarNormal(Normal, vPosition, vWorldNormal).xyz /*texture2D( normalMap, vUv ).xyz*/ * 2.0 - 1.0; // overrides both flatShading and attribute normals
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal ) * 10.;
#elif defined( TANGENTSPACE_NORMALMAP )
	vec3 mapN = triplanarNormal(Normal, vPosition, vWorldNormal).xyz /*texture2D( normalMap, vUv ).xyz*/ * 2.0 - 1.0;
	mapN.xy *= normalScale;
	#ifdef USE_TANGENT
		normal = normalize( vTBN * mapN );
  #else
		normal = perturbNormal2Arb( - vViewPosition, normal, mapN, faceDirection );
	#endif
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <map_fragment>`, `\
#ifdef USE_MAP
  vec4 sampledDiffuseColor = triplanarMap(Base_Color, vPosition, vWorldNormal);
  sampledDiffuseColor.a = 1.;
  #ifdef DECODE_VIDEO_TEXTURE
    // inline sRGB decode (TODO: Remove this code when https://crbug.com/1256340 is solved)
    sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
  #endif
  vec4 blendedBiomeColor = createBlendedBiome(sampledDiffuseColor);
  diffuseColor *= blendedBiomeColor;
#endif

// lighting
{
  const float numLightBands = 8.;

  vec3 uvLight = (vPosition - uLightBasePosition) / uTerrainSize; // XXX this can be interpolated in the vertex shader
  // uvLight.y += 2. / uTerrainSize;
  // uvLight = 1. - uvLight.y;
  // uvLight.y = 1. - uvLight.y;
  float lightValue = 1.;

  // skylight
  {
    vec4 skylightColor = texture(uSkylightTex, uvLight);
    float skylightValue = skylightColor.r * 255.;

    const float maxSkylight = 8.;
    skylightValue /= maxSkylight;
    // skylightValue *= 0.5;
    // skylightValue = ceil(skylightValue * numLightBands) / numLightBands;

    lightValue *= skylightValue;
  }
  // ao
  {
    vec4 aoColor = texture(uAoTex, uvLight);
    float aoValue = aoColor.r * 255.;
    
    const float discount = 0.;
    const float maxAo = (27. - discount);
    const float baseAo = 0.3;
    // const float baseAo = 0.;
    aoValue -= discount;
    aoValue /= maxAo;
    aoValue = baseAo + aoValue * (1. - baseAo);
    
    lightValue *= aoValue;
  }

  // apply lighting
  lightValue *= 2.;
  // lightValue = ceil(lightValue * numLightBands) / numLightBands;
  diffuseColor.rgb *= lightValue;

  // diffuseColor.rgb += uvLight;
  // diffuseColor.rgb += uvLight * 0.05;
  // vec4 aoColor = texture(uAoTex, uvLight);

  if (uvLight.x <= 0. || uvLight.x >= uTerrainSize || uvLight.z <= 0. || uvLight.z >= uTerrainSize || uvLight.y <= 0. || uvLight.y >= uTerrainSize) {
    diffuseColor.rgb = vec3(0.);
  }
  diffuseColor.a = 1.;
}
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <aomap_fragment>`, `\
#ifdef USE_AOMAP
  // reads channel R, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
  float ambientOcclusion = ( triplanarMap( Ambient_Occlusion, vPosition, vWorldNormal ).r /* * - 1.0 */ ) * aoMapIntensity /* + 1.0 */;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
#endif
        `);
        return shader;
      },
    });
    const lightBasePosition = new THREE.Vector3(
      -terrainSize/2,
      0,
      -terrainSize/2
    );
    material.uniforms = (() => {
      const uniforms = {};
      
      // biomes uv index texture
      uniforms.biomeUvDataTexture = {
        value: biomeUvDataTexture,
        needsUpdate: true,
      };
      // texture atlas
      for (const mapName of mapNames) {
        uniforms[mapName] = {
          value: atlasTextures[mapName],
          needsUpdate: true,
        };
      }
      // lighting
      uniforms.uSkylightTex = {
        value: skylightTex,
        needsUpdate: true,
      };
      uniforms.uAoTex = {
        value: aoTex,
        needsUpdate: true,
      };
      uniforms.uLightBasePosition = {
        value: lightBasePosition,
        needsUpdate: true,
      };
      uniforms.uTerrainSize = {
        value: terrainSize,
        needsUpdate: true,
      };

      return uniforms;
    })();
    super(geometry, material, allocator);
    this.frustumCulled = false;

    this.physics = physics;
    this.allocator = allocator;
    this.physicsObjects = [];

    this.skylightTex = skylightTex;
    this.aoTex = aoTex;
  }
  async addChunk(chunk, {
    signal,
  }) {
    const meshData = await dcWorkerManager.generateChunkRenderable(chunk, chunk.lodArray, {
      signal,
    });
    const geometryBuffer = await this.getChunkGeometryBufferAsync(meshData, {
      signal,
    });
    this.drawChunk(chunk, meshData, geometryBuffer, signal);
  }
  async getChunkGeometryBufferAsync(meshData, {
    signal,
  }) {
    if (meshData) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
      const physicsMesh = new THREE.Mesh(geometry, fakeMaterial);
  
      const geometryBuffer = await this.physics.cookGeometryAsync(physicsMesh, {
        signal,
      });
      // XXX should clean up if we bail out

      return geometryBuffer;
    } else {
      return null;
    }
  }
  drawChunk(chunk, meshData, geometryBuffer, signal) {
    if (meshData) { // non-empty chunk
      const _mapOffsettedIndices = (srcIndices, dstIndices, dstOffset, positionOffset) => {
        const positionIndex = positionOffset / 3;
        for (let i = 0; i < srcIndices.length; i++) {
          dstIndices[dstOffset + i] = srcIndices[i] + positionIndex;
        }
      };
      const _renderMeshDataToGeometry = (meshData, geometry, geometryBinding) => {
        let positionOffset = geometryBinding.getAttributeOffset('position');
        let normalOffset = geometryBinding.getAttributeOffset('normal');
        let biomesOffset = geometryBinding.getAttributeOffset('biomes');
        let biomesWeightsOffset = geometryBinding.getAttributeOffset('biomesWeights');
        let indexOffset = geometryBinding.getIndexOffset();

        _mapOffsettedIndices(meshData.indices, geometry.index.array, indexOffset, positionOffset);

        geometry.attributes.position.update(positionOffset, meshData.positions.length, meshData.positions, 0);
        geometry.attributes.normal.update(normalOffset, meshData.normals.length, meshData.normals, 0);
        geometry.attributes.biomes.update(biomesOffset, meshData.biomes.length, meshData.biomes, 0);
        geometry.attributes.biomesWeights.update(biomesWeightsOffset, meshData.biomesWeights.length, meshData.biomesWeights, 0);
        geometry.index.update(indexOffset, meshData.indices.length);
      };
      const _handleMesh = () => {
        localSphere.center.set((chunk.x + 0.5) * chunkWorldSize, (chunk.y + 0.5) * chunkWorldSize, (chunk.z + 0.5) * chunkWorldSize)
          .applyMatrix4(this.matrixWorld);
        localSphere.radius = chunkRadius;
        const geometryBinding = this.allocator.alloc(
          meshData.positions.length,
          meshData.indices.length,
          localSphere
        );
        _renderMeshDataToGeometry(meshData, this.allocator.geometry, geometryBinding);

        signal.addEventListener('abort', e => {
          this.allocator.free(geometryBinding);
        });
      };
      _handleMesh();

      const _handleLighting = () => {
        const renderer = useRenderer();

        const position = localVector.copy(chunk)
          .multiplyScalar(chunkWorldSize)
          .sub(this.material.uniforms.uLightBasePosition.value);
        // console.log('got position', position.x, position.y, position.z);
        if (
          position.x >= 0 && position.x < terrainSize &&
          position.y >= 0 && position.y < terrainSize &&
          position.z >= 0 && position.z < terrainSize
        ) {
          const sourceBox = localBox.set(
            localVector2.set(0, 0, 0),
            localVector3.set(chunkWorldSize - 1, chunkWorldSize - 1, chunkWorldSize - 1)
          );
          // const level = 0;

          _writeTex3d(this.skylightTex, lightTexSize, position, meshData.skylights, sourceBox);
          _writeTex3d(this.aoTex, lightTexSize, position, meshData.aos, sourceBox);
        } else {
          // chunk out of lighting range
        }
      };
      _handleLighting();

      const _handlePhysics = async () => {
        this.matrixWorld.decompose(localVector, localQuaternion, localVector2);
        const physicsObject = this.physics.addCookedGeometry(geometryBuffer, localVector, localQuaternion, localVector2);
        this.physicsObjects.push(physicsObject);
        
        // console.log('cook 3', mesh);

        signal.addEventListener('abort', e => {
          this.physics.removeGeometry(physicsObject);
          this.physicsObjects.splice(this.physicsObjects.indexOf(physicsObject), 1);
        });
      };
      _handlePhysics();
    }
  }
  updateCoord(coord, min2xCoord) {
    const lastPosition = this.material.uniforms.uLightBasePosition.value;
    const newPosition = localVector.copy(min2xCoord).multiplyScalar(chunkWorldSize);
    const deltaNegative = localVector2.copy(lastPosition)
      .sub(newPosition);

    if (!deltaNegative.equals(zeroVector)) {
      const position = deltaNegative;
      const sourceBox = localBox.set(
        localVector3.set(0, 0, 0),
        localVector4.set(terrainSize - 1, terrainSize - 1, terrainSize - 1)
      );

      // clip to texture bounds
      if (position.x < 0) {
        const deltaX = -position.x;
        sourceBox.min.x += deltaX;
        position.x += deltaX;
      } else if (position.x > 0) {
        sourceBox.max.x -= position.x;
      }
      if (position.y < 0) {
        const deltaY = -position.y;
        sourceBox.min.y += deltaY;
        position.y += deltaY;
      } else if (position.y > 0) {
        sourceBox.max.y -= position.y;
      }
      if (position.z < 0) {
        const deltaZ = -position.z;
        sourceBox.min.z += deltaZ;
        position.z += deltaZ;
      } else if (position.z > 0) {
        sourceBox.max.z -= position.z;
      }

      _writeTex3dWithin(this.skylightTex, lightTexSize, position, sourceBox);
      _writeTex3dWithin(this.aoTex, lightTexSize, position, sourceBox);

      this.material.uniforms.uLightBasePosition.value.copy(newPosition);
      this.material.uniforms.uLightBasePosition.needsUpdate = true;
    }
  }
}

class TerrainChunkGenerator {
  constructor({
    physics,
    biomeUvDataTexture,
    atlasTextures,
  } = {}) {
    // parameters
    this.physics = physics;
    this.biomeUvDataTexture = biomeUvDataTexture;
    this.atlasTextures = atlasTextures;

    // mesh
    this.object = new THREE.Group();
    this.object.name = 'terrain-chunk-generator';

    this.terrainMesh = new TerrainMesh({
      physics: this.physics,
      biomeUvDataTexture: this.biomeUvDataTexture,
      atlasTextures: this.atlasTextures,
    });
    this.object.add(this.terrainMesh);
  }

  getMeshes() {
    return this.object.children;
  }
  getPhysicsObjects() {
    // console.log('get physics object', this.terrainMesh.physicsObjects);
    return this.terrainMesh.physicsObjects;
  }

  generateChunk(chunk) {
    const signal = this.bindChunk(chunk);

    this.terrainMesh.addChunk(chunk, {
      signal,
    }).catch(err => {
      if (err !== abortError) {
        console.warn(err);
      }
    });
  }
  disposeChunk(chunk) {
    const binding = chunk.binding;
    if (binding) {
      const {abortController} = binding;
      abortController.abort(abortError);

      chunk.binding = null;
    }
  }

  bindChunk(chunk) {
    const abortController = new AbortController();
    const {signal} = abortController;

    chunk.binding = {
      abortController,
      // signal,
    };

    return signal;
  }

  async hit(e, tracker) {
    const {LodChunk} = useLodder();

    // perform damage
    const hitPosition = localVector.copy(e.hitPosition)
      .applyMatrix4(localMatrix.copy(this.terrainMesh.matrixWorld).invert());
    const chunks = await dcWorkerManager.drawSphereDamage(hitPosition, 3);
    if (chunks) {
      // generate the new chunks
      let meshSpecs = await Promise.all(chunks.map(async chunkSpec => {
        const lodArray = Array(8).fill(1);
        const chunk = new LodChunk(
          chunkSpec.position[0],
          chunkSpec.position[1],
          chunkSpec.position[2],
          lodArray
        )
          .divideScalar(chunkWorldSize);
        const signal = this.bindChunk(chunk);
        const meshData = await dcWorkerManager.generateChunkRenderable(chunk, chunk.lodArray, {
          signal,
        });
        if (meshData) {
          const geometryBuffer = await this.terrainMesh.getChunkGeometryBufferAsync(meshData, {
            signal,
          });
          return {
            chunk,
            meshData,
            geometryBuffer,
            signal,
          };
        } else {
          return null;
        }
      }));
      meshSpecs = meshSpecs.filter(m => m !== null);
      // remove old chunks
      tracker.chunks = tracker.chunks.filter(chunk => {
        if (!meshSpecs.some(meshSpec => {
          return meshSpec.chunk.equals(chunk);
        })) { // not being replaced
          return true;
        } else { // being replaced
          this.disposeChunk(chunk);
          return false;
        }
      });
      // add new chunks
      for (const meshSpec of meshSpecs) {
        const {chunk, meshData, geometryBuffer, signal} = meshSpec;
        this.terrainMesh.drawChunk(chunk, meshData, geometryBuffer, signal);
        tracker.chunks.push(chunk);
      }
    } else {
      console.log('no update');
    }
  }

  update(timestamp, timeDiff) {
    for (const mesh of this.getMeshes()) {
      mesh.update(timestamp, timeDiff);
    }
  }

  destroy() {
    // nothing; the owning lod tracker disposes of our contents
  }
}

export default (e) => {
  const app = useApp();
  const physics = usePhysics();
  const {LodChunkTracker} = useLodder();

  app.name = 'dual-contouring-terrain';

  let live = true;
  let generator = null;
  let tracker = null;
  e.waitUntil((async () => {
    // this small texture maps biome indexes in the geometry to biome uvs in the atlas texture
    const biomeUvDataTexture = (() => {
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < biomeSpecs.length; i++) {
        const biomeSpec = biomeSpecs[i];
        const [name, colorHex, textureName] = biomeSpec;
        
        const biomeAtlasIndex = neededTexturePrefixes.indexOf(textureName);
        if (biomeAtlasIndex === -1) {
          throw new Error('no such biome: ' + textureName);
        }
        
        const x = biomeAtlasIndex % texturesPerRow;
        const y = Math.floor(biomeAtlasIndex / texturesPerRow);
        
        data[i * 4] = x / texturesPerRow * 255;
        data[i * 4 + 1] = y / texturesPerRow * 255;
        data[i * 4 + 2] = 0;
        data[i * 4 + 3] = 255;
      }
      const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      return texture;
    })();
    // window.biomeUvDataTexture = biomeUvDataTexture;

    const {ktx2Loader} = useLoaders();
    const atlasTexturesArray = await Promise.all(mapNames.map(mapName => new Promise((accept, reject) => {
      ktx2Loader.load(`${biomesKtx2TexturePrefix}build/8k/${mapName}.ktx2`, accept, function onprogress(e) {}, reject);
    })));
    // window.atlasTexturesArray = atlasTexturesArray;
    if (!live) return;
    
    const atlasTextures = {};
    for (let i = 0; i < mapNames.length; i++) {
      // atlasTexturesArray[i].needsUpdate = true;
      // atlasTexturesArray[i].wrapS = THREE.RepeatWrapping;
      // atlasTexturesArray[i].wrapT = THREE.RepeatWrapping;
      const compressedTexture = atlasTexturesArray[i];
      // compressedTexture.encoding = (mapNames === 'Base_Color' || mapNames === 'Emissive') ? THREE.sRGBEncoding : THREE.LinearEncoding;
      compressedTexture.anisotropy = 16;
      // compressedTexture.premultiplyAlpha = true;
      atlasTextures[mapNames[i]] = compressedTexture;
    }

    generator = new TerrainChunkGenerator({
      physics,
      biomeUvDataTexture,
      atlasTextures,
    });
    tracker = new LodChunkTracker(generator, {
      chunkWorldSize,
      numLods,
      chunkHeight: chunkWorldSize,
    });
    tracker.addEventListener('coordupdate', coordupdate);

    app.add(generator.object);
    generator.object.updateMatrixWorld();
  })());

  app.getPhysicsObjects = () => generator ? generator.getPhysicsObjects() : [];

  // console.log('got hit tracker', app.hitTracker);
  app.addEventListener('hit', e => {
    generator && tracker && generator.hit(e, tracker);
  });

  const coordupdate = e => {
    const {coord, min2xCoord} = e.data;
    generator.terrainMesh.updateCoord(coord, min2xCoord);
  };

  useFrame(() => {
    if (tracker) {
      const localPlayer = useLocalPlayer();
      localMatrix.copy(localPlayer.matrixWorld)
        .premultiply(
          localMatrix2.copy(app.matrixWorld).invert()
        )
        .decompose(localVector, localQuaternion, localVector2);
      tracker.update(localVector);
    }
  });

  useCleanup(() => {
    live = false;
    if (tracker) {
      tracker.destroy();
      tracker.removeEventListener('coordupdate', coordupdate);
    }
  });

  return app
}