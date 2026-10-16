/**
 * The host's controls inside a visualization: the segmented control, the
 * tabs row and the dropdown. A model writes only their markup and the aria
 * state it sets on click; the stylesheet and the script here do the rest.
 *
 * Both go into every document at publish, and are added again at load
 * (`prepareVisualizationDocument`, and `VisualizationSurface.prepared` in the
 * iOS app, which mirrors both verbatim), so a document saved before either
 * existed gets them too.
 */

/**
 * The segmented control, the tabs row and the dropdown. The segmented control
 * is one rounded rectangle, not a pill: a pill's ends are half its height, so
 * a control that grew taller ballooned into a stadium. The selected segment's
 * corners are the container's less the inset between them, so the two curves
 * are concentric, as in the app's own toggle (`ViewerToggle`, 8 outside and 5
 * inside at 28 tall), here at 36 for 14px labels. Neither row wraps: options
 * past the width scroll sideways.
 *
 * Added at load after a saved stylesheet's own rules, so a document published
 * with the pill gets these too.
 */
const SEGMENTED = { height: 36, radius: 10, border: 1, padding: 3 }
const SEGMENT_INSET = SEGMENTED.border + SEGMENTED.padding
const SEGMENT_RADIUS = SEGMENTED.radius - SEGMENT_INSET
const SELECTED = ":is([aria-checked=true],[aria-selected=true],[aria-pressed=true])"
export const VISUALIZATION_CONTROLS_CSS = [
  // The edge fades' widths, registered so that a fade eases in rather than
  // snapping. Only the document can register one, never a shadow root.
  "@property --kanna-fade-start{syntax:'<length>';inherits:false;initial-value:0px}",
  "@property --kanna-fade-end{syntax:'<length>';inherits:false;initial-value:0px}",
  `.kanna-segmented{display:inline-flex;flex-wrap:nowrap;max-width:100%;min-width:0;overflow-x:auto;scrollbar-width:none;gap:2px;height:${SEGMENTED.height}px;padding:${SEGMENTED.padding}px;border:${SEGMENTED.border}px solid var(--border);border-radius:${SEGMENTED.radius}px}`,
  ".kanna-segmented::-webkit-scrollbar{display:none}",
  `.kanna-segmented>button{flex:none;height:100%;padding:0 12px;border:0;border-radius:${SEGMENT_RADIUS}px;background:transparent;color:var(--muted-foreground);font-size:14px;line-height:1;white-space:nowrap}`,
  // A control that scrolls clips what spills past it, so its focus ring goes inside.
  ".kanna-segmented>button:focus-visible{outline-offset:-2px}",
  ".kanna-tabs{display:flex;flex-wrap:nowrap;gap:20px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--border)}",
  ".kanna-tabs::-webkit-scrollbar{display:none}",
  ".kanna-tabs>button{flex:none;padding:8px 0;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted-foreground);white-space:nowrap}",
  ".kanna-segmented>button:hover,.kanna-tabs>button:hover{color:var(--foreground)}",
  `.kanna-segmented>${SELECTED}{background:var(--muted);color:var(--foreground)}`,
  `.kanna-tabs>${SELECTED}{color:var(--foreground);border-bottom-color:var(--foreground)}`,
  // Once the script has taken a tabs row on, the underline is its own, which
  // slides. The row keeps its border as the baseline, which the edge fades
  // leave alone, and stops clipping so the underline can lie on it. No
  // longer a scroll container, it needs min-width:0 to stay shrinkable.
  ".kanna-tabs[data-kanna-row]{overflow:visible;min-width:0}",
  `.kanna-tabs[data-kanna-row]>${SELECTED}{border-bottom-color:transparent}`,
  // The chevron is two gradients, not an SVG, so it takes the theme's colour.
  `.kanna-select{appearance:none;-webkit-appearance:none;max-width:100%;height:${SEGMENTED.height}px;padding:0 32px 0 12px;border:${SEGMENTED.border}px solid var(--border);border-radius:${SEGMENTED.radius}px;color:var(--foreground);font-size:14px;line-height:1;text-overflow:ellipsis;cursor:pointer;background-color:transparent;background-image:linear-gradient(45deg,transparent 50%,var(--muted-foreground) 50%),linear-gradient(135deg,var(--muted-foreground) 50%,transparent 50%);background-position:calc(100% - 17px) 50%,calc(100% - 12px) 50%;background-size:5px 5px;background-repeat:no-repeat}`,
].join("")

