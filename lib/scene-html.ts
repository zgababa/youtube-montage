/**
 * Sample generated scenes, standing in for the files the `generate` step writes
 * to `scenes/scene_NN.html`.
 *
 * They obey the hard constraints in idea.md §5, because the preview scrubber
 * depends on the same thing the exporter does:
 *   - motion is CSS animations only — no setTimeout/rAF/Date.now
 *   - every animated property is reachable via document.getAnimations()
 *   - finite iterations, `both` fill, so seeking to any time is meaningful
 *   - transparent background, system fonts, no external requests
 *   - designed for a 1920x1080 frame
 */

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: 1920px;
    height: 1080px;
    overflow: hidden;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #E8E8ED;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    position: relative;
    width: 1920px;
    height: 1080px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
`

function scene(css: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${BASE_CSS}${css}</style>
</head>
<body>
<div class="stage">
${body}
</div>
</body>
</html>`
}

/** scene_03 — job queue diagram. Measured 6.4s against a 7.0s window. */
export const SCENE_03_HTML = scene(
  `
  .row { display: flex; align-items: center; gap: 0; }
  .node {
    width: 380px;
    height: 220px;
    border: 3px solid rgba(232, 232, 237, 0.22);
    border-radius: 28px;
    background: rgba(11, 11, 15, 0.72);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    opacity: 0;
    transform: scale(0.94);
    animation: rise 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .node .label { font-size: 40px; font-weight: 620; letter-spacing: -0.01em; }
  .node .sub { font-size: 24px; color: rgba(232, 232, 237, 0.55); }
  .node:nth-child(1) { animation-delay: 200ms; }
  .node:nth-child(3) { animation-delay: 1400ms; }
  .node:nth-child(5) { animation-delay: 2600ms; }
  .node.accent { border-color: rgba(124, 92, 255, 0.75); }
  .node.accent .label { color: #A794FF; }

  .link {
    width: 150px;
    height: 3px;
    background: rgba(232, 232, 237, 0.35);
    transform-origin: left center;
    transform: scaleX(0);
    animation: draw 700ms cubic-bezier(0.33, 1, 0.68, 1) both;
  }
  .link:nth-child(2) { animation-delay: 950ms; }
  .link:nth-child(4) { animation-delay: 2150ms; }

  .caption {
    position: absolute;
    bottom: 168px;
    font-size: 30px;
    letter-spacing: 0.02em;
    color: rgba(232, 232, 237, 0.62);
    opacity: 0;
    filter: blur(6px);
    animation: soften 1000ms ease-out 3400ms both;
  }

  @keyframes rise {
    from { opacity: 0; transform: scale(0.94) translateY(18px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes draw {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  @keyframes soften {
    from { opacity: 0; filter: blur(6px); }
    to   { opacity: 1; filter: blur(0); }
  }
`,
  `
  <div class="row">
    <div class="node"><span class="label">Queue</span><span class="sub">pending jobs</span></div>
    <div class="link"></div>
    <div class="node accent"><span class="label">Agent</span><span class="sub">picks one up</span></div>
    <div class="link"></div>
    <div class="node"><span class="label">Store</span><span class="sub">writes result</span></div>
  </div>
  <div class="caption">one job at a time, never two</div>
`
)

/** scene_04 — three parallel passes. Measured 5.5s against a 6.0s window. */
export const SCENE_04_HTML = scene(
  `
  .lanes { display: flex; flex-direction: column; gap: 46px; width: 1180px; }
  .lane { display: flex; align-items: center; gap: 32px; opacity: 0; animation: fade 700ms ease-out both; }
  .lane:nth-child(1) { animation-delay: 150ms; }
  .lane:nth-child(2) { animation-delay: 400ms; }
  .lane:nth-child(3) { animation-delay: 650ms; }
  .name { width: 260px; font-size: 34px; font-weight: 560; text-align: right; }
  .track {
    position: relative;
    flex: 1;
    height: 26px;
    border-radius: 999px;
    background: rgba(232, 232, 237, 0.13);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: linear-gradient(90deg, #7C5CFF, #A794FF);
    transform-origin: left center;
    transform: scaleX(0);
    animation: fill 2600ms cubic-bezier(0.4, 0, 0.2, 1) both;
  }
  .lane:nth-child(1) .fill { animation-delay: 900ms; animation-duration: 2400ms; }
  .lane:nth-child(2) .fill { animation-delay: 900ms; animation-duration: 2900ms; }
  .lane:nth-child(3) .fill { animation-delay: 900ms; animation-duration: 2600ms; }
  .title {
    position: absolute;
    top: 210px;
    font-size: 52px;
    font-weight: 650;
    letter-spacing: -0.02em;
    opacity: 0;
    animation: fade 800ms ease-out 100ms both;
  }
  .done {
    position: absolute;
    bottom: 210px;
    font-size: 30px;
    color: rgba(167, 148, 255, 0.9);
    opacity: 0;
    animation: fade 700ms ease-out 4400ms both;
  }
  @keyframes fade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
`,
  `
  <div class="title">three passes, at once</div>
  <div class="lanes">
    <div class="lane"><span class="name">transcribe</span><div class="track"><div class="fill"></div></div></div>
    <div class="lane"><span class="name">cleanup</span><div class="track"><div class="fill"></div></div></div>
    <div class="lane"><span class="name">scenarios</span><div class="track"><div class="fill"></div></div></div>
  </div>
  <div class="done">concurrency 3 — modest on purpose</div>
`
)

