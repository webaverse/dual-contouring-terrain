import metaversefile from 'metaversefile';
import * as THREE from 'three';
import {texturesPerRow, biomeUvDataTexture, mapNames, biomesKtx2TexturePrefix} from './biomes.js';

const {
  useApp,
  useCamera,
  useLocalPlayer,
  // useScene,
  // useRenderer,
  useFrame,
  // useMaterials,
  useCleanup,
  usePhysics,
  useLoaders,
  useInstancing,
  useProcGenManager,
  useLodder,
} = metaversefile;

// const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3D = new THREE.Vector3();
const localVector3D2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();
const localSphere = new THREE.Sphere();

//

// const liveChunks = [];
// const zeroVector = new THREE.Vector3();

const procGenManager = useProcGenManager();
const chunkWorldSize = procGenManager.chunkSize;
const terrainSize = chunkWorldSize * 4;
const chunkRadius = Math.sqrt(chunkWorldSize * chunkWorldSize * 3);
const defaultNumNods = 2;
const defaultMinLodRange = 2;
const bufferSize = 4 * 1024 * 1024;

const abortError = new Error('chunk disposed');
abortError.isAbortError = true;
const fakeMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
});

class ChunkRenderData {
  constructor(meshData, geometryBuffer) {
    this.meshData = meshData;
    this.geometryBuffer = geometryBuffer;
  }
}

const { BatchedMesh, GeometryAllocator } = useInstancing();
class TerrainMesh extends BatchedMesh {
  constructor({
    procGenInstance,
    physics,
    biomeUvDataTexture,
    atlasTextures,
    appMatrix
  }) {
    const allocator = new GeometryAllocator(
      [
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
        /* {
          name: 'biomes',
          Type: Int32Array,
          itemSize: 4,
        }, */
        {
          name: 'biomesWeights',
          Type: Float32Array,
          itemSize: 4,
        },
        {
          name: 'biomesUvs1',
          Type: Float32Array,
          itemSize: 4,
        },
        {
          name: 'biomesUvs2',
          Type: Float32Array,
          itemSize: 4,
        },
        {
          name: 'skylights',
          Type: Uint8Array,
          itemSize: 1,
        },
        {
          name: 'aos',
          Type: Uint8Array,
          itemSize: 1,
        },
        {
          name: 'peeks',
          Type: Uint8Array,
          itemSize: 1,
        },
      ],
      {
        bufferSize,
        boundingType: 'sphere',
        hasOcclusionCulling : true
      }
    );
    const { geometry } = allocator;

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

    /* const lightMapper = procGenInstance.getLightMapper({
      // debug: true,
    });
    lightMapper.addEventListener('coordupdate', e => {
      const {coord} = e.data;
      // console.log('coord update', coord.toArray().join(','));
      material.uniforms.uLightBasePosition.value.copy(coord);
      material.uniforms.uLightBasePosition.needsUpdate = true;
    }); */

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
      // wireframe: true,
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

precision highp sampler3D;

// attribute ivec4 biomes;
// attribute vec4 biomesWeights;
attribute vec4 biomesUvs1;
attribute vec4 biomesUvs2;
attribute float skylights;
attribute float aos;

// uniform vec3 uLightBasePosition;
uniform float uTerrainSize;
// uniform sampler3D uSkylightTex;
// uniform sampler3D uAoTex;
// flat varying ivec4 vBiomes;
// varying vec4 vBiomesWeights;
flat varying vec4 vBiomesUvs1;
flat varying vec4 vBiomesUvs2;
varying vec3 vPosition;
varying vec3 vWorldNormal;
varying float vLightValue;
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

// varyings
{
  vWorldNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
  // vBiomes = biomes;
  // vBiomesWeights = biomesWeights;
  vBiomesUvs1 = biomesUvs1;
  vBiomesUvs2 = biomesUvs2;
}

// lighting
{
  const float numLightBands = 8.;

  // vec3 uvLight = (vPosition - uLightBasePosition) / uTerrainSize; // XXX this can be interpolated in the vertex shader
  float lightValue = 1.;

  // skylight
  {
    // vec4 skylightColor = texture(uSkylightTex, uvLight);
    float skylightValue = skylights;

    const float maxSkylight = 8.;
    skylightValue /= maxSkylight;

    lightValue *= skylightValue;
  }
  // ao
  {
    // vec4 aoColor = texture(uAoTex, uvLight);
    float aoValue = aos;
    
    const float maxAo = 27.;
    const float baseAo = 0.3;
    aoValue /= maxAo;
    aoValue = baseAo + aoValue * (1. - baseAo);
    
    lightValue *= aoValue;
  }

  // clip lighting
  /* if (uvLight.x <= 0. || uvLight.x >= uTerrainSize || uvLight.z <= 0. || uvLight.z >= uTerrainSize || uvLight.y <= 0. || uvLight.y >= uTerrainSize) {
    lightValue = 0.;
  } */
  // adjust lighting
  lightValue *= 2.;

  vLightValue = lightValue;
}
        `);

        // fragment shader

        shader.fragmentShader = shader.fragmentShader.replace(`#include <map_pars_fragment>`, `\
#ifdef USE_MAP
  // uniform sampler2D map;
#endif

uniform sampler2D Base_Color;
uniform sampler2D Emissive;
uniform sampler2D Normal;
uniform sampler2D Roughness;
uniform sampler2D Ambient_Occlusion;
uniform sampler2D Height;
uniform sampler2D biomeUvDataTexture;
// uniform vec3 uLightBasePosition;
uniform float uTerrainSize;
// flat varying ivec4 vBiomes;
flat varying vec4 vBiomesUvs1;
flat varying vec4 vBiomesUvs2;
// varying vec4 vBiomesWeights;
varying vec3 vPosition;
varying vec3 vWorldNormal;
// varying vec3 vUvLight;
varying float vLightValue;

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

  vec2 tileOffset = vBiomesUvs1.xy; // texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
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

  vec2 tileOffset = vBiomesUvs1.xy; // texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
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

  vec2 tileOffset = vBiomesUvs1.xy; // texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
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

  vec2 tileOffset = vBiomesUvs1.xy; // texture2D(biomeUvDataTexture, vec2((float(vBiomes.x) + 0.5) / 256., 0.5)).rg;
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
  diffuseColor *= sampledDiffuseColor;
#endif

// lighting
{
  // diffuseColor.rgb *= 0.3 + 0.7 * vLightValue;
  diffuseColor.rgb *= vLightValue;
  diffuseColor.a = 1.0;
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
      /* uniforms.uSkylightTex = {
        value: lightMapper.skylightTex,
        needsUpdate: true,
      };
      uniforms.uAoTex = {
        value: lightMapper.aoTex,
        needsUpdate: true,
      }; */
      /* uniforms.uLightBasePosition = {
        value: lightMapper.lightBasePosition.clone(),
        needsUpdate: true,
      }; */
      uniforms.uTerrainSize = {
        value: terrainSize,
        needsUpdate: true,
      };

      return uniforms;
    })();
    super(geometry, material, allocator);
    this.frustumCulled = false;

