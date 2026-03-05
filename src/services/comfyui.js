/**
 * ComfyUI API Service
 * Handles communication with the ComfyUI backend
 */
import {
  checkLocalComfyConnection,
  getLocalComfyHttpBaseSync,
  getLocalComfyWsBaseSync,
  hydrateLocalComfyConnection,
} from './localComfyConnection'

const COMFY_ORG_API_KEY_SETTING_KEY = 'comfyApiKeyComfyOrg';
const COMFY_ORG_API_KEY_LOCAL_KEY = 'comfystudio-comfy-api-key';

class ComfyUIService {
  constructor() {
    this.ws = null;
    this.clientId = this.generateClientId();
    this.listeners = new Map();
    this.wsFailCount = 0;
    this.lastWsAttempt = 0;
    this.wsBackoffMs = 5000; // Minimum time between reconnection attempts
    void hydrateLocalComfyConnection()
  }

  generateClientId() {
    return 'comfystudio-' + Math.random().toString(36).substring(2, 15);
  }

  getHttpBase() {
    return getLocalComfyHttpBaseSync()
  }

  getWsBase() {
    return getLocalComfyWsBaseSync()
  }

  /**
   * Connect to ComfyUI WebSocket for progress updates
   * Always connects directly to ComfyUI (bypassing Vite proxy)
   */
  connect() {
    return new Promise((resolve, reject) => {
      // Skip if already connected
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      
      // Rate limit reconnection attempts to avoid spam
      const now = Date.now();
      if (now - this.lastWsAttempt < this.wsBackoffMs) {
        reject(new Error('WebSocket reconnection rate limited'));
        return;
      }
      this.lastWsAttempt = now;
      
      // Close existing connection if in connecting/closing state
      if (this.ws) {
        try {
          this.ws.close();
        } catch (e) {}
        this.ws = null;
      }

      // Always connect directly to ComfyUI (Vite proxy doesn't handle WS well)
      const wsUrl = `${this.getWsBase()}/ws?clientId=${this.clientId}`;
      
      // Only log first attempt
      if (this.wsFailCount === 0) {
        console.log('Connecting to ComfyUI WebSocket:', wsUrl);
      }
      this.ws = new WebSocket(wsUrl);
      
      // Set a timeout for connection
      const timeout = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
          this.wsFailCount++;
          reject(new Error('WebSocket connection timeout'));
        }
      }, 5000);
      
      this.ws.onopen = () => {
        clearTimeout(timeout);
        console.log('Connected to ComfyUI WebSocket');
        this.wsFailCount = 0;
        resolve();
      };