/** scene_06 — word-level timestamp payload. Measured 8.2s against a 7.0s window (overruns). */
export const SCENE_06_HTML = scene(
  `
  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 38px;
    line-height: 1.72;
    padding: 56px 72px;
    border-radius: 32px;
    border: 3px solid rgba(232, 232, 237, 0.16);
    background: rgba(11, 11, 15, 0.78);
    opacity: 0;
    transform: scale(0.97);
    animation: pop 900ms cubic-bezier(0.22, 1, 0.36, 1) 200ms both;
  }
  .ln { display: block; opacity: 0; animation: fade 620ms ease-out both; }
  .ln:nth-child(1) { animation-delay: 900ms; }
  .ln:nth-child(2) { animation-delay: 1500ms; }
  .ln:nth-child(3) { animation-delay: 2100ms; }
  .ln:nth-child(4) { animation-delay: 2700ms; }
  .ln:nth-child(5) { animation-delay: 3300ms; }
  .ln:nth-child(6) { animation-delay: 3900ms; }
  .k { color: #A794FF; }
  .n { color: #E8E8ED; }
  .s { color: rgba(232, 232, 237, 0.72); }
  .p { color: rgba(232, 232, 237, 0.38); }
  .halo {
    position: absolute;
    inset: auto;
    bottom: 150px;
    font-size: 30px;
    color: rgba(232, 232, 237, 0.6);
    opacity: 0;
    animation: fade 900ms ease-out 6600ms both;
  }
  @keyframes pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
  @keyframes fade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
`,
  `
  <div class="code">
    <span class="ln"><span class="p">{</span></span>
    <span class="ln">  <span class="k">"w"</span><span class="p">:</span> <span class="s">"queue"</span><span class="p">,</span></span>
    <span class="ln">  <span class="k">"start"</span><span class="p">:</span> <span class="n">251.42</span><span class="p">,</span></span>
    <span class="ln">  <span class="k">"end"</span><span class="p">:</span> <span class="n">251.78</span><span class="p">,</span></span>
    <span class="ln">  <span class="k">"file"</span><span class="p">:</span> <span class="s">"raw/a-cam-01.mp4"</span></span>
    <span class="ln"><span class="p">}</span></span>
  </div>
  <div class="halo">every word keeps its timecode</div>
`
)

/** scene_07 — export cost breakdown. Measured 4.8s against a 5.5s window. */
export const SCENE_07_HTML = scene(
  `
  .bars { display: flex; align-items: flex-end; gap: 64px; height: 460px; }
  .bar { display: flex; flex-direction: column; align-items: center; gap: 26px; }
  .col {
    width: 148px;
    border-radius: 20px 20px 6px 6px;
    background: linear-gradient(180deg, #A794FF, #7C5CFF);
    transform-origin: bottom center;
    transform: scaleY(0);
    animation: grow 1400ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .bar:nth-child(1) .col { height: 150px; animation-delay: 400ms; }
  .bar:nth-child(2) .col { height: 300px; animation-delay: 700ms; }
  .bar:nth-child(3) .col { height: 430px; animation-delay: 1000ms; }
  .cap { font-size: 30px; color: rgba(232, 232, 237, 0.62); opacity: 0; animation: fade 600ms ease-out both; }
  .bar:nth-child(1) .cap { animation-delay: 1500ms; }
  .bar:nth-child(2) .cap { animation-delay: 1800ms; }
  .bar:nth-child(3) .cap { animation-delay: 2100ms; }
  .title {
    position: absolute;
    top: 200px;
    font-size: 50px;
    font-weight: 640;
    letter-spacing: -0.02em;
    opacity: 0;
    animation: fade 800ms ease-out both;
  }
  @keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  @keyframes fade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
`,
  `
  <div class="title">seconds per exported frame</div>
  <div class="bars">
    <div class="bar"><div class="col"></div><span class="cap">720p</span></div>
    <div class="bar"><div class="col"></div><span class="cap">1080p</span></div>
    <div class="bar"><div class="col"></div><span class="cap">1080p &times;2</span></div>
  </div>
`
)

/** scene_09 — the review loop, as a process. Measured 7.6s against an 8.0s window. */
export const SCENE_09_HTML = scene(
  `
  .steps { display: flex; flex-direction: column; gap: 40px; }
  .step { display: flex; align-items: center; gap: 40px; opacity: 0; animation: slide 850ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  .step:nth-child(1) { animation-delay: 300ms; }
  .step:nth-child(2) { animation-delay: 1400ms; }
  .step:nth-child(3) { animation-delay: 2500ms; }
  .step:nth-child(4) { animation-delay: 3600ms; }
  .num {
    width: 92px;
    height: 92px;
    border-radius: 999px;
    border: 3px solid rgba(124, 92, 255, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 40px;
    font-weight: 600;
    color: #A794FF;
    flex: none;
  }
  .txt { font-size: 44px; font-weight: 520; letter-spacing: -0.01em; }
  .rule {
    position: absolute;
    bottom: 170px;
    width: 0;
    height: 3px;
    background: rgba(124, 92, 255, 0.6);
    animation: extend 1200ms cubic-bezier(0.33, 1, 0.68, 1) 5000ms both;
  }
  @keyframes slide { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
  @keyframes extend { from { width: 0; } to { width: 720px; } }
`,
  `
  <div class="steps">
    <div class="step"><span class="num">1</span><span class="txt">propose spans</span></div>
    <div class="step"><span class="num">2</span><span class="txt">you approve the diff</span></div>
    <div class="step"><span class="num">3</span><span class="txt">place the scenes</span></div>
    <div class="step"><span class="num">4</span><span class="txt">export what survives</span></div>
  </div>
  <div class="rule"></div>
`
)
