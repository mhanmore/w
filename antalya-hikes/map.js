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
    coordinates: [Number(node.dataset.lng), Number(node.dataset.lat)]
  })).filter((hike) => hike.coordinates.every(Number.isFinite));

  const map = new maplibregl.Map({
    container: mapNode,
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: hikes[0]?.coordinates || [30.55, 36.54],
    zoom: 11.6
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  const bounds = new maplibregl.LngLatBounds();
  hikes.forEach((hike) => {
    bounds.extend(hike.coordinates);

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
      `<div class="map-popup"><strong>${hike.title}</strong><a href="#${hike.node.id}">Open saved hike →</a></div>`
    );

    new maplibregl.Marker({ element: marker, anchor: 'bottom' })
      .setLngLat(hike.coordinates)
      .setPopup(popup)
      .addTo(map);
  });

  if (hikes.length > 1) {
    map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 0 });
  }
})();
