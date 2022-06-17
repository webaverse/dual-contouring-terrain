import metaversefile from 'metaversefile';
import * as THREE from 'three';
import { terrainVertex, terrainFragment } from './shaders/terrainShader.js';
import biomeSpecs from './biomes.js';
import {
  fireParticlesFragment,
  fireParticlesVertex,
} from './shaders/fireParticles.js';

const {
  useApp,
  useLocalPlayer,
  useFrame,
  useCleanup,
  usePhysics,
  useLoaders,
  useInstancing,
  useDcWorkerManager,
  useLodder,
  useInternals,
} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

let terrainMaterial,
  cloudGeo,
  cloudMaterial,
  particleArray = [];

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();
// const localColor = new THREE.Color();
const localSphere = new THREE.Sphere();

const dcWorkerManager = useDcWorkerManager();
const chunkWorldSize = dcWorkerManager.chunkSize;
const chunkRadius = Math.sqrt(chunkWorldSize * chunkWorldSize * 3);
const numLods = 1;
const bufferSize = 20 * 1024 * 1024;

// const textureLoader = new THREE.TextureLoader();
const abortError = new Error('chunk disposed');
const fakeMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
});

const mapNames = [
  'Base_Color',
  'Height',
  'Normal',
  'Roughness',
  'Emissive',
  'Ambient_Occlusion',
];
const biomesPngTexturePrefix = `/images/stylized-textures/png/`;
const biomesKtx2TexturePrefix = baseUrl + `../terrain/land-textures/`;
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