      this.ws.onerror = (error) => {
        clearTimeout(timeout);
        // Only log first few errors to avoid spam
        if (this.wsFailCount < 3) {
          console.warn('WebSocket connection failed (ComfyUI may not support WebSocket or is blocked)');
        }
        this.wsFailCount++;
        // Increase backoff on repeated failures
        this.wsBackoffMs = Math.min(30000, this.wsBackoffMs * 1.5);
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        this.ws = null;
      };
    });
  }
  
  /**
   * Check if WebSocket is connected
   */
  isWebSocketConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(data) {
    const { type } = data;
    
    if (type === 'progress') {
      this.emit('progress', {
        value: data.data.value,
        max: data.data.max,
        promptId: data.data.prompt_id
      });
    } else if (type === 'executing') {
      if (data.data.node === null) {
        // Execution complete
        this.emit('complete', { promptId: data.data.prompt_id });
      } else {
        this.emit('executing', { 
          node: data.data.node,
          promptId: data.data.prompt_id 
        });
      }
    } else if (type === 'executed') {
      this.emit('executed', {
        node: data.data.node,
        output: data.data.output,
        promptId: data.data.prompt_id
      });
    } else if (type === 'status') {
      this.emit('status', data.data);
    }
  }

  /**
   * Event emitter methods
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => callback(data));
    }
  }

  /**
   * Check if ComfyUI is running
   */
  async checkConnection() {
    const result = await checkLocalComfyConnection()
    if (!result.ok) {
      console.log('ComfyUI connection check failed:', result.error)
    }
    return result.ok
  }

  /**
   * Get ComfyUI object metadata (available node classes and input schemas).
   * Optionally scopes to a single class when classType is provided.
   */
  async getObjectInfo(classType = null) {
    const suffix = classType
      ? `/object_info/${encodeURIComponent(String(classType).trim())}`
      : '/object_info'
    const response = await fetch(`${this.getHttpBase()}${suffix}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch ComfyUI object info (${response.status})`)
    }
    return response.json()
  }

  /**
   * Queue a prompt for execution
   */
  async queuePrompt(workflow) {
    try {
      const apiKey = await this.getComfyOrgApiKey();
      const payload = {
        prompt: workflow,
        client_id: this.clientId
      };
      if (apiKey) {
        payload.extra_data = {
          api_key_comfy_org: apiKey
        };
      }
      const response = await fetch(`${this.getHttpBase()}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to queue prompt');
      }

      const result = await response.json();
      return result.prompt_id;
    } catch (error) {
      console.error('Error queuing prompt:', error);
      throw error;
    }
  }

  /**
   * Resolve optional Comfy account API key for paid API nodes.
   */
  async getComfyOrgApiKey() {
    try {
      if (typeof window !== 'undefined' && window?.electronAPI?.getSetting) {
        const stored = await window.electronAPI.getSetting(COMFY_ORG_API_KEY_SETTING_KEY)
        const normalized = String(stored || '').trim()
        if (normalized) return normalized
      }
    } catch (_) {
      // Ignore and fall back to localStorage.
    }

    try {
      if (typeof localStorage !== 'undefined') {
        return String(localStorage.getItem(COMFY_ORG_API_KEY_LOCAL_KEY) || '').trim()
      }
    } catch (_) {
      // Ignore storage access errors.
    }
    return ''
  }

  /**
   * Get history/output for a prompt (or full history if no promptId)
   */
  async getHistory(promptId) {
    try {
      const url = promptId
        ? `${this.getHttpBase()}/history/${promptId}`
        : `${this.getHttpBase()}/history`;
      const response = await fetch(url);
      return await response.json();
    } catch (error) {
      console.error('Error getting history:', error);
      throw error;
    }
  }

  /**
   * Get an image/video from ComfyUI output
   */
  getMediaUrl(filename, subfolder = '', type = 'output') {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type
    });
    return `${this.getHttpBase()}/view?${params}`;
  }

  /**
   * Download a video from ComfyUI and return as a File object
   * @param {string} filename - The filename on ComfyUI
   * @param {string} subfolder - The subfolder (usually 'video')
   * @param {string} type - The type (usually 'output')
   * @returns {Promise<File>} - The video as a File object
   */
  async downloadVideo(filename, subfolder = '', type = 'output') {
    const url = this.getMediaUrl(filename, subfolder, type);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status}`);
      }
      
      const blob = await response.blob();
      const mimeType = blob.type || 'video/mp4';
      
      // Create a File object from the blob
      return new File([blob], filename, { type: mimeType });
    } catch (error) {
      console.error('Error downloading video from ComfyUI:', error);
      throw error;
    }
  }

  /**
   * Interrupt the current generation
   */
  async interrupt() {
    try {
      await fetch(`${this.getHttpBase()}/interrupt`, { method: 'POST' });
    } catch (error) {
      console.error('Error interrupting:', error);
    }
  }

  /**
   * Get queue status
   */
  async getQueueStatus() {
    try {
      const response = await fetch(`${this.getHttpBase()}/queue`);
      return await response.json();
    } catch (error) {
      console.error('Error getting queue:', error);
      return { queue_running: [], queue_pending: [] };
    }
  }
  
  /**
   * Upload a file to ComfyUI
   * @param {File|Blob} file - The file to upload
   * @param {string} filename - Optional filename override
   * @param {string} subfolder - Optional subfolder (default: empty)
   * @param {string} type - 'input', 'temp', or 'output' (default: 'input')
   * @returns {Promise<{name: string, subfolder: string, type: string}>}
   */
  async uploadFile(file, filename = null, subfolder = '', type = 'input') {
    try {
      const formData = new FormData();
      
      // Use provided filename or file's name
      const uploadFilename = filename || file.name || `upload_${Date.now()}`;
      
      // Append the file with the correct filename
      formData.append('image', file, uploadFilename);
      
      if (subfolder) {
        formData.append('subfolder', subfolder);
      }
      formData.append('type', type);
      formData.append('overwrite', 'true');

      const response = await fetch(`${this.getHttpBase()}/upload/image`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload file: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('File uploaded to ComfyUI:', result);
      return result;
    } catch (error) {
      console.error('Error uploading file to ComfyUI:', error);
      throw error;
    }
  }

  /**
   * Download an image from ComfyUI and return as a File object
   * @param {string} filename - The filename on ComfyUI
   * @param {string} subfolder - The subfolder
   * @param {string} type - The type (usually 'output')
   * @returns {Promise<File>} - The image as a File object
   */
  async downloadImage(filename, subfolder = '', type = 'output') {
    const url = this.getMediaUrl(filename, subfolder, type);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }
      
      const blob = await response.blob();
      const mimeType = blob.type || 'image/png';
      
      // Create a File object from the blob
      return new File([blob], filename, { type: mimeType });
    } catch (error) {
      console.error('Error downloading image from ComfyUI:', error);
      throw error;
    }
  }

  /**
   * Download multiple images (PNG sequence) from ComfyUI
   * @param {Array<{filename: string, subfolder: string, type: string}>} images - Array of image info
   * @returns {Promise<File[]>} - Array of File objects
   */
  async downloadImageSequence(images) {
    const files = [];
    for (const img of images) {
      const file = await this.downloadImage(img.filename, img.subfolder || '', img.type || 'output');
      files.push(file);
    }
    return files;
  }

  /**
   * Get detailed prompt execution info for progress tracking
   * This is useful when WebSocket is unavailable
   */
  async getPromptProgress(promptId) {
    try {
      // First check if it's in the queue
      const queueStatus = await this.getQueueStatus();
      
      // Check if it's currently running
      const running = queueStatus.queue_running || [];
      for (const item of running) {
        if (item[1] === promptId) {
          // It's running - try to get progress from history
          const history = await this.getHistory(promptId);
          const promptHistory = history[promptId];
          
          if (promptHistory?.status?.messages) {
            // Parse messages for progress info
            const messages = promptHistory.status.messages;
            for (const msg of messages) {
              if (msg[0] === 'execution_cached') {
                // Some nodes were cached
              }
            }
          }
          
          return { status: 'running', position: 0, promptId };
        }
      }
      
      // Check if it's pending
      const pending = queueStatus.queue_pending || [];
      for (let i = 0; i < pending.length; i++) {
        if (pending[i][1] === promptId) {
          return { status: 'pending', position: i + 1, promptId };
        }
      }
      
      // Check if it's completed
      const history = await this.getHistory(promptId);
      if (history[promptId]) {
        const promptHistory = history[promptId];
        if (promptHistory.outputs && Object.keys(promptHistory.outputs).length > 0) {
          return { status: 'completed', promptId };
        }
        if (promptHistory.status?.status_str === 'error') {
          return { status: 'error', promptId, error: promptHistory.status.messages };
        }
      }
      
      return { status: 'unknown', promptId };
    } catch (error) {
      console.error('Error getting prompt progress:', error);
      return { status: 'error', promptId, error: error.message };
    }
  }
}

