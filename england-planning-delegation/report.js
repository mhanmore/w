(() => {
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const STATUSES = [
    { key: 'adopted', label: 'Adoption evidenced', colour: '#287668' },
    { key: 'implementation_confirmed_formal_resolution_not_located', label: 'Implemented; resolution not located', colour: '#d79a2b' },
    { key: 'pending_formal_adoption', label: 'Formal adoption pending', colour: '#cf5b43' },
    { key: 'scheduled_outcome_unconfirmed', label: 'Outcome not yet confirmed', colour: '#75559a' },
    { key: 'no_evidence_found', label: 'No published evidence found', colour: '#8a9599' },
    { key: 'no_data', label: 'Not yet researched', colour: null }
  ];
  const PAGE = 40;

  const rowsNode = document.querySelector('#authority-rows');
  const resultCount = document.querySelector('#result-count');
  const search = document.querySelector('#authority-search');
  const errorNode = document.querySelector('#data-error');
  const mapMessage = document.querySelector('#map-message');
  const legendNode = document.querySelector('#legend-items');
  const showMore = document.querySelector('#show-more');
  let records = [];
  let byCode = new Map();
  let map;
  let popup;
  let filter = 'all';
  let showAll = false;

  const escapeHtml = (v = '') => String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const safeUrl = (v = '') => { try { const u = new URL(v, window.location.href); return ['http:', 'https:'].includes(u.protocol) ? u.href : '#'; } catch (_) { return '#'; } };
  const formatDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '')
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`))
    : '—');
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const statusOf = (key) => STATUSES.find((s) => s.key === key) || STATUSES[STATUSES.length - 1];

  const pillStyle = (key) => {
    const s = statusOf(key);
    return s.colour ? `border-color:${s.colour}` : 'border-image:repeating-linear-gradient(-45deg,#47606a 0 2px,transparent 2px 5px) 4';
  };

  const renderLegend = () => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s.key, records.filter((r) => r.status === s.key).length]));
    legendNode.innerHTML = [
      `<button class="legend-item${filter === 'all' ? ' active' : ''}" type="button" data-filter="all" aria-pressed="${filter === 'all'}"><span class="swatch all"></span><span>All authorities</span><strong>${records.length}</strong></button>`,
      ...STATUSES.map((s) => `<button class="legend-item${filter === s.key ? ' active' : ''}" type="button" data-filter="${s.key}" aria-pressed="${filter === s.key}"><span class="swatch${s.colour ? '' : ' hatch'}"${s.colour ? ` style="background:${s.colour}"` : ''}></span><span>${escapeHtml(s.label)}</span><strong>${counts[s.key]}</strong></button>`)
    ].join('');
    const researched = records.length - counts.no_data;
    document.querySelector('#progress-count').textContent = `${researched} of ${records.length} authorities researched`;
  };

  const sourceLinks = (r) => {
    const links = [];
    if (r.primary_source) links.push(`<a href="${safeUrl(r.primary_source)}" target="_blank" rel="noopener">Primary record ↗</a>`);
    if (r.secondary_source) links.push(`<a href="${safeUrl(r.secondary_source)}" target="_blank" rel="noopener">Supporting record ↗</a>`);
    if (r.official_site) links.push(`<a href="${safeUrl(r.official_site)}" target="_blank" rel="noopener">Authority website ↗</a>`);
    return links.join('');
  };

  const renderTable = () => {
    const term = (search?.value || '').trim().toLocaleLowerCase();
    const matches = records.filter((r) => (filter === 'all' || r.status === filter) && (!term || r.name.toLocaleLowerCase().includes(term)));
    const shown = showAll || term || filter !== 'all' ? matches : matches.slice(0, PAGE);
    rowsNode.innerHTML = shown.map((r) => `
      <tr data-id="${escapeHtml(r.lpa_code)}">
        <td data-label="Authority"><button class="borough-button" type="button" data-code="${escapeHtml(r.lpa_code)}">${escapeHtml(r.name)}</button></td>
        <td data-label="Position"><span class="status-pill" style="${pillStyle(r.status)}">${escapeHtml(r.status_label)}</span></td>
        <td data-label="Date">${escapeHtml(formatDate(r.date))}</td>
        <td data-label="Confidence"><span class="confidence">${escapeHtml(r.confidence || '—')}</span></td>
        <td data-label="Evidence">${r.status === 'no_data' ? '<span class="muted">Not yet researched</span>' : `
          <details>
            <summary>Read evidence</summary>
            <div class="evidence-copy">
              <p>${escapeHtml(r.evidence_summary)}</p>
              <div class="source-links">${sourceLinks(r)}</div>
              ${r.checked_at ? `<p class="checked">Checked ${escapeHtml(formatDate(r.checked_at))}</p>` : ''}
            </div>
          </details>`}
        </td>
      </tr>`).join('');
    resultCount.textContent = `Showing ${shown.length} of ${matches.length} matching authorities · ordered south to north`;
    showMore.hidden = shown.length >= matches.length;
  };

  const applyMap = () => {
    if (!map?.getLayer('lpa-fill')) return;
    const f = filter === 'all' ? null : ['==', ['get', 'status'], filter];
    map.setFilter('lpa-fill', f ? ['all', ['!=', ['get', 'status'], 'no_data'], f] : ['!=', ['get', 'status'], 'no_data']);
    map.setFilter('lpa-hatch', filter === 'all' || filter === 'no_data' ? ['==', ['get', 'status'], 'no_data'] : ['==', 1, 0]);
  };

  const refresh = () => { renderLegend(); renderTable(); applyMap(); };

  const showOnMap = (code, lngLat) => {
    const r = byCode.get(code);
    if (!map || !r) return;
    const feature = map.querySourceFeatures('lpa', { filter: ['==', ['get', 'code'], code] })[0];
    if (feature && !lngLat) {
      const b = new maplibregl.LngLatBounds();
      const visit = (c) => (typeof c[0] === 'number' ? b.extend(c) : c.forEach(visit));
      visit(feature.geometry.coordinates);
      map.fitBounds(b, { padding: 60, maxZoom: 10, duration: reduceMotion() ? 0 : 700 });
      lngLat = b.getCenter();
    }
    if (!lngLat) return;
    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' }).setLngLat(lngLat).setHTML(`
      <div class="map-popup">
        <span class="popup-status">${escapeHtml(r.status_label)}</span>
        <strong>${escapeHtml(r.name)}</strong>
        <p>${r.status === 'no_data' ? 'Not yet researched' : `${escapeHtml(formatDate(r.date))} · ${escapeHtml(r.confidence || '—')} confidence`}</p>
        <a href="#evidence" data-popup-code="${escapeHtml(code)}">Open record ↓</a>
      </div>`).addTo(map);
  };

  const hatchImage = () => {
    const s = 10;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(18,44,54,.45)';
    x.lineWidth = 1.1;
    x.beginPath();
    x.moveTo(0, 0); x.lineTo(s, s);
    x.moveTo(0, s); x.lineTo(s, 0);
    x.stroke();
    return x.getImageData(0, 0, s, s);
  };

  const initialiseMap = (geojson) => {
    if (typeof maplibregl === 'undefined') { mapMessage.hidden = false; return; }
    try {
      const narrow = window.matchMedia('(max-width: 620px)').matches;
      map = new maplibregl.Map({
        container: 'map', style: MAP_STYLE, center: [-1.6, 52.75], zoom: narrow ? 5.2 : 5.75,
        minZoom: 4.5, maxBounds: [[-9.5, 48.5], [5.5, 57]], attributionControl: false, cooperativeGestures: narrow
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.on('load', () => {
        mapMessage.hidden = true;
        map.addImage('crosshatch', hatchImage(), { pixelRatio: 1 });
        map.addSource('lpa', { type: 'geojson', data: geojson, generateId: true });
        map.addLayer({ id: 'lpa-hatch', type: 'fill', source: 'lpa', paint: { 'fill-pattern': 'crosshatch', 'fill-opacity': .55 } });
        map.addLayer({ id: 'lpa-fill', type: 'fill', source: 'lpa', paint: {
          'fill-color': ['match', ['get', 'status'], ...STATUSES.filter((s) => s.colour).flatMap((s) => [s.key, s.colour]), '#78878a'],
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], .92, .75] } });
        map.addLayer({ id: 'lpa-line', type: 'line', source: 'lpa', paint: {
          'line-color': '#fffdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, .5, 9, 1.6], 'line-opacity': .9 } });
        applyMap();
        let hovered = null;
        const layers = ['lpa-fill', 'lpa-hatch'];
        layers.forEach((layer) => {
          map.on('mousemove', layer, (e) => {
            map.getCanvas().style.cursor = 'pointer';
            if (hovered !== null) map.setFeatureState({ source: 'lpa', id: hovered }, { hover: false });
            hovered = e.features[0].id;
            map.setFeatureState({ source: 'lpa', id: hovered }, { hover: true });
          });
          map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
            if (hovered !== null) map.setFeatureState({ source: 'lpa', id: hovered }, { hover: false });
            hovered = null;
          });
        });
        map.on('click', (e) => {
          const hit = map.queryRenderedFeatures(e.point, { layers })[0];
          if (hit) showOnMap(hit.properties.code, e.lngLat);
        });
      });
    } catch (_) { mapMessage.hidden = false; }
  };

  document.addEventListener('click', (event) => {
    const f = event.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; refresh(); }
    const b = event.target.closest('[data-code]');
    if (b) {
      showOnMap(b.dataset.code);
      document.querySelector('.map-section')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    const p = event.target.closest('[data-popup-code]');
    if (p) {
      showAll = true;
      renderTable();
      const row = document.querySelector(`tr[data-id="${CSS.escape(p.dataset.popupCode)}"]`);
      row?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      row?.querySelector('details')?.setAttribute('open', '');
    }
  });
  search?.addEventListener('input', renderTable);
  showMore.addEventListener('click', () => { showAll = true; renderTable(); });

  Promise.all([fetch('data/authorities.json'), fetch('data/lpa.geojson')])
    .then(async ([a, g]) => {
      if (!a.ok || !g.ok) throw new Error('Data request failed');
      return [await a.json(), await g.json()];
    })
    .then(([data, geojson]) => {
      records = data;
      byCode = new Map(records.map((r) => [r.lpa_code, r]));
      geojson.features.forEach((f) => { f.properties.status = byCode.get(f.properties.code)?.status || 'no_data'; });
      const latest = records.map((r) => r.checked_at).filter(Boolean).sort().pop();
      if (latest) document.querySelector('#footer-checked').textContent = `Last checked ${formatDate(latest)}`;
      refresh();
      initialiseMap(geojson);
    })
    .catch(() => {
      resultCount.textContent = 'Detailed records unavailable';
      errorNode.hidden = false;
      mapMessage.hidden = false;
    });
})();
