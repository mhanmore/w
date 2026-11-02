(() => {
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const VIEWS = {
    current: {
      field: 'status',
      items: [
        { key: 'confirmed', label: 'Confirmed', colour: '#287668' },
        { key: 'minded_to', label: 'Minded to proceed', colour: '#d79a2b' },
        { key: 'withdrawn', label: 'Decision withdrawn – under review', colour: '#cf5b43' },
        { key: 'awaiting', label: 'Awaiting decision', colour: '#75559a' }
      ]
    },
    original: {
      field: 'original_status',
      items: [
        { key: 'decided_2027', label: 'Decided – vesting April 2027', colour: '#287668' },
        { key: 'decided_2028', label: 'Decided – vesting April 2028', colour: '#2f6690' },
        { key: 'deferred', label: 'Decision deferred', colour: '#75559a' }
      ]
    }
  };

  const rowsNode = document.querySelector('#area-rows');
  const resultCount = document.querySelector('#result-count');
  const search = document.querySelector('#area-search');
  const errorNode = document.querySelector('#data-error');
  const mapMessage = document.querySelector('#map-message');
  const legendNode = document.querySelector('#legend-items');
  const viewButtons = [...document.querySelectorAll('.view-button')];
  let areas = [];
  let map;
  let popup;
  let view = 'current';
  let filter = 'all';

  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[c]);
  const safeUrl = (value = '') => {
    try {
      const url = new URL(value, window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch (_) { return '#'; }
  };
  const formatDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${value}T00:00:00Z`));
  };
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colourFor = (v, key) => VIEWS[v].items.find((i) => i.key === key)?.colour || '#78878a';
  const statusKey = (area) => (view === 'current' ? area.status : area.original_status);
  const sourceHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return 'source'; } };

  const renderLegend = () => {
    const { items } = VIEWS[view];
    const counts = Object.fromEntries(items.map((i) => [i.key, areas.filter((a) => statusKey(a) === i.key).length]));
    legendNode.innerHTML = [
      `<button class="legend-item${filter === 'all' ? ' active' : ''}" type="button" data-filter="all" aria-pressed="${filter === 'all'}"><span class="swatch all-areas"></span><span>All areas</span><strong>${areas.length}</strong></button>`,
      ...items.map((i) => `<button class="legend-item${filter === i.key ? ' active' : ''}" type="button" data-filter="${i.key}" aria-pressed="${filter === i.key}"><span class="swatch" style="background:${i.colour}"></span><span>${escapeHtml(i.label)}</span><strong>${counts[i.key]}</strong></button>`)
    ].join('');
  };

  const pill = (v, area) => {
    const key = v === 'current' ? area.status : area.original_status;
    const label = v === 'current' ? area.status_label : area.original_label;
    const date = formatDate(v === 'current' ? area.status_date : area.original_date);
    const vest = v === 'current' ? area.vesting : area.original_vesting;
    return `<span class="status-pill" style="border-color:${colourFor(v, key)}">${escapeHtml(label)}${date ? `<small>${escapeHtml(date)}</small>` : ''}${vest ? `<small>Vesting: ${escapeHtml(vest)}</small>` : ''}</span>`;
  };

  const unitList = (area) => area.units.map((u) => `
    <li><strong>${escapeHtml(u.name)}</strong> — ${escapeHtml(u.members.join(', '))}${u.splits.length ? `<span class="split-notes">${u.splits.map((s) => `<span>${escapeHtml(s.district)}: ${escapeHtml(s.note || 'split')}</span>`).join('')}</span>` : ''}</li>`).join('');

  const renderTable = () => {
    const term = (search?.value || '').trim().toLocaleLowerCase();
    const shown = areas.filter((a) => {
      const matchesFilter = filter === 'all' || statusKey(a) === filter;
      const haystack = [a.area, ...a.units.flatMap((u) => [u.name, ...u.members])].join(' ').toLocaleLowerCase();
      return matchesFilter && (!term || haystack.includes(term));
    });
    rowsNode.innerHTML = shown.map((a) => `
      <tr data-id="${escapeHtml(a.id)}">
        <td data-label="Area"><button class="borough-button" type="button" data-area-id="${escapeHtml(a.id)}">${escapeHtml(a.area)}</button></td>
        <td data-label="Now">${pill('current', a)}</td>
        <td data-label="As announced">${pill('original', a)}</td>
        <td data-label="Councils">${a.status === 'awaiting' ? '<span class="muted">No structure decided</span>' : `${a.units.length} ${a.units.length === 1 ? 'council' : 'councils'}`}</td>
        <td data-label="Detail">
          <details>
            <summary>Read detail</summary>
            <div class="evidence-copy">
              <p>${escapeHtml(a.status_note)}</p>
              ${a.status === 'awaiting' ? `<p>Councils in the area: ${escapeHtml(a.units[0].members.join(', '))}.</p>` : `<ul class="unit-list">${unitList(a)}</ul>`}
              <div class="source-links">${a.sources.map((s) => `<a href="${safeUrl(s)}" target="_blank" rel="noopener">${escapeHtml(sourceHost(s))} ↗</a>`).join('')}</div>
            </div>
          </details>
        </td>
      </tr>`).join('');
    resultCount.textContent = `Showing ${shown.length} of ${areas.length} areas`;
  };

  const fillColour = () => {
    const { field, items } = VIEWS[view];
    return ['match', ['get', field], ...items.flatMap((i) => [i.key, i.colour]), '#78878a'];
  };
  const mapFilter = () => (filter === 'all' ? null : ['==', ['get', VIEWS[view].field], filter]);

  const applyMap = () => {
    if (!map?.getLayer('unit-fill')) return;
    map.setPaintProperty('unit-fill', 'fill-color', fillColour());
    ['unit-fill', 'unit-line', 'unit-label'].forEach((id) => map.setFilter(id, mapFilter()));
    map.setFilter('split-hatch', filter === 'all' ? ['==', ['get', 'split'], true] : ['all', ['==', ['get', 'split'], true], mapFilter()]);
  };

  const refresh = () => { renderLegend(); renderTable(); applyMap(); };

  const boundsOf = (geometry, bounds = new maplibregl.LngLatBounds()) => {
    const visit = (c) => (typeof c[0] === 'number' ? bounds.extend(c) : c.forEach(visit));
    visit(geometry.coordinates);
    return bounds;
  };

  const showUnitPopup = (props, lngLat) => {
    const area = areas.find((a) => a.id === props.area_id);
    if (!area) return;
    const unit = area.units.find((u) => u.name === props.unit);
    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
      .setLngLat(lngLat)
      .setHTML(`
        <div class="map-popup">
          <span class="popup-status">${escapeHtml(view === 'current' ? area.status_label : area.original_label)}</span>
          <strong>${escapeHtml(area.status === 'awaiting' ? area.area : props.unit)}</strong>
          <p>${area.status === 'awaiting' ? 'No structure decided.' : `${escapeHtml(area.area)} · from ${escapeHtml(unit?.members.join(', ') || '')}`}</p>
          ${unit?.splits.length ? `<p class="popup-split">Split: ${unit.splits.map((s) => escapeHtml(s.district)).join(', ')}</p>` : ''}
          <a href="#evidence" data-popup-area="${escapeHtml(area.id)}">Open record ↓</a>
        </div>`)
      .addTo(map);
  };

  const showArea = (id) => {
    if (!map?.isStyleLoaded()) return;
    const features = map.querySourceFeatures('areas', { filter: ['==', ['get', 'area_id'], id] });
    if (!features.length) return;
    const bounds = features.reduce((b, f) => boundsOf(f.geometry, b), new maplibregl.LngLatBounds());
    map.fitBounds(bounds, { padding: 50, maxZoom: 9, duration: reduceMotion() ? 0 : 700 });
  };

  const hatchImage = () => {
    const size = 12;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(18,44,54,.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, size); ctx.lineTo(size, 0);
    ctx.moveTo(-size / 2, size / 2); ctx.lineTo(size / 2, -size / 2);
    ctx.moveTo(size / 2, size * 1.5); ctx.lineTo(size * 1.5, size / 2);
    ctx.stroke();
    return ctx.getImageData(0, 0, size, size);
  };

  const initialiseMap = () => {
    if (typeof maplibregl === 'undefined') { mapMessage.hidden = false; return; }
    try {
      const narrow = window.matchMedia('(max-width: 620px)').matches;
      map = new maplibregl.Map({
        container: 'map',
        style: MAP_STYLE,
        center: [-1.6, 52.75],
        zoom: narrow ? 5.2 : 5.75,
        minZoom: 4.5,
        maxBounds: [[-9.5, 48.5], [5.5, 57]],
        attributionControl: false,
        cooperativeGestures: narrow
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.on('load', () => {
        mapMessage.hidden = true;
        map.addImage('hatch', hatchImage(), { pixelRatio: 1 });
        map.addSource('districts', { type: 'geojson', data: 'data/districts.geojson' });
        map.addSource('units', { type: 'geojson', data: 'data/units.geojson', generateId: true });
        map.addSource('areas', { type: 'geojson', data: 'data/areas.geojson' });
        map.addSource('labels', { type: 'geojson', data: 'data/unit-labels.geojson' });
        map.addLayer({ id: 'district-context', type: 'line', source: 'districts',
          paint: { 'line-color': '#5c6f76', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, .25, 9, .8], 'line-opacity': .45 } });
        map.addLayer({ id: 'unit-fill', type: 'fill', source: 'units',
          paint: { 'fill-color': fillColour(), 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], .9, .7] } });
        map.addLayer({ id: 'split-hatch', type: 'fill', source: 'districts', filter: ['==', ['get', 'split'], true],
          paint: { 'fill-pattern': 'hatch', 'fill-opacity': .8 } });
        map.addLayer({ id: 'unit-line', type: 'line', source: 'units',
          paint: { 'line-color': '#fffdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, .8, 9, 2] } });
        map.addLayer({ id: 'area-line', type: 'line', source: 'areas',
          paint: { 'line-color': '#122c36', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, .9, 9, 2.2] } });
        map.addLayer({ id: 'unit-label', type: 'symbol', source: 'labels', minzoom: 7,
          layout: { 'text-field': ['get', 'unit'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-max-width': 8 },
          paint: { 'text-color': '#122c36', 'text-halo-color': '#fffdf8', 'text-halo-width': 1.4 } });
        applyMap();

        let hovered = null;
        map.on('mousemove', 'unit-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          if (hovered !== null) map.setFeatureState({ source: 'units', id: hovered }, { hover: false });
          hovered = e.features[0].id;
          map.setFeatureState({ source: 'units', id: hovered }, { hover: true });
        });
        map.on('mouseleave', 'unit-fill', () => {
          map.getCanvas().style.cursor = '';
          if (hovered !== null) map.setFeatureState({ source: 'units', id: hovered }, { hover: false });
          hovered = null;
        });
        map.on('click', 'unit-fill', (e) => showUnitPopup(e.features[0].properties, e.lngLat));
      });
    } catch (_) {
      mapMessage.hidden = false;
    }
  };

  document.addEventListener('click', (event) => {
    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) { filter = filterButton.dataset.filter; refresh(); }
    const areaButton = event.target.closest('[data-area-id]');
    if (areaButton) {
      showArea(areaButton.dataset.areaId);
      document.querySelector('.map-section')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    const popupLink = event.target.closest('[data-popup-area]');
    if (popupLink) {
      const row = document.querySelector(`tr[data-id="${CSS.escape(popupLink.dataset.popupArea)}"]`);
      row?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
      row?.querySelector('details')?.setAttribute('open', '');
    }
  });

  viewButtons.forEach((button) => button.addEventListener('click', () => {
    view = button.dataset.view;
    filter = 'all';
    popup?.remove();
    viewButtons.forEach((b) => {
      const active = b === button;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    refresh();
  }));
  search?.addEventListener('input', renderTable);

  fetch('data/areas.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => { areas = data; renderLegend(); renderTable(); initialiseMap(); })
    .catch(() => {
      resultCount.textContent = 'Area records unavailable';
      errorNode.hidden = false;
      mapMessage.hidden = false;
    });
})();
