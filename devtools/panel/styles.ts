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
`
