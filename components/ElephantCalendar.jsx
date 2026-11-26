'use client';

import { useEffect, useRef, useState } from 'react';
import { useRive, Layout, Fit, Alignment } from '@rive-app/react-webgl2';

// Device sizes in points (portrait). iPad size is approximate (11-inch).
const DEVICES = {
  iphone: { name: 'iPhone 18', w: 402, h: 874, r: 55 }, // also the layout reference size
  ipad: { name: 'iPad 11"', w: 834, h: 1210, r: 28 },
};
// Allowed range for the free-size mode: exactly the sizes that were checked and look right.
// Shortest 402x671, tallest 402x871, widest 634x780.
const MIN_W = 402, MAX_W = 634, MIN_H = 671, MAX_H = 871;
const MIN_RATIO = 402 / 871, MAX_RATIO = 634 / 780; // width / height
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function limitSize(w, h, h_ = { cx: 0, cy: 0 }) {
  w = clamp(w, MIN_W, MAX_W)
  h = clamp(h, MIN_H, MAX_H)
  // keep the proportions inside the tested range: the edge being dragged stops
  if (w / h < MIN_RATIO) { if (h_.cy !== 0) h = w / MIN_RATIO; else w = h * MIN_RATIO }
  if (w / h > MAX_RATIO) { if (h_.cx !== 0) w = h * MAX_RATIO; else h = w / MAX_RATIO }
  return { w: Math.round(clamp(w, MIN_W, MAX_W)), h: Math.round(clamp(h, MIN_H, MAX_H)) }
}
// Resize handles: cx / cy say which edge is dragged (-1 = left/top, 1 = right/bottom, 0 = not used).
const HANDLES = [
  { id: 'n', cx: 0, cy: -1 }, { id: 's', cx: 0, cy: 1 },
  { id: 'w', cx: -1, cy: 0 }, { id: 'e', cx: 1, cy: 0 },
  { id: 'nw', cx: -1, cy: -1 }, { id: 'ne', cx: 1, cy: -1 },
  { id: 'sw', cx: -1, cy: 1 }, { id: 'se', cx: 1, cy: 1 },
];
const SM = 'Scene_SM';
const DESIGN_W = 956; // artboard width in the Rive file (layout units)
const SRC = '/latest.riv'; // 2adaptive_scene-elephant.riv
const ARTBOARD = 'Scene_Adaptiv';
const mult = 0.5; // fixed layout scale
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1); // Nov 2026 starts on Sunday