// Singleton instance
export const comfyui = new ComfyUIService();

/**
 * Workflow modifier for Mask Generation (SAM3 + MatAnyone)
 * 
 * Workflow nodes:
 * - Node 8 (VHS_LoadVideo): Load the input video/image
 * - Node 12 (SAM3VideoSegmentation): Text prompt for segmentation
 * - Node 5 (SaveImage): Output filename prefix
 * 
 * @param {Object} workflow - The base mask generation workflow
 * @param {Object} options - Configuration options
 * @returns {Object} Modified workflow
 */
export function modifyMaskWorkflow(workflow, options = {}) {
  const {
    inputFilename = '',       // The uploaded filename in ComfyUI
    textPrompt = '',          // What to segment (e.g., "person on the left")
    outputPrefix = 'ComfyStudioMask',  // Output filename prefix
    scoreThreshold = 0.04,    // Detection sensitivity (lower = more sensitive)
    frameIdx = 0,             // Which frame to use for initial detection
  } = options;

  // Create a deep copy
  const modified = JSON.parse(JSON.stringify(workflow));

  // Update input video/image (node 8 - VHS_LoadVideo)
  if (modified['8']) {
    modified['8'].inputs.video = inputFilename;
  }

  // Update text prompt and threshold (node 12 - SAM3VideoSegmentation)
  if (modified['12']) {
    modified['12'].inputs.text_prompt = textPrompt;
    modified['12'].inputs.score_threshold = scoreThreshold;
    modified['12'].inputs.frame_idx = frameIdx;
  }

  // Update output filename prefix (node 5 - SaveImage)
  if (modified['5']) {
    modified['5'].inputs.filename_prefix = outputPrefix;
  }

  return modified;
}

