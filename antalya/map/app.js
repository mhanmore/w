const colours = {
  Base: '#e8b23d',
  'Family day': '#d9633b',
  Mountain: '#3c2a6b',
  'Myth & fire': '#ff8a3d',
  'Ruins & beach': '#d9633b',
  Trailhead: '#3c2a6b',
  Canyon: '#d9633b',
  'Mountain ruins': '#3c2a6b',
  'Old town': '#1b1338'
};

const els = {
  title: document.querySelector('#trip-title'),
  kicker: document.querySelector('#trip-kicker'),
  dates: document.querySelector('#trip-dates'),
  intro: document.querySelector('#trip-intro'),
  count: document.querySelector('#location-count'),
  list: document.querySelector('#location-list'),
  heading: document.querySelector('#location-heading'),
  detail: document.querySelector('#location-detail'),
  status: document.querySelector('#map-status')
};

let data;
let map;
let popup;
let selectedCategories = new Set();
let activePlaceId;

function popupHTML(place) {
  const links = (place.links || []).map(link => `<a href="${link.url}" target="_blank" rel="noreferrer">${link.label} ↗</a>`).join('');
  return `<article class="detail-popup"><img src="${place.image}" alt="${place.name}"><div class="detail-copy"><p class="eyebrow">${place.type}</p><h2>${place.name}</h2><p>${place.description}</p>${links}</div></article>`;
}

function selectPlace(place, openPopup = true, flyToLocation = true) {
  activePlaceId = place.id;
  els.list.hidden = true;
  els.heading.hidden = true;
  els.detail.hidden = false;
  const bullets = (place.details || []).map(detail => `<li>${detail}</li>`).join('');
  const links = (place.links || []).map(link => `<a href="${link.url}" target="_blank" rel="noreferrer">${link.label} ↗</a>`).join('');
  els.detail.innerHTML = `<button class="detail-back" type="button">← All locations</button><p class="detail-type">${place.type}</p><h2>${place.name}</h2><p class="detail-note">${place.note}</p><p class="detail-description">${place.description}</p>${bullets ? `<ul class="detail-facts">${bullets}</ul>` : ''}${links ? `<div class="detail-links">${links}</div>` : ''}`;
  els.detail.querySelector('.detail-back').addEventListener('click', showLocationList);
  document.querySelectorAll('.location').forEach(button => {
    button.setAttribute('aria-current', button.dataset.id === place.id ? 'true' : 'false');
  });
  if (flyToLocation) map.flyTo({center: place.coordinates, zoom: Math.max(map.getZoom(), 11.5), essential: true});
  if (openPopup) {
    popup.setLngLat(place.coordinates).setHTML(popupHTML(place)).addTo(map);
  }
}

function showLocationList() {
  if (popup) popup.remove();
  els.detail.hidden = true;
  els.list.hidden = false;
  els.heading.hidden = false;
}

function fitLocations() {
  if (!map || !data.locations.length) return;
  const places = data.locations.filter(place => selectedCategories.has(place.category));
  if (!places.length) {
    map.flyTo({center: data.trip.center, zoom: data.trip.zoom, essential: true});
    return;
  }
  const longitudes = places.map(place => place.coordinates[0]);
  const latitudes = places.map(place => place.coordinates[1]);
  map.fitBounds(
    [[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]],
    {padding: {top: 42, right: 42, bottom: 42, left: 42}, maxZoom: 7.9, duration: 0}
  );
}

function renderCategoryFilters() {
  const categories = [...new Set(data.locations.map(place => place.category))].sort((a, b) => a.localeCompare(b));
  selectedCategories = new Set(categories);
  document.querySelector('#category-filters').innerHTML = categories.map(category => {
    const count = data.locations.filter(place => place.category === category).length;
    return `<label class="category-filter"><input type="checkbox" value="${category}" checked><span>${category}</span><span class="category-filter-count">${count}</span></label>`;
  }).join('');
  document.querySelector('#category-filters').addEventListener('change', event => {
    if (event.target.type !== 'checkbox') return;
    if (event.target.checked) selectedCategories.add(event.target.value);
    else selectedCategories.delete(event.target.value);
    applyCategoryFilter();
  });
}