function Scene({ device, setDevice, landscape, setLandscape, custom, setCustom }) {
  const { rive, RiveComponent } = useRive({
    src: SRC,
    artboard: ARTBOARD,
    stateMachines: SM,
    autoplay: true,
    autoBind: true,
    layout: new Layout({ fit: Fit.Layout, alignment: Alignment.Center, layoutScaleFactor: 1 }),
  });

  // 'layout' = responsive (the artboard resizes to the screen), 'cover' = old crop-to-fill
  const [fitMode, setFitMode] = useState('layout');
  const [byHeight, setByHeight] = useState(true); // scale by height (default) or by width

  const dev = device === 'custom' ? { name: 'Custom size', w: custom.w, h: custom.h, r: 36 } : DEVICES[device];
  const W = landscape ? dev.h : dev.w;
  const H = landscape ? dev.w : dev.h;
  const isPhone = device.startsWith('iphone');

  const [inputs, setInputs] = useState([]);
  const [active, setActive] = useState(null);
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = () => {
      if (dragging) return // keep the screen scale fixed while resizing so the edge follows the pointer
      const availW = el.clientWidth - 130
      const availH = el.clientHeight - 150
      setScale(Math.max(0.2, Math.min(1, availH / H, availW / W)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H, dragging])

  // Apply fit + layout scale whenever the device, window scale or mode changes.
  // With Fit.Layout the artboard size = canvas pixels / layoutScaleFactor, so the factor
  // makes the file's design width (956) map onto the device's shorter side.
  useEffect(() => {
    if (!rive) return;
    const dpr = window.devicePixelRatio || 1;
    // 'height': one point = the same number of artboard units on every device, derived from the
    // iPhone reference, so vertical proportions never change; extra width is left to the layout.
    // 'width': old behaviour (design width mapped onto the short side).
    const refH = (DESIGN_W / mult) * (DEVICES.iphone.h / DEVICES.iphone.w);
    const sf = byHeight
      ? dpr * scale * (H / refH)
      : (dpr * scale * Math.min(W, H) / DESIGN_W) * mult;
    rive.layout = new Layout({
      fit: fitMode === 'layout' ? Fit.Layout : Fit.Cover,
      alignment: Alignment.Center,
      layoutScaleFactor: sf,
    });
    rive.resizeDrawingSurfaceToCanvas();
  }, [rive, W, H, scale, fitMode, byHeight]);

  useEffect(() => {
    if (!rive) return;
    const list = rive.stateMachineInputs(SM) || [];
    console.log('inputs:', list.map((i) => `${i.name} (type ${i.type})`));
    setInputs(list);
  }, [rive]);

  // Trigger = 58, Boolean = 59
  const press = (input) => {
    if (input.type === 58) input.fire();
    else if (input.type === 59) {
      if (input.name === 'Blink') {
        input.value = true;
        setTimeout(() => { input.value = false; }, 200);
        return;
      }
      inputs.forEach((o) => { if (o.type === 59 && o.name !== 'Blink') o.value = false; });
      input.value = true;
    }
    if (input.name !== 'Blink') setActive(input.name);
  };

  const startDrag = (h) => (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { h, x: e.clientX, y: e.clientY, w: W, hgt: H, scale }
    // the first drag switches to the free-size mode, starting from the current size
    const start = limitSize(W, H)
    drag.current.w = start.w
    drag.current.hgt = start.h
    setCustom(start)
    setDevice('custom')
    setLandscape(false)
    setDragging(true)
  }
  const moveDrag = (e) => {
    const d = drag.current
    if (!d) return
    // The frame is centred, so an edge moves by half of the size change: multiply by 2.
    const dw = (d.h.cx * 2 * (e.clientX - d.x)) / d.scale
    const dh = (d.h.cy * 2 * (e.clientY - d.y)) / d.scale
    setCustom(limitSize(d.w + dw, d.hgt + dh, d.h))
  }
  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }
  const flipOrientation = () => {
    if (device === 'custom') setCustom({ w: custom.h, h: custom.w })
    else setLandscape(!landscape)
  }

  const moods = inputs.filter((i) => i.name !== 'Blink')
  const blink = inputs.find((i) => i.name === 'Blink')

  return (
    <>
      <section className="layout">
        <div className="stage" ref={stageRef}>
          <div className="stage-grid" />
          <div className="stage-tag"><span className="dot" />Responsive layout · live</div>

          <div className="phoneWrap" style={{ width: W * scale, height: H * scale }}>
            <div className="phone" style={{ width: W, height: H, borderRadius: dev.r, transform: `scale(${scale})` }}>
              <RiveComponent className="rive" />
              {isPhone && <div className="island" />}
              <div className="status"><b>7:10</b><span>●●● ▮</span></div>

              <div className="ui" style={{ paddingTop: isPhone ? 62 : 40 }}>
                <div className="cal">
                  <div className="bar">
                    <button className="circ">♛</button>
                    <div className="pill month"><span>‹</span><span>November 2026</span><span className="dim">›</span></div>
                    <button className="circ">⟳</button>
                  </div>
                  <div className="week">{WEEK.map((d) => <span key={d}>{d}</span>)}</div>
                  <div className="grid">
                    {DAYS.map((d) => <div key={d} className={'day' + (d === 18 ? ' today' : '')}>{d}</div>)}
                  </div>
                </div>
              </div>

              <nav className="tabs"><span>▦<br />Home</span><span>⌁<br />Insights</span><span>⚙<br />Settings</span></nav>
              <button className="plus">+</button>
            </div>
            {HANDLES.map((h) => (
              <div
                key={h.id}
                className={`handle h-${h.id}`}
                onPointerDown={startDrag(h)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                title="Drag to resize"
              />
            ))}
          </div>

          <div className="stage-hint">Drag the edges or corners of the screen to resize it</div>
        </div>

        <aside className="panel">
          <div className="top-tag"><span className="pulse" />Elephant Mood Tracker · 5 scenes <span className="update-pill">Adaptive layout</span></div>
          <h1>Responsive scenes</h1>
          <p className="sub">One Rive file that adapts to the screen. Switch device, drag the edges to change width and height, and try every mood.</p>

          <div className="group-label">Device</div>
          <div className="chip-row">
            {Object.entries(DEVICES).map(([k, d]) => (
              <button key={k} className={`chip-btn${k === device ? ' on' : ''}`} onClick={() => setDevice(k)}>{d.name}</button>
            ))}
            <button className={`chip-btn${device === 'custom' ? ' on' : ''}`} onClick={() => { setCustom(limitSize(W, H)); setDevice('custom'); setLandscape(false) }}>Custom</button>
            {device !== 'custom' && (
              <button className={`chip-btn${landscape ? ' on' : ''}`} onClick={flipOrientation}>Landscape</button>
            )}
          </div>
          <p className="hint">Custom range: width {MIN_W}–{MAX_W} pt, height {MIN_H}–{MAX_H} pt.</p>

          <div className="group-label">Fit</div>
          <div className="chip-row">
            <button className={`chip-btn${fitMode === 'layout' ? ' on' : ''}`} onClick={() => setFitMode('layout')}>Responsive (layout)</button>
            <button className={`chip-btn${fitMode === 'cover' ? ' on' : ''}`} onClick={() => setFitMode('cover')}>Cover (crop)</button>
          </div>

          {fitMode === 'layout' && (
            <>
              <div className="group-label">Scale by</div>
              <div className="chip-row">
                <button className={`chip-btn${byHeight ? ' on' : ''}`} onClick={() => setByHeight(true)}>Height</button>
                <button className={`chip-btn${!byHeight ? ' on' : ''}`} onClick={() => setByHeight(false)}>Width</button>
              </div>
            </>
          )}

          <div className="group-label">Mood <span className="live-tag">{SM}</span></div>
          <div className="chip-row">
            {moods.map((i) => (
              <button key={i.name} className={`chip-btn${i.name === active ? ' on' : ''}`} onClick={() => press(i)}>
                <span className="chip-dot" />{i.name}
              </button>
            ))}
            {blink && (
              <button className="chip-btn" onClick={() => press(blink)}><span className="chip-dot" />Blink</button>
            )}
          </div>

          <div className="state-readout">
            <span className="live-dot" />
            <span>{dev.name}</span>·<b>{W}×{H} pt</b>{landscape ? <>·<span>landscape</span></> : null}·<span>Mood <b>{active || '—'}</b></span>
          </div>

          <a className="scroll-cue" href="#docs">
            Documentation
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2.5 6.5L6 10l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </a>
        </aside>
      </section>

      <Docs />
    </>
  );
}

const LAYOUT_EXAMPLE = `import { Rive, Fit, Alignment, Layout } from '@rive-app/webgl2'

const DESIGN_W = 956      // artboard width in layout units
const MULT = 0.5          // fixed layout scale
const REF = { w: 402, h: 874 }   // iPhone reference screen (pt)
const refH = (DESIGN_W / MULT) * (REF.h / REF.w)

const scene = new Rive({
  src: '/adaptive_scene-elephant.riv',
  canvas: document.getElementById('scene'),
  artboard: 'Scene_Adaptiv',
  stateMachines: 'Scene_SM',
  autoplay: true,
  layout: new Layout({ fit: Fit.Layout, alignment: Alignment.Center }),
})

// call on load and whenever the container changes size
function applyLayout(cssHeight) {
  const dpr = window.devicePixelRatio || 1
  scene.layout = new Layout({
    fit: Fit.Layout,
    alignment: Alignment.Center,
    layoutScaleFactor: dpr * (cssHeight / refH), // scale by height
  })
  scene.resizeDrawingSurfaceToCanvas()
}

new ResizeObserver(([e]) => applyLayout(e.contentRect.height))
  .observe(document.getElementById('scene'))

// moods: set exactly one Boolean to true
const inputs = scene.stateMachineInputs('Scene_SM')
const setMood = (name) =>
  inputs.forEach((i) => {
    if (['Angry', 'Sad', 'Calm', 'Happy', 'Excited'].includes(i.name)) i.value = i.name === name
  })`

function CodeBlock({ code }) {
  return <pre className="code-block"><code>{code}</code></pre>
}

function DocSection({ id, eyebrow, title, children }) {
  return (
    <section className="doc-section" id={id}>
      <div className="doc-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Docs() {
  const links = [['overview', 'Overview'], ['inputs', 'Inputs'], ['layout', 'Responsive layout'], ['web', 'Web'], ['checklist', 'Checklist']]
  return (
    <div className="docs" id="docs">
      <div className="docs-shell">
        <nav className="docs-nav">
          <div className="docs-nav-label">Documentation</div>
          {links.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>

        <div className="docs-body">
          <DocSection id="overview" eyebrow="Overview" title="One file, five scenes, adaptive layout">
            <p>
              All five mood scenes ship in a single Rive file with a responsive layout. The elephant, bench and
              ground are scaled down about 25 % and sit slightly lower, so the calendar does not cover the elephant.
            </p>
            <table className="emotion-table">
              <tbody>
                <tr><td>File</td><td><code>adaptive_scene-elephant.riv</code></td></tr>
                <tr><td>Artboard</td><td><code>Scene_Adaptiv</code></td></tr>
                <tr><td>State machine</td><td><code>Scene_SM</code></td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 18 }}>
              Use the WebGL2 runtime (<code>@rive-app/webgl2</code> or <code>@rive-app/react-webgl2</code>) on the web,
              since the scenes use glow and blur.
            </p>
          </DocSection>

          <DocSection id="inputs" eyebrow="Reference" title="Inputs">
            <table className="emotion-table">
              <thead><tr><th>Input</th><th>Type</th><th>Plays</th></tr></thead>
              <tbody>
                {['Angry', 'Sad', 'Calm', 'Happy', 'Excited'].map((m) => (
                  <tr key={m}><td><code>{m}</code></td><td>Boolean</td><td><code>{m}_Idle</code></td></tr>
                ))}
                <tr><td><code>Blink</code></td><td>Trigger</td><td>one blink, on its own layer</td></tr>
              </tbody>
            </table>
            <p style={{ marginTop: 18 }}>
              Set exactly one mood Boolean to <code>true</code>. Fire <code>Blink</code> every 3 to 6 seconds.
            </p>
          </DocSection>

          <DocSection id="layout" eyebrow="Layout" title="How the responsive layout works">
            <p>
              The artboard uses Rive Layout, so it resizes to whatever the app gives it. Load it with{' '}
              <code>Fit.Layout</code> and a <code>layoutScaleFactor</code>. The demo scales by height from an
              iPhone reference of 402 × 874 pt, so vertical proportions stay the same and extra width is handled by the layout.
            </p>
            <p>
              Tested range: width 402 to 634 pt, height 671 to 871 pt (shortest 402 × 671, tallest 402 × 871, widest 634 × 780).
              <code>Fit.Cover</code> crops the scene instead of adapting it, so do not use it with this file.
            </p>
          </DocSection>

          <DocSection id="web" eyebrow="JavaScript" title="Web integration example">
            <CodeBlock code={LAYOUT_EXAMPLE} />
          </DocSection>

          <DocSection id="checklist" eyebrow="Integration checklist" title="Ship it">
            <ul className="check-list done">
              <li>Load <code>adaptive_scene-elephant.riv</code>, artboard <code>Scene_Adaptiv</code>, state machine <code>Scene_SM</code></li>
              <li>Use the WebGL2 runtime so glow and blur render</li>
              <li>Use <code>Fit.Layout</code> with a <code>layoutScaleFactor</code>, not <code>Fit.Cover</code></li>
              <li>Set exactly one of <code>Angry</code> / <code>Sad</code> / <code>Calm</code> / <code>Happy</code> / <code>Excited</code> to true</li>
              <li>Fire <code>Blink</code> every 3 to 6 seconds</li>
            </ul>
          </DocSection>

          <div className="docs-footer">Elephant Mood Tracker · Rive integration docs</div>
        </div>
      </div>
    </div>
  )
}

export default function ElephantCalendar() {
  const [device, setDevice] = useState('iphone');
  const [landscape, setLandscape] = useState(false);
  const [custom, setCustom] = useState({ w: DEVICES.iphone.w, h: DEVICES.iphone.h });
  return (
    <Scene
      custom={custom} setCustom={setCustom}
      device={device} setDevice={setDevice}
      landscape={landscape} setLandscape={setLandscape}
    />
  );
}