/**
 * Workflow modifier for WAN 2.2 14B Image-to-Video
 */
export function modifyWAN22Workflow(workflow, options = {}) {
  const {
    prompt = '',
    negativePrompt = '',
    inputImage = '',      // Filename uploaded to ComfyUI
    width = 800,
    height = 1424,
    frames = 81,
    fps = 16,
    seed = Math.floor(Math.random() * 1000000000000),
    filenamePrefix = 'video/ComfyStudio_wan',
    qualityPreset = 'balanced', // balanced | face-lock
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))
  const useFaceLockPreset = String(qualityPreset || 'balanced') === 'face-lock'
  const positivePrompt = useFaceLockPreset
    ? `${prompt}. Keep the exact same person identity in every frame: same face, eyes, skin tone, hairstyle, and bone structure. Preserve facial consistency during motion.`
    : prompt
  const negativeWithFaceLock = [
    negativePrompt,
    useFaceLockPreset ? 'identity drift, different person, changing face, face morphing, deformed face' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const samplerSteps = useFaceLockPreset ? 6 : 4
  const samplerCfg = useFaceLockPreset ? 1.3 : 1
  const splitStep = Math.max(2, Math.floor(samplerSteps / 2))
  const modelShift = useFaceLockPreset ? 4.5 : 5.0
  const loraStrength = useFaceLockPreset ? 1.05 : 1.0

  // Positive prompt (node 93)
  if (modified['93']) {
    modified['93'].inputs.text = positivePrompt
  }
  // Negative prompt (node 89)
  if (modified['89']) {
    modified['89'].inputs.text = negativeWithFaceLock
  }
  // Image input (node 97)
  if (modified['97']) {
    modified['97'].inputs.image = inputImage
  }
  // Resolution + frame count (node 98 - WanImageToVideo)
  if (modified['98']) {
    modified['98'].inputs.width = width
    modified['98'].inputs.height = height
    modified['98'].inputs.length = frames
  }
  // FPS (node 94 - CreateVideo)
  if (modified['94']) {
    modified['94'].inputs.fps = fps
  }
  // Seed (node 86 - KSamplerAdvanced 1st pass)
  if (modified['86']) {
    modified['86'].inputs.noise_seed = seed
    modified['86'].inputs.steps = samplerSteps
    modified['86'].inputs.cfg = samplerCfg
    modified['86'].inputs.start_at_step = 0
    modified['86'].inputs.end_at_step = splitStep
  }
  // Seed + sampler tuning (node 85 - KSamplerAdvanced 2nd pass)
  if (modified['85']) {
    modified['85'].inputs.noise_seed = seed
    modified['85'].inputs.steps = samplerSteps
    modified['85'].inputs.cfg = samplerCfg
    modified['85'].inputs.start_at_step = splitStep
    modified['85'].inputs.end_at_step = samplerSteps
  }
  // LoRA strength tuning (nodes 101/102)
  if (modified['101']) {
    modified['101'].inputs.strength_model = loraStrength
  }
  if (modified['102']) {
    modified['102'].inputs.strength_model = loraStrength
  }
  // Model sampling shift tuning (nodes 103/104)
  if (modified['103']) {
    modified['103'].inputs.shift = modelShift
  }
  if (modified['104']) {
    modified['104'].inputs.shift = modelShift
  }
  // Output prefix (node 108)
  if (modified['108']) {
    modified['108'].inputs.filename_prefix = filenamePrefix
  }

  return modified
}