    this.procGenInstance = procGenInstance;
    this.physics = physics;
    this.allocator = allocator;
    this.physicsObjects = [];
    this.physicsObjectToChunkMap = new Map();
    this.appMatrix = appMatrix;

    // this.lightMapper = lightMapper;
  }

  async getChunkRenderData(chunk, signal) {
    const meshData =
      await this.procGenInstance.dcWorkerManager.generateTerrainChunk(
        chunk.min,
        chunk.lodArray,
        {
          signal,
        }
      );
    if (meshData) {
      let geometryBuffer = null;
      if (this.physics) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(meshData.positions, 3)
        );
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        const physicsMesh = new THREE.Mesh(geometry, fakeMaterial);

        geometryBuffer = await this.physics.cookGeometryAsync(physicsMesh, {
          signal,
        });
      }
      return new ChunkRenderData(meshData, geometryBuffer);
    } else {
      return null;
    }
  }
  drawChunk(chunk, renderData, tracker, appMatrix) {
    // console.log('draw chunk', chunk.min.toArray().join(','), renderData);
    if (renderData) {
      // non-empty chunk
      const {meshData, geometryBuffer} = renderData;

      const _mapOffsettedIndices = (
        srcIndices,
        dstIndices,
        dstOffset,
        positionOffset
      ) => {
        const positionIndex = positionOffset / 3;
        for (let i = 0; i < srcIndices.length; i++) {
          dstIndices[dstOffset + i] = srcIndices[i] + positionIndex;
        }
      };
      const _renderTerrainMeshDataToGeometry = (
        meshData,
        geometry,
        geometryBinding
      ) => {
        let positionOffset = geometryBinding.getAttributeOffset('position');
        let normalOffset = geometryBinding.getAttributeOffset('normal');
        // let biomesOffset = geometryBinding.getAttributeOffset('biomes');
        let biomesWeightsOffset = geometryBinding.getAttributeOffset('biomesWeights');
        let biomesUvs1Offset = geometryBinding.getAttributeOffset('biomesUvs1');
        let biomesUvs2Offset = geometryBinding.getAttributeOffset('biomesUvs2');
        let skylightsOffset = geometryBinding.getAttributeOffset('skylights');
        let aosOffset = geometryBinding.getAttributeOffset('aos');
        let indexOffset = geometryBinding.getIndexOffset();

        _mapOffsettedIndices(
          meshData.indices,
          geometry.index.array,
          indexOffset,
          positionOffset
        );

        geometry.attributes.position.update(
          positionOffset,
          meshData.positions.length,
          meshData.positions,
          0
        );
        geometry.attributes.normal.update(
          normalOffset,
          meshData.normals.length,
          meshData.normals,
          0
        );
        /* geometry.attributes.biomes.update(
          biomesOffset,
          meshData.biomes.length,
          meshData.biomes,
          0
        ); */
        geometry.attributes.biomesWeights.update(
          biomesWeightsOffset,
          meshData.biomesWeights.length,
          meshData.biomesWeights,
          0
        );
        // console.log('biomes', geometry.attributes.biomesUvs1, geometry.attributes.biomesUvs2);
        geometry.attributes.biomesUvs1.update(
          biomesUvs1Offset,
          meshData.biomesUvs1.length,
          meshData.biomesUvs1,
          0
        );
        geometry.attributes.biomesUvs2.update(
          biomesUvs2Offset,
          meshData.biomesUvs2.length,
          meshData.biomesUvs2,
          0
        );
        geometry.attributes.skylights.update(
          skylightsOffset,
          meshData.skylights.length,
          meshData.skylights,
          0
        );
        geometry.attributes.aos.update(
          aosOffset,
          meshData.aos.length,
          meshData.aos,
          0
        );
        geometry.index.update(indexOffset, meshData.indices.length);
      };
      const _handleMesh = () => {
        /* if (!meshData) {
          debugger;
        } */
        const chunkSize = chunkWorldSize * chunk.lod;

        localSphere.center.set(
            (chunk.min.x + 0.5) * chunkSize,
            (chunk.min.y + 0.5) * chunkSize,
            (chunk.min.z + 0.5) * chunkSize
          )
          .applyMatrix4(this.matrixWorld);
        localSphere.radius = chunkRadius;

        localVector3D.set(chunk.min.x, chunk.min.y, chunk.min.z).multiplyScalar(chunkSize); // min
        localVector3D2.set(chunk.min.x, chunk.min.y, chunk.min.z).addScalar(chunk.lod).multiplyScalar(chunkSize); // max

        // console.log(localVector3D.x + ", " + localVector3D2.x);

        const geometryBinding = this.allocator.alloc(
          meshData.positions.length,
          meshData.indices.length,
          localSphere,
          localVector3D,
          localVector3D2,
          this.appMatrix,
          meshData.peeks
        );
        // console.log(localVector3D);
        _renderTerrainMeshDataToGeometry(
          meshData,
          this.allocator.geometry,
          geometryBinding
        );

        // let called = false;
        const onchunkremove = e => {
          const {chunk: removeChunk} = e.data;
          if (chunk.equalsNodeLod(removeChunk)) {
            /* if (!called) {
              called = true;
            } else {
              console.warn('double destroy');
              debugger;
            } */

            this.allocator.free(geometryBinding);
          
            tracker.removeEventListener('chunkremove', onchunkremove);
          }
        };
        tracker.addEventListener('chunkremove', onchunkremove);
      };
      _handleMesh();

      const _handlePhysics = async () => {
        if (geometryBuffer) {
          this.matrixWorld.decompose(localVector, localQuaternion, localVector2);
          const physicsObject = this.physics.addCookedGeometry(
            geometryBuffer,
            localVector,
            localQuaternion,
            localVector2
          );
          this.physicsObjects.push(physicsObject);
          this.physicsObjectToChunkMap.set(physicsObject, chunk);

          // let called = false;
          const onchunkremove = e => {
            const {chunk: removeChunk} = e.data;
            if (chunk.equalsNodeLod(removeChunk)) {
              /* if (!called) {
                called = true;
              } else {
                console.warn('double destroy');
                debugger;
              } */

              this.physics.removeGeometry(physicsObject);

              const index = this.physicsObjects.indexOf(physicsObject);
              this.physicsObjects.splice(index, 1);
              this.physicsObjectToChunkMap.delete(physicsObject);

              tracker.removeEventListener('chunkremove', onchunkremove);
            }
          }
          tracker.addEventListener('chunkremove', onchunkremove);
        }
      };
      _handlePhysics();
    }
  }
  updateCoord(min1xCoord) {
    // XXX this should be done in a separate app
    // this.lightMapper.updateCoord(min1xCoord);
  }
}

