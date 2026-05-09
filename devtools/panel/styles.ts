// @ts-nocheck
// CSS for the panel, shipped as an exported string so tsup can bundle it
// without a CSS loader plugin. Injected as a <style> tag inside the panel's
// shadow root by shell.ts.
export default `
:host { all: initial; }
.host {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483647;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #e6e6e6;
}
.dock {
  width: 480px;
  height: 360px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  resize: both;
  min-width: 280px;
  min-height: 200px;
}
.dock.collapsed {
  width: auto;
  height: auto;
  resize: none;
}
.dock.collapsed .body, .dock.collapsed .tabs { display: none; }
.header {
  display: flex;
  align-items: center;
  background: #222;
  border-bottom: 1px solid #333;
  padding: 4px 6px;
  cursor: move;
  user-select: none;
  flex-shrink: 0;
}
.header .title {
  flex: 1;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #9be3a8;
}
.header .actions { display: flex; gap: 2px; }
.header button {
  background: transparent;
  color: #888;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
}
.header button:hover { color: #e6e6e6; }
.header button.active { color: #9be3a8; }
.tabs {
  display: flex;
  background: #181818;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}
.tabs button {
  background: transparent;
  color: #888;
  border: none;
  border-right: 1px solid #2a2a2a;
  cursor: pointer;
  padding: 6px 12px;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.tabs button:hover { color: #ccc; }
.tabs button.active {
  color: #9be3a8;
  background: #1f2a20;
}
.body {
  flex: 1;
  overflow: auto;
  padding: 8px;
}
.body :is(.empty) {
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 24px 8px;
}

/* Graph tab */
.gt-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #2a2a2a;
}
.gt-label { color: #888; }
.gt-select {
  background: #161616;
  color: #e6e6e6;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 2px 4px;
  font-family: inherit;
  font-size: 11px;
  flex: 1;
  min-width: 0;
}
.gt-checkbox {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #888;
  cursor: pointer;
  white-space: nowrap;
}
.gt-tree { line-height: 1.6; }
.gt-node details { padding-left: 0; }
.gt-children { padding-left: 16px; border-left: 1px dotted #2a2a2a; margin-left: 4px; }
.gt-node summary { cursor: pointer; list-style: none; }
.gt-node summary::-webkit-details-marker { display: none; }
.gt-node summary::before {
  content: '▸';
  display: inline-block;
  width: 12px;
  color: #555;
  transition: transform 0.1s;
}
.gt-node details[open] > summary::before { transform: rotate(90deg); }
.gt-badge {
  display: inline-block;
  padding: 0 4px;
  margin-right: 4px;
  border-radius: 2px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: #2a2a2a;
  color: #888;
}
.gt-root { background: #2d3a2d; color: #9be3a8; }
.gt-child { background: #2a2a2a; color: #888; }
.gt-operator { background: #2d3447; color: #9bb3e3; }
.gt-dom { background: #3a2d2d; color: #e39b9b; }
.gt-connect { background: #3a3727; color: #e3c98e; }
.gt-linked-alias { background: #2d2d3a; color: #b39be3; }
.gt-cycle { background: #4a2929; color: #ffaaaa; }
.gt-rowlabel { color: #ddd; }
/* Picked node — the sink the DOM picker matched. Pulsing outline so the
   eye finds it immediately; fades after a couple of seconds. */
.gt-picked > details > summary,
.gt-picked > .gt-badge {
  outline: 1px solid #9be3a8;
  outline-offset: 2px;
  border-radius: 2px;
  animation: __ripple_pulse 1s ease-out 3;
}
@keyframes __ripple_pulse {
  0%   { box-shadow: 0 0 0 0 rgba(155, 227, 168, 0.55); }
  100% { box-shadow: 0 0 0 8px rgba(155, 227, 168, 0); }
}

/* Graph tab — DAG mode */
.gt-tree.gt-dag-mode { padding: 0; }
.gt-dag {
  position: relative;
  overflow: auto;
  background: #141414;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  padding: 0;
}
.gt-dag-node {
  box-sizing: border-box;
  border: 1px solid #333;
  border-radius: 3px;
  background: #1f1f1f;
  color: #e6e6e6;
  font-size: 10px;
  padding: 4px 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gt-dag-node.gt-root      { background: #2d3a2d; color: #9be3a8; border-color: #3a4f3a; }
.gt-dag-node.gt-child     { background: #2a2a2a; color: #ccc;     border-color: #3a3a3a; }
.gt-dag-node.gt-operator  { background: #2d3447; color: #9bb3e3; border-color: #3a4760; }
.gt-dag-node.gt-dom       { background: #3a2d2d; color: #e39b9b; border-color: #4d3a3a; }
.gt-dag-node.gt-connect   { background: #3a3727; color: #e3c98e; border-color: #4d472f; }
.gt-dag-edge { stroke-width: 1.5; opacity: 0.7; }
.gt-dag-edge-child { stroke: #555; stroke-dasharray: 3 3; }
.gt-dag-edge-sink  { stroke: #5e7593; }
.gt-dag-node:hover { filter: brightness(1.3); z-index: 1; }

/* Events tab */
.ev-toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid #2a2a2a;
}
.ev-btn {
  background: #161616;
  color: #ccc;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 2px 8px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.ev-btn:hover { background: #222; }
.ev-filter {
  flex: 1;
  background: #161616;
  color: #e6e6e6;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 2px 6px;
  font-family: inherit;
  font-size: 11px;
  min-width: 0;
}
.ev-count { color: #666; font-size: 10px; white-space: nowrap; }
.ev-list {
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
  max-height: calc(100% - 34px);
  overflow-y: auto;
}
.ev-row { display: flex; gap: 6px; padding: 1px 0; }
.ev-row:hover { background: #222; }
.ev-verb {
  display: inline-block;
  min-width: 36px;
  text-align: center;
  font-size: 9px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 2px;
  background: #2a2a2a;
  color: #888;
}
.ev-XU0, .ev-BU1, .ev-BU2 { color: #9bb3e3; background: #2d3447; }
.ev-BI0, .ev-BI0A, .ev-BI2 { color: #9be3a8; background: #2d3a2d; }
.ev-XR0, .ev-BR1, .ev-BR1A, .ev-BR2 { color: #e39b9b; background: #3a2d2d; }
.ev-BMV1 { color: #e3c98e; background: #3a3727; }
.ev-key { color: #ddd; }
.ev-payload { color: #888; }

/* Profile tab */
.pf-toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid #2a2a2a;
}
.pf-btn {
  background: #161616;
  color: #ccc;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 2px 8px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.pf-btn:hover { background: #222; }
.pf-status { color: #888; font-size: 10px; }
.pf-table-wrap { max-height: calc(100% - 34px); overflow-y: auto; }
.pf-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.pf-table th {
  text-align: left;
  padding: 4px 6px;
  background: #181818;
  color: #888;
  border-bottom: 1px solid #333;
  cursor: pointer;
  position: sticky;
  top: 0;
}
.pf-table th:hover { color: #ccc; }
.pf-table td {
  padding: 2px 6px;
  border-bottom: 1px dotted #2a2a2a;
  color: #ddd;
}
.pf-table tr:hover td { background: #222; }

/* Flame tab */
.fl-tab { display: flex; flex-direction: column; height: 100%; }
.fl-toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.fl-btn {
  background: #161616;
  color: #ccc;
  border: 1px solid #333;
  border-radius: 3px;
  padding: 2px 8px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.fl-btn:hover { background: #222; }
.fl-status { color: #888; font-size: 10px; }
.fl-split { display: flex; gap: 6px; flex: 1; min-height: 0; }
.fl-list {
  width: 30%;
  min-width: 110px;
  max-width: 180px;
  overflow-y: auto;
  border-right: 1px solid #2a2a2a;
  padding-right: 4px;
}
.fl-cas {
  display: flex;
  flex-direction: column;
  padding: 3px 6px;
  border-bottom: 1px dotted #2a2a2a;
  cursor: pointer;
  font-size: 11px;
}
.fl-cas:hover { background: #222; }
.fl-cas.selected { background: #2d3a2d; color: #9be3a8; }
.fl-cas-id { font-weight: 600; }
.fl-cas-meta { color: #888; font-size: 10px; }
.fl-cas.selected .fl-cas-meta { color: #7fc991; }
.fl-chart { flex: 1; overflow: auto; min-width: 0; }
.fl-head {
  font-size: 10px;
  color: #888;
  padding: 2px 4px 4px;
  border-bottom: 1px solid #2a2a2a;
  margin-bottom: 4px;
}
.fl-flame { position: relative; min-width: 100%; }
.fl-frame {
  position: absolute;
  height: 13px;
  box-sizing: border-box;
  border: 1px solid #333;
  border-radius: 2px;
  font-size: 9px;
  line-height: 11px;
  padding: 0 3px;
  overflow: hidden;
  white-space: nowrap;
  cursor: default;
  background: #2d3447;
  color: #9bb3e3;
}
.fl-frame:hover { filter: brightness(1.4); z-index: 1; }
.fl-frame[data-verb="BU1"], .fl-frame[data-verb="BU2"], .fl-frame[data-verb="XU0"] {
  background: #2d3447; color: #9bb3e3;
}
.fl-frame[data-verb="BI0"], .fl-frame[data-verb="BI0A"], .fl-frame[data-verb="BI2"] {
  background: #2d3a2d; color: #9be3a8;
}
.fl-frame[data-verb="BR1"], .fl-frame[data-verb="BR1A"], .fl-frame[data-verb="BR2"], .fl-frame[data-verb="XR0"] {
  background: #3a2d2d; color: #e39b9b;
}
.fl-frame[data-verb="BMV1"] { background: #3a3727; color: #e3c98e; }
.fl-frame-label { pointer-events: none; }

/* Replay tab */
.rp-tab { display: flex; flex-direction: column; height: 100%; }
.rp-toolbar {
  display: flex; gap: 6px; align-items: center;
  margin-bottom: 6px; padding-bottom: 6px;
  border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.rp-btn {
  background: #161616; color: #ccc; border: 1px solid #333; border-radius: 3px;
  padding: 2px 8px; font-family: inherit; font-size: 11px; cursor: pointer;
}
.rp-btn:hover { background: #222; }
.rp-status { color: #888; font-size: 10px; }
.rp-checkbox {
  display: flex; align-items: center; gap: 4px;
  color: #888; cursor: pointer; white-space: nowrap; font-size: 11px;
  margin-left: auto;
}
.rp-scrub {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 6px; padding: 4px 0;
  border-bottom: 1px dotted #2a2a2a;
  flex-shrink: 0;
}
.rp-slider { flex: 1; min-width: 0; cursor: pointer; }
.rp-scrub-label {
  color: #9be3a8; font-size: 10px; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.rp-snapshot {
  flex: 1; overflow: auto;
  margin: 0; padding: 6px 8px;
  background: #141414; color: #ddd;
  border: 1px solid #2a2a2a; border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Hover inspector sidecar. Mounted inside the panel's shadow root and
   positioned with viewport coords so it follows the cursor. */
.ho-sidecar {
  position: fixed;
  z-index: 2147483647;
  background: #1a1a1a;
  color: #e6e6e6;
  border: 1px solid #333;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  padding: 6px 8px;
  min-width: 220px;
  max-width: 320px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  transition: left 50ms linear, top 50ms linear;
}
.ho-sidecar.pinned {
  pointer-events: auto;
  border-color: #9bb3e3;
  box-shadow: 0 0 0 1px #9bb3e3, 0 4px 16px rgba(0, 0, 0, 0.45);
}
.ho-head {
  font-weight: 600;
  color: #9bb3e3;
  padding-bottom: 3px;
  margin-bottom: 4px;
  border-bottom: 1px solid #2a2a2a;
}
.ho-chain { color: #ddd; word-break: break-all; }
.ho-ctor  { color: #888; }
.ho-value { color: #9be3a8; word-break: break-all; }
.ho-sinks { color: #888; }
.ho-empty { color: #e39b9b; font-style: italic; }
.ho-hint  {
  margin-top: 4px;
  padding-top: 3px;
  border-top: 1px dotted #2a2a2a;
  color: #666;
  font-size: 10px;
}

.__ripple_highlight {
  outline: 2px solid #9be3a8 !important;
  outline-offset: 2px;
}
`
