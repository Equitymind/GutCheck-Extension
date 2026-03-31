// Reactr Authentic — Content Script
// Dual-signal analysis: viewer biometrics + subject frame analysis

(function () {
  'use strict';

  const BADGE_ATTR = 'data-gutcheck-badge';
  let activeAnalysis = null;

  // ========== VIDEO DETECTION & BADGE INJECTION ==========

  function createBadge(video) {
    const badge = document.createElement('button');
    badge.className = 'gutcheck-badge';
    badge.textContent = '🔍 Analyze';
    badge.setAttribute('title', 'Reactr Authentic — Analyze video authenticity');
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startAnalysis(video, badge);
    });
    return badge;
  }

  function wrapVideo(video) {
    if (video.getAttribute(BADGE_ATTR)) return;
    if (video.clientWidth < 120 || video.clientHeight < 80) return;

    video.setAttribute(BADGE_ATTR, 'true');

    let container = video.parentElement;
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const badge = createBadge(video);
    container.appendChild(badge);
    video._reactrBadge = badge;
    video._reactrContainer = container;
  }

  function scanForVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(wrapVideo);
  }

  // ========== CONSENT DIALOG ==========

  function showConsentDialog(viewerEnabled, subjectEnabled) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'reactr-consent-backdrop';

      let description = '';
      if (viewerEnabled && subjectEnabled) {
        description = 'Reactr Authentic will use your front-facing camera to capture facial micro-expressions (viewer analysis) and analyze the video frames for subject authenticity signals. Camera feed is processed locally — no data is stored or transmitted.';
      } else if (viewerEnabled) {
        description = 'Reactr Authentic needs your front-facing camera to capture facial micro-expressions while you watch this video. Your camera feed is processed locally — no video data is stored or transmitted.';
      } else {
        description = 'Reactr Authentic will analyze the video frames for subject authenticity signals. All processing is local — no data is stored or transmitted.';
      }

      const card = document.createElement('div');
      card.className = 'reactr-consent-card';
      card.innerHTML = `
        <h3>${viewerEnabled ? 'Camera Access Required' : 'Start Analysis'}</h3>
        <p>${description}</p>
        <div class="reactr-consent-buttons">
          <button class="reactr-btn-allow">${viewerEnabled ? 'Allow Camera' : 'Start'}</button>
          <button class="reactr-btn-deny">Cancel</button>
        </div>
      `;

      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      card.querySelector('.reactr-btn-allow').addEventListener('click', () => {
        backdrop.remove();
        resolve(true);
      });
      card.querySelector('.reactr-btn-deny').addEventListener('click', () => {
        backdrop.remove();
        resolve(false);
      });
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) { backdrop.remove(); resolve(false); }
      });
    });
  }

  // ========== CAMERA PREVIEW ==========

  function createCameraPreview(stream) {
    const preview = document.createElement('div');
    preview.className = 'reactr-camera-preview';

    const vid = document.createElement('video');
    vid.srcObject = stream;
    vid.autoplay = true;
    vid.muted = true;
    vid.playsInline = true;

    const recDot = document.createElement('div');
    recDot.className = 'reactr-rec-dot';

    const label = document.createElement('div');
    label.className = 'reactr-camera-label';
    label.textContent = 'Analyzing response...';

    preview.appendChild(vid);
    preview.appendChild(recDot);
    preview.appendChild(label);
    document.body.appendChild(preview);

    return { preview, videoEl: vid };
  }

  // ========== PROGRESS BAR ==========

  function createProgressBar() {
    const bar = document.createElement('div');
    bar.className = 'reactr-progress-bar';
    bar.style.width = '0%';
    document.body.appendChild(bar);
    return bar;
  }

  // ========== FACE-API LOADING ==========

  let faceApiLoaded = false;
  let faceApiLoading = false;

  function loadFaceApi() {
    return new Promise((resolve, reject) => {
      if (faceApiLoaded) return resolve();
      if (faceApiLoading) {
        const check = setInterval(() => {
          if (faceApiLoaded) { clearInterval(check); resolve(); }
        }, 100);
        return;
      }
      faceApiLoading = true;

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/face-api.js@0.22.2/dist/face-api.min.js';
      script.onload = async () => {
        try {
          const MODEL_URL = 'https://unpkg.com/face-api.js@0.22.2/weights';
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL)
          ]);
          faceApiLoaded = true;
          faceApiLoading = false;
          resolve();
        } catch (err) {
          faceApiLoading = false;
          reject(err);
        }
      };
      script.onerror = () => {
        faceApiLoading = false;
        reject(new Error('Failed to load face-api.js'));
      };
      document.head.appendChild(script);
    });
  }

  // ========== UTILITY FUNCTIONS ==========

  function avg(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function computeVariance(arr) {
    if (arr.length === 0) return 0;
    const m = avg(arr);
    return avg(arr.map((v) => (v - m) ** 2));
  }

  function dominantEmotion(expr) {
    let max = -1, dominant = 'neutral';
    for (const [emotion, val] of Object.entries(expr)) {
      if (val > max) { max = val; dominant = emotion; }
    }
    return dominant;
  }

  function scoreColor(val) {
    if (val >= 65) return '#22c55e';
    if (val >= 40) return '#f59e0b';
    return '#ef4444';
  }

  // ========== VIEWER SCORING (existing logic, preserved) ==========

  function computeViewerScore(samples) {
    if (samples.length < 3) {
      return {
        score: 50,
        verdict: 'Insufficient Data',
        verdictColor: '#f59e0b',
        signals: [
          { text: 'Not enough viewer expression data captured', color: '#f59e0b' },
          { text: 'Try watching a longer portion of the video', color: '#f59e0b' },
          { text: 'Ensure good lighting on your face', color: '#f59e0b' }
        ]
      };
    }

    const emotions = samples.map((s) => s.expressions);

    const avgSurprise = avg(emotions.map((e) => e.surprised || 0));
    const avgHappy = avg(emotions.map((e) => e.happy || 0));
    const avgDisgust = avg(emotions.map((e) => e.disgusted || 0));
    const avgNeutral = avg(emotions.map((e) => e.neutral || 0));
    const avgFear = avg(emotions.map((e) => e.fearful || 0));
    const avgAngry = avg(emotions.map((e) => e.angry || 0));
    const avgSad = avg(emotions.map((e) => e.sad || 0));

    const mirrorScore = (avgSurprise + avgHappy) * 50;
    const uncannySignal = (avgDisgust * 0.6 + (avgNeutral > 0.7 ? 0.4 : 0)) * 40;

    const allEmotionValues = emotions.flatMap((e) => [
      e.surprised || 0, e.happy || 0, e.fearful || 0,
      e.disgusted || 0, e.angry || 0, e.sad || 0, e.neutral || 0
    ]);
    const variance = computeVariance(allEmotionValues);
    const varianceScore = Math.min(variance * 200, 30);

    let cascadeScore = 0;
    if (emotions.length >= 4) {
      let transitions = 0;
      for (let i = 1; i < emotions.length; i++) {
        const prev = dominantEmotion(emotions[i - 1]);
        const curr = dominantEmotion(emotions[i]);
        if (prev !== curr) transitions++;
      }
      const transitionRate = transitions / (emotions.length - 1);
      if (transitionRate >= 0.15 && transitionRate <= 0.65) {
        cascadeScore = 20;
      } else if (transitionRate < 0.15) {
        cascadeScore = 5;
      } else {
        cascadeScore = 10;
      }
    }

    const cognitiveLoad = (avgAngry + avgFear + avgSad) * 15;
    const cognitiveBonus = cognitiveLoad > 3 && cognitiveLoad < 12 ? 10 : 0;

    let rawScore = mirrorScore + varianceScore + cascadeScore + cognitiveBonus - uncannySignal;
    rawScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    let verdict, verdictColor;
    if (rawScore >= 65) { verdict = 'Likely Real'; verdictColor = '#22c55e'; }
    else if (rawScore >= 40) { verdict = 'Uncertain'; verdictColor = '#f59e0b'; }
    else { verdict = 'Likely AI-Generated'; verdictColor = '#ef4444'; }

    const signals = [
      { val: mirrorScore, text: `Mirror response: ${mirrorScore > 15 ? 'strong' : 'weak'} emotional contagion detected`, color: mirrorScore > 15 ? '#22c55e' : '#ef4444' },
      { val: uncannySignal, text: `Uncanny valley: ${uncannySignal > 10 ? 'micro-disgust patterns present' : 'no aversion signals'}`, color: uncannySignal > 10 ? '#ef4444' : '#22c55e' },
      { val: varianceScore, text: `Expression range: ${varianceScore > 10 ? 'dynamic' : 'flat'} emotional variance`, color: varianceScore > 10 ? '#22c55e' : '#ef4444' },
      { val: cascadeScore, text: `Temporal flow: ${cascadeScore >= 15 ? 'natural' : 'irregular'} emotion cascade`, color: cascadeScore >= 15 ? '#22c55e' : '#f59e0b' },
      { val: cognitiveBonus, text: `Cognitive load: ${cognitiveBonus > 0 ? 'moderate engagement' : 'low processing depth'}`, color: cognitiveBonus > 0 ? '#22c55e' : '#f59e0b' }
    ];

    signals.sort((a, b) => b.val - a.val);

    return { score: rawScore, verdict, verdictColor, signals };
  }

  // ========== SUBJECT SCORING (NEW — 5 signals) ==========

  function computeSubjectScore(samples) {
    if (samples.length < 5) {
      return {
        score: 50,
        verdict: 'Insufficient Data',
        verdictColor: '#f59e0b',
        signals: [
          { text: 'Not enough subject frames captured', color: '#f59e0b' },
          { text: 'Video may not contain a visible face', color: '#f59e0b' }
        ]
      };
    }

    // --- Signal 1: Blink Regularity ---
    // Track eye aspect ratio (EAR) from landmarks to detect blinks
    const earValues = [];
    for (const s of samples) {
      if (s.landmarks) {
        const ear = computeEAR(s.landmarks);
        earValues.push({ ear, time: s.videoTime });
      }
    }

    let blinkScore = 50; // default
    if (earValues.length >= 10) {
      // Detect blinks: EAR drops below threshold
      const earMean = avg(earValues.map((e) => e.ear));
      const blinkThreshold = earMean * 0.75;
      const blinks = [];
      let inBlink = false;
      for (const ev of earValues) {
        if (ev.ear < blinkThreshold && !inBlink) {
          blinks.push(ev.time);
          inBlink = true;
        } else if (ev.ear >= blinkThreshold) {
          inBlink = false;
        }
      }

      if (blinks.length >= 2) {
        // Calculate inter-blink intervals
        const intervals = [];
        for (let i = 1; i < blinks.length; i++) {
          intervals.push(blinks[i] - blinks[i - 1]);
        }
        const intervalVariance = computeVariance(intervals);
        const intervalMean = avg(intervals);
        const cv = intervalMean > 0 ? Math.sqrt(intervalVariance) / intervalMean : 0;

        // Natural blinking: CV of inter-blink intervals is typically 0.3-0.8
        // Too regular (CV < 0.15) = synthetic, too irregular/absent = also suspect
        if (cv >= 0.25 && cv <= 0.9) {
          blinkScore = 70 + Math.min(cv * 30, 30); // natural irregularity
        } else if (cv < 0.25) {
          blinkScore = 20 + cv * 80; // too regular = synthetic
        } else {
          blinkScore = 40; // very erratic
        }

        // Also check blink rate: 3-17 blinks/min normal
        const duration = earValues[earValues.length - 1].time - earValues[0].time;
        if (duration > 0) {
          const blinksPerMin = (blinks.length / duration) * 60;
          if (blinksPerMin < 2 || blinksPerMin > 25) {
            blinkScore = Math.max(10, blinkScore - 25);
          }
        }
      } else {
        // Very few or no blinks in the sample period — suspicious
        blinkScore = 20;
      }
    }
    blinkScore = Math.max(0, Math.min(100, Math.round(blinkScore)));

    // --- Signal 2: Expression Cascade Timing ---
    const emotions = samples.map((s) => ({ dom: dominantEmotion(s.expressions), time: s.videoTime }));
    let cascadeTimingScore = 50;
    if (emotions.length >= 6) {
      const transitionDurations = [];
      for (let i = 1; i < emotions.length; i++) {
        if (emotions[i].dom !== emotions[i - 1].dom) {
          transitionDurations.push(emotions[i].time - emotions[i - 1].time);
        }
      }
      if (transitionDurations.length >= 2) {
        const avgTransDur = avg(transitionDurations);
        // Natural transitions: 0.2-0.5s (200-500ms)
        // At 500ms sample interval, natural transitions = 0.5-1.0 intervals
        if (avgTransDur >= 0.3 && avgTransDur <= 1.5) {
          cascadeTimingScore = 75 + Math.min((1 - Math.abs(avgTransDur - 0.7)) * 35, 25);
        } else if (avgTransDur < 0.3) {
          cascadeTimingScore = 25; // abrupt jumps
        } else {
          cascadeTimingScore = 30; // held too long
        }
        // Variance in transition timing — natural = varied
        const transVar = computeVariance(transitionDurations);
        if (transVar > 0.05) cascadeTimingScore = Math.min(100, cascadeTimingScore + 10);
      } else {
        // Almost no transitions — suspicious stillness or monotone
        cascadeTimingScore = 30;
      }
    }
    cascadeTimingScore = Math.max(0, Math.min(100, Math.round(cascadeTimingScore)));

    // --- Signal 3: Facial Asymmetry ---
    let asymmetryScore = 50;
    if (samples.some((s) => s.landmarks)) {
      const asymmetries = [];
      for (const s of samples) {
        if (s.landmarks) {
          const asym = computeFacialAsymmetry(s.landmarks);
          asymmetries.push(asym);
        }
      }
      if (asymmetries.length >= 5) {
        const avgAsym = avg(asymmetries);
        // Natural faces: slight asymmetry (avgAsym 0.02-0.08)
        // AI faces: near-perfect symmetry (avgAsym < 0.01)
        if (avgAsym >= 0.015 && avgAsym <= 0.12) {
          asymmetryScore = 70 + Math.min(avgAsym * 300, 30);
        } else if (avgAsym < 0.015) {
          asymmetryScore = 15 + avgAsym * 2000; // too symmetric
        } else {
          asymmetryScore = 45; // extreme asymmetry (probably detection noise)
        }
      }
    }
    asymmetryScore = Math.max(0, Math.min(100, Math.round(asymmetryScore)));

    // --- Signal 4: Idle Motion ---
    // In neutral frames, real faces have micro-movements
    let idleMotionScore = 50;
    const neutralSamples = samples.filter((s) =>
      s.expressions && (s.expressions.neutral || 0) > 0.5 && s.landmarks
    );
    if (neutralSamples.length >= 4) {
      const positionDiffs = [];
      for (let i = 1; i < neutralSamples.length; i++) {
        const diff = landmarkDrift(neutralSamples[i - 1].landmarks, neutralSamples[i].landmarks);
        positionDiffs.push(diff);
      }
      const avgDrift = avg(positionDiffs);
      // Natural micro-movement: small but nonzero drift
      if (avgDrift > 0.5 && avgDrift < 8) {
        idleMotionScore = 70 + Math.min(avgDrift * 5, 30);
      } else if (avgDrift <= 0.5) {
        idleMotionScore = 15; // suspiciously still
      } else {
        idleMotionScore = 40; // too much motion (probably camera shake or different person)
      }
    }
    idleMotionScore = Math.max(0, Math.min(100, Math.round(idleMotionScore)));

    // --- Signal 5: Temporal Resonance (placeholder — combined score fills this in) ---
    // This signal is computed in the combined scoring function using both viewer+subject data.
    // For subject-only mode, use expression variety as proxy.
    let temporalResonanceScore = 50;
    const expressionDiversity = new Set(samples.map((s) => dominantEmotion(s.expressions))).size;
    if (expressionDiversity >= 3) {
      temporalResonanceScore = 65 + Math.min(expressionDiversity * 5, 20);
    } else if (expressionDiversity === 2) {
      temporalResonanceScore = 50;
    } else {
      temporalResonanceScore = 25; // monotone face = less likely to trigger viewer mirroring
    }
    temporalResonanceScore = Math.max(0, Math.min(100, Math.round(temporalResonanceScore)));

    // --- Weighted Average ---
    const weights = { blink: 0.20, cascade: 0.20, asymmetry: 0.25, idle: 0.20, resonance: 0.15 };
    const rawScore = Math.round(
      blinkScore * weights.blink +
      cascadeTimingScore * weights.cascade +
      asymmetryScore * weights.asymmetry +
      idleMotionScore * weights.idle +
      temporalResonanceScore * weights.resonance
    );
    const score = Math.max(0, Math.min(100, rawScore));

    let verdict, verdictColor;
    if (score >= 65) { verdict = 'Likely Real'; verdictColor = '#22c55e'; }
    else if (score >= 40) { verdict = 'Uncertain'; verdictColor = '#f59e0b'; }
    else { verdict = 'Likely AI-Generated'; verdictColor = '#ef4444'; }

    const signals = [
      { text: `Blink regularity: ${blinkScore >= 60 ? 'natural irregular pattern' : blinkScore >= 40 ? 'somewhat regular' : 'abnormal or absent'}`, color: scoreColor(blinkScore), val: blinkScore },
      { text: `Cascade timing: ${cascadeTimingScore >= 60 ? 'natural transitions' : cascadeTimingScore >= 40 ? 'borderline timing' : 'abrupt or held expressions'}`, color: scoreColor(cascadeTimingScore), val: cascadeTimingScore },
      { text: `Facial asymmetry: ${asymmetryScore >= 60 ? 'natural left/right difference' : asymmetryScore >= 40 ? 'borderline symmetry' : 'suspiciously symmetric'}`, color: scoreColor(asymmetryScore), val: asymmetryScore },
      { text: `Idle motion: ${idleMotionScore >= 60 ? 'micro-movements present' : idleMotionScore >= 40 ? 'limited movement' : 'overly static'}`, color: scoreColor(idleMotionScore), val: idleMotionScore },
      { text: `Temporal resonance: ${temporalResonanceScore >= 60 ? 'expressive range detected' : temporalResonanceScore >= 40 ? 'moderate range' : 'monotone expression'}`, color: scoreColor(temporalResonanceScore), val: temporalResonanceScore }
    ];

    return { score, verdict, verdictColor, signals, blinkScore, cascadeTimingScore, asymmetryScore, idleMotionScore, temporalResonanceScore };
  }

  // ========== LANDMARK HELPERS ==========

  function computeEAR(landmarks) {
    // Eye Aspect Ratio from 68-point landmarks
    // Left eye: points 36-41, Right eye: points 42-47
    const pts = landmarks.positions || landmarks._positions || [];
    if (pts.length < 48) return 0.3; // fallback

    function eyeAR(p1, p2, p3, p4, p5, p6) {
      const vertical1 = Math.sqrt((p2.x - p6.x) ** 2 + (p2.y - p6.y) ** 2);
      const vertical2 = Math.sqrt((p3.x - p5.x) ** 2 + (p3.y - p5.y) ** 2);
      const horizontal = Math.sqrt((p1.x - p4.x) ** 2 + (p1.y - p4.y) ** 2);
      return horizontal > 0 ? (vertical1 + vertical2) / (2 * horizontal) : 0.3;
    }

    const leftEAR = eyeAR(pts[36], pts[37], pts[38], pts[39], pts[40], pts[41]);
    const rightEAR = eyeAR(pts[42], pts[43], pts[44], pts[45], pts[46], pts[47]);
    return (leftEAR + rightEAR) / 2;
  }

  function computeFacialAsymmetry(landmarks) {
    const pts = landmarks.positions || landmarks._positions || [];
    if (pts.length < 68) return 0.03; // fallback

    // Compare left vs right corresponding landmark pairs
    // Nose bridge (27) as vertical axis reference
    const noseTip = pts[30];
    const pairs = [
      [pts[0], pts[16]],   // jaw extremes
      [pts[1], pts[15]],
      [pts[2], pts[14]],
      [pts[3], pts[13]],
      [pts[36], pts[45]],  // eye outer corners
      [pts[39], pts[42]],  // eye inner corners
      [pts[48], pts[54]],  // mouth corners
      [pts[31], pts[35]],  // nostril edges
    ];

    let totalAsym = 0;
    for (const [left, right] of pairs) {
      const distLeft = Math.sqrt((left.x - noseTip.x) ** 2 + (left.y - noseTip.y) ** 2);
      const distRight = Math.sqrt((right.x - noseTip.x) ** 2 + (right.y - noseTip.y) ** 2);
      const maxDist = Math.max(distLeft, distRight, 1);
      totalAsym += Math.abs(distLeft - distRight) / maxDist;
    }

    return totalAsym / pairs.length;
  }

  function landmarkDrift(landmarks1, landmarks2) {
    const pts1 = landmarks1.positions || landmarks1._positions || [];
    const pts2 = landmarks2.positions || landmarks2._positions || [];
    if (pts1.length < 68 || pts2.length < 68) return 2; // fallback

    // Average pixel drift across key landmarks
    const indices = [30, 36, 39, 42, 45, 48, 54, 27]; // nose, eyes, mouth, bridge
    let totalDrift = 0;
    for (const idx of indices) {
      totalDrift += Math.sqrt((pts1[idx].x - pts2[idx].x) ** 2 + (pts1[idx].y - pts2[idx].y) ** 2);
    }
    return totalDrift / indices.length;
  }

  // ========== TEMPORAL RESONANCE (cross-signal) ==========

  function computeTemporalResonance(viewerSamples, subjectSamples) {
    // Find subject emotion peaks and check if viewer mirrors 200-400ms later
    if (viewerSamples.length < 5 || subjectSamples.length < 5) return 50;

    // Build subject peak list: times when dominant emotion is NOT neutral
    const subjectPeaks = [];
    for (const s of subjectSamples) {
      const dom = dominantEmotion(s.expressions);
      if (dom !== 'neutral') {
        const strength = s.expressions[dom] || 0;
        if (strength > 0.4) {
          subjectPeaks.push({ time: s.videoTime, emotion: dom, strength });
        }
      }
    }

    if (subjectPeaks.length === 0) return 40;

    // For each subject peak, check viewer response in 200-800ms window
    // (Using wider window because 500ms sample rate limits precision)
    let mirrorHits = 0;
    let totalChecked = 0;

    for (const peak of subjectPeaks) {
      totalChecked++;
      const windowStart = peak.time + 0.2;
      const windowEnd = peak.time + 0.8;

      // Find viewer samples in window
      const viewerInWindow = viewerSamples.filter(
        (v) => v.videoTime >= windowStart && v.videoTime <= windowEnd
      );

      for (const v of viewerInWindow) {
        const viewerDom = dominantEmotion(v.expressions);
        // Check if viewer mirrors the same emotion or shows engagement (not neutral)
        if (viewerDom === peak.emotion || (viewerDom !== 'neutral' && (v.expressions[viewerDom] || 0) > 0.3)) {
          mirrorHits++;
          break;
        }
      }
    }

    if (totalChecked === 0) return 40;

    const mirrorRate = mirrorHits / totalChecked;
    // Natural mirroring: 20-70% mirror rate
    if (mirrorRate >= 0.15 && mirrorRate <= 0.8) {
      return Math.round(50 + mirrorRate * 60);
    } else if (mirrorRate < 0.15) {
      return Math.round(20 + mirrorRate * 130); // low mirroring = synthetic content
    }
    return 60; // very high mirroring — could be natural or coincidence
  }

  // ========== SUBJECT FRAME CAPTURE ==========

  function captureVideoFrame(video, canvas, ctx) {
    canvas.width = video.videoWidth || video.clientWidth || 320;
    canvas.height = video.videoHeight || video.clientHeight || 240;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // ========== RESULTS DISPLAY ==========

  function showResults(viewerResult, subjectResult, combinedResult, toggles) {
    const backdrop = document.createElement('div');
    backdrop.className = 'reactr-overlay-backdrop';

    const card = document.createElement('div');
    card.className = 'reactr-results-card reactr-results-card--dual';

    // Determine which main score to show in the ring
    let mainScore, mainVerdict, mainVerdictColor;
    if (toggles.combinedEnabled && combinedResult) {
      mainScore = combinedResult.score;
      mainVerdict = combinedResult.verdict;
      mainVerdictColor = combinedResult.verdictColor;
    } else if (toggles.viewerEnabled && viewerResult) {
      mainScore = viewerResult.score;
      mainVerdict = viewerResult.verdict;
      mainVerdictColor = viewerResult.verdictColor;
    } else if (toggles.subjectEnabled && subjectResult) {
      mainScore = subjectResult.score;
      mainVerdict = subjectResult.verdict;
      mainVerdictColor = subjectResult.verdictColor;
    } else {
      mainScore = 50;
      mainVerdict = 'No Data';
      mainVerdictColor = '#f59e0b';
    }

    const circumference = 2 * Math.PI * 52;
    const offset = circumference - (mainScore / 100) * circumference;
    const ringColor = scoreColor(mainScore);

    let sectionsHtml = '';

    // --- Viewer Section ---
    if (toggles.viewerEnabled && viewerResult) {
      sectionsHtml += buildSection(
        '👁 VIEWER RESPONSE',
        viewerResult.score,
        viewerResult.signals.slice(0, 5)
      );
    }

    // --- Subject Section ---
    if (toggles.subjectEnabled && subjectResult) {
      sectionsHtml += buildSection(
        '🎬 SUBJECT ANALYSIS',
        subjectResult.score,
        subjectResult.signals
      );
    }

    // --- Combined Section ---
    if (toggles.combinedEnabled && combinedResult) {
      let combinedSignals = [
        ...combinedResult.signals
      ];
      sectionsHtml += buildSection(
        '🔀 COMBINED',
        combinedResult.score,
        combinedSignals
      );
    }

    card.innerHTML = `
      <div class="reactr-header">🔍 REACTR AUTHENTIC</div>
      <div class="reactr-score-ring">
        <svg viewBox="0 0 120 120">
          <circle class="reactr-ring-bg" cx="60" cy="60" r="52"></circle>
          <circle class="reactr-ring-fill" cx="60" cy="60" r="52"
            stroke="${ringColor}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${circumference}"></circle>
        </svg>
        <div class="reactr-score-value" style="color: ${ringColor}">${mainScore}</div>
        <div class="reactr-score-label">Score</div>
      </div>
      <div class="reactr-verdict" style="color: ${mainVerdictColor}">${mainVerdict}</div>
      <div class="reactr-sections">${sectionsHtml}</div>
      <div class="reactr-disclaimer">
        Experimental dual-signal biometric analysis. Viewer micro-expressions
        and subject frame analysis are combined for authenticity scoring.
        Not a definitive determination of video authenticity.
      </div>
      <button class="reactr-close-btn">Close</button>
    `;

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    // Animate ring fill
    requestAnimationFrame(() => {
      const ring = card.querySelector('.reactr-ring-fill');
      ring.style.strokeDashoffset = offset;
    });

    card.querySelector('.reactr-close-btn').addEventListener('click', () => {
      backdrop.remove();
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
  }

  function buildSection(title, sectionScore, signals) {
    const sColor = scoreColor(sectionScore);
    const signalsHtml = signals.map((s) => `
      <div class="reactr-signal">
        <div class="reactr-signal-dot" style="background: ${s.color}"></div>
        <span>${s.text}</span>
      </div>
    `).join('');

    return `
      <div class="reactr-section">
        <div class="reactr-section-header">
          <span class="reactr-section-title">${title}</span>
          <span class="reactr-section-score" style="color: ${sColor}">${sectionScore}</span>
        </div>
        ${signalsHtml}
      </div>
    `;
  }

  // ========== COMBINED SCORING ==========

  function computeCombinedScore(viewerResult, subjectResult, viewerSamples, subjectSamples, toggles) {
    const signals = [];
    let score;

    const hasViewer = toggles.viewerEnabled && viewerResult && viewerResult.verdict !== 'Insufficient Data';
    const hasSubject = toggles.subjectEnabled && subjectResult && subjectResult.verdict !== 'Insufficient Data';

    if (hasViewer && hasSubject) {
      // Compute temporal resonance cross-signal
      const resonanceScore = computeTemporalResonance(viewerSamples, subjectSamples);

      // Update subject result's temporal resonance with real cross-signal data
      subjectResult.temporalResonanceScore = resonanceScore;
      // Recompute subject signal text for resonance
      const resSignal = subjectResult.signals.find((s) => s.text.startsWith('Temporal resonance'));
      if (resSignal) {
        resSignal.text = `Temporal resonance: ${resonanceScore >= 60 ? 'viewer mirrors subject emotions' : resonanceScore >= 40 ? 'partial mirroring' : 'viewer flat during subject expression'}`;
        resSignal.color = scoreColor(resonanceScore);
        resSignal.val = resonanceScore;
      }

      // Recalculate subject score with updated resonance
      const weights = { blink: 0.20, cascade: 0.20, asymmetry: 0.25, idle: 0.20, resonance: 0.15 };
      const updatedSubjectScore = Math.max(0, Math.min(100, Math.round(
        subjectResult.blinkScore * weights.blink +
        subjectResult.cascadeTimingScore * weights.cascade +
        subjectResult.asymmetryScore * weights.asymmetry +
        subjectResult.idleMotionScore * weights.idle +
        resonanceScore * weights.resonance
      )));
      subjectResult.score = updatedSubjectScore;

      // Combined: 50% viewer + 50% subject
      score = Math.round(viewerResult.score * 0.5 + updatedSubjectScore * 0.5);

      signals.push({
        text: `Viewer signal: ${viewerResult.score}/100`,
        color: scoreColor(viewerResult.score)
      });
      signals.push({
        text: `Subject signal: ${updatedSubjectScore}/100`,
        color: scoreColor(updatedSubjectScore)
      });
      signals.push({
        text: `Temporal resonance: ${resonanceScore >= 60 ? 'viewer mirrors subject' : resonanceScore >= 40 ? 'partial sync' : 'no emotional contagion'}`,
        color: scoreColor(resonanceScore)
      });

      // Divergence indicator
      const divergence = Math.abs(viewerResult.score - updatedSubjectScore);
      if (divergence > 20) {
        signals.push({
          text: `⚠️ Signal Divergence — one signal defeats the other (${divergence}pt gap)`,
          color: '#f59e0b'
        });
      }
    } else if (hasViewer) {
      score = viewerResult.score;
      signals.push({ text: `Viewer signal only: ${viewerResult.score}/100`, color: scoreColor(viewerResult.score) });
      signals.push({ text: 'Subject analysis disabled or insufficient data', color: '#f59e0b' });
    } else if (hasSubject) {
      score = subjectResult.score;
      signals.push({ text: `Subject signal only: ${subjectResult.score}/100`, color: scoreColor(subjectResult.score) });
      signals.push({ text: 'Viewer analysis disabled or insufficient data', color: '#f59e0b' });
    } else {
      score = 50;
      signals.push({ text: 'Insufficient data from both signals', color: '#f59e0b' });
    }

    score = Math.max(0, Math.min(100, score));

    let verdict, verdictColor;
    if (score >= 65) { verdict = 'Likely Real'; verdictColor = '#22c55e'; }
    else if (score >= 40) { verdict = 'Uncertain'; verdictColor = '#f59e0b'; }
    else { verdict = 'Likely AI-Generated'; verdictColor = '#ef4444'; }

    return { score, verdict, verdictColor, signals };
  }

  // ========== PAYWALL ==========

  const GC_FREE_LIMIT = 3;

  function getPaywallStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ gc_analyses_used: 0, gc_premium: false }, resolve);
    });
  }

  function incrementUsage() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ gc_analyses_used: 0 }, (data) => {
        const newCount = (data.gc_analyses_used || 0) + 1;
        chrome.storage.local.set({ gc_analyses_used: newCount }, () => resolve(newCount));
      });
    });
  }

  function showPaywall() {
    const backdrop = document.createElement('div');
    backdrop.className = 'reactr-paywall-backdrop';

    const card = document.createElement('div');
    card.className = 'reactr-paywall-card';
    card.innerHTML = `
      <button class="reactr-paywall-close">&times;</button>
      <h3>You have used your 3 free GutCheck analyses</h3>
      <p class="reactr-paywall-sub">Unlock unlimited analyses to keep protecting yourself.</p>
      <a href="https://gutcheck.you/upgrade" target="_blank" rel="noopener" class="reactr-paywall-cta">Unlock GutCheck for $9.95</a>
      <p class="reactr-paywall-note">One-time payment. No subscription. Works forever.</p>
    `;

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    card.querySelector('.reactr-paywall-close').addEventListener('click', () => {
      backdrop.remove();
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
  }

  // ========== TOGGLE STATE ==========

  async function getToggles() {
    const defaults = { viewerEnabled: true, subjectEnabled: true, combinedEnabled: true };
    try {
      return await new Promise((resolve) => {
        chrome.storage.local.get(defaults, resolve);
      });
    } catch {
      return defaults;
    }
  }

  // ========== MAIN ANALYSIS FLOW ==========

  async function startAnalysis(video, badge) {
    if (activeAnalysis) return;
    activeAnalysis = true;

    const toggles = await getToggles();

    // Need at least one signal enabled
    if (!toggles.viewerEnabled && !toggles.subjectEnabled) {
      alert('Reactr Authentic: Enable at least one analysis signal (Viewer or Subject) in the extension popup.');
      activeAnalysis = null;
      return;
    }

    // Paywall check: block if free limit reached and not premium
    const paywallStatus = await getPaywallStatus();
    if ((paywallStatus.gc_analyses_used || 0) >= GC_FREE_LIMIT && !paywallStatus.gc_premium) {
      showPaywall();
      activeAnalysis = null;
      return;
    }

    // Step 1: Consent
    const consented = await showConsentDialog(toggles.viewerEnabled, toggles.subjectEnabled);
    if (!consented) {
      activeAnalysis = null;
      return;
    }

    badge.classList.add('gutcheck-badge--active');
    badge.textContent = '⏳ Loading...';

    try {
      // Step 2: Load face-api
      await loadFaceApi();

      // Step 3: Setup camera (if viewer enabled)
      let stream = null;
      let preview = null;
      let cameraVideo = null;

      if (toggles.viewerEnabled) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 320, height: 240 }
        });
        const cam = createCameraPreview(stream);
        preview = cam.preview;
        cameraVideo = cam.videoEl;

        await new Promise((resolve) => {
          cameraVideo.onloadedmetadata = resolve;
        });
      }

      // Step 4: Setup subject canvas (if subject enabled)
      let subjectCanvas = null;
      let subjectCtx = null;
      if (toggles.subjectEnabled) {
        subjectCanvas = document.createElement('canvas');
        subjectCtx = subjectCanvas.getContext('2d');
      }

      const progressBar = createProgressBar();
      badge.textContent = '🔴 Analyzing...';

      // Step 5: Restart video and sample both signals
      video.currentTime = 0;
      await video.play().catch(() => {});

      const viewerSamples = [];
      const subjectSamples = [];
      const maxDuration = Math.min(video.duration || 30, 30);
      const sampleInterval = 500;
      const startTime = Date.now();

      const samplingPromise = new Promise((resolve) => {
        const intervalId = setInterval(async () => {
          const elapsed = (Date.now() - startTime) / 1000;
          const videoTime = video.currentTime;

          const progress = Math.min((elapsed / maxDuration) * 100, 100);
          progressBar.style.width = progress + '%';

          if (elapsed >= maxDuration || video.paused || video.ended) {
            clearInterval(intervalId);
            resolve();
            return;
          }

          // --- Viewer sampling ---
          if (toggles.viewerEnabled && cameraVideo) {
            try {
              const detection = await faceapi
                .detectSingleFace(cameraVideo, new faceapi.TinyFaceDetectorOptions())
                .withFaceExpressions();

              if (detection) {
                viewerSamples.push({
                  timestamp: elapsed,
                  videoTime: videoTime,
                  expressions: detection.expressions
                });
              }
            } catch (err) {
              // Skip failed frame
            }
          }

          // --- Subject sampling ---
          if (toggles.subjectEnabled && subjectCanvas) {
            try {
              captureVideoFrame(video, subjectCanvas, subjectCtx);
              const detection = await faceapi
                .detectSingleFace(subjectCanvas, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks(true)
                .withFaceExpressions();

              if (detection) {
                subjectSamples.push({
                  videoTime: videoTime,
                  timestamp: elapsed,
                  expressions: detection.expressions,
                  landmarks: detection.landmarks
                });
              }
            } catch (err) {
              // Skip failed frame
            }
          }
        }, sampleInterval);
      });

      await samplingPromise;

      // Step 6: Cleanup
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (preview) preview.remove();
      progressBar.remove();

      // Step 7: Compute scores
      let viewerResult = null;
      let subjectResult = null;
      let combinedResult = null;

      if (toggles.viewerEnabled) {
        viewerResult = computeViewerScore(viewerSamples);
      }

      if (toggles.subjectEnabled) {
        subjectResult = computeSubjectScore(subjectSamples);
      }

      if (toggles.combinedEnabled) {
        combinedResult = computeCombinedScore(viewerResult, subjectResult, viewerSamples, subjectSamples, toggles);
      }

      // Step 8: Increment usage and show results
      await incrementUsage();
      showResults(viewerResult, subjectResult, combinedResult, toggles);

    } catch (err) {
      console.error('[Reactr Authentic]', err);
      alert('Reactr Authentic: ' + (err.message || 'An error occurred during analysis.'));
    } finally {
      badge.classList.remove('gutcheck-badge--active');
      badge.textContent = '🔍 Analyze';
      activeAnalysis = null;
    }
  }

  // ========== INIT ==========

  scanForVideos();

  const observer = new MutationObserver((mutations) => {
    let hasNewNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) { hasNewNodes = true; break; }
    }
    if (hasNewNodes) scanForVideos();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(scanForVideos, 3000);
})();
