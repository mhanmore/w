(() => {
  const mapNode = document.querySelector('#map');
  const hikeNodes = [...document.querySelectorAll('.hike[data-lat][data-lng]')];

  if (!mapNode || !hikeNodes.length || typeof maplibregl === 'undefined') {
    if (mapNode) {
      mapNode.innerHTML = '<div class="map-fallback">The map could not load. Use the start-point list below to open a saved hike.</div>';
    }
    return;
  }

  const hikes = hikeNodes.map((node, index) => ({
    node,
    number: index + 1,
    title: node.dataset.title || node.querySelector('h3')?.textContent || `Hike ${index + 1}`,
    driveMinutes: Number(node.dataset.driveMinutes),
    coordinates: [Number(node.dataset.lng), Number(node.dataset.lat)]
  })).filter((hike) => hike.coordinates.every(Number.isFinite));

  const origin = [30.56461518859461, 36.5989684352011];

  const map = new maplibregl.Map({
    container: mapNode,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: hikes[0]?.coordinates || [30.55, 36.54],
    zoom: 11.6
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  const bounds = new maplibregl.LngLatBounds();
  bounds.extend(origin);

  const addDriveLines = () => {
    if (map.getSource('drive-lines')) return;
    const lineFeatures = hikes.map((hike) => ({
      type: 'Feature',
      properties: { number: hike.number, minutes: hike.driveMinutes },
      geometry: { type: 'LineString', coordinates: [origin, hike.coordinates] }
    }));
    map.addSource('drive-lines', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: lineFeatures }
    });
    map.addLayer({
      id: 'drive-line-casing',
      type: 'line',
      source: 'drive-lines',
      paint: { 'line-color': '#fffdf8', 'line-width': 5, 'line-opacity': .78 }
    });
    map.addLayer({
      id: 'drive-lines',
      type: 'line',
      source: 'drive-lines',
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': '#b45334',
        'line-width': 2.5,
        'line-dasharray': [1, 2]
      }
    });
  };

  if (map.isStyleLoaded()) addDriveLines();
  else map.once('style.load', addDriveLines);

  const originMarker = document.createElement('div');
  originMarker.className = 'origin-marker';
  originMarker.setAttribute('role', 'img');
  originMarker.setAttribute('aria-label', 'Shared driving origin');
  originMarker.innerHTML = '<span aria-hidden="true">⌂</span>';
  new maplibregl.Marker({ element: originMarker })
    .setLngLat(origin)
    .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML('<div class="map-popup"><strong>Shared driving origin</strong><span>36.598968, 30.564615</span></div>'))
    .addTo(map);

  const labelledCoordinates = new Set();
  hikes.forEach((hike) => {
    bounds.extend(hike.coordinates);

    const coordinateKey = hike.coordinates.join(',');
    if (!labelledCoordinates.has(coordinateKey)) {
      labelledCoordinates.add(coordinateKey);
      const labelPosition = hike.number === 2 ? .42 : hike.number === 3 ? .64 : .5;
      const driveLabel = document.createElement('div');
      driveLabel.className = 'drive-time-label';
      driveLabel.setAttribute('aria-hidden', 'true');
      driveLabel.textContent = `≈${hike.driveMinutes} min`;
      new maplibregl.Marker({ element: driveLabel, offset: hike.number === 5 ? [62, 0] : [0, 0] })
        .setLngLat([
          origin[0] + (hike.coordinates[0] - origin[0]) * labelPosition,
          origin[1] + (hike.coordinates[1] - origin[1]) * labelPosition
        ])
        .addTo(map);
    }

    const marker = document.createElement('button');
    marker.className = 'hike-marker';
    marker.type = 'button';
    marker.setAttribute('aria-label', `Go to hike ${hike.number}: ${hike.title}`);
    marker.innerHTML = `<span aria-hidden="true">${hike.number}</span>`;
    marker.addEventListener('click', () => {
      hike.node.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      history.replaceState(null, '', `#${hike.node.id}`);
    });

    const popup = new maplibregl.Popup({ offset: 24 }).setHTML(
      `<div class="map-popup"><strong>${hike.title}</strong><span>≈${hike.driveMinutes} min drive</span><a href="#${hike.node.id}">Open saved hike →</a></div>`
    );

    const markerOffset = hike.number === 5 ? [-17, 0] : hike.number === 6 ? [17, 0] : [0, 0];
    new maplibregl.Marker({ element: marker, anchor: 'bottom', offset: markerOffset })
      .setLngLat(hike.coordinates)
      .setPopup(popup)
      .addTo(map);
  });

  map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 0 });
})();