class TerrainChunkGenerator {
  constructor({
    procGenInstance,
    physics,
    biomeUvDataTexture,
    atlasTextures,
    appMatrix
  } = {}) {
    // parameters
    this.procGenInstance = procGenInstance;
    this.physics = physics;
    this.biomeUvDataTexture = biomeUvDataTexture;
    this.atlasTextures = atlasTextures;

    // mesh
    this.object = new THREE.Group();
    this.object.name = 'terrain-chunk-generator';

    this.terrainMesh = new TerrainMesh({
      procGenInstance: this.procGenInstance,
      physics: this.physics,
      biomeUvDataTexture: this.biomeUvDataTexture,
      atlasTextures: this.atlasTextures,
      appMatrix
    });
    this.object.add(this.terrainMesh);
  }

  getMeshes() {
    return this.objectchildren;
  }
  getPhysicsObjects() {
    return this.terrainMesh.physicsObjects;
  }
  getChunkForPhysicsObject(physicsObject) {
    return this.terrainMesh.physicsObjectToChunkMap.get(physicsObject);
  }

  async generateChunk(chunk, {signal = null} = {}) {
    try {
      await this.terrainMesh.addChunk(chunk, {
        signal,
      });
    } catch (err) {
      if (err?.isAbortError) {
        console.log('generate chunk abort', err);
      }
      if (!err?.isAbortError) {
        console.warn(err);
      }
    }
  }
  /* removeChunkTask(task) {
    const binding = chunk.binding;
    if (binding) {
      const {abortController} = binding;
      abortController.abort(abortError);

      chunk.binding = null;
      chunk.disposeStack = new Error().stack;
    }
  } */
  async relodChunksTask(task, tracker, appMatrix) {
    // console.log('got task', task);
    // const {oldChunks, newChunk, signal} = task;
    // console.log('relod chunk', task);

    try {
      let {maxLodNode, newNodes, oldNodes, signal} = task;

      const renderDatas = await Promise.all(newNodes.map(newNode => this.terrainMesh.getChunkRenderData(
        newNode,
        signal
      )));
      signal.throwIfAborted();

      for (const oldNode of oldNodes) {
        console.log('destroy old node', oldNode);
        tracker.emitChunkDestroy(oldNode);
      }

      for (let i = 0; i < newNodes.length; i++) {
        const newNode = newNodes[i];
        const renderData = renderDatas[i];
        this.terrainMesh.drawChunk(newNode, renderData, signal, task, tracker, appMatrix);
      }

      task.commit();
    } catch (err) {
      if (err?.isAbortError) {
        // console.log('chunk render abort', new Error().stack);
        // nothing
      } else {
        throw err;
        // console.warn(err);
      }
    }
  }

