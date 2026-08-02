import { getLoadedLut } from '../services/lutLibrary'
import { normalizeLutSettings } from './adjustments'

/**
 * GPU color grade shared by the export compositor and the live preview.
 *
 * The GLSL here is the single source of truth for adjustment math on the
 * GPU: services/gpuCompositor.js compiles these chunks into its export
 * pipeline, and applyAdjustmentSettingsToCanvasGpu runs the same shader
 * standalone for the preview (canvas in → graded canvas out). The preview
 * previously ran applyAdjustmentSettingsToImageData — a full-frame
 * getImageData + ~2M-pixel JavaScript loop per clip per frame — which made
 * live tonal grading unplayable; that loop remains only as the no-WebGL2
 * fallback.
 *
 * The math mirrors applyAdjustmentGroupToRgb /
 * applyAdjustmentSettingsToImageData in utils/adjustments.js exactly: same
 * stage order, same per-stage clamping, same tonal smoothstep weights.
 */

export const ADJUSTMENT_STAGES_GLSL = `
vec3 linearStage(vec3 c, float slope, float intercept) {
  return clamp(c * slope + intercept, 0.0, 1.0);
}

// p: brightness, contrast, saturation, gain, gamma, offset, hue
vec3 applyGroupStages(vec3 c, float p[7]) {
  if (p[0] != 0.0) {
    c = linearStage(c, max((100.0 + p[0]) / 100.0, 0.0), 0.0);
  }
  if (p[1] != 0.0) {
    float slope = max((100.0 + p[1]) / 100.0, 0.0);
    c = linearStage(c, slope, 0.5 - 0.5 * slope);
  }
  if (p[2] != 0.0) {
    float amount = max((100.0 + p[2]) / 100.0, 0.0);
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(vec3(lum) + (c - vec3(lum)) * amount, 0.0, 1.0);
  }
  if (p[3] != 0.0) {
    c = linearStage(c, max((100.0 + p[3]) / 100.0, 0.0), 0.0);
  }
  if (p[4] != 0.0) {
    float slope = max((100.0 + p[4] * 0.5) / 100.0, 0.0);
    c = linearStage(c, slope, 0.5 - 0.5 * slope);
  }
  if (p[5] != 0.0) {
    c = linearStage(c, 1.0, p[5] / 200.0);
  }
  if (p[6] != 0.0) {
    float angle = p[6] * 0.017453292519943295;
    float cosA = cos(angle);
    float sinA = sin(angle);
    mat3 m = mat3(
      0.213 + cosA * 0.787 - sinA * 0.213,
      0.213 - cosA * 0.213 + sinA * 0.143,
      0.213 - cosA * 0.213 - sinA * 0.787,
      0.715 - cosA * 0.715 - sinA * 0.715,
      0.715 + cosA * 0.285 + sinA * 0.140,
      0.715 - cosA * 0.715 + sinA * 0.715,
      0.072 - cosA * 0.072 + sinA * 0.928,
      0.072 - cosA * 0.072 - sinA * 0.283,
      0.072 + cosA * 0.928 + sinA * 0.072
    );
    c = clamp(m * c, 0.0, 1.0);
  }
  return c;
}
`

