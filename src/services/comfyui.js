/**
 * ComfyUI API Service
 * Handles communication with the ComfyUI backend
 * 
 * In development, requests are proxied through Vite to avoid CORS issues.
 * In production (Electron), requests go directly to ComfyUI.
 */

// Use relative URLs in dev (proxied by Vite), direct URLs in production
const isDev = import.meta.env.DEV;
const COMFYUI_HTTP = isDev ? '' : 'http://127.0.0.1:8188';
// WebSocket must connect directly to ComfyUI (Vite proxy doesn't support WS well)
const COMFYUI_WS = 'ws://127.0.0.1:8188';

class ComfyUIService {
  constructor() {
    this.ws = null;
    this.clientId = this.generateClientId();
    this.listeners = new Map();
    this.wsFailCount = 0;
    this.lastWsAttempt = 0;
    this.wsBackoffMs = 5000; // Minimum time between reconnection attempts
  }

  generateClientId() {
    return 'storyflow-' + Math.random().toString(36).substring(2, 15);
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
      const wsUrl = `${COMFYUI_WS}/ws?clientId=${this.clientId}`;
      
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
    try {
      const response = await fetch(`${COMFYUI_HTTP}/system_stats`);
      return response.ok;
    } catch (error) {
      console.log('ComfyUI connection check failed:', error.message);
      return false;
    }
  }

