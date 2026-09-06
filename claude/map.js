const places=[
{name:'Çamyuva',c:[30.5587,36.5552],type:'Base',img:'images/kemer.jpg',note:'Pine-shaded base with the mountains at your back and the sea in front.'},
{name:'Phaselis',url:'../trips/antalya-2026/places/phaselis/',c:[30.5515,36.5256],type:'Family day',img:'images/phaselis.jpg',note:'Three ancient harbours and a pine forest full of ruins. Swim when the walking wins.'},
{name:'Tahtalı Dağı',url:'../trips/antalya-2026/places/tahtali/',c:[30.4788,36.5366],type:'Mountain',img:'images/tahtali.jpg',note:'Cable car from 726 m to 2,365 m in about ten minutes.'},
{name:'Yanartaş',url:'../trips/antalya-2026/places/yanartas/',c:[30.4655,36.4319],type:'Myth & fire',img:'images/yanartas.jpg',note:'Methane flames burning out of bare rock since antiquity — go at dusk.'},
{name:'Olympos',url:'../trips/antalya-2026/places/olympos/',c:[30.464,36.3961],type:'Ruins & beach',img:'images/olympos.jpg',note:'A ruined city swallowed by forest, ending on a long shingle beach.'},
{name:'Adrasan',c:[30.4802,36.3068],type:'Trailhead',img:'images/olympos.jpg',note:'Quiet bay and the start of the Musa Dağı crossing to Olympos.'},
{name:'Göynük Canyon',url:'../trips/antalya-2026/places/goynuk/',c:[30.5455,36.6821],type:'Canyon',img:'images/goynuk.jpg',note:'Clear-water gorge; the lower canyon is a paddle, the uplands are serious hiking.'},
{name:'Termessos',url:'../trips/antalya-2026/places/termessos/',c:[30.4654,36.9821],type:'Mountain ruins',img:'images/termessos.jpg',note:'The city Alexander the Great chose not to besiege. 1,000 m up, still half-buried.'},
{name:'Antalya (Kaleiçi)',c:[30.704,36.884],type:'Old town',img:'images/kemer.jpg',note:'Ottoman harbour town, Hadrian\'s Gate and the Karaalioğlu clifftop park.'}
];
const colours={'Base':'#e8b23d','Family day':'#d9633b','Mountain':'#3c2a6b','Myth & fire':'#ff8a3d','Ruins & beach':'#d9633b','Trailhead':'#3c2a6b','Canyon':'#d9633b','Mountain ruins':'#3c2a6b','Old town':'#1b1338'};
const map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',center:[30.55,36.66],zoom:9});
map.addControl(new maplibregl.NavigationControl(),'top-right');
places.forEach(p=>{
  const el=document.createElement('div');
  el.style.cssText=`width:24px;height:24px;border-radius:50%;background:${colours[p.type]};border:3px solid #fbf7ee;box-shadow:0 2px 10px #0006;cursor:pointer`;
  new maplibregl.Marker({element:el}).setLngLat(p.c).setPopup(new maplibregl.Popup({offset:16}).setHTML(`<div class="mapcard"><img src="${p.img}" alt=""><div><b>${p.name}</b><small>${p.type} · ${p.note}</small>${p.url?`<a href="${p.url}">Open mini-guide →</a>`:''}</div></div>`)).addTo(map);
});
