/**
 * SplitPane — renders collapsible command blocks
 * each containing a 50/50 side-by-side diff grid.
 *
 * Expected data shape (per node):
 * {
 *   show_version:          { nodeId, state, version, ... },
 *   show_interface_status: { eth1/1: {...}, eth1/2: {...} }
 * }
 */
const SplitPane = (() => {

    // ── Command display labels ──────────────────────────────────
    const COMMAND_LABELS = {
      show_version:          'show version',
      show_interface_status: 'show interface status'
    };
  
    // ── CSS ────────────────────────────────────────────────────
    const CSS = `
      /* ── Collapsible block wrapper ── */
      .sp-block {
        border: 1px solid #30363d;
        border-radius: 8px;
        margin-bottom: 12px;
        overflow: hidden;
      }
  
      /* ── Collapsible header bar ── */
      .sp-block-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px;
        background: #161b22;
        cursor: pointer;
        user-select: none;
        border-bottom: 1px solid transparent;
        transition: background 0.15s;
        gap: 12px;
      }
  
      .sp-block-header:hover { background: #1c2128; }
  
      .sp-block-header.expanded {
        border-bottom-color: #30363d;
      }
  
      .sp-block-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }
  
      .sp-chevron {
        color: #58a6ff;
        font-size: 0.75rem;
        transition: transform 0.2s;
        flex-shrink: 0;
        width: 16px;
        text-align: center;
      }
  
      .sp-chevron.open { transform: rotate(90deg); }
  
      .sp-cmd-name {
        font-family: 'Courier New', monospace;
        font-size: 0.85rem;
        font-weight: 700;
        color: #c9d1d9;
      }
  
      .sp-cmd-stats {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
  
      .sp-stat-pill {
        font-size: 0.68rem;
        padding: 2px 7px;
        border-radius: 10px;
        font-weight: 600;
      }
  
      .sp-pill-changed {
        background: rgba(210,153,34,0.15);
        color: #d29922;
        border: 1px solid rgba(210,153,34,0.3);
      }
      .sp-pill-added {
        background: rgba(63,185,80,0.12);
        color: #3fb950;
        border: 1px solid rgba(63,185,80,0.25);
      }
      .sp-pill-removed {
        background: rgba(248,81,73,0.12);
        color: #f85149;
        border: 1px solid rgba(248,81,73,0.25);
      }
      .sp-pill-match {
        background: rgba(139,148,158,0.1);
        color: #8b949e;
        border: 1px solid #30363d;
      }
  
      /* ── Run Live button per block ── */
      .sp-run-live-btn {
        background: #1f6feb;
        color: #fff;
        border: none;
        border-radius: 5px;
        padding: 5px 12px;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
        transition: background 0.15s;
        flex-shrink: 0;
      }
  
      .sp-run-live-btn:hover:not(:disabled) { background: #388bfd; }
      .sp-run-live-btn:disabled {
        background: #21262d;
        color: #484f58;
        cursor: not-allowed;
      }
  
      /* ── Collapsible body ── */
      .sp-block-body {
        display: none;
        overflow: hidden;
      }
  
      .sp-block-body.open { display: flex; }
  
      /* ── Left / Right panes ── */
      .sp-pane {
        flex: 1;
        overflow-y: auto;
        max-height: 420px;
        padding: 12px;
      }
  
      .sp-pane.left { border-right: 2px solid #30363d; }
  
      /* ── Pane sub-header ── */
      .sp-pane-header {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 4px 6px 8px;
        border-bottom: 1px solid #21262d;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
  
      .sp-pane-header.left-hdr  { color: #d29922; }
      .sp-pane-header.right-hdr { color: #3fb950; }
  
      .sp-pane-ts {
        font-size: 0.65rem;
        color: #6e7681;
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
      }
  
      /* ── Diff Table ── */
      .sp-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.78rem;
        font-family: 'Courier New', monospace;
      }
  
      .sp-table th {
        text-align: left;
        padding: 5px 8px;
        font-size: 0.68rem;
        color: #6e7681;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        border-bottom: 1px solid #30363d;
        position: sticky;
        top: 0;
        background: #0d1117;
        z-index: 1;
      }
  
      .sp-table td {
        padding: 5px 8px;
        border-bottom: 1px solid #21262d;
        vertical-align: top;
        word-break: break-all;
        color: #c9d1d9;
      }
  
      .sp-table tr.row-changed td { background: rgba(210,153,34,0.07); }
      .sp-table tr.row-added   td { background: rgba(63,185,80,0.07);  }
      .sp-table tr.row-removed td { background: rgba(248,81,73,0.07);  }
  
      .sp-table td.key-col   { color: #8b949e; width: 40%; }
      .sp-table td.val-changed { color: #d29922; font-weight: 600; }
      .sp-table td.val-added   { color: #3fb950; font-weight: 600; }
      .sp-table td.val-removed { color: #f85149; font-weight: 600; }
  
      .sp-section-header td {
        background: #161b22 !important;
        color: #58a6ff !important;
        font-weight: 700;
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 7px 8px 4px;
        border-bottom: 1px solid #30363d;
      }
  
      /* ── Empty / placeholder states ── */
      .sp-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
        color: #484f58;
        gap: 8px;
        font-size: 0.82rem;
        text-align: center;
      }
  
      .sp-empty-icon { font-size: 1.8rem; }
  
      /* ── No data loaded state ── */
      .sp-no-data {
        padding: 40px 24px;
        text-align: center;
        color: #484f58;
        font-size: 0.9rem;
      }
    `;
  
    let stylesInjected = false;
  
    function injectStyles() {
      if (stylesInjected) return;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      stylesInjected = true;
    }
  
    // ── Flatten nested object to dot-notation ──────────────────
    function flatten(obj, prefix = '') {
      const out = {};
      for (const [k, v] of Object.entries(obj || {})) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          Object.assign(out, flatten(v, key));
        } else {
          out[key] = Array.isArray(v) ? JSON.stringify(v) : String(v ?? '');
        }
      }
      return out;
    }
  
    // ── Build diff map ─────────────────────────────────────────
    function buildDiff(leftFlat, rightFlat) {
      const keys = new Set([
        ...Object.keys(leftFlat),
        ...Object.keys(rightFlat)
      ]);
      const diff  = {};
      const stats = { changed: 0, added: 0, removed: 0, matching: 0 };
  
      for (const key of keys) {
        const lv = leftFlat[key];
        const rv = rightFlat[key];
  
        if      (lv === undefined) { diff[key] = { status: 'added',   left: '',  right: rv }; stats.added++;    }
        else if (rv === undefined) { diff[key] = { status: 'removed',  left: lv, right: '' }; stats.removed++;  }
        else if (lv !== rv)        { diff[key] = { status: 'changed',  left: lv, right: rv }; stats.changed++;  }
        else                       { diff[key] = { status: 'match',    left: lv, right: rv }; stats.matching++; }
      }
      return { diff, stats };
    }
  
    // ── Build one side of the diff table ──────────────────────
    function buildTable(diff, side) {
      const table = document.createElement('table');
      table.className = 'sp-table';
  
      const thead = table.createTHead();
      const hrow  = thead.insertRow();
      ['Key', 'Value'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        hrow.appendChild(th);
      });
  
      const tbody      = table.createTBody();
      let   lastSection = '';
  
      for (const [key, entry] of Object.entries(diff)) {
        const section = key.split('.')[0];
  
        if (section !== lastSection) {
          const sr = tbody.insertRow();
          sr.className = 'sp-section-header';
          const sd = sr.insertCell();
          sd.colSpan     = 2;
          sd.textContent = section;
          lastSection    = section;
        }
  
        const row = tbody.insertRow();
        if (entry.status !== 'match') row.classList.add(`row-${entry.status}`);
  
        const keyTd = row.insertCell();
        keyTd.className   = 'key-col';
        keyTd.textContent = key.split('.').slice(1).join('.') || key;
  
        const valTd = row.insertCell();
        const value = side === 'left' ? entry.left : entry.right;
        valTd.textContent = value;
  
        if (entry.status !== 'match') {
          if (side === 'left'  && entry.status === 'removed') valTd.className = 'val-removed';
          if (side === 'left'  && entry.status === 'changed') valTd.className = 'val-changed';
          if (side === 'right' && entry.status === 'added')   valTd.className = 'val-added';
          if (side === 'right' && entry.status === 'changed') valTd.className = 'val-changed';
        }
      }
      return table;
    }
  
    // ── Build one collapsible command block ───────────────────
    function buildCommandBlock(cmdKey, leftNodeData, rightNodeData, timestamps, onRunLive) {
      const label     = COMMAND_LABELS[cmdKey] || cmdKey;
      const leftData  = leftNodeData?.[cmdKey]  ?? null;
      const rightData = rightNodeData?.[cmdKey] ?? null;
  
      const leftFlat  = leftData  ? flatten(leftData)  : {};
      const rightFlat = rightData ? flatten(rightData)  : {};
      const { diff, stats } = buildDiff(leftFlat, rightFlat);
  
      // ── Outer block ──────────────────────────────────────────
      const block = document.createElement('div');
      block.className = 'sp-block';
  
      // ── Header ───────────────────────────────────────────────
      const header = document.createElement('div');
      header.className = 'sp-block-header';
  
      // Left side of header
      const headerLeft = document.createElement('div');
      headerLeft.className = 'sp-block-header-left';
  
      const chevron = document.createElement('span');
      chevron.className   = 'sp-chevron';
      chevron.textContent = '›';
  
      const cmdName = document.createElement('span');
      cmdName.className   = 'sp-cmd-name';
      cmdName.textContent = label;
  
      // Stat pills — only show when there is data on both sides
      const pillsWrap = document.createElement('div');
      pillsWrap.className = 'sp-cmd-stats';
  
      if (leftData && rightData) {
        const pillDefs = [
          { count: stats.changed,  cls: 'sp-pill-changed', label: 'changed' },
          { count: stats.added,    cls: 'sp-pill-added',   label: 'added'   },
          { count: stats.removed,  cls: 'sp-pill-removed', label: 'removed' },
          { count: stats.matching, cls: 'sp-pill-match',   label: 'match'   }
        ];
        pillDefs.forEach(({ count, cls, label: pl }) => {
          if (count === 0) return;
          const pill = document.createElement('span');
          pill.className   = `sp-stat-pill ${cls}`;
          pill.textContent = `${count} ${pl}`;
          pillsWrap.appendChild(pill);
        });
      }
  
      headerLeft.appendChild(chevron);
      headerLeft.appendChild(cmdName);
      headerLeft.appendChild(pillsWrap);
  
      // Run Live button — right side of header
      const runBtn = document.createElement('button');
      runBtn.className   = 'sp-run-live-btn';
      runBtn.textContent = '▶ Run Live';
      runBtn.disabled    = !onRunLive;
      runBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't toggle collapse
        if (onRunLive) onRunLive(cmdKey, runBtn);
      });
  
      header.appendChild(headerLeft);
      header.appendChild(runBtn);
  
      // ── Body ─────────────────────────────────────────────────
      const body = document.createElement('div');
      body.className = 'sp-block-body';
  
      // Left pane
      const leftPane = document.createElement('div');
      leftPane.className = 'sp-pane left';
  
      const leftHdr = document.createElement('div');
      leftHdr.className = 'sp-pane-header left-hdr';
      leftHdr.innerHTML = `
        <span>Historical Snapshot</span>
        <span class="sp-pane-ts">${timestamps?.left || ''}</span>
      `;
      leftPane.appendChild(leftHdr);
  
      if (leftData) {
        leftPane.appendChild(buildTable(diff, 'left'));
      } else {
        leftPane.innerHTML += `
          <div class="sp-empty">
            <div class="sp-empty-icon">📂</div>
            <div>No historical data for this command</div>
          </div>`;
      }
  
      // Right pane
      const rightPane = document.createElement('div');
      rightPane.className = 'sp-pane right';
      rightPane.id        = `live-pane-${cmdKey}`;
  
      const rightHdr = document.createElement('div');
      rightHdr.className = 'sp-pane-header right-hdr';
      rightHdr.innerHTML = `
        <span>Live / New Data</span>
        <span class="sp-pane-ts" id="live-ts-${cmdKey}">${timestamps?.right || ''}</span>
      `;
      rightPane.appendChild(rightHdr);
  
      if (rightData) {
        rightPane.appendChild(buildTable(diff, 'right'));
      } else {
        rightPane.innerHTML += `
          <div class="sp-empty" id="live-empty-${cmdKey}">
            <div class="sp-empty-icon">▶</div>
            <div>Click Run Live to collect data</div>
          </div>`;
      }
  
      // Sync scroll
      let syncing = false;
      leftPane.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        rightPane.scrollTop = leftPane.scrollTop;
        syncing = false;
      });
      rightPane.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        leftPane.scrollTop = rightPane.scrollTop;
        syncing = false;
      });
  
      body.appendChild(leftPane);
      body.appendChild(rightPane);
  
      // ── Toggle collapse ───────────────────────────────────────
      header.addEventListener('click', () => {
        const isOpen = body.classList.contains('open');
        body.classList.toggle('open', !isOpen);
        header.classList.toggle('expanded', !isOpen);
        chevron.classList.toggle('open', !isOpen);
      });
  
      block.appendChild(header);
      block.appendChild(body);
  
      return { block, stats };
    }
  
    // ── Public render ──────────────────────────────────────────
    /**
     * render(container, leftNodeData, rightNodeData, options)
     *
     * leftNodeData / rightNodeData shape:
     * {
     *   show_version:          { ...fields },
     *   show_interface_status: { ...fields }
     * }
     *
     * options: {
     *   commands:    ['show_version', 'show_interface_status'],
     *   timestamps:  { left: '...', right: '...' },
     *   onRunLive:   function(cmdKey, btnEl) { ... }  // callback
     * }
     *
     * Returns: { changed, added, removed, matching }  (totals)
     */
    function render(container, leftNodeData, rightNodeData, options = {}) {
      injectStyles();
      container.innerHTML = '';
  
      const {
        commands   = Object.keys(leftNodeData || rightNodeData || {}),
        timestamps = {},
        onRunLive  = null
      } = options;
  
      if (!commands || commands.length === 0) {
        container.innerHTML = `
          <div class="sp-no-data">
            <div style="font-size:2.5rem; margin-bottom:12px;">📂</div>
            Load a snapshot to begin comparison
          </div>`;
        return { changed: 0, added: 0, removed: 0, matching: 0 };
      }
  
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        width: 100%; height: 100%;
        overflow-y: auto; padding: 12px;
      `;
  
      const totals = { changed: 0, added: 0, removed: 0, matching: 0 };
  
      commands.forEach(cmdKey => {
        const { block, stats } = buildCommandBlock(
          cmdKey,
          leftNodeData,
          rightNodeData,
          timestamps,
          onRunLive
        );
  
        totals.changed  += stats.changed;
        totals.added    += stats.added;
        totals.removed  += stats.removed;
        totals.matching += stats.matching;
  
        wrapper.appendChild(block);
      });
  
      container.appendChild(wrapper);
      return totals;
    }
  
    // ── Update one live pane in-place (no full re-render) ──────
    /**
     * updateLivePane(cmdKey, rightNodeData, timestamp)
     * Replaces only the right pane content for a specific command
     * without collapsing other blocks.
     */
    function updateLivePane(cmdKey, leftNodeData, rightNodeData, timestamp) {
      const pane = document.getElementById(`live-pane-${cmdKey}`);
      if (!pane) return { changed: 0, added: 0, removed: 0, matching: 0 };
  
      const leftData  = leftNodeData?.[cmdKey]  ?? null;
      const rightData = rightNodeData?.[cmdKey] ?? null;
  
      const leftFlat  = leftData  ? flatten(leftData)  : {};
      const rightFlat = rightData ? flatten(rightData)  : {};
      const { diff, stats } = buildDiff(leftFlat, rightFlat);
  
      // Update timestamp label
      const tsEl = document.getElementById(`live-ts-${cmdKey}`);
      if (tsEl && timestamp) tsEl.textContent = timestamp;
  
      // Remove old content after the header
      const header = pane.querySelector('.sp-pane-header');
      while (pane.children.length > 1) pane.removeChild(pane.lastChild);
  
      if (rightData) {
        pane.appendChild(buildTable(diff, 'right'));
      } else {
        const empty = document.createElement('div');
        empty.className = 'sp-empty';
        empty.innerHTML = `
          <div class="sp-empty-icon">⚠</div>
          <div>No data returned for this command</div>`;
        pane.appendChild(empty);
      }
  
      return stats;
    }
  
    return { render, updateLivePane };
  })();