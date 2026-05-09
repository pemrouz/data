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

.__ripple_highlight {
  outline: 2px solid #9be3a8 !important;
  outline-offset: 2px;
}
`
