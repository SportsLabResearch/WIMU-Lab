"use strict";
V.comparador=async(v)=>{
  v.innerHTML=head('Comparación entre dispositivos','Importa un registro para analizarlo individualmente o dos para comparar sus señales. Los originales no se modifican.')+`<div class="card"><div class="card-body"><p>Dispositivo A <input type="file" id="cmp-a" accept=".fit,.gpx,.tcx,.csv"></p><p>Dispositivo B <input type="file" id="cmp-b" accept=".fit,.gpx,.tcx,.csv"></p><p>Variable <select id="cmp-var"><option value="hr">Frecuencia cardíaca (lpm)</option><option value="speed">Velocidad (m/s)</option><option value="alt">Altitud (m)</option></select> Desfase B (segundos) <input id="cmp-shift" type="number" value="0" style="width:95px"> Intervalo (s) <input id="cmp-step" type="number" min="1" value="1" style="width:75px"></p><button class="btn primary" id="cmp-analyze">Analizar dispositivo A</button> <button class="btn" id="cmp-run">Importar y comparar</button><div id="cmp-out" style="margin-top:18px"></div></div></div>`;
  const analizarArchivo = async()=>{
    const out=$('#cmp-out'),f=$('#cmp-a').files[0],pre=S.archivoUniversal;
    if(!f&&!pre){toast('Selecciona el archivo del dispositivo A',true);return}
    out.textContent='Importando y analizando…';
    try{
      let j;
      if(pre){j=pre;S.archivoUniversal=null;}
      else {if(f.size>30000000)throw Error('Máximo 30 MB');const r=await fetch('/api/comparador/cargar?nombre='+encodeURIComponent(f.name),{method:'POST',body:f});j=await r.json();if(!r.ok||j.error)throw Error(j.error||'Error de importación');}
      const a=await api('/api/comparador/analizar',{id:j.id});
      const fmt=x=>x==null?'No disponible':Number(x).toFixed(2);
      const trs=Object.entries(a.variables).map(([k,v])=>`<tr><td>${({hr:'Frecuencia cardíaca (lpm)',speed:'Velocidad (m/s)',alt:'Altitud (m)'})[k]}</td><td>${v?fmt(v.media):'No disponible'}</td><td>${v?fmt(v.min):'—'}</td><td>${v?fmt(v.max):'—'}</td><td>${v?v.n:'0'}</td></tr>`).join('');
      out.innerHTML=`<h3>Análisis individual · ${esc(j.nombre)}</h3><p>Duración: ${fmt(a.duracion_s)} s · Registros: ${a.n} · Posiciones GPS: ${a.gps_n} · Distancia GPS: ${fmt(a.distancia_gps_m)} m</p><div class="tablewrap"><table class="data"><thead><tr><th>Variable</th><th>Media</th><th>Mín.</th><th>Máx.</th><th>N</th></tr></thead><tbody>${trs}</tbody></table></div><h3>Serie temporal y posición GPS</h3><div id="univ-plot"></div><label>Desplazar cursor y posición GPS <input type="range" id="univ-slider" min="0" max="${a.serie.length-1}" value="0" style="width:100%"></label><p id="univ-read"></p><div id="univ-map" style="height:320px;min-height:320px"></div><p>${esc(a.advertencia)}</p><button class="btn" id="univ-csv">Exportar análisis CSV</button>`;
      const rows=a.serie;const gps=rows.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
      const variable=['speed','hr','alt'].find(k=>rows.some(x=>Number.isFinite(x[k])));
      const values=rows.filter(x=>variable&&Number.isFinite(x[variable]));
      const min=Math.min(...values.map(x=>x[variable]),0),max=Math.max(...values.map(x=>x[variable]),1);
      const dur=Math.max(1,a.duracion_s);
      const path=values.map((x,i)=>`${i?'L':'M'}${(35+725*x.t/dur).toFixed(2)},${(180-145*(x[variable]-min)/Math.max(.001,max-min)).toFixed(2)}`).join(' ');
      $('#univ-plot').innerHTML=`<svg viewBox="0 0 800 205" style="width:100%"><path d="${path}" fill="none" stroke="#1976d2" stroke-width="2"/><line id="univ-cursor" x1="35" x2="35" y1="15" y2="185" stroke="#e05a35" stroke-width="2"/></svg><p>${variable?esc(variable):'Sin variables temporales compatibles'}</p>`;
      let map=null,marker=null;
      if(gps.length&&typeof L!=='undefined'){map=L.map('univ-map');L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);L.polyline(gps.map(x=>[x.lat,x.lon]),{color:'#1976d2'}).addTo(map);marker=L.circleMarker([gps[0].lat,gps[0].lon],{radius:8,color:'#fff',weight:2,fillColor:'#e05a35',fillOpacity:1}).addTo(map);map.fitBounds(L.latLngBounds(gps.map(x=>[x.lat,x.lon])));}
      else $('#univ-map').textContent=gps.length?'Mapa cartográfico no disponible sin conexión':'Archivo sin coordenadas GPS';
      const slider=$('#univ-slider');const move=i=>{i=Math.max(0,Math.min(rows.length-1,i));slider.value=i;const x=rows[i];const px=35+725*x.t/dur;const line=$('#univ-cursor');line.setAttribute('x1',px);line.setAttribute('x2',px);$('#univ-read').textContent=`Tiempo: ${fmt(x.t)} s · ${variable||'Variable'}: ${fmt(x[variable])}`;if(marker&&gps.length){let best=gps[0],d=Infinity;for(const p of gps){const dd=Math.abs(p.t-x.t);if(dd<d){best=p;d=dd}}marker.setLatLng([best.lat,best.lon]);}};
      slider.oninput=()=>move(Number(slider.value));move(0);
      if(map){map.on('click',e=>{let best=0,d=Infinity;rows.forEach((x,i)=>{if(!Number.isFinite(x.lat)||!Number.isFinite(x.lon))return;const z=map.distance(e.latlng,[x.lat,x.lon]);if(z<d){d=z;best=i}});move(best)});setTimeout(()=>map.invalidateSize(),100)}
      $('#univ-csv').onclick=()=>{const csv=['tiempo_s,fc_lpm,velocidad_ms,altitud_m,latitud,longitud',...rows.map(x=>[x.t,x.hr??'',x.speed??'',x.alt??'',x.lat??'',x.lon??''].join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='analisis_dispositivo.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
    }catch(e){out.textContent='Error: '+e.message;toast(e.message,true)}
  };
  $('#cmp-analyze').onclick=analizarArchivo;
  if(S.archivoUniversal) analizarArchivo();
  $('#cmp-run').onclick=async()=>{
    const out=$('#cmp-out'),files=[$('#cmp-a').files[0],$('#cmp-b').files[0]];
    if(files.some(x=>!x)){toast('Selecciona ambos archivos',true);return}
    out.textContent='Importando y calculando…';
    try{
      const ids=[];
      for(const f of files){if(f.size>30000000)throw Error('Máximo 30 MB por archivo');const r=await fetch('/api/comparador/cargar?nombre='+encodeURIComponent(f.name),{method:'POST',body:f});const j=await r.json();if(!r.ok||j.error)throw Error(j.error||'Error de importación');ids.push(j)}
      const data=await api('/api/comparador/comparar',{a:ids[0].id,b:ids[1].id,variable:$('#cmp-var').value,desfase:Number($('#cmp-shift').value),intervalo:Number($('#cmp-step').value)});
      const fmt=x=>x==null?'No calculable':Number(x).toFixed(3);
      const rows=data.serie, lo=Math.min(...rows.flatMap(x=>[x.a,x.b])),hi=Math.max(...rows.flatMap(x=>[x.a,x.b]));
      const px=(x)=>35+730*x/Math.max(1,rows.at(-1).t),py=x=>175-145*(x-lo)/Math.max(.0001,hi-lo);
      const line=k=>rows.map((x,i)=>(i?'L':'M')+px(x.t).toFixed(1)+','+py(x[k]).toFixed(1)).join(' ');
      out.innerHTML=`<h3>${esc(ids[0].nombre)} frente a ${esc(ids[1].nombre)}</h3><p>Registros emparejados: <b>${data.n}</b> · Sesgo B−A: <b>${fmt(data.sesgo_B_menos_A)}</b> · RMSE: <b>${fmt(data.rmse)}</b> · MAE: <b>${fmt(data.mae)}</b> · Pearson r: <b>${fmt(data.pearson_r)}</b></p><p>Límites de acuerdo 95 %: ${data.limites_acuerdo_95.map(fmt).join(' a ')}</p><svg viewBox="0 0 800 205" style="width:100%;background:var(--surface,#fff);border:1px solid #999;border-radius:8px"><path d="${line('a')}" stroke="#1976d2" stroke-width="2" fill="none"/><path d="${line('b')}" stroke="#d65b32" stroke-width="2" fill="none"/></svg><p><span style="color:#1976d2">━━</span> A &nbsp; <span style="color:#d65b32">━━</span> B</p><p>${esc(data.advertencia)}</p><button class="btn" id="cmp-export">Exportar resultados CSV</button>`;
      $('#cmp-export').onclick=()=>{const csv=['tiempo_s,dispositivo_A,dispositivo_B',...rows.map(x=>[x.t,x.a,x.b].join(','))].join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='comparacion_dispositivos.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),500)};
    }catch(e){out.textContent='Error: '+e.message;toast(e.message,true)}
  };
};