/** How far an edge fades when it has more beyond it, and how far when a mouse's arrow sits on it too. */
const FADE = 24
const ARROW = 24
const ARROW_FADE = ARROW + 20

/**
 * The script's arithmetic, as the script's own source so the tests run the
 * very text that ships. Pure: sizes in, a scroll position or an edge state out.
 *
 * `centredScrollLeft` puts an option's middle in the middle of the row,
 * clamped to the row's scroll range, so the first and last options stop at
 * the row's ends instead of leaving an empty half row beside them.
 *
 * `overflowEdges` says, for each edge, whether there is more beyond it, how
 * wide its fade is, and whether it shows an arrow: only for a mouse, which
 * has no swipe, and only where there is somewhere to go.
 */
export const VISUALIZATION_CONTROLS_GEOMETRY = [
  "const centredScrollLeft = (rowWidth, optionOffset, optionWidth, scrollRange) => Math.max(0, Math.min(Math.max(0, scrollRange), Math.round(optionOffset + optionWidth / 2 - rowWidth / 2)));",
  `const overflowEdges = (scrollLeft, scrollRange, finePointer) => { const edge = more => ({ more, arrow: more && finePointer, fade: more ? (finePointer ? ${ARROW_FADE} : ${FADE}) : 0 }); return { start: edge(scrollLeft > 1), end: edge(scrollLeft < scrollRange - 1) }; };`,
].join("\n")

// The parts of a row the script draws, in its shadow root. The track scrolls
// and fades; the row around it keeps its border, or its baseline, unfaded.
// The underline rides in the track, so it scrolls with the tabs. The arrows
// sit on the row, over the track's faded ends.
const ROW_CSS = [
  ":host{position:relative}",
  "*{box-sizing:border-box}",
  ".track{position:relative;display:flex;flex:0 1 auto;min-width:0;align-self:stretch;align-items:inherit;gap:inherit;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-mask-image:linear-gradient(to right,transparent,#000 var(--kanna-fade-start),#000 calc(100% - var(--kanna-fade-end)),transparent);mask-image:linear-gradient(to right,transparent,#000 var(--kanna-fade-start),#000 calc(100% - var(--kanna-fade-end)),transparent)}",
  ".track::-webkit-scrollbar{display:none}",
  // Not on the first frame: a row that loads scrolled has its fades at once.
  ".track.settled{transition:--kanna-fade-start 150ms ease-out,--kanna-fade-end 150ms ease-out}",
  `:host(.kanna-segmented) .track{border-radius:${SEGMENT_RADIUS}px}`,
  // Down over the row's 1px baseline, as its tabs reach, so the underline
  // lies on it; the padding gives back the pixel, so the row is as tall as
  // it was, whatever its tabs are.
  ":host(.kanna-tabs) .track{margin-bottom:-1px;padding-bottom:1px}",
  ".indicator{position:absolute;left:0;bottom:0;width:1px;height:2px;background:var(--foreground);transform-origin:0 0;pointer-events:none;opacity:0}",
  ".indicator.slide{transition:transform 200ms cubic-bezier(0.23,1,0.32,1)}",
  ":host(.kanna-segmented) .indicator{display:none}",
  `.arrow{position:absolute;top:50%;z-index:1;display:none;place-items:center;width:${ARROW}px;height:${ARROW}px;margin-top:-${ARROW / 2}px;border:1px solid var(--border);border-radius:${ARROW / 2}px;background:var(--background);color:var(--muted-foreground);cursor:pointer;opacity:0;pointer-events:none;transition:opacity 120ms ease-out}`,
  "@media (hover:hover) and (pointer:fine){.arrow{display:grid}}",
  ".arrow:hover{color:var(--foreground)}",
  ".arrow.on{opacity:1;pointer-events:auto}",
  ".start{left:0}.end{right:0}",
  // In the segmented control an arrow is a segment's shape, in a segment's place.
  `:host(.kanna-segmented) .arrow{height:${SEGMENTED.height - 2 * SEGMENT_INSET}px;margin-top:-${(SEGMENTED.height - 2 * SEGMENT_INSET) / 2}px;border:0;border-radius:${SEGMENT_RADIUS}px}`,
  `:host(.kanna-segmented) .start{left:${SEGMENTED.padding}px}:host(.kanna-segmented) .end{right:${SEGMENTED.padding}px}`,
  "@media (prefers-reduced-motion:reduce){.track.settled,.indicator.slide,.arrow{transition:none}}",
].join("")