/**
 * Workflow modifier for 1-Click Multiple Angles (Qwen Image Edit)
 * Generates 8 camera angles from a single image
 */
export function modifyMultipleAnglesWorkflow(workflow, options = {}) {
  const {
    inputImage = '',      // Filename uploaded to ComfyUI
    seed = Math.floor(Math.random() * 1000000000000),
    // Allow overriding individual angle prompts
    prompts = {},
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))

  // Image input (node 25)
  if (modified['25']) {
    modified['25'].inputs.image = inputImage
  }

  // Default angle prompts
  const defaultPrompts = {
    closeUp:  'Turn the camera to a close-up.',
    wide:     'Turn the camera to a wide-angle lens.',
    right45:  'Rotate the camera 45 degrees to the right.',
    right90:  'Rotate the camera 90 degrees to the right.',
    aerial:   'Turn the camera to an aerial view.',
    lowAngle: 'Turn the camera to a low-angle view.',
    left45:   'Rotate the camera 45 degrees to the left.',
    left90:   'Rotate the camera 90 degrees to the left.',
  }

  // Prompt node mapping: angle key -> node ID
  const promptNodes = {
    closeUp:  '66',
    wide:     '67',
    right45:  '69',
    right90:  '68',
    aerial:   '70',
    lowAngle: '71',
    left45:   '73',
    left90:   '72',
  }

  // KSampler node mapping for seeds
  const seedNodes = [
    '65:33:21', '65:35:21', '65:37:21', '65:39:21',
    '65:40:21', '65:42:21', '65:44:21', '65:46:21',
  ]

  // Update prompts
  for (const [key, nodeId] of Object.entries(promptNodes)) {
    if (modified[nodeId]) {
      modified[nodeId].inputs.value = prompts[key] || defaultPrompts[key]
    }
  }

  // Update seeds (same seed for consistency, or random per angle)
  for (const nodeId of seedNodes) {
    if (modified[nodeId]) {
      modified[nodeId].inputs.seed = seed
    }
  }

  // Update save prefixes to ComfyStudio
  const saveNodes = { '31': 'close_up', '34': 'wide_shot', '36': '45_right', '38': '90_right', '47': '90_left', '41': 'aerial_view', '43': 'low_angle', '45': '45_left' }
  for (const [nodeId, suffix] of Object.entries(saveNodes)) {
    if (modified[nodeId]) {
      modified[nodeId].inputs.filename_prefix = `ComfyStudio-${suffix}`
    }
  }

  return modified
}

/**
 * Workflow modifier for Image Edit (Qwen 2509)
 * Finds nodes by class_type / _meta.title so it works with exported API workflow.
 * Optional referenceImages: [filename1?, filename2?] – add LoadImage nodes and wire image2/image3 when present.
 */