// Fullscreen color pass over a PREMULTIPLIED texture: the global stage
// group plus the tonal shadows/midtones/highlights groups. Tonal weights
// mirror getTonalWeight; each active group grades the globally-adjusted
// color and lerps into the running result by its luminance weight, in
// shadows→midtones→highlights order like the JS pixel loop.
//
// The 3D LUT is the LAST color stage: correct/balance with the stages
// above, then apply the look — the order every grading tool teaches.
// u_lut lives on texture unit 1 (unit 0 holds the sampler2D; two sampler
// TYPES sharing one unit is a draw-time error on many drivers, so hosts
// keep a 1³ dummy bound there whenever no LUT is active). The coordinate
// scale/offset samples texel CENTERS so input 0 hits the first table entry
// and input 1 the last, with trilinear filtering between.
export const ADJUSTMENT_COLOR_PASS_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_texture;
uniform sampler3D u_lut;
uniform float u_lutSize;
uniform float u_lutAmount;
uniform float u_global[7];
uniform float u_shadows[7];
uniform float u_midtones[7];
uniform float u_highlights[7];
uniform float u_groupActive[3];
in vec2 v_uv;
out vec4 outColor;
${ADJUSTMENT_STAGES_GLSL}
void main() {
  vec4 texel = texture(u_texture, v_uv);
  vec3 rgb = texel.a > 0.0 ? texel.rgb / texel.a : vec3(0.0);
  vec3 global = applyGroupStages(rgb, u_global);
  vec3 result = global;
  if (u_groupActive[0] + u_groupActive[1] + u_groupActive[2] > 0.0) {
    float lum = dot(global, vec3(0.2126, 0.7152, 0.0722));
    if (u_groupActive[0] > 0.5) {
      float weight = 1.0 - smoothstep(0.18, 0.55, lum);
      if (weight > 0.0) result = mix(result, applyGroupStages(global, u_shadows), weight);
    }
    if (u_groupActive[1] > 0.5) {
      float weight = smoothstep(0.18, 0.5, lum) * (1.0 - smoothstep(0.5, 0.82, lum));
      if (weight > 0.0) result = mix(result, applyGroupStages(global, u_midtones), weight);
    }
    if (u_groupActive[2] > 0.5) {
      float weight = smoothstep(0.45, 0.82, lum);
      if (weight > 0.0) result = mix(result, applyGroupStages(global, u_highlights), weight);
    }
  }
  if (u_lutSize > 0.5 && u_lutAmount > 0.0) {
    vec3 lutCoord = clamp(result, 0.0, 1.0) * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
    result = mix(result, texture(u_lut, lutCoord).rgb, clamp(u_lutAmount, 0.0, 1.0));
  }
  outColor = vec4(result * texel.a, texel.a);
}
`

const ADJUSTMENT_PASS_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const groupToArray = (group) => new Float32Array([
  Number(group?.brightness) || 0,
  Number(group?.contrast) || 0,
  Number(group?.saturation) || 0,
  Number(group?.gain) || 0,
  Number(group?.gamma) || 0,
  Number(group?.offset) || 0,
  Number(group?.hue) || 0,
])

const groupHasEffect = (group) => groupToArray(group).some((value) => value !== 0)

/**
 * Uniform values for ADJUSTMENT_COLOR_PASS_FS. Inactive tonal groups must
 * be SKIPPED, not applied-as-identity: the shader lerps each active group
 * into a running result, so the active flags mirror the JS loop's
 * hasAdjustmentGroupEffect guard.
 */
export function buildAdjustmentUniformValues(settings = {}) {
  return {
    global: groupToArray(settings),
    shadows: groupToArray(settings?.shadows),
    midtones: groupToArray(settings?.midtones),
    highlights: groupToArray(settings?.highlights),
    groupActive: new Float32Array([
      groupHasEffect(settings?.shadows) ? 1 : 0,
      groupHasEffect(settings?.midtones) ? 1 : 0,
      groupHasEffect(settings?.highlights) ? 1 : 0,
    ]),
  }
}

/**
 * Resolve a settings object's LUT reference against the in-memory LUT
 * library. Both GPU hosts (the export compositor's color pass and the
 * standalone preview grade below) resolve through here so a clip's
 * { lutId, amount } means the same table everywhere. Null when there is no
 * LUT, its amount is 0, or the library hasn't loaded that id (render
 * degrades to no-LUT for that frame rather than failing).
 */
export function resolveLutForSettings(settings) {
  const lut = normalizeLutSettings(settings?.lut)
  if (!lut || lut.amount <= 0) return null
  const entry = getLoadedLut(lut.lutId)
  if (!entry) return null
  return { entry, amount: lut.amount / 100 }
}

/**
 * Upload a LUT library entry as a filterable RGBA8 3D texture. Premultiply
 * and flip are forced off — hosts toggle those for 2D source uploads and
 * the pixel-store state is global to the context.
 */
export function createLut3DTexture(gl, entry) {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_3D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, entry.size, entry.size, entry.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, entry.rgba8)
  return texture
}

/** 1×1×1 identity stand-in so unit 1 always holds a valid sampler3D binding. */
export function createDummyLut3DTexture(gl) {
  return createLut3DTexture(gl, { size: 1, rgba8: new Uint8Array([0, 0, 0, 255]) })
}

const UNIFORM_NAMES = ['u_texture', 'u_lut', 'u_lutSize', 'u_lutAmount', 'u_global', 'u_shadows', 'u_midtones', 'u_highlights', 'u_groupActive']

function createGradeRenderer(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  })
  if (!gl) return null

  const compile = (type, source) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'shader compile failed'
      gl.deleteShader(shader)
      throw new Error(message)
    }
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, ADJUSTMENT_PASS_VS)
  const fs = compile(gl.FRAGMENT_SHADER, ADJUSTMENT_COLOR_PASS_FS)
  const program = gl.createProgram()
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'a_pos')
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'program link failed'
    gl.deleteProgram(program)
    throw new Error(message)
  }

  const uniforms = {}
  for (const name of UNIFORM_NAMES) {
    uniforms[name] = gl.getUniformLocation(program, name)
  }

  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  const dummyLutTexture = createDummyLut3DTexture(gl)
  const lutTextures = new Map() // lutId -> WebGLTexture (entries are immutable per id)

  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)

  const render = (source, settings) => {
    if (gl.isContextLost()) return false
    gl.viewport(0, 0, width, height)
    gl.useProgram(program)

    // LUT on unit 1 first: its upload must not inherit the premultiply/flip
    // pixel-store state the 2D source upload sets below.
    const resolvedLut = resolveLutForSettings(settings)
    let lutTexture = dummyLutTexture
    if (resolvedLut) {
      lutTexture = lutTextures.get(resolvedLut.entry.id)
      if (!lutTexture) {
        lutTexture = createLut3DTexture(gl, resolvedLut.entry)
        lutTextures.set(resolvedLut.entry.id, lutTexture)
      }
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, lutTexture)
    gl.uniform1i(uniforms.u_lut, 1)
    gl.uniform1f(uniforms.u_lutSize, resolvedLut ? resolvedLut.entry.size : 0)
    gl.uniform1f(uniforms.u_lutAmount, resolvedLut ? resolvedLut.amount : 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // The shader unpremultiplies/premultiplies internally, matching the JS
    // loop operating on getImageData's straight values; upload premultiplied
    // so semi-transparent pixels round-trip the same way.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.uniform1i(uniforms.u_texture, 0)
    const values = buildAdjustmentUniformValues(settings)
    gl.uniform1fv(uniforms.u_global, values.global)
    gl.uniform1fv(uniforms.u_shadows, values.shadows)
    gl.uniform1fv(uniforms.u_midtones, values.midtones)
    gl.uniform1fv(uniforms.u_highlights, values.highlights)
    gl.uniform1fv(uniforms.u_groupActive, values.groupActive)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  }

  return { canvas, gl, render }
}

const gradeRendererCache = new Map() // `${w}x${h}` -> renderer | null (null = creation failed)

/**
 * Grade `sourceCanvas` through the shared adjustment shader and write the
 * result into `targetCtx` (replacing its contents). Returns false when the
 * GPU path is unavailable — callers fall back to the CPU pixel loop.
 */
export function applyAdjustmentSettingsToCanvasGpu(sourceCanvas, targetCtx, width, height, settings) {
  if (!sourceCanvas || !targetCtx || !width || !height) return false
  // Kill switch, same pattern as the export flags: '0' forces the CPU loop.
  try {
    if (window.localStorage.getItem('comfystudio-preview-gpu-grade') === '0') return false
  } catch (_) { /* ignore */ }
  const key = `${width}x${height}`
  try {
    let renderer = gradeRendererCache.get(key)
    if (renderer === null) return false
    if (!renderer) {
      renderer = createGradeRenderer(width, height)
      gradeRendererCache.set(key, renderer)
      if (!renderer) return false
    }
    if (!renderer.render(sourceCanvas, settings)) {
      // Context lost — drop the renderer so a later call can rebuild.
      gradeRendererCache.delete(key)
      return false
    }
    targetCtx.save()
    targetCtx.filter = 'none'
    targetCtx.globalAlpha = 1
    targetCtx.globalCompositeOperation = 'copy'
    targetCtx.drawImage(renderer.canvas, 0, 0)
    targetCtx.restore()
    return true
  } catch (err) {
    console.warn('GPU adjustment grade failed; using CPU path.', err)
    gradeRendererCache.set(key, null)
    return false
  }
}