/**
 * What makes a row of options that does not fit still read as a row of
 * options, on every kanna-segmented and kanna-tabs row, those in the markup
 * and those a script builds or rebuilds later:
 *
 * - The edge with more beyond it fades, and for a mouse shows an arrow that
 *   pages the row.
 * - The selected option is scrolled to the middle of the row: on a click, an
 *   arrow key, the first render and a selection a script sets. Smoothly on a
 *   click or a script's change; at once on a key, at load and under reduced
 *   motion, since motion on a key press only makes it feel slow.
 * - A tabs row's underline slides to the selected tab, on the same rule.
 * - Left, Right, Home and End move between the options.
 *
 * The model's markup stays as it wrote it. The row gets a shadow root that
 * slots its buttons into a scrolling track, so the buttons, their parent and
 * every listener on them are untouched. The script reads the selection from
 * the aria state and never sets it: a key press clicks the next option, and
 * the model's own handler selects it. Nothing it adds takes room, so the
 * page's height is what it was.
 *
 * First in the head, ahead of any copy saved in the document, and the first
 * copy to run is the only one: the one added at load is the newest.
 */
export const VISUALIZATION_CONTROLS_SCRIPT = `(() => {
  if (window.__kannaControls) return;
  window.__kannaControls = true;
  ${VISUALIZATION_CONTROLS_GEOMETRY}
  const ROWS = '.kanna-segmented,.kanna-tabs';
  const OPTION = 'button,[role=radio],[role=tab]';
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const rows = new Map();
  let recent = null, loaded = false, keyStart = null;
  const chevron = path => '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const options = row => [...row.children].filter(node => node.matches(OPTION) && !node.hidden);
  const selected = row => options(row).find(node => ['aria-checked', 'aria-selected', 'aria-pressed'].some(name => node.getAttribute(name) === 'true'));
  const rowOf = target => { const option = target instanceof Element ? target.closest(OPTION) : null; const row = option?.parentElement; return row && rows.has(row) ? row : null; };

  const edges = row => {
    const { track, back, next } = rows.get(row);
    const state = overflowEdges(track.scrollLeft, track.scrollWidth - track.clientWidth, fine.matches);
    track.style.setProperty('--kanna-fade-start', state.start.fade + 'px');
    track.style.setProperty('--kanna-fade-end', state.end.fade + 'px');
    back.classList.toggle('on', state.start.arrow);
    next.classList.toggle('on', state.end.arrow);
  };

  // how: 'pointer' or 'script' move smoothly; 'key', 'initial' and 'layout'
  // at once. 'layout' (a resize, fonts arriving) re-centres only a row the
  // reader has not scrolled or used, so it never undoes where they went.
  const sync = (row, how) => {
    const state = rows.get(row);
    if (!state || !row.isConnected) return;
    const { track, indicator } = state;
    const instant = how === 'key' || how === 'initial' || how === 'layout' || !state.settled || !loaded || reduced.matches;
    const option = selected(row);
    if (option) {
      const box = track.getBoundingClientRect(), at = option.getBoundingClientRect();
      // Measured on screen, placed in layout: a scaled ancestor would otherwise skew both.
      const scale = box.width ? track.offsetWidth / box.width : 1;
      const offset = (at.left - box.left) * scale + track.scrollLeft, width = at.width * scale;
      indicator.classList.toggle('slide', !instant);
      indicator.style.transform = 'translateX(' + offset + 'px) scaleX(' + width + ')';
      indicator.style.opacity = '1';
      if (how !== 'layout' || !state.touched) {
        const left = centredScrollLeft(track.clientWidth, offset, width, track.scrollWidth - track.clientWidth);
        if (Math.abs(left - track.scrollLeft) > 0.5) track.scrollTo({ left, behavior: instant ? 'auto' : 'smooth' });
      }
    } else indicator.style.opacity = '0';
    edges(row);
  };

  const resize = new ResizeObserver(entries => {
    const changed = new Set();
    for (const entry of entries) {
      const target = entry.target;
      const row = rows.has(target.parentElement) ? target.parentElement : target.getRootNode().host;
      if (row && rows.has(row)) changed.add(row);
    }
    for (const row of changed) sync(row, 'layout');
  });
  const observeOptions = row => { for (const option of options(row)) resize.observe(option); };

  const enhance = row => {
    if (rows.has(row) || row.shadowRoot) return;
    let root;
    // Only some elements take a shadow root; a row on any other scrolls as it is.
    try { root = row.attachShadow({ mode: 'open' }); } catch { return; }
    root.innerHTML = '<style>${ROW_CSS}</style><div class="track" part="track"><slot></slot><span class="indicator"></span></div><span class="arrow start" aria-hidden="true">' + chevron('M10 3 5 8l5 5') + '</span><span class="arrow end" aria-hidden="true">' + chevron('M6 3l5 5-5 5') + '</span>';
    const track = root.querySelector('.track');
    const [back, next] = root.querySelectorAll('.arrow');
    const state = { track, back, next, indicator: root.querySelector('.indicator'), settled: false, touched: false };
    rows.set(row, state);
    row.setAttribute('data-kanna-row', '');
    track.addEventListener('scroll', () => edges(row), { passive: true });
    for (const kind of ['wheel', 'touchstart', 'pointerdown']) track.addEventListener(kind, () => { state.touched = true; }, { passive: true });
    for (const [arrow, direction] of [[back, -1], [next, 1]]) arrow.addEventListener('click', event => {
      // The arrows are the host's: a model's handler on the row never hears them.
      event.stopPropagation();
      state.touched = true;
      track.scrollBy({ left: direction * track.clientWidth * 0.7, behavior: reduced.matches ? 'auto' : 'smooth' });
    });
    resize.observe(track);
    observeOptions(row);
    sync(row, 'initial');
    requestAnimationFrame(() => requestAnimationFrame(() => { state.settled = true; track.classList.add('settled'); }));
  };
  const enhanceWithin = node => {
    if (!(node instanceof Element)) return;
    if (node.matches(ROWS)) enhance(node);
    for (const row of node.querySelectorAll(ROWS)) enhance(row);
  };

  new MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) enhanceWithin(node);
        if (rows.has(record.target)) changed.add(record.target);
      } else if (record.attributeName === 'class') {
        enhanceWithin(record.target);
      } else if (rows.has(record.target.parentElement)) {
        changed.add(record.target.parentElement);
      }
    }
    for (const row of changed) { observeOptions(row); sync(row, recent || 'script'); }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-checked', 'aria-selected', 'aria-pressed', 'hidden'] });

  // What started a change in selection, for as long as the event's task
  // runs: a script's change in that time is the reader's doing, and moves
  // the way their own input would.
  const note = how => { recent = how; setTimeout(() => { recent = null; }); };
  addEventListener('pointerdown', event => { note('pointer'); const row = rowOf(event.target); if (row) rows.get(row).touched = true; }, true);
  addEventListener('click', event => note(event.detail === 0 ? 'key' : 'pointer'), true);
  addEventListener('keydown', event => {
    note('key');
    const row = rowOf(event.target);
    keyStart = row ? { row, option: selected(row) } : null;
    if (row) rows.get(row).touched = true;
  }, true);
  // Heard last, after the page's own handlers.
  addEventListener('click', event => { const row = rowOf(event.target); if (row) sync(row, event.detail === 0 ? 'key' : 'pointer'); });
  addEventListener('keydown', event => {
    const row = rowOf(event.target);
    if (!row || keyStart?.row !== row || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const now = selected(row);
    // The page's own keys moved it: follow, rather than move it again.
    if (now && now !== keyStart.option) { now.focus({ preventScroll: true }); sync(row, 'key'); return; }
    if (event.defaultPrevented) return;
    const all = options(row), at = all.indexOf(event.target.closest(OPTION));
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    if (to === at || !all[to]) return;
    all[to].focus({ preventScroll: true });
    all[to].click();
    sync(row, 'key');
  });

  // A row taken out is kept: put back, it is the same row with the same shadow root.
  const all = how => { for (const row of rows.keys()) sync(row, how); };
  addEventListener('DOMContentLoaded', () => enhanceWithin(document.body));
  addEventListener('load', () => { loaded = true; all('layout'); });
  document.fonts?.ready.then(() => all('layout'));
  fine.addEventListener('change', () => all('layout'));
})();`