export function modifyQwenImageEdit2509Workflow(workflow, options = {}) {
  const {
    prompt = 'edit the image',
    inputImage = '',
    seed = Math.floor(Math.random() * 1000000000000),
    referenceImages = [],
    filenamePrefix = '',
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))
  const ref1 = referenceImages[0]
  const ref2 = referenceImages[1]
  const hasDedicatedModelAndProductLoaders = Object.values(modified).some((node) => {
    if (!node || typeof node !== 'object') return false
    if (node.class_type !== 'LoadImage' || !node.inputs || !('image' in node.inputs)) return false
    const title = String(node?._meta?.title || '')
    return /load\s*model/i.test(title)
  }) && Object.values(modified).some((node) => {
    if (!node || typeof node !== 'object') return false
    if (node.class_type !== 'LoadImage' || !node.inputs || !('image' in node.inputs)) return false
    const title = String(node?._meta?.title || '')
    return /load\s*product/i.test(title)
  })

  for (const [nodeId, node] of Object.entries(modified)) {
    if (!node || typeof node !== 'object') continue
    const title = (node._meta && node._meta.title) ? String(node._meta.title) : ''
    const cls = node.class_type || ''

    // Main image handling:
    // - default workflows: set main LoadImage from inputImage
    // - model/product workflow: map dedicated loaders from model + product refs
    if (cls === 'LoadImage' && node.inputs && 'image' in node.inputs) {
      if (hasDedicatedModelAndProductLoaders) {
        if (/load\s*model/i.test(title)) {
          const modelImage = inputImage || ref2 || ref1
          if (modelImage) node.inputs.image = modelImage
        } else if (/load\s*product/i.test(title)) {
          const productImage = ref1 || ref2 || inputImage
          if (productImage) node.inputs.image = productImage
        } else if (inputImage) {
          node.inputs.image = inputImage
        }
      } else {
        node.inputs.image = inputImage
      }
    }
    // Text prompt: node with string/prompt/text or value (only if node looks like a prompt node)
    if (node.inputs) {
      const key = ['prompt', 'text', 'string'].find(k => k in node.inputs)
      const valueKey = (key === undefined && 'value' in node.inputs && (title.includes('Prompt') || cls.includes('Prompt'))) ? 'value' : null
      if (key) node.inputs[key] = prompt
      else if (valueKey) node.inputs[valueKey] = prompt
    }
    // Seed: apply to edit-specific nodes and sampler nodes.
    // The 2509 workflows use KSampler seed directly, so this must be updated per take.
    const isSeedTargetNode = (
      title.includes('Image Edit') ||
      title.includes('Qwen') ||
      cls.includes('Edit') ||
      cls === 'KSampler' ||
      title.includes('KSampler') ||
      cls.includes('Sampler')
    )
    if (node.inputs && 'seed' in node.inputs && isSeedTargetNode) {
      node.inputs.seed = seed
    }
    // Save Image: set prefix
    if (cls === 'SaveImage' && node.inputs && 'filename_prefix' in node.inputs) {
      node.inputs.filename_prefix = filenamePrefix || node.inputs.filename_prefix || 'image/ComfyStudio_edit'
    }
  }

  // Optional reference images: default qwen-edit workflows wire refs into image2/image3.
  // Dedicated model/product workflows already consume refs via their own loader nodes.
  if (!hasDedicatedModelAndProductLoaders) {
    if (ref1) {
      modified['ref_img_1'] = {
        class_type: 'LoadImage',
        inputs: { image: ref1 },
        _meta: { title: 'Load Image (ref 1)' },
      }
    }
    if (ref2) {
      modified['ref_img_2'] = {
        class_type: 'LoadImage',
        inputs: { image: ref2 },
        _meta: { title: 'Load Image (ref 2)' },
      }
    }
    // Wire refs into node that accepts them (e.g. TextEncodeQwenImageEditPlus).
    // Export often omits image2/image3 when unconnected, so set them if we have refs.
    for (const node of Object.values(modified)) {
      if (!node?.inputs) continue
      const hasImage1 = 'image1' in node.inputs
      const isQwenEdit = (node.class_type === 'TextEncodeQwenImageEditPlus') || ((node._meta?.title || '').includes('Image Edit') && hasImage1)
      if (!isQwenEdit) continue
      if (ref1) node.inputs.image2 = ['ref_img_1', 0]
      if (ref2) node.inputs.image3 = ['ref_img_2', 0]
    }
  }

  return modified
}

/**
 * Workflow modifier for Z Image Turbo (text-to-image).
 * Sets prompt on CLIPTextEncode and seed on KSampler.
 */
export function modifyZImageTurboWorkflow(workflow, options = {}) {
  const {
    prompt = '',
    seed = Math.floor(Math.random() * 1000000000000),
    filenamePrefix = '',
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))

  for (const [nodeId, node] of Object.entries(modified)) {
    if (!node?.inputs) continue
    if (node.class_type === 'CLIPTextEncode' && (node._meta?.title || '').includes('Prompt')) {
      node.inputs.text = prompt
    }
    if (node.class_type === 'KSampler' && 'seed' in node.inputs) {
      node.inputs.seed = seed
    }
    if (node.class_type === 'SaveImage' && 'filename_prefix' in node.inputs) {
      node.inputs.filename_prefix = filenamePrefix || node.inputs.filename_prefix || 'image/z_image_turbo'
    }
  }

  return modified
}

