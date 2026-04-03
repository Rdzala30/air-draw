// ============================================================
//  AIR DRAW — main.js v2 (Production Ready)
//  Hand gesture drawing app powered by MediaPipe Hands
//  Full features: 6 gestures, animations, mobile optimized
// ============================================================

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // DOM REFS
  // ──────────────────────────────────────────────
  const loadingScreen   = document.getElementById('loading-screen');
  const app             = document.getElementById('app');
  const onboardingModal = document.getElementById('onboarding-modal');
  const video           = document.getElementById('webcam');
  const cameraCanvas    = document.getElementById('camera-canvas');
  const drawingCanvas   = document.getElementById('drawing-canvas');
  const uiCanvas        = document.getElementById('ui-canvas');
  const gestureHud      = document.getElementById('gesture-hud');
  const gestureIcon     = document.getElementById('gesture-icon');
  const gestureLabel    = document.getElementById('gesture-label');
  const cursorDot       = document.getElementById('cursor-dot');
  const thicknessSlider = document.getElementById('thickness-slider');
  const thicknessValue  = document.getElementById('thickness-value');
  const glowSlider      = document.getElementById('glow-slider');
  const glowValue       = document.getElementById('glow-value');
  const fpsCounter      = document.getElementById('fps-counter');
  const btnUndo         = document.getElementById('btn-undo');
  const btnClear        = document.getElementById('btn-clear');
  const btnCameraToggle = document.getElementById('btn-camera-toggle');
  const btnSave         = document.getElementById('btn-save');
  const btnHelp         = document.getElementById('btn-help');
  const btnStart        = document.getElementById('btn-start');
  const colorSwatches   = document.querySelectorAll('.color-swatch');

  const camCtx  = cameraCanvas.getContext('2d');
  const drawCtx = drawingCanvas.getContext('2d');
  const uiCtx   = uiCanvas.getContext('2d');

  // ──────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────
  let currentColor   = '#00f0ff';
  let thickness      = 6;
  let glowAmount     = 24;          // maps from slider 0-100 → 0-40
  let showCamera     = true;
  let isRunning      = false;

  // Drawing state
  let lastX = null;
  let lastY = null;
  let currentStroke  = [];
  let allStrokes     = [];           // each: { color, thickness, glow, points[] }
  let pendingStroke  = null;

  // Gesture smoothing (8-frame buffer for stable detection)
  let gestureHistory = [];
  const GESTURE_FRAMES = 8;         // frames a gesture must hold to be accepted
  let activeGesture   = 'IDLE';

  // Dot-matrix message display
  let msgState = { text: '', alpha: 0, active: false, color: '#00f0ff' };

  // FPS tracking
  let fpsLastTime = performance.now();
  let fpsFrames   = 0;
  let fps         = 0;

  // Device detection
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // ──────────────────────────────────────────────
  // CANVAS RESIZE (responsive to viewport)
  // ──────────────────────────────────────────────
  function resizeCanvases () {
    const W = window.innerWidth;
    const H = window.innerHeight;
    [cameraCanvas, drawingCanvas, uiCanvas].forEach(c => {
      c.width  = W;
      c.height = H;
    });
    redrawAllStrokes();
  }

  window.addEventListener('resize', resizeCanvases, { passive: true });
  window.addEventListener('orientationchange', resizeCanvases, { passive: true });

  // ──────────────────────────────────────────────
  // COLOR & TOOLBAR EVENT LISTENERS
  // ──────────────────────────────────────────────
  colorSwatches.forEach(btn => {
    btn.addEventListener('click', () => {
      colorSwatches.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentColor = btn.dataset.color;
    });
  });

  thicknessSlider.addEventListener('input', () => {
    thickness = parseInt(thicknessSlider.value, 10);
    thicknessValue.textContent = thickness + 'px';
  }, { passive: true });

  glowSlider.addEventListener('input', () => {
    const pct = parseInt(glowSlider.value, 10);
    glowValue.textContent = pct + '%';
    glowAmount = Math.round((pct / 100) * 40);
  }, { passive: true });

  btnUndo.addEventListener('click', () => {
    allStrokes.pop();
    redrawAllStrokes();
  });

  btnClear.addEventListener('click', () => {
    allStrokes = [];
    currentStroke = [];
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  });

  btnCameraToggle.addEventListener('click', () => {
    showCamera = !showCamera;
    btnCameraToggle.classList.toggle('active', showCamera);
    if (!showCamera) {
      camCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    }
  });

  btnSave.addEventListener('click', saveDrawing);

  btnHelp.addEventListener('click', () => {
    onboardingModal.classList.remove('hidden');
  });

  btnStart.addEventListener('click', () => {
    onboardingModal.classList.add('hidden');
  });

  // Prevent scrolling/zoom on mobile
  document.addEventListener('touchmove', (e) => {
    if (e.target.tagName !== 'INPUT') {
      e.preventDefault();
    }
  }, { passive: false });

  // ──────────────────────────────────────────────
  // SAVE AS PNG
  // ──────────────────────────────────────────────
  function saveDrawing () {
    const merged = document.createElement('canvas');
    merged.width  = drawingCanvas.width;
    merged.height = drawingCanvas.height;
    const mCtx = merged.getContext('2d');

    if (showCamera) {
      mCtx.drawImage(cameraCanvas, 0, 0);
    } else {
      mCtx.fillStyle = '#07080f';
      mCtx.fillRect(0, 0, merged.width, merged.height);
    }
    mCtx.drawImage(drawingCanvas, 0, 0);

    const link     = document.createElement('a');
    link.download  = 'air-draw-' + Date.now() + '.png';
    link.href      = merged.toDataURL('image/png');
    link.click();
  }

  // ──────────────────────────────────────────────
  // DRAWING ENGINE
  // ──────────────────────────────────────────────
  function drawSegment (ctx, x1, y1, x2, y2, color, lw, glow) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur  = glow;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  }

  function redrawAllStrokes () {
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    for (const stroke of allStrokes) {
      const pts = stroke.points;
      if (pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        drawSegment(
          drawCtx,
          pts[i-1].x, pts[i-1].y,
          pts[i].x,   pts[i].y,
          stroke.color,
          stroke.thickness,
          stroke.glow
        );
      }
    }
  }

  function eraseAt (cx, cy, radius) {
    drawCtx.save();
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.beginPath();
    drawCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    drawCtx.fillStyle = 'rgba(0,0,0,1)';
    drawCtx.fill();
    drawCtx.restore();
  }

  // ──────────────────────────────────────────────
  // GESTURE DETECTION (6 gestures)
  // ──────────────────────────────────────────────
  /**
   * Returns whether a finger is "up" (tip above PIP joint in screen-y).
   * MediaPipe landmarks: y increases downward.
   */
  function isFingerUp (lm, tipIdx, pipIdx) {
    return lm[tipIdx].y < lm[pipIdx].y;
  }

  function getPinchDist (lm) {
    return Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  }

  function getHandOpenness (lm) {
    // Calculate how "open" the hand is by checking all fingers
    const indexUp  = isFingerUp(lm, 8,  6);
    const middleUp = isFingerUp(lm, 12, 10);
    const ringUp   = isFingerUp(lm, 16, 14);
    const pinkyUp  = isFingerUp(lm, 20, 18);
    return [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;
  }

  function rawGesture (lm) {
    const indexUp  = isFingerUp(lm, 8,  6);
    const middleUp = isFingerUp(lm, 12, 10);
    const ringUp   = isFingerUp(lm, 16, 14);
    const pinkyUp  = isFingerUp(lm, 20, 18);
    const allFingersUp = indexUp && middleUp && ringUp && pinkyUp;

    // Thumb up: tip clearly above its MCP joint (landmark 2)
    const thumbUp  = lm[4].y < lm[2].y - 0.02;

    const pinch    = getPinchDist(lm) < 0.06;

    // ── Priority order matters for stable detection ──
    // 1. THUMBS_UP: thumb raised, all other fingers folded
    if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) return 'THUMBS_UP';
    
    // 2. WAVE: full open palm (all 4 fingers up)  → shows "HELLO"
    if (allFingersUp && !thumbUp) return 'WAVE';
    
    // 3. ERASE: peace sign (index + middle up, ring + pinky folded)
    if (indexUp && middleUp && !ringUp && !pinkyUp) return 'ERASE';
    
    // 4. PINCH: pause gesture
    if (pinch) return 'PINCH';
    
    // 5. DRAW: only index finger up
    if (indexUp && !middleUp) return 'DRAW';
    
    return 'IDLE';
  }

  /** Smooth gesture over N frames to avoid flicker using majority vote */
  function smoothGesture (raw) {
    gestureHistory.push(raw);
    if (gestureHistory.length > GESTURE_FRAMES) gestureHistory.shift();

    // Majority vote (need at least 2 consecutive frames)
    const counts = {};
    for (const g of gestureHistory) counts[g] = (counts[g] || 0) + 1;
    let best = raw, bestCount = 0;
    for (const [g, c] of Object.entries(counts)) {
      if (c > bestCount) { best = g; bestCount = c; }
    }
    return best;
  }

  // ──────────────────────────────────────────────
  // HUD UPDATE
  // ──────────────────────────────────────────────
  const GESTURE_META = {
    DRAW:      { icon: '☝️',  label: 'Drawing',   cls: 'drawing' },
    ERASE:     { icon: '✌️',  label: 'Erasing',   cls: 'erasing' },
    WAVE:      { icon: '🖐️',  label: 'Hello!',    cls: 'waving'  },
    THUMBS_UP: { icon: '👍',  label: 'Well Done!', cls: 'thumbsup'},
    PINCH:     { icon: '🤏',  label: 'Paused',    cls: ''        },
    IDLE:      { icon: '✊',  label: 'Ready',     cls: ''        },
  };

  function updateHUD (gesture) {
    const meta = GESTURE_META[gesture] || GESTURE_META.IDLE;
    gestureIcon.textContent  = meta.icon;
    gestureLabel.textContent = meta.label;
    
    // Update HUD styling based on gesture
    gestureHud.className = '';
    if (meta.cls) {
      gestureHud.classList.add(meta.cls);
    }
  }

  // ──────────────────────────────────────────────
  // UI CANVAS — full hand skeleton overlay
  // ──────────────────────────────────────────────

  // MediaPipe hand bone connections (pairs of landmark indices)
  const HAND_CONNECTIONS = [
    // Thumb
    [0,1],[1,2],[2,3],[3,4],
    // Index
    [0,5],[5,6],[6,7],[7,8],
    // Middle
    [0,9],[9,10],[10,11],[11,12],
    // Ring
    [0,13],[13,14],[14,15],[15,16],
    // Pinky
    [0,17],[17,18],[18,19],[19,20],
    // Palm cross links
    [5,9],[9,13],[13,17],
  ];

  // Dot color per finger group
  const LANDMARK_COLORS = {
    0:  '#ffffff',  // wrist
    // Thumb (Gold)
    1:'#ffd700', 2:'#ffd700', 3:'#ffd700', 4:'#ffd700',
    // Index (Cyan)
    5:'#00f0ff', 6:'#00f0ff', 7:'#00f0ff', 8:'#00f0ff',
    // Middle (Lime)
    9:'#39ff14', 10:'#39ff14', 11:'#39ff14', 12:'#39ff14',
    // Ring (Magenta)
    13:'#ff00e5', 14:'#ff00e5', 15:'#ff00e5', 16:'#ff00e5',
    // Pinky (Pink)
    17:'#ff2d6b', 18:'#ff2d6b', 19:'#ff2d6b', 20:'#ff2d6b',
  };

  /**
   * Convert a normalised MediaPipe landmark to canvas pixels (non-mirrored).
   */
  function lmToCanvas (lm) {
    return {
      x: lm.x * uiCanvas.width,
      y: lm.y * uiCanvas.height,
    };
  }

  /**
   * Draw full hand skeleton: bones + glowing dots on every joint.
   * @param {Array}  landmarks  - 21 MediaPipe normalised landmarks
   * @param {string} gesture    - current gesture string
   */
  function drawHandOverlay (landmarks, gesture) {
    uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);

    const accentColor = gesture === 'DRAW'  ? currentColor
                      : gesture === 'ERASE' ? '#ff2d6b'
                      : gesture === 'WAVE'  ? '#00f0ff'
                      : gesture === 'THUMBS_UP' ? '#ffd700'
                      : 'rgba(255,255,255,0.35)';

    // ── 1. Draw bones (lines between joints) ──
    for (const [a, b] of HAND_CONNECTIONS) {
      const pA = lmToCanvas(landmarks[a]);
      const pB = lmToCanvas(landmarks[b]);

      uiCtx.beginPath();
      uiCtx.moveTo(pA.x, pA.y);
      uiCtx.lineTo(pB.x, pB.y);
      uiCtx.strokeStyle = 'rgba(255,255,255,0.18)';
      uiCtx.lineWidth   = 1.5;
      uiCtx.shadowColor = accentColor;
      uiCtx.shadowBlur  = 6;
      uiCtx.stroke();
      uiCtx.shadowBlur  = 0;
    }

    // ── 2. Draw a dot on every landmark ──
    for (let i = 0; i < landmarks.length; i++) {
      const p     = lmToCanvas(landmarks[i]);
      const color = LANDMARK_COLORS[i] || '#ffffff';

      // outer glow ring
      uiCtx.beginPath();
      uiCtx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      uiCtx.fillStyle   = 'rgba(0,0,0,0)';
      uiCtx.shadowColor = color;
      uiCtx.shadowBlur  = 18;
      uiCtx.fill();
      uiCtx.shadowBlur  = 0;

      // filled dot
      uiCtx.beginPath();
      uiCtx.arc(p.x, p.y, i === 0 ? 6 : 4.5, 0, Math.PI * 2);
      uiCtx.fillStyle   = color;
      uiCtx.shadowColor = color;
      uiCtx.shadowBlur  = 14;
      uiCtx.fill();
      uiCtx.shadowBlur  = 0;

      // white core
      uiCtx.beginPath();
      uiCtx.arc(p.x, p.y, i === 0 ? 3 : 2, 0, Math.PI * 2);
      uiCtx.fillStyle = 'rgba(255,255,255,0.9)';
      uiCtx.fill();
    }

    // ── 3. Extra cursor ring on index fingertip (landmark 8) ──
    const tip = lmToCanvas(landmarks[8]);
    const r   = gesture === 'ERASE' ? 44 : (thickness / 2 + 10);

    uiCtx.beginPath();
    uiCtx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
    uiCtx.strokeStyle = accentColor;
    uiCtx.lineWidth   = 2;
    uiCtx.shadowColor = accentColor;
    uiCtx.shadowBlur  = 14;
    uiCtx.stroke();
    uiCtx.shadowBlur  = 0;
  }

  // ──────────────────────────────────────────────
  // DOT-MATRIX TEXT RENDERER (5×7 bitmap font)
  // ──────────────────────────────────────────────

  /**
   * 5×7 pixel bitmap font.
   * Each character = array of 7 rows, each row = 5-bit number.
   * Bit 4 = leftmost pixel, bit 0 = rightmost pixel.
   */
  const DOT_FONT = {
    'H': [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
    'E': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
    'L': [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
    'O': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
    'W': [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
    'D': [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
    'N': [0b10001, 0b11001, 0b11001, 0b10101, 0b10011, 0b10011, 0b10001],
    'I': [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
    'C': [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
    'Y': [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
    'A': [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
    'K': [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
    'S': [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
    'T': [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
    'U': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
    'P': [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
    'R': [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
    'G': [0b01111, 0b10000, 0b10000, 0b10011, 0b10001, 0b10001, 0b01111],
    'B': [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
    'F': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
    'M': [0b10001, 0b11011, 0b10101, 0b10001, 0b10001, 0b10001, 0b10001],
    'V': [0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100],
    'X': [0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b01010, 0b10001],
    'Z': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
    ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
  };

  const DOT_SIZE   = 7;   // px — filled circle radius
  const DOT_STEP   = 11;  // px — grid cell size (dot + gap)
  const CHAR_SPACE = 6;   // px — extra gap between characters

  /**
   * Render dot-matrix text on ui-canvas above a given anchor point.
   * @param {string} text    - uppercase string to render
   * @param {number} anchorX - center x in canvas pixels
   * @param {number} anchorY - bottom y in canvas pixels (text drawn upward from here)
   * @param {string} color   - CSS color string
   * @param {number} alpha   - 0..1 opacity
   */
  function drawDotText (text, anchorX, anchorY, color, alpha) {
    if (alpha <= 0) return;

    const chars = text.toUpperCase().split('');
    const charW = 5 * DOT_STEP + CHAR_SPACE;   // width of one character cell
    const totalW = chars.length * charW - CHAR_SPACE;
    const totalH = 7 * DOT_STEP;

    // Top-left corner so text is centered on anchorX, bottom at anchorY
    const startX = anchorX - totalW / 2;
    const startY = anchorY - totalH;

    uiCtx.save();
    uiCtx.globalAlpha = alpha;

    chars.forEach((ch, ci) => {
      const bitmap = DOT_FONT[ch] || DOT_FONT[' '];
      const cx = startX + ci * charW;

      bitmap.forEach((row, ri) => {
        for (let col = 0; col < 5; col++) {
          // Check bit (leftmost bit = col 0)
          const bit = (row >> (4 - col)) & 1;
          const px = cx + col * DOT_STEP + DOT_STEP / 2;
          const py = startY + ri * DOT_STEP + DOT_STEP / 2;

          if (bit) {
            // Lit dot — glowing filled circle
            uiCtx.beginPath();
            uiCtx.arc(px, py, DOT_SIZE / 2, 0, Math.PI * 2);
            uiCtx.fillStyle   = color;
            uiCtx.shadowColor = color;
            uiCtx.shadowBlur  = 10;
            uiCtx.fill();
            // Bright white core
            uiCtx.beginPath();
            uiCtx.arc(px, py, DOT_SIZE / 4, 0, Math.PI * 2);
            uiCtx.fillStyle = 'rgba(255,255,255,0.85)';
            uiCtx.shadowBlur = 0;
            uiCtx.fill();
          } else {
            // Unlit dot — dim ghost circle
            uiCtx.beginPath();
            uiCtx.arc(px, py, DOT_SIZE / 2, 0, Math.PI * 2);
            uiCtx.fillStyle = 'rgba(255,255,255,0.06)';
            uiCtx.shadowBlur = 0;
            uiCtx.fill();
          }
        }
      });
    });

    uiCtx.shadowBlur  = 0;
    uiCtx.globalAlpha = 1;
    uiCtx.restore();
  }

  // ──────────────────────────────────────────────
  // MEDIAPIPE RESULTS CALLBACK
  // ──────────────────────────────────────────────
  function onHandResults (results) {
    // FPS tracking
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLastTime >= 1000) {
      fps = fpsFrames;
      fpsFrames = 0;
      fpsLastTime = now;
      fpsCounter.textContent = fps + ' fps';
    }

    // Camera feed (non-mirrored)
    if (showCamera) {
      camCtx.save();
      camCtx.scale(-1, 1);
      camCtx.drawImage(results.image, -cameraCanvas.width, 0, cameraCanvas.width, cameraCanvas.height);
      camCtx.restore();
    } else {
      camCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    }

    // No hand detected
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
      updateHUD('IDLE');
      if (currentStroke.length > 1) {
        allStrokes.push({ color: currentColor, thickness, glow: glowAmount, points: [...currentStroke] });
        currentStroke = [];
      }
      lastX = null;
      lastY = null;
      return;
    }

    const lm = results.multiHandLandmarks[0];

    // Convert landmark [0..1] → canvas pixels (non-mirrored)
    const tipLm = lm[8];
    const cx = tipLm.x * drawingCanvas.width;
    const cy = tipLm.y * drawingCanvas.height;

    const raw     = rawGesture(lm);
    const gesture = smoothGesture(raw);
    activeGesture = gesture;

    updateHUD(gesture);
    drawHandOverlay(lm, gesture);

    // ── Dot-matrix message logic ──
    if (gesture === 'WAVE') {
      msgState.text   = 'HELLO';
      msgState.color  = '#00f0ff';
      msgState.active = true;
    } else if (gesture === 'THUMBS_UP') {
      msgState.text   = 'WELL DONE';
      msgState.color  = '#ffd700';
      msgState.active = true;
    } else {
      msgState.active = false;
    }

    // Fade in / fade out smoothly
    if (msgState.active) {
      msgState.alpha = Math.min(1, (msgState.alpha || 0) + 0.1);
    } else {
      msgState.alpha = Math.max(0, (msgState.alpha || 0) - 0.06);
    }

    // Draw dot-matrix text above the wrist (landmark 0)
    if (msgState.alpha > 0) {
      const wrist   = lmToCanvas(lm[0]);
      const anchorX = wrist.x;
      const anchorY = wrist.y - 60;   // 60px above wrist → appears above hand
      drawDotText(msgState.text, anchorX, anchorY, msgState.color, msgState.alpha);
    }

    // ── Drawing logic ──
    if (gesture === 'DRAW') {
      if (lastX !== null) {
        drawSegment(drawCtx, lastX, lastY, cx, cy, currentColor, thickness, glowAmount);
        currentStroke.push({ x: cx, y: cy });
      } else {
        currentStroke = [{ x: cx, y: cy }];
      }
      lastX = cx;
      lastY = cy;

    } else if (gesture === 'ERASE') {
      // Erasing uses palm center (landmark 9)
      const palLm = lm[9];
      const px = palLm.x * drawingCanvas.width;
      const py = palLm.y * drawingCanvas.height;
      eraseAt(px, py, 40);
      // Commit current stroke if any
      if (currentStroke.length > 1) {
        allStrokes.push({ color: currentColor, thickness, glow: glowAmount, points: [...currentStroke] });
      }
      currentStroke = [];
      lastX = null;
      lastY = null;

    } else {
      // IDLE, PINCH, WAVE, THUMBS_UP — commit stroke if drawing
      if (currentStroke.length > 1) {
        allStrokes.push({ color: currentColor, thickness, glow: glowAmount, points: [...currentStroke] });
      }
      currentStroke = [];
      lastX = null;
      lastY = null;
    }
  }

  // ──────────────────────────────────────────────
  // MEDIAPIPE SETUP (selfieMode: true for mirroring)
  // ──────────────────────────────────────────────
  function initMediaPipe () {
    const hands = new Hands({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands:           1,
      modelComplexity:       isMobile ? 0 : 1,    // Lower complexity for mobile
      minDetectionConfidence: 0.72,
      minTrackingConfidence:  0.65,
      selfieMode:            false,               // Non-mirrored camera feed
    });

    hands.onResults(onHandResults);

    const camera = new Camera(video, {
      onFrame: async () => {
        if (isRunning) await hands.send({ image: video });
      },
      width:  isMobile ? 640 : 1280,  // Lower resolution for mobile
      height: isMobile ? 480 : 720,
    });

    camera.start()
      .then(() => {
        console.log('[AirDraw] Camera started ✓');
        isRunning = true;
      })
      .catch(err => {
        console.error('[AirDraw] Camera error:', err);
        gestureLabel.textContent = 'No Camera';
      });
  }

  // ──────────────────────────────────────────────
  // APP BOOT
  // ──────────────────────────────────────────────
  function boot () {
    resizeCanvases();

    // Hide loader after 2.8s (matches animation), show onboarding
    setTimeout(() => {
      loadingScreen.classList.add('hidden');
      app.classList.remove('hidden');
      onboardingModal.classList.remove('hidden');
    }, 2800);

    // Start tracking immediately in background
    setTimeout(() => {
      initMediaPipe();
    }, 500);
  }

  // Wait for DOM fonts + scripts
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();