const loadImage = (u) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = (err) => {
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
const bakeBiomesAtlas = async ({ size = 8 * 1024 } = {}) => {
  const atlasTextures = [];
  const textureTileSize = size / texturesPerRow;
  const halfTextureTileSize = textureTileSize / 2;

  for (const mapName of mapNames) {
    const neededTextureNames = neededTexturePrefixes.map(
      (prefix) => `${prefix}${mapName}`
    );

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
          (x * textureTileSize) / size,
          (y * textureTileSize) / size,
          ((x + 1) * textureTileSize) / size,
          ((y + 1) * textureTileSize) / size,
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

const { BatchedMesh } = useInstancing();
class TerrainMesh extends BatchedMesh {
  constructor({
    physics,
    // biomeDataTexture,
    biomeUvDataTexture,
    atlasTextures,
  }) {
    const allocator = new dcWorkerManager.constructor.GeometryAllocator(
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
      ],
      {
        bufferSize,
        boundingType: 'sphere',
      }
    );
    const { geometry } = allocator;

    // console.log(geometry.attributes.biomes.array);

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
    const textureLoader = new THREE.TextureLoader();

    const earthTexture = textureLoader.load(
      baseUrl + 'assets/textures/SinglePlane_DefaultMaterial_BaseColor.png'
    );
    earthTexture.wrapS = earthTexture.wrapT = THREE.RepeatWrapping;
    earthTexture.encoding = THREE.sRGBEncoding;
    const earthTexture2 = textureLoader.load(
      baseUrl + 'assets/textures/rock2_BaseColor.png'
    );
    earthTexture2.wrapS = earthTexture2.wrapT = THREE.RepeatWrapping;
    earthTexture2.encoding = THREE.sRGBEncoding;
    const earthTexture3 = textureLoader.load(
      baseUrl + 'assets/textures/rock3_BaseColor.png'
    );
    earthTexture3.wrapS = earthTexture3.wrapT = THREE.RepeatWrapping;
    earthTexture3.encoding = THREE.sRGBEncoding;
    const earthNormal = textureLoader.load(
      baseUrl + 'assets/textures/SinglePlane_DefaultMaterial_Normal.png'
    );
    earthNormal.wrapS = earthNormal.wrapT = THREE.RepeatWrapping;

    const grassTexture = textureLoader.load(
      baseUrl + 'assets/textures/GrassBaseColor1.png'
    );
    grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
    const grassNormal = textureLoader.load(
      baseUrl + 'assets/textures/GrassNormal1.png'
    );
    grassNormal.wrapS = grassNormal.wrapT = THREE.RepeatWrapping;

    terrainMaterial = new THREE.MeshStandardMaterial({
      onBeforeCompile: (shader) => {
        // console.log('on before compile', shader.fragmentShader);

        shader.uniforms.uEarthBaseColor = {
          value: earthTexture,
          needsUpdate: true,
        };
        shader.uniforms.uEarthBaseColor2 = {
          value: earthTexture2,
          needsUpdate: true,
        };
        shader.uniforms.uEarthBaseColor3 = {
          value: earthTexture3,
          needsUpdate: true,
        };
        shader.uniforms.uEarthNormal = {
          value: earthNormal,
          needsUpdate: true,
        };
        shader.uniforms.uGrassBaseColor = {
          value: grassTexture,
          needsUpdate: true,
        };
        shader.uniforms.uTime = {
          value: 0,
          needsUpdate: true,
        };

        shader.uniforms.biomeUvDataTexture = {
          value: biomeUvDataTexture,
          needsUpdate: true,
        };
        for (const mapName of mapNames) {
          shader.uniforms[mapName] = {
            value: atlasTextures[mapName],
            needsUpdate: true,
          };
        }

        // vertex shader

        shader.vertexShader = shader.vertexShader.replace(
          `#include <uv_pars_vertex>`,
          `\
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
      // uniform sampler2D map;
      flat varying ivec4 vBiomes;
      varying vec4 vBiomesWeights;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
              `
        );
        shader.vertexShader = shader.vertexShader.replace(
          `#include <worldpos_vertex>`,
          `\
      // #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION )
        vec4 worldPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          worldPosition = instanceMatrix * worldPosition;
        #endif
        worldPosition = modelMatrix * worldPosition;
      // #endif
      vWorldPosition = worldPosition.xyz;
      vWorldNormal = (modelMatrix * vec4(normal, 0.0)).xyz;
      vBiomes = biomes;
      vBiomesWeights = biomesWeights;
              `
        );

        // fragment shader

        shader.fragmentShader = shader.fragmentShader.replace(
          `#include <map_pars_fragment>`,
          `\
      #ifdef USE_MAP
        // uniform sampler2D map;
      #endif
      uniform float uTime;
      uniform sampler2D uEarthBaseColor;
      uniform sampler2D uEarthBaseColor2;
      uniform sampler2D uEarthBaseColor3;
      uniform sampler2D uEarthNormal;
      uniform sampler2D uGrassBaseColor;

      uniform sampler2D Base_Color;
      uniform sampler2D Emissive;
      uniform sampler2D Normal;
      uniform sampler2D Roughness;
      uniform sampler2D Ambient_Occlusion;
      uniform sampler2D Height;
      uniform sampler2D biomeUvDataTexture;
      flat varying ivec4 vBiomes;
      varying vec4 vBiomesWeights;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      #define NUM_OCTAVES 8

  // Simplex 2D noise
  //
  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
  
  float noise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
      dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  const mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
float fbm(vec2 x) {
	float v = 0.0;
	float a = 0.5;
	vec2 shift = vec2(100);
	// Rotate to reduce axial bias
	for (int i = 0; i < NUM_OCTAVES; ++i) {
		v += a * noise(x);
		x = rot * x * 2.0 + shift;
		a *= 0.5;
	}
	return v;
}

float warpNoise(vec3 pos)
{
    return noise(pos.xz+ vec2(100.2, 1.3)); 
}


  vec4 triplanarTexture(sampler2D inputTexture , float scale , float blendSharpness){
    vec2 uvX = vWorldPosition.zy * scale;
    vec2 uvY = vWorldPosition.xz * scale;
    vec2 uvZ = vWorldPosition.xy * scale;
    
    vec4 colX = texture2D(inputTexture , uvX);
    vec4 colY = texture2D(inputTexture , uvY);
    vec4 colZ = texture2D(inputTexture , uvZ);

    vec3 blendWeight = pow(abs(vWorldNormal), vec3(blendSharpness));
    blendWeight /= dot(blendWeight,vec3(1));

    return colX * blendWeight.x + colY * blendWeight.y + colZ * blendWeight.z;
  }

  vec4 triplanarNormal(sampler2D inputTexture , float scale , float blendSharpness) {
    // Tangent Reconstruction
    // Triplanar uvs
    vec2 uvX = vWorldPosition.zy * scale;
    vec2 uvY = vWorldPosition.xz * scale;
    vec2 uvZ = vWorldPosition.xy * scale;
    
    vec4 colX = texture2D(inputTexture , uvX);
    vec4 colY = texture2D(inputTexture , uvY);
    vec4 colZ = texture2D(inputTexture , uvZ);
    // Tangent space normal maps
    vec3 tx = colX.xyz * vec3(2,2,2) - vec3(1,1,1);
    vec3 ty = colY.xyz * vec3(2,2,2) - vec3(1,1,1);
    vec3 tz = colZ.xyz * vec3(2,2,2) - vec3(1,1,1);
    vec3 weights = abs(vWorldNormal.xyz);
    weights = weights / (weights.x + weights.y + weights.z);
    // Get the sign (-1 or 1) of the surface normal
    vec3 axis = sign(vWorldNormal);
    // Construct tangent to world matrices for each axis
    vec3 tangentX = normalize(cross(vWorldNormal, vec3(0.0, axis.x, 0.0)));
    vec3 bitangentX = normalize(cross(tangentX, vWorldNormal)) * axis.x;
    mat3 tbnX = mat3(tangentX, bitangentX, vWorldNormal);
    vec3 tangentY = normalize(cross(vWorldNormal, vec3(0.0, 0.0, axis.y)));
    vec3 bitangentY = normalize(cross(tangentY, vWorldNormal)) * axis.y;
    mat3 tbnY = mat3(tangentY, bitangentY, vWorldNormal);
    vec3 tangentZ = normalize(cross(vWorldNormal, vec3(0.0, -axis.z, 0.0)));
    vec3 bitangentZ = normalize(-cross(tangentZ, vWorldNormal)) * axis.z;
    mat3 tbnZ = mat3(tangentZ, bitangentZ, vWorldNormal);
    // Apply tangent to world matrix and triblend
    // Using clamp() because the cross products may be NANs
    vec3 worldNormal = normalize(
        clamp(tbnX * tx, -1.0, 1.0) * weights.x +
        clamp(tbnY * ty, -1.0, 1.0) * weights.y +
        clamp(tbnZ * tz, -1.0, 1.0) * weights.z
        );
    return vec4(worldNormal, 0.0);
  }

  vec4 terrainBlend(vec4 samples[4], vec4 weights) {
    vec4 a = samples[0];
    vec4 b = samples[1];
    vec4 c = samples[2];
    vec4 d = samples[3];

    float weightSum = weights.x + weights.y + weights.z + weights.w;
    return (a*weights.x + b*weights.y + c*weights.z + d*weights.w) / weightSum;
}

  void setBiome(int biome, out vec4 diffuseSample, out vec4 normalSample){
    if(0 <= biome && biome <= 9 ){
      // rocky ground 2
      float rockNoise = clamp(noise(vWorldPosition.xz/100.0+ vec2(100.2, 1.3))*2.0,0.,1.);
      vec4 diffuseSample1 = texture2D( uEarthBaseColor , vWorldPosition.xz/10.0) * rockNoise;
      vec4 diffuseSample2 = texture2D( uEarthBaseColor3 , vWorldPosition.xz/10.0) * (1. - rockNoise);
      diffuseSample += diffuseSample1;
      diffuseSample += diffuseSample2;
      // diffuseSample = rockNoise;
      normalSample =  vec4(1.);
      // normalSample = texture2D( uEarthNormal , vWorldPosition.xz/10.0);
    }
   else if(10 <= biome && biome <= 29 ){
      diffuseSample = texture2D( uEarthBaseColor2 , vWorldPosition.xz/10.0);
      normalSample =  vec4(1.);
    }
   else if(30 <= biome && biome <= 59 ){
      diffuseSample = texture2D( uEarthBaseColor3 , vWorldPosition.xz/10.0);
      normalSample =  vec4(1.);
    }
    else if(60 <= biome && biome <= 79 ){
      // mountains tunnel 
      float time = -uTime/70000.0;
      vec2 fakeUv = vWorldPosition.xz/15.0;
    float f = fbm(vec2(time)+fakeUv + fbm(vec2(time)-fakeUv));

    float r = smoothstep(.0, 0.5, f);
    float g = smoothstep(.3, 0.7, f);
    float b = smoothstep(.6, 1., f);
    
    vec3 marble = vec3(r, g, b);
    float f2 = .5 - f;
    
	  r = smoothstep(.7, 1. , f2);
    g = smoothstep(.85, 0.95, f2);
    b = smoothstep(.85, 0.95, f2);
    
      vec3 col2 = vec3(r, g, b);    
      marble = mix(marble, col2, f2) * vec3(1.,0.6,0.2);
      diffuseSample = vec4(marble,1.0);
      normalSample = vec4(1,1,1,1);
    }
    else if(80 <= biome && biome <= 255){
      float rockNoise = noise(vWorldPosition.xz/10.0);
      vec4 rockColor = vec4(vec3(1.5 , 0.6 , 0.2)*(rockNoise+0.3) , 1.)*texture2D( uEarthBaseColor3 , vWorldPosition.xy/30.0);
      diffuseSample = rockColor;
      normalSample = vec4(1.);
    }
    else{
      // default color is red
      diffuseSample = vec4(1., 0.,0.,1.0);
      normalSample = vec4(1,1,1,1);
    }
  
  }   
      `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <alphamap_fragment>',
          `\      
          float time = uTime;
          vec4 diffuseSamples[4];
          vec4 normalSamples[4];
          setBiome(vBiomes.x, diffuseSamples[0], normalSamples[0]);
          setBiome(vBiomes.y, diffuseSamples[1], normalSamples[1]);
          setBiome(vBiomes.z, diffuseSamples[2], normalSamples[2]);
          setBiome(vBiomes.w, diffuseSamples[3], normalSamples[3]);
              `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          `#include <normal_fragment_maps>`,
          `\
          vec4 diffuseBlended = terrainBlend(diffuseSamples,vBiomesWeights);
          vec4 normalBlended = terrainBlend(normalSamples,vec4(1));
          diffuseColor *= diffuseBlended;
          normal *= normalBlended.xyz;
          `
        );
        terrainMaterial.userData.shader = shader;
        return shader;
      },
    });
    // terrainMaterial = new THREE.MeshStandardMaterial({
    //   map: new THREE.Texture(),
    //   normalMap: new THREE.Texture(),
    //   emissiveMap: new THREE.Texture(),
    //   // normalScale: new THREE.Vector2(50, 50),
    //   // normalMapType: THREE.ObjectSpaceNormalMap,
    //   bumpMap: new THREE.Texture(),
    //   // bumpScale: 1,
    //   roughnessMap: new THREE.Texture(),
    //   aoMap: new THREE.Texture(),
    //   transparent: true,
    //   color: new THREE.Color("red"),
    // });

    // terrainMaterial = new THREE.ShaderMaterial({
    //   vertexShader: terrainVertex,
    //   fragmentShader: terrainFragment,
    //   // wireframe: true,
    //   vertexColors: true,
    //   side: THREE.FrontSide,
    //   uniforms: {
    //     uTime: { value: 0 },
    //     uEarthBaseColor: {
    //       value: earthTexture,
    //     },
    //     uGrassBaseColor: {
    //       value: grassTexture,
    //     },
    //     uEarthNormal: {
    //       value: earthNormal,
    //     },
    //     uGrassNormal: {
    //       value: grassNormal,
    //     },
    //     // diffuseMap: {
    //     //   value: {
    //     //     textures: [
    //     //       new THREE.TextureLoader(
    //     //         baseUrl + '/assets/texture/EarthBaseColor.png'
    //     //       ),
    //     //       new THREE.TextureLoader(
    //     //         baseUrl + '/assets/texture/GrassBaseColor.png'
    //     //       ),
    //     //     ],
    //     //   },
    //     // },
    //     // normalMap: {
    //     //   value: {
    //     //     textures: [
    //     //       new THREE.TextureLoader(
    //     //         baseUrl + '/assets/texture/EarthNormal.png'
    //     //       ),
    //     //       new THREE.TextureLoader(
    //     //         baseUrl + '/assets/texture/GrassNormal.png'
    //     //       ),
    //     //     ],
    //     //   },
    //     // },
    //     noiseMap: {
    //       value: new THREE.TextureLoader().load(
    //         baseUrl + '/assets/texture/noiseMap.png'
    //       ),
    //     },
    //     uResolution: {
    //       value: new THREE.Vector2(window.innerWidth, window.innerHeight),
    //     },
    //     uTexture: { value: null },
    //   },
    // });
    super(geometry, terrainMaterial, allocator);
    this.frustumCulled = false;

    this.physics = physics;
    this.allocator = allocator;
    this.physicsObjects = [];

    // window.terrainMesh = this;
  }
  async addChunk(chunk, { signal }) {
    const meshData = await dcWorkerManager.generateChunk(chunk, chunk.lodArray);
    // console.log('mesh data', meshData);
    signal.throwIfAborted();
    if (meshData) {
      // non-empty chunk
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
      const _renderMeshDataToGeometry = (
        meshData,
        geometry,
        geometryBinding
      ) => {
        let positionOffset = geometryBinding.getAttributeOffset('position');
        let normalOffset = geometryBinding.getAttributeOffset('normal');
        let biomesOffset = geometryBinding.getAttributeOffset('biomes');
        let biomesWeightsOffset =
          geometryBinding.getAttributeOffset('biomesWeights');
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
        geometry.attributes.biomes.update(
          biomesOffset,
          meshData.biomes.length,
          meshData.biomes,
          0
        );
        geometry.attributes.biomesWeights.update(
          biomesWeightsOffset,
          meshData.biomesWeights.length,
          meshData.biomesWeights,
          0
        );
        geometry.index.update(indexOffset, meshData.indices.length);
      };
      /* const _updateRenderList = () => {
        this.allocator.geometry.groups = this.allocator.indexFreeList.getGeometryGroups(); // XXX memory for this can be optimized
      }; */
      const _handleMesh = () => {
        localSphere.center
          .set(
            (chunk.x + 0.5) * chunkWorldSize,
            (chunk.y + 0.5) * chunkWorldSize,
            (chunk.z + 0.5) * chunkWorldSize
          )
          .applyMatrix4(this.matrixWorld);
        localSphere.radius = chunkRadius;
        const geometryBinding = this.allocator.alloc(
          meshData.positions.length,
          meshData.indices.length,
          localSphere
        );
        _renderMeshDataToGeometry(
          meshData,
          this.allocator.geometry,
          geometryBinding
        );
        // _updateRenderList();

        signal.addEventListener('abort', (e) => {
          this.allocator.free(geometryBinding);
          // _updateRenderList();
        });
      };
      _handleMesh();

      const _handlePhysics = async () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(meshData.positions, 3)
        );
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        const physycsMesh = new THREE.Mesh(geometry, fakeMaterial);

        // console.log('cook 1', mesh);
        const geometryBuffer = await this.physics.cookGeometryAsync(
          physycsMesh,
          {
            signal,
          }
        );
        // console.log('cook 2', mesh);

        this.matrixWorld.decompose(localVector, localQuaternion, localVector2);
        const physicsObject = this.physics.addCookedGeometry(
          geometryBuffer,
          localVector,
          localQuaternion,
          localVector2
        );
        this.physicsObjects.push(physicsObject);

        // console.log('cook 3', mesh);

        signal.addEventListener('abort', (e) => {
          this.physics.removeGeometry(physicsObject);
          this.physicsObjects.splice(
            this.physicsObjects.indexOf(physicsObject),
            1
          );
        });
      };
      await _handlePhysics();
    }
  }
}