/**
 * Workflow modifier for Nano Banana 2.
 * Supports both GeminiNanoBanana2 (new) and GeminiImage2Node (legacy) nodes.
 */
export function modifyNanoBanana2Workflow(workflow, options = {}) {
  const {
    prompt = '',
    seed = Math.floor(Math.random() * 1000000000000),
    model = 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    aspectRatio = 'auto',
    resolution = '2K',
    filenamePrefix = 'image/nano_banana_2',
    systemPrompt = null,
    thinkingLevel = 'MINIMAL',
    referenceImages = [],
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))
  const validReferences = (Array.isArray(referenceImages) ? referenceImages : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .slice(0, 2)

  let geminiNode = null

  const getUniqueNodeId = (baseId) => {
    let nextId = baseId
    let suffix = 1
    while (modified[nextId]) {
      nextId = `${baseId}_${suffix}`
      suffix += 1
    }
    return nextId
  }

  for (const node of Object.values(modified)) {
    if (!node?.inputs) continue

    const isNanoBananaNode = (
      node.class_type === 'GeminiNanoBanana2' ||
      node.class_type === 'GeminiImage2Node'
    )
    if (isNanoBananaNode) {
      geminiNode = node
      if ('prompt' in node.inputs) node.inputs.prompt = prompt
      if ('model' in node.inputs) node.inputs.model = model
      if ('seed' in node.inputs) node.inputs.seed = seed
      if ('aspect_ratio' in node.inputs) node.inputs.aspect_ratio = aspectRatio
      if ('resolution' in node.inputs) node.inputs.resolution = resolution
      if ('response_modalities' in node.inputs) node.inputs.response_modalities = 'IMAGE'
      if ('thinking_level' in node.inputs) node.inputs.thinking_level = thinkingLevel
      if (systemPrompt && 'system_prompt' in node.inputs) {
        node.inputs.system_prompt = systemPrompt
      }
    }

    if (node.class_type === 'SaveImage' && 'filename_prefix' in node.inputs) {
      node.inputs.filename_prefix = filenamePrefix
    }
  }

  if (geminiNode && validReferences.length === 0) {
    // Remove placeholder image linkage from exported workflow when no refs were provided.
    if (Object.prototype.hasOwnProperty.call(geminiNode.inputs, 'images')) {
      delete geminiNode.inputs.images
    }
  }

  if (geminiNode && validReferences.length > 0) {
    const referenceNodeIds = validReferences.map((filename, index) => {
      const loadNodeId = getUniqueNodeId(`ref_img_${index + 1}`)
      modified[loadNodeId] = {
        class_type: 'LoadImage',
        inputs: { image: filename },
        _meta: { title: `Load Image (reference ${index + 1})` },
      }
      return loadNodeId
    })

    if (referenceNodeIds.length === 1) {
      geminiNode.inputs.images = [referenceNodeIds[0], 0]
    } else {
      const batchNodeId = getUniqueNodeId('ref_img_batch')
      modified[batchNodeId] = {
        class_type: 'ImageBatch',
        inputs: {
          image1: [referenceNodeIds[0], 0],
          image2: [referenceNodeIds[1], 0],
        },
        _meta: { title: 'Batch reference images' },
      }
      geminiNode.inputs.images = [batchNodeId, 0]
    }
  }

  return modified
}

// Backward-compatible alias for legacy callers.
export const modifyNanoBananaProWorkflow = modifyNanoBanana2Workflow

function resolveClosestAspectRatio(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return '16:9'

  const target = w / h
  const candidates = [
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:4', value: 3 / 4 },
  ]

  let best = candidates[0]
  let bestDelta = Math.abs(target - best.value)
  for (const candidate of candidates.slice(1)) {
    const delta = Math.abs(target - candidate.value)
    if (delta < bestDelta) {
      best = candidate
      bestDelta = delta
    }
  }

  return best.label
}

/**
 * Workflow modifier for Kling 3.0 Omni image-to-video.
 * Expects LoadImage + KlingOmniProImageToVideoNode + SaveVideo in the workflow JSON.
 */
