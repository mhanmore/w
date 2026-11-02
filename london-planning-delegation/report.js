(() => {
  const DATA_URL = 'data/boroughs.geojson';
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const STATUS_CLASS = {
    adopted: 'adopted',
    implementation_confirmed_formal_resolution_not_located: 'implemented',
    pending_formal_adoption: 'pending',
    scheduled_outcome_unconfirmed: 'unconfirmed'
  };
  const STATUS_COLOURS = {
    adopted: '#287668',
    implementation_confirmed_formal_resolution_not_located: '#d79a2b',
    pending_formal_adoption: '#cf5b43',
    scheduled_outcome_unconfirmed: '#75559a'
  };

  const rowsNode = document.querySelector('#borough-rows');
  const resultCount = document.querySelector('#result-count');
  const search = document.querySelector('#borough-search');
  const errorNode = document.querySelector('#data-error');
  const mapMessage = document.querySelector('#map-message');
  const filterButtons = [...document.querySelectorAll('.legend-item[data-status]')];
  let collection;
  let map;
  let selectedStatus = 'all';
  let popup;

  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  const safeUrl = (value = '') => {
    try {
      const url = new URL(value, window.location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch (_) {
      return '#';
    }
  };

  const formatDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || '—';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${value}T00:00:00Z`));
  };

  const sourceLinks = (properties) => {
    const links = [`<a href="${safeUrl(properties.primary_source)}" target="_blank" rel="noopener">Primary record ↗</a>`];
    if (properties.secondary_source) {
      links.push(`<a href="${safeUrl(properties.secondary_source)}" target="_blank" rel="noopener">Supporting record ↗</a>`);
    }
    links.push(`<a href="${safeUrl(properties.official_site)}" target="_blank" rel="noopener">Council website ↗</a>`);
    return links.join('');
  };

  const renderTable = () => {
    if (!collection) return;
    const term = (search?.value || '').trim().toLocaleLowerCase();
    const features = collection.features.filter(({ properties }) => {
      const matchesStatus = selectedStatus === 'all' || properties.status === selectedStatus;
      const matchesTerm = !term || properties.name.toLocaleLowerCase().includes(term);
      return matchesStatus && matchesTerm;
    });
    rowsNode.innerHTML = features.map(({ properties: p }) => `
      <tr data-id="${escapeHtml(p.id)}">
        <td data-label="Borough"><button class="borough-button" type="button" data-borough-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button></td>
        <td data-label="Position"><span class="status-pill ${STATUS_CLASS[p.status]}">${escapeHtml(p.status_label)}</span></td>
        <td data-label="Date">${escapeHtml(formatDate(p.date))}</td>
        <td data-label="Confidence"><span class="confidence">${escapeHtml(p.confidence)}</span></td>
        <td data-label="Evidence">
          <details>
            <summary>Read evidence</summary>
            <div class="evidence-copy">
              <p>${escapeHtml(p.evidence_summary)}</p>
              <div class="source-links">${sourceLinks(p)}</div>
            </div>
          </details>
        </td>
      </tr>`).join('');
    resultCount.textContent = `Showing ${features.length} of 32 boroughs`;
  };

  const findFeature = (id) => collection?.features.find(({ properties }) => properties.id === id);

  const popupHtml = (properties) => `
    <div class="map-popup">
      <span class="popup-status">${escapeHtml(properties.status_label)}</span>
      <strong>${escapeHtml(properties.name)}</strong>
      <p>${escapeHtml(formatDate(properties.date))} · ${escapeHtml(properties.confidence)} confidence</p>
      <a href="#evidence" data-popup-borough="${escapeHtml(properties.id)}">Open evidence ↓</a>
    </div>`;

  const showFeatureOnMap = (feature) => {
    if (!map || !feature) return;
    const bounds = new maplibregl.LngLatBounds();
    const visit = (coordinates) => {
      if (typeof coordinates[0] === 'number') bounds.extend(coordinates);
      else coordinates.forEach(visit);
    };
    visit(feature.geometry.coordinates);
    map.fitBounds(bounds, { padding: 70, maxZoom: 10.4, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700 });
    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
      .setLngLat(bounds.getCenter())
      .setHTML(popupHtml(feature.properties))
      .addTo(map);
  };

  const applyMapFilter = () => {
    if (!map?.getLayer('borough-fill')) return;
    const filter = selectedStatus === 'all' ? null : ['==', ['get', 'status'], selectedStatus];
    map.setFilter('borough-fill', filter);
    map.setFilter('borough-line', filter);
  };

  const setStatus = (status) => {
    selectedStatus = status;
    filterButtons.forEach((button) => {
      const active = button.dataset.status === status;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    applyMapFilter();
    renderTable();
  };

  const initialiseMap = () => {
    if (typeof maplibregl === 'undefined') {
      mapMessage.hidden = false;
      return;
    }
    try {
      map = new maplibregl.Map({
        container: 'map',
        style: MAP_STYLE,
        center: [-0.105, 51.50],
        zoom: 8.55,
        minZoom: 7.5,
        attributionControl: false
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      map.on('load', () => {
        map.addSource('boroughs', { type: 'geojson', data: collection, promoteId: 'id' });
        map.addLayer({
          id: 'borough-fill',
          type: 'fill',
          source: 'boroughs',
          paint: {
            'fill-color': ['match', ['get', 'status'],
              'adopted', STATUS_COLOURS.adopted,
              'implementation_confirmed_formal_resolution_not_located', STATUS_COLOURS.implementation_confirmed_formal_resolution_not_located,
              'pending_formal_adoption', STATUS_COLOURS.pending_formal_adoption,
              'scheduled_outcome_unconfirmed', STATUS_COLOURS.scheduled_outcome_unconfirmed,
              '#78878a'
            ],
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], .92, .73]
          }
        });
        map.addLayer({
          id: 'borough-line',
          type: 'line',
          source: 'boroughs',
          paint: { 'line-color': '#fffdf8', 'line-width': 1.4, 'line-opacity': .9 }
        });
        applyMapFilter();
        let hoveredId = null;
        map.on('mousemove', 'borough-fill', (event) => {
          map.getCanvas().style.cursor = 'pointer';
          if (hoveredId !== null) map.setFeatureState({ source: 'boroughs', id: hoveredId }, { hover: false });
          hoveredId = event.features[0].properties.id;
          map.setFeatureState({ source: 'boroughs', id: hoveredId }, { hover: true });
        });
        map.on('mouseleave', 'borough-fill', () => {
          map.getCanvas().style.cursor = '';
          if (hoveredId !== null) map.setFeatureState({ source: 'boroughs', id: hoveredId }, { hover: false });
          hoveredId = null;
        });
        map.on('click', 'borough-fill', (event) => {
          const feature = findFeature(event.features[0].properties.id);
          if (feature) showFeatureOnMap(feature);
        });
      });
      map.on('error', (event) => {
        if (!map.loaded() && event?.error) mapMessage.hidden = false;
      });
    } catch (_) {
      mapMessage.hidden = false;
    }
  };

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-borough-id]');
    if (button) {
      showFeatureOnMap(findFeature(button.dataset.boroughId));
      document.querySelector('.map-section')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    const popupLink = event.target.closest('[data-popup-borough]');
    if (popupLink) {
      const row = document.querySelector(`tr[data-id="${CSS.escape(popupLink.dataset.popupBorough)}"]`);
      row?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      row?.querySelector('details')?.setAttribute('open', '');
    }
  });

  filterButtons.forEach((button) => button.addEventListener('click', () => setStatus(button.dataset.status)));
  search?.addEventListener('input', renderTable);

  fetch(DATA_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      collection = data;
      renderTable();
      initialiseMap();
    })
    .catch(() => {
      resultCount.textContent = 'Detailed records unavailable';
      errorNode.hidden = false;
      mapMessage.hidden = false;
    });
})();
