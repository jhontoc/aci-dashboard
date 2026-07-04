/**
 * SplitPane — renders a 50/50 side-by-side diff grid
 * and returns change statistics.
 */
const SplitPane = (() => {

    // ── Styles (injected once) ──────────────────────────────────
    const CSS = `
      .sp-container {
        display: flex;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .sp-pane {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }
      .sp-pane.left  { border-right: 2px solid #30363d; }
  
      .sp-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #484f58;
        gap: 10px;
        font-size: 0.88rem;
      }
  
      /* ── Diff Table ── */
      .sp-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
        font-family: 'Courier New', monospace;
      }
  
      .sp-table th {
        text-align: left;
        padding: 6px 10px;
        font-size: 0.7rem;
        color: #6e7681;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid #30363d;
        position: sticky;
        top: 0;
        background: #0d1117;
        z-index: 1;
      }
  
      .sp-table td {
        padding: 6px 10px;
        border-bottom: 1px solid #21262d;
        vertical-align: top;
        word-break: break-all;
        color: #c9d1d9;
      }
  
      .sp-table tr.row-changed td { background: rgba(210,153,34,0.08); }
      .sp-table tr.row-added   td { background: rgba(63,185,80,0.08);  }
      .sp-table tr.row-removed td { background: rgba(248,81,73,0.08);  }
  
      .sp-table td.key-col   { color: #8b949e; width: 38%; }
      .sp-table td.val-col   { color: #c9d1d9; }
  
      .sp-table td.val-changed { color: #d29922; font-weight: 600; }
      .sp-table td.val-added   { color: #3fb950; font-weight: 600; }
      .sp-table td.val-removed { color: #f85149; font-weight: 600; }
  
      /* ── Section headers in the table ── */
      .sp-section-header td {
        background: #161b22 !important;
        color: #58a6ff !important;
        font-weight: 700;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 8px 10px 4px;
        border-bottom: 1px solid #30363d;
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
  
    // ── Flatten JSON to key-value pairs ────────────────────────
    function flatten(obj, prefix = '') {
      const result = {};
      for (const [key, val] of Object.entries(obj || {})) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          Object.assign(result, flatten(val, fullKey));
        } else {
          result[fullKey] = Array.isArray(val) ? JSON.stringify(val) : String(val ?? '');
        }
      }
      return result;
    }
  
    // ── Build diff map ─────────────────────────────────────────
    function buildDiff(leftFlat, rightFlat) {
      const allKeys = new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)]);
      const diff    = {};
  
      for (const key of allKeys) {
        const lv = leftFlat[key];
        const rv = rightFlat[key];
  
        if      (lv === undefined)  diff[key] = { status: 'added',   left: '',  right: rv };
        else if (rv === undefined)  diff[key] = { status: 'removed',  left: lv, right: '' };
        else if (lv !== rv)         diff[key] = { status: 'changed',  left: lv, right: rv };
        else                        diff[key] = { status: 'match',    left: lv, right: rv };
      }
      return diff;
    }
  
    // ── Build one pane table ───────────────────────────────────
    function buildTable(diff, side) {
      const table = document.createElement('table');
      table.className = 'sp-table';
  
      const thead = table.createTHead();
      const hrow  = thead.insertRow();
      ['Key', 'Value'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        hrow.appendChild(th);
      });
  
      const tbody = table.createTBody();
      let   lastSection = '';
  
      for (const [key, entry] of Object.entries(diff)) {
        // Section grouping by first path segment
        const section = key.split('.')[0];
        if (section !== lastSection) {
          const secRow = tbody.insertRow();
          secRow.className = 'sp-section-header';
          const secTd = secRow.insertCell();
          secTd.colSpan = 2;
          secTd.textContent = section;
          lastSection = section;
        }
  
        const row = tbody.insertRow();
        if (entry.status !== 'match') row.classList.add(`row-${entry.status}`);
  
        const keyTd = row.insertCell();
        keyTd.className = 'key-col';
        keyTd.textContent = key.split('.').slice(1).join('.') || key;
  
        const valTd = row.insertCell();
        valTd.className = 'val-col';
  
        const value = side === 'left' ? entry.left : entry.right;
        valTd.textContent = value;
  
        if (entry.status !== 'match') {
          if (side === 'left'  && entry.status === 'removed') valTd.className += ' val-removed';
          if (side === 'left'  && entry.status === 'changed') valTd.className += ' val-changed';
          if (side === 'right' && entry.status === 'added')   valTd.className += ' val-added';
          if (side === 'right' && entry.status === 'changed') valTd.className += ' val-changed';
        }
      }
  
      return table;
    }
  
    // ── Public render method ───────────────────────────────────
    function render(container, leftData, rightData) {
      injectStyles();
      container.innerHTML = '';
  
      const wrapper = document.createElement('div');
      wrapper.className = 'sp-container';
  
      const leftPane  = document.createElement('div');
      leftPane.className  = 'sp-pane left';
  
      const rightPane = document.createElement('div');
      rightPane.className = 'sp-pane right';
  
      // Stats counters
      let stats = { changed: 0, added: 0, removed: 0, matching: 0 };
  
      if (!leftData && !rightData) {
        [leftPane, rightPane].forEach(pane => {
          pane.innerHTML = `
            <div class="sp-empty">
              <div style="font-size:2rem;">📂</div>
              <div>Load a snapshot to begin</div>
            </div>`;
        });
      } else {
        const leftFlat  = leftData  ? flatten(leftData)  : {};
        const rightFlat = rightData ? flatten(rightData) : {};
        const diff      = buildDiff(leftFlat, rightFlat);
  
        // Tally stats
        for (const entry of Object.values(diff)) {
          if      (entry.status === 'changed')  stats.changed++;
          else if (entry.status === 'added')    stats.added++;
          else if (entry.status === 'removed')  stats.removed++;
          else                                  stats.matching++;
        }
  
        leftPane.appendChild(
          leftData
            ? buildTable(diff, 'left')
            : (() => {
                const d = document.createElement('div');
                d.className = 'sp-empty';
                d.innerHTML = '<div>No historical data</div>';
                return d;
              })()
        );
  
        rightPane.appendChild(
          rightData
            ? buildTable(diff, 'right')
            : (() => {
                const d = document.createElement('div');
                d.className = 'sp-empty';
                d.innerHTML = '<div style="font-size:2rem;">▶</div><div>Run Live to populate</div>';
                return d;
              })()
        );
  
        // Sync scroll between panes
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
      }
  
      wrapper.appendChild(leftPane);
      wrapper.appendChild(rightPane);
      container.appendChild(wrapper);
  
      return stats;
    }
  
    return { render };
  })();