function applyCategoryFilter() {
  const filtered = data.locations.filter(place => selectedCategories.has(place.category));
  els.count.textContent = `${filtered.length} of ${data.locations.length} pins`;
  els.list.innerHTML = filtered.length ? filtered.map(place => `
    <button class="location" data-id="${place.id}" aria-current="false" role="listitem">
      <span class="marker-dot" style="background:${colours[place.type] || colours['Family day']}"></span>
      <span><span class="location-name">${place.name}</span><span class="location-type">${place.category} · ${place.type}</span></span>
      <span class="location-arrow" aria-hidden="true">›</span>
    </button>`).join('') : '<p class="empty-list">No locations in this category selection.</p>';
  const source = map && map.getSource('locations');
  if (source) {
    source.setData({
      type: 'FeatureCollection',
      features: filtered.map(place => ({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: place.coordinates},
        properties: {id: place.id, name: place.name, category: place.category, color: colours[place.type] || colours['Family day']}
      }))
    });
  }
  if (popup && popup.isOpen()) {
    const active = data.locations.find(place => place.id === activePlaceId);
    if (active && !selectedCategories.has(active.category)) popup.remove();
  }
}

function renderList() {
  applyCategoryFilter();
  els.list.addEventListener('click', event => {
    const button = event.target.closest('.location');
    if (!button) return;
    selectPlace(data.locations.find(place => place.id === button.dataset.id));
  });
}

function renderMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: data.trip.center,
    zoom: data.trip.zoom,
    attributionControl: {compact: true}
  });
  map.on('load', () => { els.status.classList.add('ready'); });
  map.on('error', event => {
    console.error('MapLibre error:', event.error || event);
    els.status.textContent = 'Map tiles could not be loaded. Check your connection and reload.';
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  popup = new maplibregl.Popup({offset: 14, closeButton: true, closeOnClick: true, maxWidth: '340px'});
  map.on('load', () => {
    map.addSource('locations', {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []},
      cluster: true,
      clusterMaxZoom: 11,
      clusterRadius: 44
    });
    map.addLayer({id:'location-clusters',type:'circle',source:'locations',filter:['has','point_count'],paint:{'circle-color':'#3c2a6b','circle-radius':['step',['get','point_count'],19,5,23,10,27],'circle-stroke-width':3,'circle-stroke-color':'#fbf7ee'}});
    map.addLayer({id:'location-cluster-count',type:'symbol',source:'locations',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-font':['Noto Sans Bold'],'text-size':13},paint:{'text-color':'#ffffff'}});
    map.addLayer({id:'location-points',type:'circle',source:'locations',filter:['!',['has','point_count']],paint:{'circle-color':['get','color'],'circle-radius':8,'circle-stroke-width':3,'circle-stroke-color':'#fbf7ee'}});
    applyCategoryFilter();
    fitLocations();
    map.on('click','location-clusters',event => {
      const feature = map.queryRenderedFeatures(event.point,{layers:['location-clusters']})[0];
      map.getSource('locations').getClusterExpansionZoom(feature.properties.cluster_id,(error,zoom)=>{
        if (!error) map.easeTo({center:feature.geometry.coordinates,zoom});
      });
    });
    map.on('click','location-points',event => {
      const id = event.features[0].properties.id;
      const place = data.locations.find(location => location.id === id);
      if (place) selectPlace(place);
    });
    map.on('mouseenter','location-clusters',()=>{map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave','location-clusters',()=>{map.getCanvas().style.cursor='';});
    map.on('mouseenter','location-points',()=>{map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave','location-points',()=>{map.getCanvas().style.cursor='';});
  });
  const resizeObserver = new ResizeObserver(() => map.resize());
  resizeObserver.observe(document.querySelector('.map-panel'));
}

async function init() {
  try {
    const response = await fetch('locations.json');
    if (!response.ok) throw new Error(`Could not load locations.json (${response.status})`);
    data = await response.json();
    els.title.textContent = data.trip.title;
    els.kicker.textContent = data.trip.kicker;
    els.dates.textContent = data.trip.dates;
    els.intro.textContent = data.trip.intro;
    renderCategoryFilters();
    renderList();
    renderMap();
    selectPlace(data.locations[0], false, false);
  } catch (error) {
    els.status.textContent = 'Could not load map content.';
    console.error(error);
  }
}

document.querySelector('#reset-view').addEventListener('click', fitLocations);
document.querySelector('#zoom-in').addEventListener('click', () => map && map.zoomIn());
document.querySelector('#zoom-out').addEventListener('click', () => map && map.zoomOut());
init();