export function modifyKlingO3I2VWorkflow(workflow, options = {}) {
  const {
    prompt = '',
    inputImage = '',
    width = 1280,
    height = 720,
    duration = 5,
    frames = null,
    fps = 24,
    seed = Math.floor(Math.random() * 1000000000000),
    generateAudio = false,
    modelName = 'kling-v3-omni',
    filenamePrefix = 'video/kling_o3_i2v',
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))
  const parsedDuration = Number(duration)
  const fallbackDuration = (
    Number.isFinite(Number(frames)) && Number(frames) > 1 && Number.isFinite(Number(fps)) && Number(fps) > 0
  )
    ? Number(frames) / Number(fps)
    : 5
  const safeDuration = Number.isFinite(parsedDuration) && parsedDuration > 0
    ? parsedDuration
    : Math.max(1, Math.round(fallbackDuration))
  const aspectRatio = resolveClosestAspectRatio(width, height)
  const resolution = Number(height) >= 1080 ? '1080p' : '720p'

  for (const node of Object.values(modified)) {
    if (!node?.inputs) continue

    if (node.class_type === 'LoadImage' && 'image' in node.inputs) {
      node.inputs.image = inputImage
    }

    if (node.class_type === 'KlingOmniProImageToVideoNode') {
      if ('model_name' in node.inputs) node.inputs.model_name = modelName
      if ('prompt' in node.inputs) node.inputs.prompt = prompt
      if ('aspect_ratio' in node.inputs) node.inputs.aspect_ratio = aspectRatio
      if ('duration' in node.inputs) node.inputs.duration = safeDuration
      if ('resolution' in node.inputs) node.inputs.resolution = resolution
      if ('generate_audio' in node.inputs) node.inputs.generate_audio = Boolean(generateAudio)
      if ('seed' in node.inputs) node.inputs.seed = seed
    }

    if (node.class_type === 'SaveVideo' && 'filename_prefix' in node.inputs) {
      node.inputs.filename_prefix = filenamePrefix
    }
  }

  return modified
}

/**
 * Workflow modifier for Music Generation (AceStep 1.5)
 */
export function modifyMusicWorkflow(workflow, options = {}) {
  const {
    tags = '',            // Style/genre description
    lyrics = '',          // Song lyrics (can be empty for instrumental)
    duration = 30,        // Duration in seconds
    bpm = 120,
    seed = Math.floor(Math.random() * 1000000),
    timesignature = '4',
    language = 'en',
    keyscale = 'C major',
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))

  // Text encoder (node 94 - TextEncodeAceStepAudio1.5)
  // ComfyUI now requires: generate_audio_codes, top_k, top_p, temperature, cfg_scale, min_p
  if (modified['94']) {
    modified['94'].inputs.generate_audio_codes = modified['94'].inputs.generate_audio_codes ?? true
    modified['94'].inputs.top_k = modified['94'].inputs.top_k ?? 0
    modified['94'].inputs.top_p = modified['94'].inputs.top_p ?? 0.9
    modified['94'].inputs.temperature = modified['94'].inputs.temperature ?? 1
    modified['94'].inputs.cfg_scale = modified['94'].inputs.cfg_scale ?? 1
    modified['94'].inputs.min_p = modified['94'].inputs.min_p ?? 0
    modified['94'].inputs.tags = tags
    modified['94'].inputs.lyrics = lyrics
    modified['94'].inputs.duration = duration
    modified['94'].inputs.bpm = bpm
    modified['94'].inputs.seed = seed
    modified['94'].inputs.timesignature = timesignature
    modified['94'].inputs.language = language
    modified['94'].inputs.keyscale = keyscale
  }
  // Latent audio duration (node 98)
  if (modified['98']) {
    modified['98'].inputs.seconds = duration
  }
  // KSampler seed (node 3)
  if (modified['3']) {
    modified['3'].inputs.seed = seed
  }
  // Output prefix (node 107)
  if (modified['107']) {
    modified['107'].inputs.filename_prefix = 'audio/ComfyStudio'
  }

  return modified
}

export default comfyui;
