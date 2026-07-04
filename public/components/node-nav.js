/**
 * NodeNav — manages the node navigation bar
 * in the comparison page.
 */
const NodeNav = (() => {

    const CSS = `
      .nn-pill {
        padding: 5px 14px;
        border-radius: 20px;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid #30363d;
        background: #0d1117;
        color: #8b949e;
        white-space: nowrap;
        transition: all 0.15s;
      }
      .nn-pill:hover  { border-color: #58a6ff; color: #58a6ff; }
      .nn-pill.active {
        background: #1f3a5f;
        border-color: #58a6ff;
        color: #58a6ff;
      }
      .nn-count {
        font-size: 0.72rem;
        color: #6e7681;
        margin-left: 6px;
        white-space: nowrap;
      }
      .nn-prev, .nn-next {
        padding: 4px 10px;
        border-radius: 4px;
        background: #21262d;
        border: 1px solid #30363d;
        color: #c9d1d9;
        cursor: pointer;
        font-size: 0.8rem;
        transition: background 0.15s;
      }
      .nn-prev:hover, .nn-next:hover { background: #30363d; }
      .nn-prev:disabled, .nn-next:disabled { color: #484f58; cursor: default; }
    `;
  
    let stylesInjected = false;
    let nodeIds        = [];
    let currentIndex   = 0;
    let changeCallback = null;
  
    function injectStyles() {
      if (stylesInjected) return;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      stylesInjected = true;
    }
  
    // ── Render the nav bar ─────────────────────────────────────
    function renderNav() {
      const navEl = document.getElementById('nodeNav');
      if (!navEl) return;
  
      navEl.innerHTML = '';
  
      // Label
      const label = document.createElement('span');
      label.className   = 'nav-label';
      label.textContent = 'Node:';
      navEl.appendChild(label);
  
      // Prev button
      const prevBtn = document.createElement('button');
      prevBtn.className   = 'nn-prev';
      prevBtn.textContent = '◄';
      prevBtn.disabled    = currentIndex === 0;
      prevBtn.addEventListener('click', () => navigate(currentIndex - 1));
      navEl.appendChild(prevBtn);
  
      // Pills for each node
      nodeIds.forEach((id, idx) => {
        const pill = document.createElement('button');
        pill.className   = `nn-pill${idx === currentIndex ? ' active' : ''}`;
        pill.textContent = `Node ${id}`;
        pill.setAttribute('data-index', idx);
        pill.addEventListener('click', () => navigate(idx));
        navEl.appendChild(pill);
      });
  
      // Next button
      const nextBtn = document.createElement('button');
      nextBtn.className   = 'nn-next';
      nextBtn.textContent = '►';
      nextBtn.disabled    = currentIndex === nodeIds.length - 1;
      nextBtn.addEventListener('click', () => navigate(currentIndex + 1));
      navEl.appendChild(nextBtn);
  
      // Count
      const count = document.createElement('span');
      count.className   = 'nn-count';
      count.textContent = `${currentIndex + 1} / ${nodeIds.length}`;
      navEl.appendChild(count);
    }
  
    // ── Navigate to a node index ───────────────────────────────
    function navigate(index) {
      if (index < 0 || index >= nodeIds.length) return;
      currentIndex = index;
      renderNav();
      if (typeof changeCallback === 'function') {
        changeCallback(nodeIds[currentIndex]);
      }
    }
  
    // ── Public API ─────────────────────────────────────────────
    function init(ids, onChangeFn) {
      injectStyles();
      nodeIds        = ids;
      currentIndex   = 0;
      changeCallback = onChangeFn;
      renderNav();
      // Trigger initial callback
      if (ids.length > 0 && typeof onChangeFn === 'function') {
        onChangeFn(ids[0]);
      }
    }
  
    function getCurrent() {
      return nodeIds[currentIndex];
    }
  
    return { init, navigate, getCurrent };
  })();