  bindChunk(chunk) {
    const abortController = new AbortController();
    const {signal} = abortController;

    chunk.binding = {
      abortController,
    };

    return signal;
  }

  async hit(e, tracker) {
    const {LodChunk} = useLodder();

    // perform damage
    const hitPosition = localVector
      .copy(e.hitPosition)
      .applyMatrix4(localMatrix.copy(this.terrainMesh.matrixWorld).invert());
    const chunks = await this.procGenInstance.dcWorkerManager.drawSphereDamage(
      hitPosition,
      3
    );
    if (chunks) {
      // generate the new chunks
      let meshSpecs = await Promise.all(
        chunks.map(async (chunkSpec) => {
          const lodArray = Array(8).fill(1);
          const chunk = new LodChunk(
            chunkSpec.position[0],
            chunkSpec.position[1],
            chunkSpec.position[2],
            lodArray[0],
            lodArray
          ).divideScalar(chunkWorldSize);
          const signal = this.bindChunk(chunk);
          const renderData = await this.terrainMesh.getChunkRenderData(
            chunk,
            signal
          );
          if (renderData) {
            return {
              chunk,
              renderData,
              signal,
            };
          } else {
            return null;
          }
        })
      );
      meshSpecs = meshSpecs.filter((m) => m !== null);
      // remove old chunks
      tracker.chunks = tracker.chunks.filter((chunk) => {
        if (
          !meshSpecs.some((meshSpec) => {
            return meshSpec.chunk.equals(chunk);
          })
        ) {
          // not being replaced
          return true;
        } else {
          // being replaced
          this.disposeChunk(chunk);
          return false;
        }
      });
      // add new chunks
      for (const meshSpec of meshSpecs) {
        const { chunk, signal, renderData } = meshSpec;
        this.terrainMesh.drawChunk(chunk, renderData, signal);
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
  const camera = useCamera();
  const procGenManager = useProcGenManager();

  const lods = app.getComponent('lods') ?? defaultNumNods;
  const minLodRange = app.getComponent('minLodRange') ?? defaultMinLodRange;

  const seed = app.getComponent('seed') ?? null;
  let clipRange = app.getComponent('clipRange') ?? null;
  const wait = app.getComponent('wait') ?? false;
  const debug = app.getComponent('debug') ?? false;
  if (clipRange) {
    clipRange = new THREE.Box3(
      new THREE.Vector3().fromArray(clipRange[0]),
      new THREE.Vector3().fromArray(clipRange[1]),
    );
  }

  const physicsInstance = app.getComponent('physicsInstance');
  const physics = physicsInstance !== false ? usePhysics(physicsInstance) : null;

  app.name = 'dual-contouring-terrain';

  const componentupdate = e => {
    const {key, value} = e;
    if (key === 'renderPosition') {
      tracker.update(localVector.fromArray(value));
    }
  };

  let live = true;
  let generator = null;
  let tracker = null;
  e.waitUntil(
    (async () => {
      const {ktx2Loader} = useLoaders();
      const atlasTexturesArray = await Promise.all(
        mapNames.map(
          (mapName) =>
            new Promise((accept, reject) => {
              ktx2Loader.load(
                `${biomesKtx2TexturePrefix}build/8k/${mapName}.ktx2`,
                accept,
                function onprogress(e) {},
                reject
              );
            })
        )
      );
      if (!live) return;

      const renderPosition = app.getComponent('renderPosition');

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

      const procGenInstance = procGenManager.getInstance(seed, clipRange);

      const appMatrix = app.matrixWorld;

      generator = new TerrainChunkGenerator({
        procGenInstance,
        physics,
        biomeUvDataTexture,
        atlasTextures,
        appMatrix
      });
      tracker = procGenInstance.getChunkTracker({
        lods,
        minLodRange,
        trackY: true,
        sort: !renderPosition,
        debug,
      });
      if (debug) {
        app.add(tracker.debugMesh);
        tracker.debugMesh.updateMatrixWorld();
      }

      /* const coordupdate = (e) => {
        debugger;
        const {coord} = e.data;
        generator.terrainMesh.updateCoord(coord);
      };
      tracker.addEventListener('coordupdate', coordupdate); */

      const chunkdatarequest = (e) => {
        const {chunk, waitUntil, signal} = e.data;
    
        const loadPromise = (async () => {
          const renderData = await generator.terrainMesh.getChunkRenderData(
            chunk,
            signal
          );
          signal.throwIfAborted();
          return renderData;
        })();
        waitUntil(loadPromise);
      };
      const chunkadd = (e) => {
        const {renderData, chunk} = e.data;
        generator.terrainMesh.drawChunk(chunk, renderData, tracker);
      };
      tracker.addEventListener('chunkdatarequest', chunkdatarequest);
      tracker.addEventListener('chunkadd', chunkadd);

      if (renderPosition) {
        tracker.update(localVector.fromArray(renderPosition));
      }
      app.addEventListener('componentupdate', componentupdate);

      if (wait) {
        // console.log('tracker wait 1');
        await tracker.waitForLoad();
        // console.log('tracker wait 2');
      }

      app.add(generator.object);
      generator.object.updateMatrixWorld();
    })()
  );

  app.getPhysicsObjects = () => generator ? generator.getPhysicsObjects() : [];
  app.getChunkForPhysicsObject = (physicsObject) => generator ? generator.getChunkForPhysicsObject(physicsObject) : null;

  app.addEventListener('hit', (e) => {
    generator && tracker && generator.hit(e, tracker);
  });

  useFrame(() => {
    if (!!tracker && !app.getComponent('renderPosition')) {
      const localPlayer = useLocalPlayer();
      localMatrix
        .copy(localPlayer.matrixWorld)
        .premultiply(localMatrix2.copy(app.matrixWorld).invert())
        .decompose(localVector, localQuaternion, localVector2);
      tracker.update(localVector, localQuaternion, camera.projectionMatrix);
    }
  });

  useCleanup(() => {
    live = false;
    if (tracker) {
      tracker.destroy();
    }

    app.removeEventListener('componentupdate', componentupdate);
  });

  return app;
};
