import metaversefile from 'metaversefile';
import * as THREE from 'three';
import { terrainVertex, terrainFragment } from './shaders/terrainShader.js';
import biomeSpecs from './biomes.js';

const {useApp, useLocalPlayer, useFrame, useCleanup, usePhysics, useLoaders, useInstancing, useDcWorkerManager, useLodder} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

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
    // biomeDataTexture,
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
    const textureLoader = new THREE.TextureLoader();

    const earthTexture = textureLoader.load(
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
    );
    grassNormal.wrapS = grassNormal.wrapT = THREE.RepeatWrapping;
    const material = new THREE.ShaderMaterial({
      vertexShader: terrainVertex,
      fragmentShader: terrainFragment,
      // wireframe: true,
      vertexColors: true,
      side: THREE.FrontSide,
      uniforms: {
        uTime: { value: 0 },
        uEarthBaseColor: {
          value: earthTexture,
        },
        uGrassBaseColor: {
          value: grassTexture,
        },
        uEarthNormal: {
          value: earthNormal,
        },
        uGrassNormal: {
          value: grassNormal,
        },
        // diffuseMap: {
        //   value: {
        //     textures: [
        //       new THREE.TextureLoader(
        //         baseUrl + '/assets/texture/EarthBaseColor.png'
        //       ),
        //       new THREE.TextureLoader(
        //         baseUrl + '/assets/texture/GrassBaseColor.png'
        //       ),
        //     ],
        //   },
        // },
        // normalMap: {
        //   value: {
        //     textures: [
        //       new THREE.TextureLoader(
        //         baseUrl + '/assets/texture/EarthNormal.png'
        //       ),
        //       new THREE.TextureLoader(
        //         baseUrl + '/assets/texture/GrassNormal.png'
        //       ),
        //     ],
        //   },
        // },
        noiseMap: {
          value: new THREE.TextureLoader().load(
            baseUrl + '/assets/texture/noiseMap.png'
          ),
        },
        uResolution: {
          value: new THREE.Vector2(window.innerWidth, window.innerHeight),
        },
        uTexture: { value: null },
      },
    });
    super(geometry, material, allocator);
    this.frustumCulled = false;

    this.physics = physics;
    this.allocator = allocator;
    this.physicsObjects = [];

    // window.terrainMesh = this;
  }
  async addChunk(chunk, {
    signal,
  }) {
    const meshData = await dcWorkerManager.generateChunk(chunk, chunk.lodArray);
    // console.log('mesh data', meshData);
    signal.throwIfAborted();
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
      /* const _updateRenderList = () => {
        this.allocator.geometry.groups = this.allocator.indexFreeList.getGeometryGroups(); // XXX memory for this can be optimized
      }; */
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
        // _updateRenderList();

        signal.addEventListener('abort', e => {
          this.allocator.free(geometryBinding);
          // _updateRenderList();
        });
      };
      _handleMesh();

      const _handlePhysics = async () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        const physycsMesh = new THREE.Mesh(geometry, fakeMaterial);
    
        // console.log('cook 1', mesh);
        const geometryBuffer = await this.physics.cookGeometryAsync(physycsMesh, {
          signal,
        });
        // console.log('cook 2', mesh);

        this.matrixWorld.decompose(localVector, localQuaternion, localVector2);
        const physicsObject = this.physics.addCookedGeometry(geometryBuffer, localVector, localQuaternion, localVector2);
        this.physicsObjects.push(physicsObject);
        
        // console.log('cook 3', mesh);

        signal.addEventListener('abort', e => {
          this.physics.removeGeometry(physicsObject);
          this.physicsObjects.splice(this.physicsObjects.indexOf(physicsObject), 1);
        });
      };
      await _handlePhysics();
    }
  }
}

class TerrainChunkGenerator {
  constructor(parent, {
    physics,
    // biomeDataTexture,
    biomeUvDataTexture,
    atlasTextures,
  } = {}) {
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
    const {signal} = abortController;

    this.terrainMesh.addChunk(chunk, {
      signal,
    }).catch(err => {
      if (err !== abortError) {
        console.warn(err);
      }
    });

    chunk.binding = {
      abortController,
      // signal,
    }
  }

  disposeChunk(chunk) {
    const binding = chunk.binding;
    if (binding) {
      const {abortController} = binding;
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
    const {hitPosition} = e;
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
    pos.x, pos.y, pos.z,
    size, size, size,
    lod,
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
      }
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
  const {LodChunkTracker} = useLodder();

  app.name = 'dual-contouring-terrain';

  let live = true;
  let generator = null;
  let tracker = null;
  e.waitUntil((async () => {
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
        
        data[i * 4] = x / texturesPerRow * 255;
        data[i * 4 + 1] = y / texturesPerRow * 255;
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
  })());

  app.getPhysicsObjects = () => generator ? generator.getPhysicsObjects() : [];

  // console.log('got hit tracker', app.hitTracker);
  app.addEventListener('hit', e => {
    generator && generator.hit(e);
  });

  useFrame(() => {
    if (tracker) {
      const localPlayer = useLocalPlayer();
      localMatrix.copy(localPlayer.matrixWorld)
        .premultiply(
          localMatrix2.copy(app.matrixWorld).invert()
        )
        .decompose(localVector, localQuaternion, localVector2)
      tracker.update(localVector);
    }
  });

  useCleanup(() => {
    live = false;
    tracker && tracker.destroy();
  });

  return app
}