class TerrainChunkGenerator {
  constructor(
    parent,
    {
      physics,
      // biomeDataTexture,
      biomeUvDataTexture,
      atlasTextures,
    } = {}
  ) {
    // parameters
    this.parent = parent;
    this.physics = physics;
    // this.biomeDataTexture = biomeDataTexture;
    this.biomeUvDataTexture = biomeUvDataTexture;
    this.atlasTextures = atlasTextures;

    // mesh
    this.object = new THREE.Group();
    this.object.name = 'terrain-chunk-generator';

    this.terrainMesh = new TerrainMesh({
      physics: this.physics,
      // biomeDataTexture: this.biomeDataTexture,
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
    const abortController = new AbortController();
    const { signal } = abortController;

    this.terrainMesh
      .addChunk(chunk, {
        signal,
      })
      .catch((err) => {
        if (err !== abortError) {
          console.warn(err);
        }
      });

    chunk.binding = {
      abortController,
      // signal,
    };
  }

  disposeChunk(chunk) {
    const binding = chunk.binding;
    if (binding) {
      const { abortController } = binding;
      abortController.abort(abortError);

      chunk.binding = null;
    }
  }

  /* getMeshAtWorldPosition(p) {
    return null; // XXX will be done with intersection
    localVector.copy(p).divideScalar(chunkWorldSize);
    const mesh =
      this.object.children.find(
        (m) => !!m.chunk && m.chunk.equals(localVector)
      ) || null;
    return mesh;
  } */

  hit(e) {
    const { hitPosition } = e;
    // console.log('hit 1', hitPosition.toArray().join(','));
    const result = dcWorkerManager.eraseSphereDamage(hitPosition, 3);
    // console.log('hit 2', hitPosition.toArray().join(','), result);
    /* const oldMeshes = neededChunkMins.map((v) => {
      return this.getMeshAtWorldPosition(v);
    });
    const oldChunks = oldMeshes.filter(mesh => mesh !== null).map(mesh => mesh.chunk);
    for (const oldChunk of oldChunks) {
      this.disposeChunk(oldChunk);
    }

    setTimeout(async () => {
      await Promise.all(neededChunkMins.map(async minVector => {
        const chunkPosition = localVector.copy(minVector).divideScalar(chunkWorldSize).clone();
        const chunk = await this.generateChunk(chunkPosition);
        return chunk;
      }));
      // console.log('got hit result', result, chunks, this.object.children.map(m => m.chunk.toArray().join(',')));
    }, 1000); */
  }

  update(timestamp, timeDiff) {
    for (const mesh of this.getMeshes()) {
      mesh.update(timestamp, timeDiff);
      // console.log(mesh);
    }
  }

  destroy() {
    // nothing; the owning lod tracker disposes of our contents
  }
}

window.addAoMesh = async () => {
  const dcWorkerManager = useDcWorkerManager();
  const pos = new THREE.Vector3(0, 0, 0);
  const size = chunkWorldSize * 2;
  const lod = 1;
  const aos = await dcWorkerManager.getAoFieldRange(
    pos.x,
    pos.y,
    pos.z,
    size,
    size,
    size,
    lod
  );
  console.log('got aos', aos);

  const aoTex = new THREE.DataTexture3D(aos, size, size, size);

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const geometry = new THREE.InstancedBufferGeometry().copy(boxGeometry);
  const material = new WebaverseShaderMaterial({
    uniforms: {
      uAoTex: {
        value: aoTex,
        needsUpdate: true,
      },
    },
    vertexShader: `\
      varying vec3 vUv;

      void main() {
        vUv = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `\
      precision highp float;
      precision highp int;

      #define PI 3.1415926535897932384626433832795

      uniform sampler3D uAoTex;
      varying vec2 vUv;

      void main() {
        vec4 sampleColor = texture3D(uAoTex, vUv);        
        gl_FragColor = vec4(sampleColor, 0., 0., 1.);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geometry, material);
  mesh.frustumCulled = false;

  const scene = useScene();
  scene.add(mesh);
};

export default (e) => {
  const app = useApp();
  const physics = usePhysics();
  const { LodChunkTracker } = useLodder();
  const gl = useInternals().renderer;

  app.name = 'dual-contouring-terrain';

  new THREE.TextureLoader().load(
    baseUrl + 'assets/textures/smoke.png',
    (texture) => {
      cloudGeo = new THREE.PlaneBufferGeometry(20, 20);
      cloudMaterial = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        // side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: '#010101',
      });
      const addClouds = (pos, material, array) => {
        for (let p = 0; p < 20; p++) {
          const cloud = new THREE.Mesh(cloudGeo, material);
          cloud.position.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 2);
          cloud.position.x += pos[0];
          cloud.position.y += pos[1];
          cloud.position.z += pos[2];
          cloud.rotation.y += Math.PI;
          // cloud.rotation.y = -0.12
          // cloud.rotation.x = 1.16
          cloud.rotation.z = Math.random() * 2 * Math.PI;
          cloud.material.opacity = 0.6;
          array.push(cloud);
          cloud.updateMatrixWorld();
          // cloud.layers.toggle(BLOOM_SCENE)
          app.add(cloud);
        }
      };
      addClouds([2, 55, 2], cloudMaterial, particleArray);
      addClouds([-2, 56, 2], cloudMaterial, particleArray);
      addClouds([1, 57, 1], cloudMaterial, particleArray);
      addClouds([-2, 54, -2], cloudMaterial, particleArray);

      const fireGeometry = new THREE.SphereGeometry(5, 10, 10);

      const particleTextures = [
        'assets/textures/fire_01.png',
        'assets/textures/circle_05.png',
        'assets/textures/trace_03.png',
        'assets/textures/trace_04.png',
      ];

      const addFire = (pos, size, array) => {
        const fireMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          transparent: true,
          color: '#cc1400',
          size: 0.2 + size,
          map: new THREE.TextureLoader().load(
            baseUrl +
              particleTextures[
                Math.floor(Math.random() * particleTextures.length)
              ]
          ),
        });
        const fire = new THREE.Points(fireGeometry, fireMaterial);
        fire.position.x += pos[0];
        fire.position.y += pos[1] + 65;
        fire.position.z += pos[2];
        fire.scale.set(1 + Math.random(), 1 + Math.random(), 1 + Math.random());
        fire.updateMatrixWorld();
        app.add(fire);
        array.push(fire);
      };
      addFire([2 / 2, 54, -1 / 2], 0.165, particleArray);
      addFire([-1 / 2, 56, 4 / 2], 0.1, particleArray);
      addFire([1 / 2, 59, -4 / 2], 0.135, particleArray);
      addFire([1.5 / 2, 53, -2 / 2], 0.05, particleArray);
      addFire([3 / 2, 58, 1.5 / 2], 0.05, particleArray);
      addFire([1 / 2, 56, 2 / 2], 0.21, particleArray);
    }
  );

  let live = true;
  let generator = null;
  let tracker = null;
  e.waitUntil(
    (async () => {
      /* const biomeDataTexture = (() => {
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < biomeSpecs.length; i++) {
        const biomeSpec = biomeSpecs[i];
        const [name, colorHex, textureName] = biomeSpec;
        localColor.setHex(colorHex);
        data[i * 4] = localColor.r * 255;
        data[i * 4 + 1] = localColor.g * 255;
        data[i * 4 + 2] = localColor.b * 255;
        data[i * 4 + 3] = 255;
      }
      const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.needsUpdate = true;
      return texture;
    })(); */
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

          data[i * 4] = (x / texturesPerRow) * 255;
          data[i * 4 + 1] = (y / texturesPerRow) * 255;
          data[i * 4 + 2] = 0;
          data[i * 4 + 3] = 255;
        }
        // console.log('got uv data texture', data);
        const texture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.needsUpdate = true;
        return texture;
      })();
      // window.biomeUvDataTexture = biomeUvDataTexture;

      const { ktx2Loader } = useLoaders();
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

      generator = new TerrainChunkGenerator(this, {
        physics,
        // biomeDataTexture,
        biomeUvDataTexture,
        atlasTextures,
      });
      tracker = new LodChunkTracker(generator, {
        chunkWorldSize,
        numLods,
        chunkHeight: chunkWorldSize,
      });

      app.add(generator.object);
      generator.object.updateMatrixWorld();
    })()
  );

  app.getPhysicsObjects = () =>
    generator ? generator.getPhysicsObjects() : [];

  // console.log('got hit tracker', app.hitTracker);
  app.addEventListener('hit', (e) => {
    generator && generator.hit(e);
  });

  useFrame(({ timestamp }) => {
    if (tracker) {
      const localPlayer = useLocalPlayer();
      localMatrix
        .copy(localPlayer.matrixWorld)
        .premultiply(localMatrix2.copy(app.matrixWorld).invert())
        .decompose(localVector, localQuaternion, localVector2);
      tracker.update(localVector);
      // console.log(tracker.update);
    }
    if (terrainMaterial) {
      const shader = terrainMaterial.userData.shader;
      if (shader) {
        shader.uniforms.uTime.value = timestamp;
      }
      // smoke and fire particles
      particleArray.forEach((particle) => {
        if (particle.position.y > 65) {
          particle.position.y = 40;
          particle.updateMatrixWorld();
          particle.material.opacity = 0.6;
          if (particle.material.size) {
            particle.material.size = 0.2 + Math.random() / 9;
          }
        }
        particle.rotation.z = Math.sin(timestamp / 100000) * 4;
        particle.position.y += 0.02;
        particle.material.opacity -= 0.0001;
        if (particle.material.size) {
          // particle.material.size -= 0.000001;
        }
        particle.updateMatrixWorld();
      });
    }
    // console.log(timestamp);
  });

  useCleanup(() => {
    live = false;
    tracker && tracker.destroy();
  });

  return app;
};
