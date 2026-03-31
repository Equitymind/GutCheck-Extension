// Reactr Authentic — Camera Module
// Standalone camera + face-api utilities (web-accessible resource)
// Primary analysis logic is in content.js; this module provides
// shared utilities if needed by overlay.html or other contexts.

const ReactrCamera = {
  stream: null,

  async requestCamera() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 320, height: 240 }
    });
    return this.stream;
  },

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  },

  async loadFaceApi() {
    if (typeof faceapi === 'undefined') {
      throw new Error('face-api.js not loaded');
    }
    const MODEL_URL = 'https://unpkg.com/face-api.js@0.22.2/weights';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
    ]);
  },

  async detectExpression(videoElement) {
    if (typeof faceapi === 'undefined') return null;
    try {
      const detection = await faceapi
        .detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions())
        .withFaceExpressions();
      return detection ? detection.expressions : null;
    } catch {
      return null;
    }
  },

  // Compute authenticity score from expression samples
  computeScore(samples) {
    if (samples.length < 3) {
      return {
        score: 50,
        verdict: 'Insufficient Data',
        verdictColor: '#f59e0b',
        signals: [
          { text: 'Not enough expression data captured', color: '#f59e0b' },
          { text: 'Try watching a longer portion of the video', color: '#f59e0b' },
          { text: 'Ensure good lighting on your face', color: '#f59e0b' }
        ]
      };
    }

    const emotions = samples.map((s) => s.expressions);
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const avgSurprise = avg(emotions.map((e) => e.surprised || 0));
    const avgHappy = avg(emotions.map((e) => e.happy || 0));
    const avgDisgust = avg(emotions.map((e) => e.disgusted || 0));
    const avgNeutral = avg(emotions.map((e) => e.neutral || 0));
    const avgFear = avg(emotions.map((e) => e.fearful || 0));
    const avgAngry = avg(emotions.map((e) => e.angry || 0));
    const avgSad = avg(emotions.map((e) => e.sad || 0));

    const mirrorScore = (avgSurprise + avgHappy) * 50;
    const uncannySignal = (avgDisgust * 0.6 + (avgNeutral > 0.7 ? 0.4 : 0)) * 40;

    const allVals = emotions.flatMap((e) => [
      e.surprised || 0, e.happy || 0, e.fearful || 0,
      e.disgusted || 0, e.angry || 0, e.sad || 0, e.neutral || 0
    ]);
    const mean = avg(allVals);
    const variance = avg(allVals.map((v) => (v - mean) ** 2));
    const varianceScore = Math.min(variance * 200, 30);

    let cascadeScore = 0;
    if (emotions.length >= 4) {
      let transitions = 0;
      for (let i = 1; i < emotions.length; i++) {
        const dom = (expr) => {
          let mx = -1, d = 'neutral';
          for (const [k, v] of Object.entries(expr)) { if (v > mx) { mx = v; d = k; } }
          return d;
        };
        if (dom(emotions[i - 1]) !== dom(emotions[i])) transitions++;
      }
      const rate = transitions / (emotions.length - 1);
      cascadeScore = (rate >= 0.15 && rate <= 0.65) ? 20 : rate < 0.15 ? 5 : 10;
    }

    const cogLoad = (avgAngry + avgFear + avgSad) * 15;
    const cogBonus = (cogLoad > 3 && cogLoad < 12) ? 10 : 0;

    let score = Math.max(0, Math.min(100,
      Math.round(mirrorScore + varianceScore + cascadeScore + cogBonus - uncannySignal)
    ));

    let verdict, verdictColor;
    if (score >= 65) { verdict = 'Likely Real'; verdictColor = '#22c55e'; }
    else if (score >= 40) { verdict = 'Uncertain'; verdictColor = '#f59e0b'; }
    else { verdict = 'Likely AI-Generated'; verdictColor = '#ef4444'; }

    const signals = [
      { val: mirrorScore, text: `Mirror response: ${mirrorScore > 15 ? 'strong' : 'weak'} emotional contagion`, color: mirrorScore > 15 ? '#22c55e' : '#ef4444' },
      { val: uncannySignal, text: `Uncanny valley: ${uncannySignal > 10 ? 'aversion detected' : 'no aversion'}`, color: uncannySignal > 10 ? '#ef4444' : '#22c55e' },
      { val: varianceScore, text: `Expression range: ${varianceScore > 10 ? 'dynamic' : 'flat'}`, color: varianceScore > 10 ? '#22c55e' : '#ef4444' }
    ];

    return { score, verdict, verdictColor, signals };
  }
};

// Export for use in overlay.html or other contexts
if (typeof window !== 'undefined') {
  window.ReactrCamera = ReactrCamera;
}
