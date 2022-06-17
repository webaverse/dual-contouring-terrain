import * as THREE from 'three'

const terrainVertex = `
      ${THREE.ShaderChunk.common}
      attribute ivec4 biomes;
      attribute vec4 biomesWeights;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;
      flat varying ivec4 vBiomes;
      varying vec4 vBiomesWeights;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform sampler2D uTexture;
     
${THREE.ShaderChunk.logdepthbuf_pars_vertex}
void main() {
  vUv = uv;
  vNormal = normal;
  vPosition = position;
  vBiomes = biomes;
  vBiomesWeights = biomesWeights;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  vec4 projectedPosition = projectionMatrix * viewPosition;
  // gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.);
  gl_Position = projectedPosition;
  ${THREE.ShaderChunk.logdepthbuf_vertex}
}
    `

const terrainFragment = `
  precision highp float;
  precision highp int;
  precision lowp sampler2DArray;
  #define PI 3.1415926535897932384626433832795
  ${THREE.ShaderChunk.logdepthbuf_pars_fragment}
  uniform mat4 modelMatrix;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  flat varying ivec4 vBiomes;
  varying vec4 vBiomesWeights;
  uniform vec2 uResolution;
  uniform sampler2DArray diffuseMap;
  uniform sampler2DArray normalMap;
  uniform sampler2D uEarthBaseColor;
  uniform sampler2D uGrassBaseColor;
  uniform sampler2D uEarthNormal;
  uniform sampler2D uGrassNormal;
  uniform sampler2D noiseMap;
  uniform float uTime;

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

  vec4 triplanarTexture(sampler2D inputTexture , float scale , float blendSharpness){
    vec2 uvX = vPosition.zy * scale;
    vec2 uvY = vPosition.xz * scale;
    vec2 uvZ = vPosition.xy * scale;
    
    vec4 colX = texture2D(inputTexture , uvX);
    vec4 colY = texture2D(inputTexture , uvY);
    vec4 colZ = texture2D(inputTexture , uvZ);

    vec3 blendWeight = pow(abs(vNormal), vec3(blendSharpness));
    blendWeight /= dot(blendWeight,vec3(1));

    return colX * blendWeight.x + colY * blendWeight.y + colZ * blendWeight.z;
  }

  vec4 triplanarNormal(sampler2D inputTexture , float scale , float blendSharpness) {
    // Tangent Reconstruction
    // Triplanar uvs
    vec2 uvX = vPosition.zy * scale;
    vec2 uvY = vPosition.xz * scale;
    vec2 uvZ = vPosition.xy * scale;
    
    vec4 colX = texture2D(inputTexture , uvX);
    vec4 colY = texture2D(inputTexture , uvY);
    vec4 colZ = texture2D(inputTexture , uvZ);
    // Tangent space normal maps
    vec3 tx = colX.xyz * vec3(2,2,2) - vec3(1,1,1);
    vec3 ty = colY.xyz * vec3(2,2,2) - vec3(1,1,1);
    vec3 tz = colZ.xyz * vec3(2,2,2) - vec3(1,1,1);
    vec3 weights = abs(vNormal.xyz);
    weights = weights / (weights.x + weights.y + weights.z);
    // Get the sign (-1 or 1) of the surface normal
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

  void setBiome(int biome, out vec4 diffuseSample,out vec4 normalSample){
    if(biome == 1){
      // rocky ground 1
      // diffuseSample = vec4(0.5, 0.1 , 0.69, 1.);
      diffuseSample = vec4(0,0,0,1.);
      normalSample = vec4(1,1,1,1.);
    } 
    else if(biome == 4){
      // rocky ground 2
      // diffuseSample = vec4(0.36 , 0.2 , 0.06 ,1 );
      diffuseSample = vec4(0,0,0,1.);
      normalSample = vec4(1,1,1,1.);
    }
    else if(biome == 18){
      // mountains tunnel 
      // diffuseSample = vec4(0.1, 0.9 , 0.1, 1.);
      diffuseSample = vec4(0,0,0,1.);
      normalSample = vec4(1,1,1,1.);
    }
    else if(biome == 61){
      // subtle lava
      // diffuseSample = vec4(0.1, 0.4 , 0.9, 1.);
      diffuseSample = vec4(0,0,0,1.);
      normalSample = vec4(1,1,1,1.);
    }
    else if(biome == 62){
      // diffuseSample = vec4(0.1, 0.4 , 0.9, 1.);
      diffuseSample = vec4(0,0,1,1);
      normalSample = vec4(1,1,1,1);
    }
    else if(biome == 63){
      // diffuseSample = vec4(0.1, 0.4 , 0.9, 1.);
      diffuseSample = vec4(0,0,1,1);
      normalSample = vec4(1,1,1,1);
    }
    else if(biome == 64){
      // diffuseSample = vec4(0.1, 0.4 , 0.9, 1.);
      diffuseSample = vec4(0,0,1,1);
      normalSample = vec4(1,1,1,1);
    }
    else if(biome == 65){
      // diffuseSample = vec4(0.1, 0.4 , 0.9, 1.);
      diffuseSample = vec4(0,0,1,1);
      normalSample = vec4(1,1,1,1);
    }
    else if(biome == 66){
      // diffuseSample = vec4(0.1, 0.4 , 0.9, 1.);
      diffuseSample = vec4(0,0,1,1);
      normalSample = vec4(1,1,1,1);
    }
    else if(biome == 67){
      // lava
      // diffuseSample = vec4(0.1, 0.4 , 0.9, 1.);
      diffuseSample = vec4(0,0,1,1);
      normalSample = vec4(1,1,1,1);
    }
    else{
      // default color is red
      // diffuseSample = vec4(1, 0.1 , 0.1, 1.);
      // diffuseSample = vec4(1,0,0,1);
      float time = -uTime / 200000.;
      vec2 fakeUv = vPosition.xz/15.0;
    float f = fbm(vec2(time)+fakeUv + fbm(vec2(time)-fakeUv));

    float r = smoothstep(.0, 0.4, f);
    float g = smoothstep(.3, 0.7, f);
    float b = smoothstep(.6, 1., f);
    
    vec3 marble = vec3(r, g, b);
    float f2 = .5 - f;
    
	  r = smoothstep(.7, 1. , f2);
    g = smoothstep(.65, .9, f2);
    b = smoothstep(.65, 0.9, f2);
    
      vec3 col2 = vec3(r, g, b);    
      marble = mix(marble, col2, f2) * vec3(1.,0.6,0.4);
      diffuseSample = vec4(marble,1.0);
      normalSample = vec4(1,1,1,1);
    }
  
  }

  void main() {
    float time = uTime;
    vec4 diffuseSamples[4];
    vec4 normalSamples[4];

    vec3 worldPosition = (modelMatrix * vec4(vPosition, 1)).xyz;
    vec3 eyeDirection = normalize(worldPosition - cameraPosition);
    vec3 sunDir = normalize(vec3(1, 0, 0));

    setBiome(vBiomes.x, diffuseSamples[0], normalSamples[0]);
    setBiome(vBiomes.y, diffuseSamples[1], normalSamples[1]);
    setBiome(vBiomes.z, diffuseSamples[2], normalSamples[2]);
    setBiome(vBiomes.w, diffuseSamples[3], normalSamples[3]);
 
    vec4 diffuseBlended = terrainBlend(diffuseSamples,vBiomesWeights);
    vec4 normalBlended = terrainBlend(normalSamples,vec4(1));

    vec3 worldSpaceNormal = normalize(normalBlended.xyz);
    vec4 finalColor = diffuseBlended;
    gl_FragColor = finalColor;
  ${THREE.ShaderChunk.logdepthbuf_fragment}
  }
`

export { terrainVertex, terrainFragment }
