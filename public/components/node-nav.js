/**
 * node-nav.js
 *
 * Manages the node navigation bar on the compare page.
 * Supports group-aware pill colouring and ordering.
 *
 * Public API:
 *   NodeNav.init(nodeIds, onChangeFn, groups)
 *   NodeNav.navigate(index)
 *   NodeNav.getCurrent()
 *
 * groups shape (from sessionStorage):
 *   [ { groupId: 1, nodeIds: ["101","102"] },
 *     { groupId: 2, nodeIds: ["201","202"] } ]
 *
 * Node.js 10 compatible — no ?? or ?. operators.
 */

var NodeNav = (function () {

  // ── Group colour map ────────────────────────────────────────
  var GROUP_COLOURS = {
    1: '#58a6ff',   // blue
    2: '#3fb950',   // green
    3: '#d29922',   // amber
    4: '#bc8cff'    // purple
  };

  // ── CSS ─────────────────────────────────────────────────────
  var CSS = [
    '.nn-pill {',
    '  padding: 4px 12px;',
    '  border-radius: 20px;',
    '  font-size: 0.78rem;',
    '  font-weight: 600;',
    '  cursor: pointer;',
    '  border: 1px solid #30363d;',
    '  background: #0d1117;',
    '  color: #8b949e;',
    '  white-space: nowrap;',
    '  transition: all 0.15s;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 4px;',
    '}',

    '.nn-pill:hover {',
    '  border-color: #58a6ff;',
    '  color: #58a6ff;',
    '}',

    '.nn-pill.active {',
    '  background: #1f3a5f;',
    '}',

    '.nn-group-badge {',
    '  font-size: 0.6rem;',
    '  opacity: 0.75;',
    '  font-weight: 700;',
    '  letter-spacing: 0.3px;',
    '}',

    '.nn-group-separator {',
    '  width: 1px;',
    '  height: 22px;',
    '  background: #30363d;',
    '  flex-shrink: 0;',
    '  margin: 0 2px;',
    '}',

    '.nn-group-label {',
    '  font-size: 0.65rem;',
    '  font-weight: 700;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.5px;',
    '  padding: 2px 6px;',
    '  border-radius: 4px;',
    '  white-space: nowrap;',
    '  flex-shrink: 0;',
    '}',

    '.nn-prev, .nn-next {',
    '  padding: 4px 10px;',
    '  border-radius: 4px;',
    '  background: #21262d;',
    '  border: 1px solid #30363d;',
    '  color: #c9d1d9;',
    '  cursor: pointer;',
    '  font-size: 0.8rem;',
    '  transition: background 0.15s;',
    '  flex-shrink: 0;',
    '}',

    '.nn-prev:hover, .nn-next:hover { background: #30363d; }',

    '.nn-prev:disabled, .nn-next:disabled {',
    '  color: #484f58;',
    '  cursor: default;',
    '  background: #161b22;',
    '}',

    '.nn-count {',
    '  font-size: 0.72rem;',
    '  color: #6e7681;',
    '  margin-left: 4px;',
    '  white-space: nowrap;',
    '  flex-shrink: 0;',
    '}'
  ].join('\n');

  var stylesInjected = false;
  var nodeIds        = [];
  var currentIndex   = 0;
  var changeCallback = null;
  var groups         = null;   // stored group info from session

  // ── Inject CSS once ──────────────────────────────────────────
  function injectStyles() {
    if (stylesInjected) return;
    var style         = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    stylesInjected    = true;
  }

  // ── Build node → group map ────────────────────────────────────
  // Returns { "101": 1, "102": 1, "201": 2, ... }
  function buildNodeGroupMap(grps) {
    var map = {};
    if (!grps || grps.length === 0) return map;

    for (var gi = 0; gi < grps.length; gi++) {
      var grp     = grps[gi];
      var groupId = grp.groupId;
      var ids     = grp.nodeIds || [];
      for (var ni = 0; ni < ids.length; ni++) {
        map[ids[ni]] = groupId;
      }
    }
    return map;
  }

  // ── Render the nav bar ────────────────────────────────────────
  function renderNav() {
    var navEl = document.getElementById('nodeNav');
    if (!navEl) return;

    navEl.innerHTML = '';

    // ── Node label ───────────────────────────────────────────
    var label       = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = 'Node:';
    navEl.appendChild(label);

    // ── Prev button ──────────────────────────────────────────
    var prevBtn         = document.createElement('button');
    prevBtn.className   = 'nn-prev';
    prevBtn.textContent = '◄';
    prevBtn.disabled    = currentIndex === 0;
    prevBtn.addEventListener('click', function () {
      navigate(currentIndex - 1);
    });
    navEl.appendChild(prevBtn);

    // ── Build node → group mapping ───────────────────────────
    var nodeGroupMap = buildNodeGroupMap(groups);

    // ── Group sorted structure ───────────────────────────────
    // When groups are available, render group labels + separators
    // between groups to visually separate them
    var prevGroupId = null;

    nodeIds.forEach(function (id, idx) {
      var groupId = nodeGroupMap[id] || null;
      var colour  = groupId
        ? (GROUP_COLOURS[groupId] || '#58a6ff')
        : '#58a6ff';

      // ── Insert group label when group changes ────────────
      if (groupId && groupId !== prevGroupId) {
        // Separator before each group (except the first)
        if (prevGroupId !== null) {
          var sep       = document.createElement('div');
          sep.className = 'nn-group-separator';
          navEl.appendChild(sep);
        }

        var grpLabel         = document.createElement('span');
        grpLabel.className   = 'nn-group-label';
        grpLabel.textContent = 'G' + groupId;
        grpLabel.style.color       = colour;
        grpLabel.style.background  =
          'rgba(' + hexToRgb(colour) + ',0.1)';
        grpLabel.style.border      =
          '1px solid rgba(' + hexToRgb(colour) + ',0.25)';

        navEl.appendChild(grpLabel);
        prevGroupId = groupId;
      }

      // ── Node pill ────────────────────────────────────────
      var pill       = document.createElement('button');
      pill.className = 'nn-pill' + (idx === currentIndex ? ' active' : '');

      if (idx === currentIndex) {
        pill.style.borderColor = colour;
        pill.style.color       = colour;
        pill.style.background  =
          'rgba(' + hexToRgb(colour) + ',0.12)';
      }

      // Node ID text
      var nodeText         = document.createElement('span');
      nodeText.textContent = 'Node ' + id;

      pill.appendChild(nodeText);

      // Group badge inside pill (small indicator)
      if (groupId) {
        var badge         = document.createElement('span');
        badge.className   = 'nn-group-badge';
        badge.textContent = 'G' + groupId;
        badge.style.color = colour;
        pill.appendChild(badge);
      }

      // Click handler — IIFE to capture correct index
      (function (i) {
        pill.addEventListener('click', function () {
          navigate(i);
        });
      }(idx));

      navEl.appendChild(pill);
    });

    // ── Next button ──────────────────────────────────────────
    var nextBtn         = document.createElement('button');
    nextBtn.className   = 'nn-next';
    nextBtn.textContent = '►';
    nextBtn.disabled    = currentIndex === nodeIds.length - 1;
    nextBtn.addEventListener('click', function () {
      navigate(currentIndex + 1);
    });
    navEl.appendChild(nextBtn);

    // ── Counter ──────────────────────────────────────────────
    var count         = document.createElement('span');
    count.className   = 'nn-count';
    count.textContent = (currentIndex + 1) + ' / ' + nodeIds.length;
    navEl.appendChild(count);
  }

  // ── Hex to RGB helper for rgba() ────────────────────────────
  // Input:  "#58a6ff"
  // Output: "88,166,255"
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    }
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return r + ',' + g + ',' + b;
  }

  // ── Navigate to a specific index ────────────────────────────
  function navigate(index) {
    if (index < 0 || index >= nodeIds.length) return;
    currentIndex = index;
    renderNav();
    if (typeof changeCallback === 'function') {
      changeCallback(nodeIds[currentIndex]);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC: init
  //
  //  Parameters:
  //    ids        string[]  — ordered list of node IDs
  //    onChangeFn function  — called with nodeId on navigation
  //    grps       array     — group definitions from session
  //                          [ { groupId, nodeIds } ]
  // ────────────────────────────────────────────────────────────
  function init(ids, onChangeFn, grps) {
    injectStyles();

    nodeIds        = ids    || [];
    currentIndex   = 0;
    changeCallback = onChangeFn || null;
    groups         = grps   || null;

    renderNav();

    // Trigger initial callback for first node
    if (nodeIds.length > 0 && typeof onChangeFn === 'function') {
      onChangeFn(nodeIds[0]);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC: getCurrent
//  Returns the currently selected node ID
  // ────────────────────────────────────────────────────────────
  function getCurrent() {
    return nodeIds[currentIndex] || null;
  }

  // ── Expose public API ─────────────────────────────────────
  return {
    init:       init,
    navigate:   navigate,
    getCurrent: getCurrent
  };

}());