  /**
   * Queue a prompt for execution
   */
  async queuePrompt(workflow) {
    try {
      const response = await fetch(`${COMFYUI_HTTP}/prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: this.clientId
        }),
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
   * Get history/output for a prompt (or full history if no promptId)
   */
  async getHistory(promptId) {
    try {
      const url = promptId
        ? `${COMFYUI_HTTP}/history/${promptId}`
        : `${COMFYUI_HTTP}/history`;
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
    return `${COMFYUI_HTTP}/view?${params}`;
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
      await fetch(`${COMFYUI_HTTP}/interrupt`, { method: 'POST' });
    } catch (error) {
      console.error('Error interrupting:', error);
    }
  }

  /**
   * Get queue status
   */
  async getQueueStatus() {
    try {
      const response = await fetch(`${COMFYUI_HTTP}/queue`);
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

      const response = await fetch(`${COMFYUI_HTTP}/upload/image`, {
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
 * Workflow modifier for LTX-2 Text-to-Video
 */
export function modifyLTX2Workflow(workflow, options = {}) {
  const {
    prompt = '',
    negativePrompt = 'blurry, low quality, still frame, frames, watermark, overlay, titles, has blurbox, has subtitles',
    width = 1280,
    height = 720,
    frames = 121,
    seed = Math.floor(Math.random() * 1000000),
    fps = 24
  } = options;

  // Create a deep copy
  const modified = JSON.parse(JSON.stringify(workflow));

  // Update positive prompt (node 92:3)
  if (modified['92:3']) {
    modified['92:3'].inputs.text = prompt;
  }

  // Update negative prompt (node 92:4)
  if (modified['92:4']) {
    modified['92:4'].inputs.text = negativePrompt;
  }

  // Update resolution (node 92:89)
  if (modified['92:89']) {
    modified['92:89'].inputs.width = width;
    modified['92:89'].inputs.height = height;
  }

  // Update frame count (node 92:62)
  if (modified['92:62']) {
    modified['92:62'].inputs.value = frames;
  }

  // Update seed (node 92:11)
  if (modified['92:11']) {
    modified['92:11'].inputs.noise_seed = seed;
  }

  // Update FPS (nodes 92:102 and 92:99)
  if (modified['92:102']) {
    modified['92:102'].inputs.value = fps;
  }
  if (modified['92:99']) {
    modified['92:99'].inputs.value = fps;
  }

  return modified;
}

/**
 * Workflow modifier for LTX-2 Image-to-Video.
 * Accepts same options as other i2v workflows. Node IDs may need to match your
 * ltx2_Image_to_Video.json workflow (inspect the JSON and update below if needed).
 */
export function modifyLTX2I2VWorkflow(workflow, options = {}) {
  const {
    prompt = '',
    negativePrompt = 'blurry, low quality, still frame, watermark',
    inputImage = '',
    width = 1280,
    height = 720,
    frames = 121,
    fps = 24,
    seed = Math.floor(Math.random() * 1000000),
  } = options;

  const modified = JSON.parse(JSON.stringify(workflow));

  // Patch any node that has these input names (works across different workflow layouts)
  for (const nodeId of Object.keys(modified)) {
    const node = modified[nodeId]
    if (!node?.inputs) continue
    const inputs = node.inputs
    if (typeof inputs.image === 'string') inputs.image = inputImage
    if (typeof inputs.width === 'number') inputs.width = width
    if (typeof inputs.height === 'number') inputs.height = height
    if (typeof inputs.noise_seed === 'number') inputs.noise_seed = seed
    if (typeof inputs.fps === 'number') inputs.fps = fps
    if (typeof inputs.value === 'number' && inputs.value > 50 && inputs.value < 500) inputs.value = frames
    if (typeof inputs.length === 'number') inputs.length = frames
  }

  // Positive and negative prompt: first text node = prompt, second = negative
  let textCount = 0
  for (const nodeId of Object.keys(modified)) {
    const node = modified[nodeId]
    if (!node?.inputs || typeof node.inputs.text !== 'string') continue
    textCount++
    if (textCount === 1) node.inputs.text = prompt
    else if (textCount === 2) {
      node.inputs.text = negativePrompt
      break
    }
  }

  return modified;
}

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
    outputPrefix = 'StoryFlowMask',  // Output filename prefix
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
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))

  // Positive prompt (node 93)
  if (modified['93']) {
    modified['93'].inputs.text = prompt
  }
  // Negative prompt (node 89)
  if (modified['89']) {
    modified['89'].inputs.text = negativePrompt
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
  }
  // Output prefix (node 108)
  if (modified['108']) {
    modified['108'].inputs.filename_prefix = 'video/StoryFlow_wan'
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

  // Update save prefixes to StoryFlow
  const saveNodes = { '31': 'close_up', '34': 'wide_shot', '36': '45_right', '38': '90_right', '47': '90_left', '41': 'aerial_view', '43': 'low_angle', '45': '45_left' }
  for (const [nodeId, suffix] of Object.entries(saveNodes)) {
    if (modified[nodeId]) {
      modified[nodeId].inputs.filename_prefix = `StoryFlow-${suffix}`
    }
  }

  return modified
}

/**
 * Workflow modifier for Inflation / Image Edit (Qwen 2511)
 */
export function modifyInflationWorkflow(workflow, options = {}) {
  const {
    prompt = 'inflate the subject',
    inputImage = '',      // Filename uploaded to ComfyUI
    seed = Math.floor(Math.random() * 1000000000000),
    steps = 40,
    cfg = 4,
  } = options

  const modified = JSON.parse(JSON.stringify(workflow))

  // Image input (node 41)
  if (modified['41']) {
    modified['41'].inputs.image = inputImage
  }
  // Positive prompt (node 89:68)
  if (modified['89:68']) {
    modified['89:68'].inputs.prompt = prompt
  }
  // KSampler settings (node 89:65)
  if (modified['89:65']) {
    modified['89:65'].inputs.seed = seed
    modified['89:65'].inputs.steps = steps
    modified['89:65'].inputs.cfg = cfg
  }
  // Output prefix (node 9)
  if (modified['9']) {
    modified['9'].inputs.filename_prefix = 'StoryFlow_edit'
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
  if (modified['94']) {
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
    modified['107'].inputs.filename_prefix = 'audio/StoryFlow'
  }

  return modified
}

export default comfyui;
