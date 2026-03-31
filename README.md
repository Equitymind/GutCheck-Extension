# GutCheck — Chrome Extension

AI video detection via human biometric response analysis.

**Private test build for Joe & Nora only.**

## What It Does

Detects video elements on any web page and adds a small "🔍 Analyze" badge. When clicked, it activates your front-facing camera (with explicit consent), captures your facial micro-expressions as you watch the video, and returns an **authenticity confidence score** (0–100) indicating how likely the video is real vs AI-generated — based purely on your biological response.

### Scoring Signals

| Signal | What It Measures |
|---|---|
| **Emotional Contagion** | Mirror response to authentic human content (surprise + happiness) |
| **Uncanny Valley** | Micro-disgust and neutral flatness when watching synthetic content |
| **Expression Variance** | Overall emotional dynamism vs flat non-response |
| **Temporal Cascade** | Natural emotion transition timing vs static/erratic patterns |
| **Cognitive Load** | Brow tension and engagement depth |

### Score Ranges

- **65–100**: Likely Real — strong biometric engagement detected
- **40–64**: Uncertain — mixed or ambiguous signals
- **0–39**: Likely AI-Generated — uncanny valley / low contagion patterns

## Install as Unpacked Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this folder (`reactr-authentic-extension`)
5. The GutCheck icon will appear in your toolbar

## How to Use

1. Navigate to any page with a video (YouTube, Twitter/X, news sites, LinkedIn, etc.)
2. Hover over a video — the **🔍 Analyze** badge appears in the top-right corner
3. Click the badge
4. A consent dialog will ask for camera access — click **Allow Camera**
5. Your browser will also request camera permission — allow it
6. Watch the video naturally while your micro-expressions are captured (you'll see a small camera preview in the bottom-right corner)
7. After analysis completes (up to 30 seconds), a results card shows:
   - Your **authenticity score** (0–100)
   - A **verdict** (Likely Real / Uncertain / Likely AI-Generated)
   - The **top 3 signals** that drove the score

## Privacy

- Camera feed is processed **locally** via face-api.js — no data leaves your browser
- Only scored emotion vectors are used — **no raw video is stored or transmitted**
- The camera shuts off immediately after analysis

## Technical Details

- **Chrome Manifest V3** extension
- **face-api.js** (v0.22.2) loaded from unpkg CDN for facial expression detection
- Uses `TinyFaceDetector` + `FaceExpressionNet` models
- Samples front camera every 500ms during video playback
- Captures 7-emotion vector: surprised, happy, fearful, disgusted, angry, sad, neutral
- All scoring runs client-side — zero server dependencies

## Limitations

- This is an **experimental hypothesis test**, not a definitive AI detector
- Scoring accuracy depends on lighting, camera quality, and natural viewing behavior
- The score reflects *your biometric response*, not direct analysis of the video content
- Results should be treated as exploratory research data

## Files

```
reactr-authentic-extension/
├── manifest.json      # Chrome MV3 manifest
├── content.js         # Video detection + badge injection + analysis engine
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic (video count)
├── camera.js          # Standalone camera utilities
├── overlay.html       # Analysis overlay page
├── overlay.js         # Overlay messaging logic
├── styles.css         # Dark Reactr UI styles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md          # This file
```
