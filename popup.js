// Reactr Authentic — Popup Script

(async function () {
  const countEl = document.getElementById('videoCount');
  const toggleViewer = document.getElementById('toggleViewer');
  const toggleSubject = document.getElementById('toggleSubject');
  const toggleCombined = document.getElementById('toggleCombined');
  const usageStatusEl = document.getElementById('usageStatus');

  // --- Toggle Persistence ---
  const DEFAULTS = { viewerEnabled: true, subjectEnabled: true, combinedEnabled: true };

  // Load saved toggle state
  const stored = await chrome.storage.local.get(DEFAULTS);
  toggleViewer.checked = stored.viewerEnabled;
  toggleSubject.checked = stored.subjectEnabled;
  toggleCombined.checked = stored.combinedEnabled;

  // Save on change
  toggleViewer.addEventListener('change', () => {
    chrome.storage.local.set({ viewerEnabled: toggleViewer.checked });
  });
  toggleSubject.addEventListener('change', () => {
    chrome.storage.local.set({ subjectEnabled: toggleSubject.checked });
  });
  toggleCombined.addEventListener('change', () => {
    chrome.storage.local.set({ combinedEnabled: toggleCombined.checked });
  });

  // --- Usage / Premium Status ---
  const FREE_LIMIT = 3;
  const usageData = await chrome.storage.local.get({ gc_analyses_used: 0, gc_premium: false });
  const used = usageData.gc_analyses_used || 0;
  const isPremium = usageData.gc_premium === true;

  if (isPremium) {
    usageStatusEl.innerHTML = '<span style="color:#22c55e;font-size:16px;">&#10003;</span> <span style="color:#a5b4fc;font-weight:600;">Premium.</span>&nbsp;Unlimited analyses.';
  } else {
    const remaining = Math.max(0, FREE_LIMIT - used);
    usageStatusEl.innerHTML = `<span style="color:#a5b4fc;font-weight:600;">${remaining} of ${FREE_LIMIT}</span> free analyses remaining`;
  }

  // --- Dev Unlock: 5 rapid clicks on logo ---
  const logoEl = document.querySelector('.logo');
  let devClicks = 0;
  let devClickTimer = null;

  if (logoEl) {
    logoEl.style.cursor = 'pointer';
    logoEl.addEventListener('click', () => {
      devClicks++;
      clearTimeout(devClickTimer);
      devClickTimer = setTimeout(() => { devClicks = 0; }, 1500);
      if (devClicks >= 5) {
        devClicks = 0;
        chrome.storage.local.set({ gc_premium: true });
        usageStatusEl.innerHTML = '<span style="color:#22c55e;font-size:16px;">&#10003;</span> <span style="color:#a5b4fc;font-weight:600;">Premium.</span>&nbsp;Unlimited analyses.';
      }
    });
  }

  // --- Video Count ---
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      countEl.innerHTML = 'No active tab detected.';
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.querySelectorAll('video').length
    });

    const count = results?.[0]?.result || 0;
    if (count === 0) {
      countEl.innerHTML = 'No videos detected on this page.';
    } else {
      countEl.innerHTML = `<strong>${count}</strong> video${count !== 1 ? 's' : ''} detected on this page`;
    }
  } catch (err) {
    countEl.innerHTML = 'Unable to scan this page.';
  }
})();
