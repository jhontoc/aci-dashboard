/**
 * split-pane.js
 *
 * Renders collapsible command blocks inside the ACI Compare page.
 * Each block contains a 50/50 side-by-side diff table for one command.
 *
 */

var SplitPane = (function () {

  // ── Command display label map ───────────────────────────────
  var COMMAND_LABELS = {
    show_version:          'show version',
    show_interface_status: 'show interface status'
  };

  // ────────────────────────────────────────────────────────────
  //  CSS — injected once into <head>
  // ────────────────────────────────────────────────────────────
  var CSS = [

    /* ── Outer scrollable wrapper ── */
    '.sp-wrapper {',
    '  width: 100%;',
    '  height: 100%;',
    '  overflow-y: auto;',
    '  padding: 12px;',
    '}',

    /* ── Collapsible block ── */
    '.sp-block {',
    '  border: 1px solid #30363d;',
    '  border-radius: 8px;',
    '  margin-bottom: 12px;',
    '  overflow: hidden;',
    '}',

    /* ── Block header bar ── */
    '.sp-block-header {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  padding: 10px 16px;',
    '  background: #161b22;',
    '  cursor: pointer;',
    '  user-select: none;',
    '  border-bottom: 1px solid transparent;',
    '  transition: background 0.15s;',
    '  gap: 12px;',
    '}',

    '.sp-block-header:hover { background: #1c2128; }',

    '.sp-block-header.expanded {',
    '  border-bottom-color: #30363d;',
    '}',

    '.sp-block-header-left {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 10px;',
    '  flex: 1;',
    '  min-width: 0;',
    '}',

    /* ── Chevron toggle icon ── */
    '.sp-chevron {',
    '  color: #58a6ff;',
    '  font-size: 0.78rem;',
    '  transition: transform 0.2s;',
    '  flex-shrink: 0;',
    '  width: 16px;',
    '  text-align: center;',
    '  display: inline-block;',
    '}',

    '.sp-chevron.open { transform: rotate(90deg); }',

    /* ── Command name label ── */
    '.sp-cmd-name {',
    '  font-family: "Courier New", monospace;',
    '  font-size: 0.85rem;',
    '  font-weight: 700;',
    '  color: #c9d1d9;',
    '}',

    /* ── Stat pills row ── */
    '.sp-cmd-stats {',
    '  display: flex;',
    '  gap: 6px;',
    '  flex-wrap: wrap;',
    '}',

    '.sp-stat-pill {',
    '  font-size: 0.68rem;',
    '  padding: 2px 7px;',
    '  border-radius: 10px;',
    '  font-weight: 600;',
    '}',

    '.sp-pill-changed {',
    '  background: rgba(210,153,34,0.15);',
    '  color: #d29922;',
    '  border: 1px solid rgba(210,153,34,0.3);',
    '}',

    '.sp-pill-added {',
    '  background: rgba(63,185,80,0.12);',
    '  color: #3fb950;',
    '  border: 1px solid rgba(63,185,80,0.25);',
    '}',

    '.sp-pill-removed {',
    '  background: rgba(248,81,73,0.12);',
    '  color: #f85149;',
    '  border: 1px solid rgba(248,81,73,0.25);',
    '}',

    '.sp-pill-match {',
    '  background: rgba(139,148,158,0.1);',
    '  color: #8b949e;',
    '  border: 1px solid #30363d;',
    '}',

    /* ── Run Live button per block ── */
    '.sp-run-live-btn {',
    '  background: #1f6feb;',
    '  color: #fff;',
    '  border: none;',
    '  border-radius: 5px;',
    '  padding: 5px 12px;',
    '  font-size: 0.75rem;',
    '  font-weight: 600;',
    '  cursor: pointer;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 5px;',
    '  white-space: nowrap;',
    '  transition: background 0.15s;',
    '  flex-shrink: 0;',
    '}',

    '.sp-run-live-btn:hover { background: #388bfd; }',

    '.sp-run-live-btn:disabled {',
    '  background: #21262d;',
    '  color: #484f58;',
    '  cursor: not-allowed;',
    '}',

    /* ── Collapsible body ── */
    '.sp-block-body {',
    '  display: none;',
    '  overflow: hidden;',
    '}',

    '.sp-block-body.open { display: flex; }',

    /* ── Left / Right panes ── */
    '.sp-pane {',
    '  flex: 1;',
    '  overflow-y: auto;',
    '  max-height: 420px;',
    '  padding: 12px;',
    '}',

    '.sp-pane.left { border-right: 2px solid #30363d; }',

    /* ── Pane sub-header ── */
    '.sp-pane-header {',
    '  font-size: 0.7rem;',
    '  font-weight: 700;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.5px;',
    '  padding: 4px 6px 8px;',
    '  border-bottom: 1px solid #21262d;',
    '  margin-bottom: 8px;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '}',

    '.sp-pane-header.left-hdr  { color: #d29922; }',
    '.sp-pane-header.right-hdr { color: #3fb950; }',

    '.sp-pane-ts {',
    '  font-size: 0.65rem;',
    '  color: #6e7681;',
    '  font-weight: 400;',
    '  text-transform: none;',
    '  letter-spacing: 0;',
    '}',

    /* ── Diff Table ── */
    '.sp-table {',
    '  width: 100%;',
    '  border-collapse: collapse;',
    '  font-size: 0.78rem;',
    '  font-family: "Courier New", monospace;',
    '}',

    '.sp-table th {',
    '  text-align: left;',
    '  padding: 5px 8px;',
    '  font-size: 0.68rem;',
    '  color: #6e7681;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.4px;',
    '  border-bottom: 1px solid #30363d;',
    '  position: sticky;',
    '  top: 0;',
    '  background: #0d1117;',
    '  z-index: 1;',
    '}',

    '.sp-table td {',
    '  padding: 5px 8px;',
    '  border-bottom: 1px solid #21262d;',
    '  vertical-align: top;',
    '  word-break: break-all;',
    '  color: #c9d1d9;',
    '}',

    '.sp-table tr.row-changed td { background: rgba(210,153,34,0.07); }',
    '.sp-table tr.row-added   td { background: rgba(63,185,80,0.07);  }',
    '.sp-table tr.row-removed td { background: rgba(248,81,73,0.07);  }',

    '.sp-table td.key-col     { color: #8b949e; width: 40%; }',
    '.sp-table td.val-changed { color: #d29922; font-weight: 600; }',
    '.sp-table td.val-added   { color: #3fb950; font-weight: 600; }',
    '.sp-table td.val-removed { color: #f85149; font-weight: 600; }',

    /* ── Section grouping header row ── */
    '.sp-section-header td {',
    '  background: #161b22 !important;',
    '  color: #58a6ff !important;',
    '  font-weight: 700;',
    '  font-size: 0.68rem;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.4px;',
    '  padding: 7px 8px 4px;',
    '  border-bottom: 1px solid #30363d;',
    '}',

    /* ── Empty / placeholder states ── */
    '.sp-empty {',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: center;',
    '  justify-content: center;',
    '  padding: 32px 16px;',
    '  color: #484f58;',
    '  gap: 8px;',
    '  font-size: 0.82rem;',
    '  text-align: center;',
    '}',

    '.sp-empty-icon { font-size: 1.8rem; }',

    /* ── Full page no-data state ── */
    '.sp-no-data {',
    '  width: 100%;',
    '  padding: 60px 24px;',
    '  text-align: center;',
    '  color: #484f58;',
    '  font-size: 0.9rem;',
    '}'

  ].join('\n');

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    var style       = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  // ────────────────────────────────────────────────────────────
  //  flatten — dot-notation key-value pairs from nested object
  //  Node.js 10 compatible — no ?? or ?. used
  // ────────────────────────────────────────────────────────────
  function flatten(obj, prefix) {
    prefix  = prefix || '';
    var out     = {};
    var entries = Object.entries(obj || {});

    for (var i = 0; i < entries.length; i++) {
      var k   = entries[i][0];
      var v   = entries[i][1];
      var key = prefix ? prefix + '.' + k : k;

      if (
        v !== null &&
        v !== undefined &&
        typeof v === 'object' &&
        !Array.isArray(v)
      ) {
        var nested     = flatten(v, key);
        var nestedKeys = Object.keys(nested);
        for (var j = 0; j < nestedKeys.length; j++) {
          out[nestedKeys[j]] = nested[nestedKeys[j]];
        }
      } else {
        // Node.js 10 fix — explicit check instead of ??
        var safeVal = (v !== null && v !== undefined) ? v : '';
        out[key] = Array.isArray(v) ? JSON.stringify(v) : String(safeVal);
      }
    }
    return out;
  }

  // ────────────────────────────────────────────────────────────
  //  buildDiff — compare two flattened objects
  //
  //  Returns:
  //  {
  //    diff:  { key: { status, left, right } },
  //    stats: { changed, added, removed, matching }
  //  }
  // ────────────────────────────────────────────────────────────
  function buildDiff(leftFlat, rightFlat) {
    var allKeysMap = {};
    var leftKeys   = Object.keys(leftFlat);
    var rightKeys  = Object.keys(rightFlat);

    for (var li = 0; li < leftKeys.length; li++) {
      allKeysMap[leftKeys[li]] = true;
    }
    for (var ri = 0; ri < rightKeys.length; ri++) {
      allKeysMap[rightKeys[ri]] = true;
    }

    var allKeys = Object.keys(allKeysMap);
    var diff    = {};
    var stats   = { changed: 0, added: 0, removed: 0, matching: 0 };

    for (var i = 0; i < allKeys.length; i++) {
      var key = allKeys[i];
      var lv  = leftFlat[key];
      var rv  = rightFlat[key];

      if (lv === undefined) {
        diff[key] = { status: 'added',   left: '',  right: rv };
        stats.added++;
      } else if (rv === undefined) {
        diff[key] = { status: 'removed', left: lv,  right: '' };
        stats.removed++;
      } else if (lv !== rv) {
        diff[key] = { status: 'changed', left: lv,  right: rv };
        stats.changed++;
      } else {
        diff[key] = { status: 'match',   left: lv,  right: rv };
        stats.matching++;
      }
    }

    return { diff: diff, stats: stats };
  }

  // ────────────────────────────────────────────────────────────
  //  buildTable — construct one side of the diff table
  //
  //  side: 'left' | 'right'
  // ────────────────────────────────────────────────────────────
  function buildTable(diff, side) {
    var table   = document.createElement('table');
    table.className = 'sp-table';

    // ── Table header ─────────────────────────────────────────
    var thead  = table.createTHead();
    var hrow   = thead.insertRow();
    var labels = ['Key', 'Value'];

    for (var hi = 0; hi < labels.length; hi++) {
      var th       = document.createElement('th');
      th.textContent = labels[hi];
      hrow.appendChild(th);
    }

    // ── Table body ───────────────────────────────────────────
    var tbody       = table.createTBody();
    var lastSection = '';
    var diffKeys    = Object.keys(diff);

    for (var di = 0; di < diffKeys.length; di++) {
      var key   = diffKeys[di];
      var entry = diff[key];

      // ── Section grouping by first path segment ────────────
      var section = key.split('.')[0];

      if (section !== lastSection) {
        var secRow  = tbody.insertRow();
        secRow.className = 'sp-section-header';
        var secTd   = secRow.insertCell();
        secTd.colSpan     = 2;
        secTd.textContent = section;
        lastSection       = section;
      }

      // ── Data row ──────────────────────────────────────────
      var row = tbody.insertRow();
      if (entry.status !== 'match') {
        row.classList.add('row-' + entry.status);
      }

      // Key cell — show path without leading section prefix
      var keyTd       = row.insertCell();
      keyTd.className = 'key-col';
      var keyParts    = key.split('.');
      keyTd.textContent = keyParts.length > 1
        ? keyParts.slice(1).join('.')
        : key;

      // Value cell
      var valTd = row.insertCell();
      var value = side === 'left' ? entry.left : entry.right;
      valTd.textContent = (value !== null && value !== undefined) ? value : '';

      // Apply diff colour class
      if (entry.status !== 'match') {
        if (side === 'left'  && entry.status === 'removed') {
          valTd.className = 'val-removed';
        } else if (side === 'left'  && entry.status === 'changed') {
          valTd.className = 'val-changed';
        } else if (side === 'right' && entry.status === 'added') {
          valTd.className = 'val-added';
        } else if (side === 'right' && entry.status === 'changed') {
          valTd.className = 'val-changed';
        }
      }
    }

    return table;
  }

  // ────────────────────────────────────────────────────────────
  //  buildEmptyPane — placeholder content for a pane
  // ────────────────────────────────────────────────────────────
  function buildEmptyPane(icon, message) {
    var div = document.createElement('div');
    div.className = 'sp-empty';
    div.innerHTML =
      '<div class="sp-empty-icon">' + icon + '</div>' +
      '<div>' + message + '</div>';
    return div;
  }

  // ────────────────────────────────────────────────────────────
  //  buildCommandBlock — one collapsible block for one command
  //
  //  Returns: { block: HTMLElement, stats: object }
  // ────────────────────────────────────────────────────────────
  function buildCommandBlock(cmdKey, leftNodeData, rightNodeData, timestamps, onRunLive) {

    // Resolve display label
    var label = COMMAND_LABELS[cmdKey] || cmdKey.replace(/_/g, ' ');

    // Extract command-specific data from node data objects
    // Node.js 10 fix — no ?. used
    var leftData = null;
    if (leftNodeData !== null && leftNodeData !== undefined) {
      leftData = (
        leftNodeData[cmdKey] !== undefined &&
        leftNodeData[cmdKey] !== null
      ) ? leftNodeData[cmdKey] : null;
    }

    var rightData = null;
    if (rightNodeData !== null && rightNodeData !== undefined) {
      rightData = (
        rightNodeData[cmdKey] !== undefined &&
        rightNodeData[cmdKey] !== null
      ) ? rightNodeData[cmdKey] : null;
    }

    // Build diff between the two sides
    var leftFlat  = leftData  ? flatten(leftData)  : {};
    var rightFlat = rightData ? flatten(rightData)  : {};
    var result    = buildDiff(leftFlat, rightFlat);
    var diff      = result.diff;
    var stats     = result.stats;

    // ── Outer block container ─────────────────────────────────
    var block       = document.createElement('div');
    block.className = 'sp-block';

    // ────────────────────────────────────────────────────────
    //  HEADER
    // ────────────────────────────────────────────────────────
    var header       = document.createElement('div');
    header.className = 'sp-block-header';

    // Left side of header
    var headerLeft       = document.createElement('div');
    headerLeft.className = 'sp-block-header-left';

    var chevron       = document.createElement('span');
    chevron.className = 'sp-chevron';
    chevron.textContent = '›';

    var cmdName       = document.createElement('span');
    cmdName.className = 'sp-cmd-name';
    cmdName.textContent = label;

    // Stat pills — only render when both sides have data
    var pillsWrap       = document.createElement('div');
    pillsWrap.className = 'sp-cmd-stats';

    if (leftData && rightData) {
      var pillDefs = [
        { count: stats.changed,  cls: 'sp-pill-changed', lbl: 'changed'  },
        { count: stats.added,    cls: 'sp-pill-added',   lbl: 'added'    },
        { count: stats.removed,  cls: 'sp-pill-removed', lbl: 'removed'  },
        { count: stats.matching, cls: 'sp-pill-match',   lbl: 'matching' }
      ];

      for (var pi = 0; pi < pillDefs.length; pi++) {
        var pd = pillDefs[pi];
        if (pd.count === 0) continue;
        var pill       = document.createElement('span');
        pill.className = 'sp-stat-pill ' + pd.cls;
        pill.textContent = pd.count + ' ' + pd.lbl;
        pillsWrap.appendChild(pill);
      }
    }

    headerLeft.appendChild(chevron);
    headerLeft.appendChild(cmdName);
    headerLeft.appendChild(pillsWrap);

    // Run Live button — right side of header
    var runBtn       = document.createElement('button');
    runBtn.className = 'sp-run-live-btn';
    runBtn.textContent = '▶ Run Live';
    runBtn.disabled  = !onRunLive;

    // Use closure to capture cmdKey correctly
    (function (ck) {
      runBtn.addEventListener('click', function (e) {
        e.stopPropagation();   // prevent header collapse toggle
        if (onRunLive) onRunLive(ck, runBtn);
      });
    }(cmdKey));

    header.appendChild(headerLeft);
    header.appendChild(runBtn);

    // ────────────────────────────────────────────────────────
    //  BODY — contains left + right panes side by side
    // ────────────────────────────────────────────────────────
    var body       = document.createElement('div');
    body.className = 'sp-block-body';

    // ── Left pane ────────────────────────────────────────────
    var leftPane       = document.createElement('div');
    leftPane.className = 'sp-pane left';

    var leftHdr       = document.createElement('div');
    leftHdr.className = 'sp-pane-header left-hdr';
    leftHdr.innerHTML =
      '<span>Historical Snapshot</span>' +
      '<span class="sp-pane-ts">' +
      (timestamps && timestamps.left ? timestamps.left : '') +
      '</span>';

    leftPane.appendChild(leftHdr);

    if (leftData) {
      leftPane.appendChild(buildTable(diff, 'left'));
    } else {
      leftPane.appendChild(
        buildEmptyPane('📂', 'No historical data for this command')
      );
    }

    // ── Right pane ───────────────────────────────────────────
    var rightPane       = document.createElement('div');
    rightPane.className = 'sp-pane right';
    rightPane.id        = 'live-pane-' + cmdKey;

    var rightHdr       = document.createElement('div');
    rightHdr.className = 'sp-pane-header right-hdr';
    rightHdr.innerHTML =
      '<span>Live / New Data</span>' +
      '<span class="sp-pane-ts" id="live-ts-' + cmdKey + '">' +
      (timestamps && timestamps.right ? timestamps.right : '') +
      '</span>';

    rightPane.appendChild(rightHdr);

    if (rightData) {
      rightPane.appendChild(buildTable(diff, 'right'));
    } else {
      rightPane.appendChild(
        buildEmptyPane('▶', 'Click Run Live to collect data')
      );
    }

    // ── Sync scroll between left and right panes ─────────────
    var syncing = false;

    leftPane.addEventListener('scroll', function () {
      if (syncing) return;
      syncing = true;
      rightPane.scrollTop = leftPane.scrollTop;
      syncing = false;
    });

    rightPane.addEventListener('scroll', function () {
      if (syncing) return;
      syncing = true;
      leftPane.scrollTop = rightPane.scrollTop;
      syncing = false;
    });

    body.appendChild(leftPane);
    body.appendChild(rightPane);

    // ────────────────────────────────────────────────────────
    //  COLLAPSE TOGGLE — click header to expand / collapse
    // ────────────────────────────────────────────────────────
    header.addEventListener('click', function () {
      var isOpen = body.classList.contains('open');

      if (isOpen) {
        body.classList.remove('open');
        header.classList.remove('expanded');
        chevron.classList.remove('open');
      } else {
        body.classList.add('open');
        header.classList.add('expanded');
        chevron.classList.add('open');
      }
    });

    block.appendChild(header);
    block.appendChild(body);

    return { block: block, stats: stats };
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC: render
  //
  //  Renders all command blocks into the container element.
  //  Clears previous content first.
  //
  //  Parameters:
  //    container     HTMLElement  — the .split-wrapper div
  //    leftNodeData  object|null  — historical node data
  //    rightNodeData object|null  — live node data
  //    options       object       — {
  //                                   commands:   string[],
  //                                   timestamps: { left, right },
  //                                   onRunLive:  function(cmdKey, btnEl)
  //                                 }
  //
  //  Returns: { changed, added, removed, matching }  — total across all commands
  // ────────────────────────────────────────────────────────────
  function render(container, leftNodeData, rightNodeData, options) {
    injectStyles();

    options = options || {};

    // Resolve command list
    // Node.js 10 fix — explicit fallback chain instead of ??
    var commands = options.commands;
    if (!commands || commands.length === 0) {
      var resolvedData = leftNodeData || rightNodeData || {};
      commands = Object.keys(resolvedData);
    }

    var timestamps = options.timestamps || {};
    var onRunLive  = options.onRunLive  || null;

    // Clear container
    container.innerHTML = '';

    // No data at all — show placeholder
    if (!commands || commands.length === 0) {
      container.innerHTML =
        '<div class="sp-no-data">' +
        '<div style="font-size:2.5rem; margin-bottom:12px;">📂</div>' +
        'Load a snapshot to begin comparison' +
        '</div>';
      return { changed: 0, added: 0, removed: 0, matching: 0 };
    }

    // Outer scrollable wrapper
    var wrapper       = document.createElement('div');
    wrapper.className = 'sp-wrapper';

    var totals = { changed: 0, added: 0, removed: 0, matching: 0 };

    for (var ci = 0; ci < commands.length; ci++) {
      var cmdKey = commands[ci];

      var built  = buildCommandBlock(
        cmdKey,
        leftNodeData,
        rightNodeData,
        timestamps,
        onRunLive
      );

      totals.changed  += built.stats.changed;
      totals.added    += built.stats.added;
      totals.removed  += built.stats.removed;
      totals.matching += built.stats.matching;

      wrapper.appendChild(built.block);
    }

    container.appendChild(wrapper);
    return totals;
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC: updateLivePane
  //
  //  Replaces only the right pane content for one command block
  //  without collapsing other blocks or triggering a full re-render.
  //  Called from compare.html after a per-command Run Live completes.
  //
  //  Parameters:
  //    cmdKey        string       — e.g. "show_version"
  //    leftNodeData  object|null  — full historical node data object
  //    rightNodeData object|null  — full live node data object
  //    timestamp     string       — display timestamp for right pane header
  //
  //  Returns: stats { changed, added, removed, matching } for this command
  // ────────────────────────────────────────────────────────────
  function updateLivePane(cmdKey, leftNodeData, rightNodeData, timestamp) {
    var pane = document.getElementById('live-pane-' + cmdKey);
    if (!pane) {
      return { changed: 0, added: 0, removed: 0, matching: 0 };
    }

    // Extract command-specific data
    // Node.js 10 fix — no ?. used
    var leftData = null;
    if (leftNodeData !== null && leftNodeData !== undefined) {
      leftData = (
        leftNodeData[cmdKey] !== undefined &&
        leftNodeData[cmdKey] !== null
      ) ? leftNodeData[cmdKey] : null;
    }

    var rightData = null;
    if (rightNodeData !== null && rightNodeData !== undefined) {
      rightData = (
        rightNodeData[cmdKey] !== undefined &&
        rightNodeData[cmdKey] !== null
      ) ? rightNodeData[cmdKey] : null;
    }

    var leftFlat  = leftData  ? flatten(leftData)  : {};
    var rightFlat = rightData ? flatten(rightData)  : {};
    var result    = buildDiff(leftFlat, rightFlat);

    // ── Update timestamp label ────────────────────────────────
    var tsEl = document.getElementById('live-ts-' + cmdKey);
    if (tsEl && timestamp) {
      tsEl.textContent = timestamp;
    }

    // ── Remove all pane content after the header ──────────────
    // The header is always the first child — keep it, remove the rest
    while (pane.children.length > 1) {
      pane.removeChild(pane.lastChild);
    }

    // ── Render updated right-side table or empty state ────────
    if (rightData) {
      pane.appendChild(buildTable(result.diff, 'right'));
    } else {
      pane.appendChild(
        buildEmptyPane('⚠', 'No data returned for this command')
      );
    }

    // ── Update stat pills in the block header ─────────────────
    // Find the parent block and refresh its pills
    var blockEl = pane.closest ? pane.closest('.sp-block') : null;

    // Fallback for browsers without closest() support
    if (!blockEl) {
      var parent = pane.parentNode;
      while (parent && !parent.classList.contains('sp-block')) {
        parent = parent.parentNode;
      }
      blockEl = parent;
    }

    if (blockEl) {
      var pillsWrap = blockEl.querySelector('.sp-cmd-stats');
      if (pillsWrap) {
        pillsWrap.innerHTML = '';

        var pillDefs = [
          { count: result.stats.changed,  cls: 'sp-pill-changed', lbl: 'changed'  },
          { count: result.stats.added,    cls: 'sp-pill-added',   lbl: 'added'    },
          { count: result.stats.removed,  cls: 'sp-pill-removed', lbl: 'removed'  },
          { count: result.stats.matching, cls: 'sp-pill-match',   lbl: 'matching' }
        ];

        for (var pi = 0; pi < pillDefs.length; pi++) {
          var pd = pillDefs[pi];
          if (pd.count === 0) continue;
          var pill       = document.createElement('span');
          pill.className = 'sp-stat-pill ' + pd.cls;
          pill.textContent = pd.count + ' ' + pd.lbl;
          pillsWrap.appendChild(pill);
        }
      }
    }

    return result.stats;
  }

  // ── Expose public API ─────────────────────────────────────
  return {
    render:         render,
    updateLivePane: updateLivePane
  };

}());