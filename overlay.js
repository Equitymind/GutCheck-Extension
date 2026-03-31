// Reactr Authentic — Overlay Script
// Standalone overlay page for analysis display (used when opened separately)

(function () {
  'use strict';

  const statusEl = document.getElementById('status');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const sampleCountEl = document.getElementById('sampleCount');
  const cameraPreview = document.getElementById('cameraPreview');

  let sampleCount = 0;

  // Listen for messages from the parent/content script
  window.addEventListener('message', (event) => {
    const { type, data } = event.data || {};

    switch (type) {
      case 'reactr-status':
        statusEl.textContent = data.message;
        break;

      case 'reactr-progress':
        const pct = Math.round(data.progress);
        progressFill.style.width = pct + '%';
        progressText.textContent = pct + '%';
        break;

      case 'reactr-sample':
        sampleCount++;
        sampleCountEl.textContent = `${sampleCount} expression sample${sampleCount !== 1 ? 's' : ''} captured`;
        break;

      case 'reactr-camera-stream':
        // If stream is passed via transfer
        if (data.stream) {
          cameraPreview.srcObject = data.stream;
        }
        break;

      case 'reactr-complete':
        statusEl.textContent = 'Analysis complete!';
        progressFill.style.width = '100%';
        progressText.textContent = '100%';
        break;
    }
  });

  // Update status
  statusEl.textContent = 'Waiting for analysis to start...';
})();
