/*
 * Home Guardian — Pulse Noir  (live Home Assistant panel_custom element)
 * Element: <guardian-dashboard>  ·  reads hass.states live, auto-updates.
 * Three families: Water Leak · GFCI Canaries · Temperature.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config maps
  // Leak sensor display names come straight from HA's friendly_name (prefix stripped)
  // so they always match what's in HA — no hardcoded location guesses.
  var LEAK_BATT = {
    'binary_sensor.ikea_of_sweden_badring_water_leakage_sensor': 'sensor.ikea_of_sweden_badring_water_leakage_sensor_battery',
    'binary_sensor.ikea_of_sweden_badring_water_leakage_sensor_2': 'sensor.ikea_of_sweden_badring_water_leakage_sensor_battery_2',
    'binary_sensor.ikea_of_sweden_badring_water_leakage_sensor_3': 'sensor.ikea_of_sweden_badring_water_leakage_sensor_battery_3',
    'binary_sensor.ikea_of_sweden_badring_water_leakage_sensor_4': 'sensor.ikea_of_sweden_badring_water_leakage_sensor_battery_4',
    'binary_sensor.kitchen_water_leak_sensor_kitchen_sink': 'sensor.kitchen_water_leak_sensor_kitchen_sink_battery',
    'binary_sensor.water_leak_sensor_meg_sink': 'sensor.water_leak_sensor_meg_sink_battery',
    'binary_sensor.water_leak_sensor_chris_sink': 'sensor.water_leak_sensor_chris_sink_battery',
    'binary_sensor.water_leak_sensor_laundry_sink': 'sensor.water_leak_sensor_laundry_sink_battery',
    'binary_sensor.water_leak_sensor_refrigerator': 'sensor.water_leak_sensor_refrigerator_battery',
    'binary_sensor.water_leak_sensor_washer': 'sensor.water_leak_sensor_washer_battery'
  };
  var TEMP_RENAME = {
    'Kdnp': 'KDNP Room',
    'Kitchen View Plus': 'Kitchen (Airthings)',
    'Workout Room View Radon': 'Workout Room (Airthings)',
    'Meg Office Register Right': "Meg's Office Vent",
    'Outdoor Kitchen Fridge Ambient': 'Outdoor Kitchen (Ambient)'
  };

  function titleize(s) {
    return s.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  // Real HA area for an entity: entity area, else its device's area, else null.
  function areaOf(hass, entityId) {
    try {
      var ent = hass.entities && hass.entities[entityId];
      var areaId = ent && ent.area_id;
      if (!areaId && ent && ent.device_id && hass.devices) {
        var dev = hass.devices[ent.device_id]; areaId = dev && dev.area_id;
      }
      if (areaId && hass.areas && hass.areas[areaId]) return hass.areas[areaId].name || null;
    } catch (e) { /* registries may be absent */ }
    return null;
  }
  // Clean leak display name: HA friendly_name with the shared "Water Leak Sensor - " prefix removed.
  function stripLeakName(fn) { return (fn || '').replace(/^\s*water\s*leak\s*sensor\s*[-–—:]\s*/i, '').trim(); }
  function cleanGfci(fn) { return fn.replace(/\bGfci\b/g, 'GFCI'); }
  function leakZone(nm) {
    var n = nm.toLowerCase();
    if (n.indexOf('kitchen') > -1 || n.indexOf('dishwash') > -1 || n.indexOf('refriger') > -1) return 'Kitchen';
    if (n.indexOf('bath') > -1 || n.indexOf('sink') > -1) return 'Bathrooms';
    if (n.indexOf('laundry') > -1 || n.indexOf('wash') > -1) return 'Laundry';
    if (n.indexOf('water heater') > -1 || n.indexOf('hvac') > -1 || n.indexOf('sump') > -1) return 'Utility';
    return 'Home';
  }
  function gfciZone(nm) {
    var n = nm.toLowerCase();
    if (n.indexOf('garage') > -1) return 'Garage';
    if (n.indexOf('pool') > -1) return 'Pool';
    if (n.indexOf('kitchen') > -1) return 'Kitchen';
    if (n.indexOf('porch') > -1 || n.indexOf('walkway') > -1 || n.indexOf('grill') > -1 ||
        n.indexOf('irrigation') > -1 || n.indexOf('outdoor') > -1 || n.indexOf('front') > -1 ||
        n.indexOf('back') > -1) return 'Outdoor';
    if (n.indexOf('water heater') > -1) return 'Utility';
    return 'Home';
  }
  function stripTemp(fn) {
    return fn.replace(/ Current Temperature$/, '').replace(/ Temperature$/, '').trim();
  }
  function tempMeta(id, nm) {
    var n = (id + ' ' + nm).toLowerCase();
    if (n.indexOf('freezer') > -1) return { grp: 'Cold chain', lo: null, hi: 10 };
    if ((n.indexOf('fridge') > -1 || n.indexOf('refriger') > -1) && n.indexOf('ambient') === -1)
      return { grp: 'Cold chain', lo: 30, hi: 42 };
    return { grp: 'Climate', lo: 60, hi: 84 };
  }

  // ---------------------------------------------------------------- time (Central)
  var CT_TIME = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  var CT_FULL = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  function fmtCT(iso) { try { return CT_TIME.format(new Date(iso)) + ' CT'; } catch (e) { return ''; } }
  function relAgo(iso, now) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var m = Math.floor((now - t) / 60000);
    if (m < 2) return 'just now';
    if (m < 90) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 40) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  function lastReport(st) {
    return (st && (st.last_reported || st.last_updated || st.last_changed)) || null;
  }
  function toNum(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  // ---------------------------------------------------------------- detail view: time + history helpers
  var CT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
  var CT_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  function fmtDateCT(ms) { try { return CT_DATE.format(new Date(ms)); } catch (e) { return ''; } }
  function fmtClockCT(ms) { try { return CT_CLOCK.format(new Date(ms)); } catch (e) { return ''; } }

  // Normalize a history_during_period array -> [{t: ms, s: state}] ascending. NOTE: lu/lc are epoch SECONDS.
  function normPts(arr) {
    if (!arr || !arr.length) return [];
    return arr.map(function (p) { var sec = (p.lu != null ? p.lu : p.lc); return { t: Math.round(sec * 1000), s: p.s }; })
      .filter(function (p) { return !isNaN(p.t); })
      .sort(function (a, b) { return a.t - b.t; });
  }
  // last point with t <= tMs (points ascending); null if none
  function asOf(points, tMs) {
    var out = null;
    for (var i = 0; i < points.length; i++) { if (points[i].t <= tMs) out = points[i]; else break; }
    return out;
  }
  // collapse consecutive identical states (drops attribute-only rows the recorder kept)
  function collapseConsec(points) {
    var out = [];
    for (var i = 0; i < points.length; i++) { if (!out.length || out[out.length - 1].s !== points[i].s) out.push(points[i]); }
    return out;
  }
  function battText(s) {
    if (s == null) return '—';
    if (s === 'unknown' || s === 'unavailable') return '?';
    var n = toNum(s); return n == null ? '?' : Math.round(n) + '%';
  }

  // Build <=30 report rows for a sensor from a history_during_period result map.
  // Rows: {t, dateCT, timeCT, status, valueText, batteryText}. startMs = window start (ms).
  function buildReportRows(sensor, res, startMs) {
    res = res || {};
    var eps = startMs + 2000; // exclude the synthetic window-start boundary element
    var rows = [];
    if (sensor.kind === 'temp') {
      var tp = normPts(res[sensor.entityId]);
      var hp = sensor.humidityId ? normPts(res[sensor.humidityId]) : [];
      var now = Date.now(), span = Math.max(1, now - startMs), N = 30, buckets = {};
      tp.forEach(function (p) {
        if (p.t <= eps) return;
        var b = Math.min(N - 1, Math.floor((p.t - startMs) / span * N));
        var cur = buckets[b]; if (!cur || p.t > cur.t) buckets[b] = p;
      });
      Object.keys(buckets).forEach(function (b) {
        var p = buckets[b], v = toNum(p.s);
        var valueText = v == null ? String(p.s) : v.toFixed(1) + '°F';
        if (hp.length) { var h = asOf(hp, p.t); var hv = h && toNum(h.s); if (hv != null) valueText += ' · ' + Math.round(hv) + '%'; }
        var status = 'ok';
        if (v == null) status = 'warn';
        else { if (sensor.lo != null && v < sensor.lo) status = 'critical'; if (sensor.hi != null && v > sensor.hi) status = 'critical'; }
        rows.push({ t: p.t, dateCT: fmtDateCT(p.t), timeCT: fmtClockCT(p.t), status: status, valueText: valueText, batteryText: '—' });
      });
    } else if (sensor.kind === 'gfci') {
      collapseConsec(normPts(res[sensor.entityId])).forEach(function (p) {
        if (p.t <= eps) return;
        // Card semantics: the plug reporting at all (on OR off) means the outlet has power; only unavailable/unknown = power loss.
        var powered = p.s !== 'unavailable' && p.s !== 'unknown';
        var valueText = p.s === 'on' ? 'On' : p.s === 'off' ? 'Off' : 'No power';
        rows.push({ t: p.t, dateCT: fmtDateCT(p.t), timeCT: fmtClockCT(p.t), status: powered ? 'ok' : 'critical', valueText: valueText, batteryText: '—' });
      });
    } else { // leak: one row per check-in (battery report) unioned with leak state-changes
      var lp = normPts(res[sensor.entityId]);
      var lchg = collapseConsec(lp);
      var bp = sensor.battId ? normPts(res[sensor.battId]) : [];
      var times = [];
      bp.forEach(function (p) { if (p.t > eps) times.push(p.t); });
      lchg.forEach(function (p) { if (p.t > eps) times.push(p.t); });
      times.sort(function (a, b) { return a - b; });
      var merged = [];
      times.forEach(function (t) { if (!merged.length || t - merged[merged.length - 1] > 60000) merged.push(t); });
      merged.forEach(function (t) {
        var ls = asOf(lp, t), st = ls ? ls.s : null;
        var wet = st === 'on', dry = st === 'off';
        var bv = asOf(bp, t), bs = bv ? bv.s : null, bn = toNum(bs);
        var status = 'ok';
        if (wet) status = 'critical';
        else if (!dry) status = 'warn';
        else if (bn != null && bn <= 20) status = 'warn';
        rows.push({ t: t, dateCT: fmtDateCT(t), timeCT: fmtClockCT(t), status: status, valueText: wet ? 'Wet' : dry ? 'Dry' : '—', batteryText: battText(bs) });
      });
    }
    rows.sort(function (a, b) { return b.t - a.t; });
    return rows.slice(0, 30);
  }

  // ---------------------------------------------------------------- build model from hass
  function buildData(hass) {
    var states = hass.states || {};
    var now = Date.now();
    var sigParts = [];
    function track(id) {
      var s = states[id];
      if (s) sigParts.push(id + '=' + s.state + '@' + lastReport(s));
    }

    // ---- LEAK ----
    var leakGroup = states['group.water_leak_sensors'];
    var leakIds = (leakGroup && leakGroup.attributes && leakGroup.attributes.entity_id) || Object.keys(LEAK_NAMES);
    var leak = leakIds.map(function (id) {
      var s = states[id]; track(id);
      var fn = (s && s.attributes && s.attributes.friendly_name) || '';
      var name = stripLeakName(fn) || titleize(id.replace(/^binary_sensor\./, ''));
      var area = areaOf(hass, id);
      var zone = area || (/garage/i.test(name) ? 'Garage' : ''); // fall back to name only when no HA area is set
      var state = s ? s.state : 'unavailable';
      var online = state === 'on' || state === 'off';
      var wet = state === 'on';
      var battId = LEAK_BATT[id];
      if (battId) track(battId);
      var battState = battId && states[battId] ? states[battId].state : null;
      var battery = toNum(battState);
      var warnings = [], status = 'ok';
      if (!online) { warnings.push('Sensor offline / unreachable'); status = 'critical'; }
      if (wet) { warnings.push('WATER DETECTED'); status = 'critical'; }
      if (battState == null || battState === 'unknown' || battState === 'unavailable')
        warnings.push('Battery level not reporting');
      if (battery != null && battery <= 20) warnings.push('Low battery (' + Math.round(battery) + '%)');
      if (status !== 'critical') status = warnings.length ? 'warn' : 'ok';
      var lr = lastReport(s);
      return {
        name: name, zone: zone, online: online,
        value: wet ? 'Water detected!' : (online ? 'Dry' : '—'),
        battery: (battState == null || battState === 'unknown' || battState === 'unavailable') ? null : battery,
        warnings: warnings, status: status,
        lastCT: lr ? fmtCT(lr) : '', ago: lr ? relAgo(lr, now) : '', device: 'Zigbee',
        entityId: id, kind: 'leak', battId: battId || null
      };
    });

    // ---- GFCI ----
    var gfciGroup = states['group.gfci_canaries'];
    var gfciIds = (gfciGroup && gfciGroup.attributes && gfciGroup.attributes.entity_id) || [];
    var gfci = gfciIds.map(function (id) {
      var s = states[id]; track(id);
      var fn = (s && s.attributes && s.attributes.friendly_name) || titleize(id.replace(/^light\./, ''));
      var name = cleanGfci(fn);
      var state = s ? s.state : 'unavailable';
      var online = state !== 'unavailable' && state !== 'unknown';
      var warnings = [], status = 'ok';
      if (!online) { warnings.push('No power — GFCI may be TRIPPED'); status = 'critical'; }
      var lr = lastReport(s);
      return {
        name: name, zone: areaOf(hass, id) || gfciZone(name), online: online,
        value: online ? 'Powered' : 'No power (check GFCI)',
        battery: null, warnings: warnings, status: status,
        lastCT: lr ? fmtCT(lr) : '', ago: lr ? relAgo(lr, now) : '',
        device: (s && s.attributes && s.attributes.manufacturer) || 'Outlet monitor',
        entityId: id, domain: id.split('.')[0], switchOn: state === 'on', kind: 'gfci'
      };
    });

    // ---- TEMPERATURE ----
    var temp = [];
    Object.keys(states).forEach(function (id) {
      var s = states[id];
      if (!s || !s.attributes || s.attributes.device_class !== 'temperature') return;
      if (id.indexOf('sensor.waterguru') === 0) return;
      var fn = s.attributes.friendly_name || titleize(id.replace(/^sensor\./, ''));
      if (fn.indexOf('Keen Home Inc SV0') === 0) return; // anonymous duplicate vents
      var nm = stripTemp(fn); nm = TEMP_RENAME[nm] || nm;
      var state = s.state;
      var online = state !== 'unavailable' && state !== 'unknown';
      var meta = tempMeta(id, nm);
      if (meta.grp !== 'Cold chain') return; // temp tab shows only fridge/freezer (433) sensors
      var warnings = [], status = 'ok', value = '—';
      if (online) {
        var v = toNum(state);
        if (v != null) {
          value = v.toFixed(1) + '°F';
          if (meta.lo != null && v < meta.lo) { warnings.push('Below ' + meta.lo + '°F (too cold)'); status = meta.grp === 'Cold chain' ? 'critical' : 'warn'; }
          if (meta.hi != null && v > meta.hi) { warnings.push(meta.grp === 'Cold chain' ? ('Above ' + meta.hi + '°F — cold-chain risk') : ('Above ' + meta.hi + '°F')); status = meta.grp === 'Cold chain' ? 'critical' : 'warn'; }
        } else { value = state; }
      } else { warnings.push('Sensor offline / unreachable'); status = 'critical'; }
      track(id);
      var lr = lastReport(s);
      var humId = id.indexOf('_temperature') > -1 ? id.replace('_temperature', '_humidity') : null;
      if (humId && !states[humId]) humId = null;
      temp.push({
        name: nm, zone: meta.grp, online: online, value: value, battery: null,
        warnings: warnings, status: status, group: meta.grp,
        lastCT: lr ? fmtCT(lr) : '', ago: lr ? relAgo(lr, now) : '',
        device: meta.grp === 'Cold chain' ? 'SDR 433MHz' : 'Zigbee/Thermostat',
        entityId: id, kind: 'temp', humidityId: humId, lo: meta.lo, hi: meta.hi
      });
    });
    var sev = { critical: 0, warn: 1, ok: 2 };
    temp.sort(function (a, b) {
      var ca = a.zone === 'Cold chain' ? 0 : 1, cb = b.zone === 'Cold chain' ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (sev[a.status] !== sev[b.status]) return sev[a.status] - sev[b.status];
      return a.name.localeCompare(b.name);
    });

    function onlineCount(list) { return list.filter(function (x) { return x.online; }).length; }
    var data = {
      generatedCT: CT_FULL.format(new Date(now)) + ' CT',
      families: [
        { key: 'leak', label: 'Water Leak', icon: 'droplet', summary: onlineCount(leak) + '/' + leak.length + ' online', sensors: leak },
        { key: 'gfci', label: 'GFCI Canaries', icon: 'bolt', summary: onlineCount(gfci) + '/' + gfci.length + ' powered', sensors: gfci },
        { key: 'temp', label: 'Temperature', icon: 'thermometer', summary: onlineCount(temp) + '/' + temp.length + ' online', sensors: temp }
      ]
    };
    return { data: data, sig: sigParts.sort().join('|') };
  }

  // ==================================================================== RENDER
  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function prefersReduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function rank(s) { return s === 'critical' ? 0 : s === 'warn' ? 1 : 2; }
  function health(x) { if (!x.online) return 'critical'; if (x.status === 'critical') return 'critical'; if (x.status === 'warn') return 'warn'; return 'ok'; }
  function sortSensors(list) {
    return list.slice().sort(function (a, b) {
      var ra = rank(health(a)), rb = rank(health(b));
      if (ra !== rb) return ra - rb;
      if (a.online !== b.online) return a.online ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }
  function computeVerdict(family) {
    var sensors = family.sensors || [], total = sensors.length, crit = 0, warn = 0;
    sensors.forEach(function (s) { var h = health(s); if (h === 'critical') crit++; else if (h === 'warn') warn++; });
    var attention = crit + warn, tone, headline, sub, num;
    if (attention === 0) { tone = 'ok'; headline = 'ALL CLEAR'; num = total; sub = allClearSub(family, total); }
    else if (crit > 0) { tone = 'critical'; num = attention; headline = attention === 1 ? '1 NEEDS ATTENTION' : attention + ' NEED ATTENTION'; sub = critSub(family, crit, warn); }
    else { tone = 'warn'; num = attention; headline = attention === 1 ? '1 NEEDS ATTENTION' : attention + ' NEED ATTENTION'; sub = warn + (warn === 1 ? ' sensor to watch' : ' sensors to watch'); }
    return { tone: tone, headline: headline, sub: sub, num: num, total: total, crit: crit, warn: warn, attention: attention };
  }
  function allClearSub(f, t) { if (f.key === 'leak') return t + ' of ' + t + ' sensors dry'; if (f.key === 'gfci') return t + ' of ' + t + ' outlets powered'; return t + ' of ' + t + ' sensors nominal'; }
  function critSub(f, crit, warn) { var p = []; if (crit) p.push(crit + (f.key === 'gfci' ? (crit === 1 ? ' outlet down' : ' outlets down') : ' critical')); if (warn) p.push(warn + ' to watch'); return p.join(' · '); }

  function icon(name) {
    var svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    if (name === 'droplet') svg += '<path d="M12 3.2C9 7 6.5 9.6 6.5 13a5.5 5.5 0 0 0 11 0C17.5 9.6 15 7 12 3.2Z"/>';
    else if (name === 'bolt') svg += '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>';
    else if (name === 'thermometer') svg += '<path d="M12 3a2.5 2.5 0 0 1 2.5 2.5v8.05a4 4 0 1 1-5 0V5.5A2.5 2.5 0 0 1 12 3Z"/><path d="M12 9v6"/>';
    else if (name === 'offline') svg += '<path d="M3 3l18 18"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 3.2-2.1"/><path d="M19 12.9a10 10 0 0 0-4.6-2.7"/><path d="M2 8.8A15 15 0 0 1 6 6.3"/><path d="M22 8.8a15 15 0 0 0-6.4-3.4"/><path d="M12 20h.01"/>';
    else if (name === 'check') svg += '<path d="M20 6 9 17l-5-5"/>';
    else if (name === 'alert') svg += '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>';
    else if (name === 'back') svg += '<path d="M15 18l-6-6 6-6"/>';
    return svg + '</svg>';
  }

  function batteryRing(pct, unknown) {
    var wrap = el('div', 'pln-ring');
    var size = 38, stroke = 4.5, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
    var lvl = 'pln-ring-ok';
    if (unknown || pct == null) lvl = 'pln-ring-unknown';
    else if (pct <= 15) lvl = 'pln-ring-crit';
    else if (pct <= 35) lvl = 'pln-ring-warn';
    var val = (unknown || pct == null) ? 0 : Math.max(0, Math.min(100, pct));
    var offset = circ * (1 - val / 100), ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size); svg.setAttribute('class', 'pln-ring-svg ' + lvl); svg.setAttribute('aria-hidden', 'true');
    var bg = document.createElementNS(ns, 'circle');
    bg.setAttribute('cx', size / 2); bg.setAttribute('cy', size / 2); bg.setAttribute('r', r);
    bg.setAttribute('class', 'pln-ring-track'); bg.setAttribute('stroke-width', stroke); bg.setAttribute('fill', 'none');
    svg.appendChild(bg);
    if (!(unknown || pct == null)) {
      var fg = document.createElementNS(ns, 'circle');
      fg.setAttribute('cx', size / 2); fg.setAttribute('cy', size / 2); fg.setAttribute('r', r);
      fg.setAttribute('class', 'pln-ring-fill'); fg.setAttribute('stroke-width', stroke); fg.setAttribute('fill', 'none'); fg.setAttribute('stroke-linecap', 'round');
      fg.setAttribute('stroke-dasharray', circ.toFixed(2));
      fg.setAttribute('transform', 'rotate(-90 ' + (size / 2) + ' ' + (size / 2) + ')');
      if (prefersReduced()) fg.setAttribute('stroke-dashoffset', offset.toFixed(2));
      else { fg.setAttribute('stroke-dashoffset', circ.toFixed(2)); fg.dataset.target = offset.toFixed(2); }
      svg.appendChild(fg);
    }
    wrap.appendChild(svg);
    var label = el('div', 'pln-ring-label');
    if (unknown || pct == null) { label.textContent = '?'; label.classList.add('pln-ring-label-unknown'); }
    else label.innerHTML = '<span class="pln-ring-pct">' + val + '</span>';
    wrap.appendChild(label);
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', (unknown || pct == null) ? 'Battery level unknown' : 'Battery ' + val + ' percent');
    return wrap;
  }

  function buildToggle(sensor, onToggle) {
    var on = !!sensor.switchOn, reachable = sensor.online;
    var btn = el('button', 'pln-toggle' + (on ? ' is-on' : '') + (reachable ? '' : ' is-disabled'));
    btn.type = 'button'; btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.setAttribute('aria-label', 'Power ' + sensor.name);
    if (!reachable) { btn.disabled = true; btn.title = 'No power — GFCI may be tripped'; }
    btn.appendChild(el('span', 'pln-toggle-knob'));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!reachable) return;
      var now = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', now);              // optimistic
      btn.setAttribute('aria-checked', now ? 'true' : 'false');
      onToggle(sensor.entityId, sensor.domain);
    });
    return btn;
  }

  function buildCard(sensor, famKey, onToggle, onOpen) {
    var h = health(sensor), offline = !sensor.online;
    var card = el('article', 'pln-card pln-card-' + h);
    card.setAttribute('tabindex', '0');
    var statusLabel = offline ? 'OFFLINE' : h === 'critical' ? 'CRITICAL' : h === 'warn' ? 'WATCH' : 'OK';
    card.setAttribute('aria-label', sensor.name + ', ' + statusLabel + ', ' + sensor.value + ', ' + sensor.ago);
    var top = el('div', 'pln-cardtop');
    var flag = el('span', 'pln-flag pln-flag-' + h);
    var flagIc = el('span', 'pln-flag-ic'); flagIc.innerHTML = offline ? icon('offline') : (h === 'ok' ? icon('check') : icon('alert'));
    flag.appendChild(flagIc); flag.appendChild(el('span', 'pln-flag-txt', statusLabel));
    top.appendChild(flag);
    if (famKey === 'gfci' && sensor.entityId && onToggle) top.appendChild(buildToggle(sensor, onToggle));
    card.appendChild(top);
    card.appendChild(el('h3', 'pln-name', sensor.name));
    if (sensor.zone) card.appendChild(el('div', 'pln-zone', sensor.zone));
    card.appendChild(el('div', 'pln-value pln-value-' + h, sensor.value));
    if (sensor.warnings && sensor.warnings.length) {
      var chips = el('div', 'pln-chips');
      sensor.warnings.forEach(function (w) {
        var chip = el('span', 'pln-chip pln-chip-' + (h === 'critical' ? 'crit' : 'warn'));
        var ci = el('span', 'pln-chip-ic'); ci.innerHTML = icon('alert'); chip.appendChild(ci);
        chip.appendChild(el('span', 'pln-chip-tx', w)); chips.appendChild(chip);
      });
      card.appendChild(chips);
    }
    var meta = el('div', 'pln-meta');
    var isMains = sensor.battery == null && !(sensor.warnings || []).some(function (w) { return /not reporting/i.test(w); });
    var isUnknownBatt = sensor.battery == null && !isMains;
    var battCell = el('div', 'pln-batt');
    if (isMains) {
      var mains = el('div', 'pln-mains'); var mi = el('span', 'pln-mains-ic'); mi.innerHTML = icon('bolt');
      mains.appendChild(mi); mains.appendChild(el('span', 'pln-mains-tx', 'AC')); battCell.appendChild(mains);
    } else if (isUnknownBatt) { battCell.appendChild(batteryRing(null, true)); }
    else { battCell.appendChild(batteryRing(sensor.battery, false)); }
    battCell.appendChild(el('span', 'pln-batt-cap', isMains ? 'mains' : 'batt'));
    meta.appendChild(battCell);
    var when = el('div', 'pln-when');
    var conn = el('span', 'pln-conn ' + (offline ? 'pln-conn-off' : 'pln-conn-on'));
    conn.appendChild(el('span', 'pln-conn-dot')); conn.appendChild(el('span', null, offline ? 'Offline' : 'Online'));
    when.appendChild(conn); when.appendChild(el('span', 'pln-ago', sensor.ago || '')); when.appendChild(el('span', 'pln-ct', sensor.lastCT || ''));
    if (onOpen && sensor.entityId) {
      when.classList.add('pln-when-click');
      when.setAttribute('role', 'button'); when.setAttribute('tabindex', '0');
      when.setAttribute('aria-label', 'View recent reports for ' + sensor.name);
      when.addEventListener('click', function (e) { e.stopPropagation(); onOpen(sensor); });
      when.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(sensor); } });
    }
    meta.appendChild(when); card.appendChild(meta);
    return card;
  }

  function tallyPill(kind, count, label) {
    var p = el('span', 'pln-tp pln-tp-' + kind); p.appendChild(el('span', 'pln-tp-n', String(count))); p.appendChild(el('span', 'pln-tp-l', label)); return p;
  }
  function buildScreen(family, onToggle, onOpen) {
    var screen = el('div', 'pln-screen'), v = computeVerdict(family);
    var verdict = el('div', 'pln-verdict pln-verdict-' + v.tone); verdict.setAttribute('role', 'status');
    var vTop = el('div', 'pln-verdict-top'); var vIcon = el('span', 'pln-verdict-ic');
    vIcon.innerHTML = v.tone === 'ok' ? icon('check') : icon('alert'); vTop.appendChild(vIcon);
    vTop.appendChild(el('span', 'pln-verdict-fam', family.label)); verdict.appendChild(vTop);
    var headWrap = el('div', 'pln-verdict-headwrap');
    if (v.tone !== 'ok') {
      var bigNum = el('span', 'pln-verdict-num'); bigNum.textContent = prefersReduced() ? String(v.num) : '0';
      bigNum.dataset.target = String(v.num); headWrap.appendChild(bigNum);
      headWrap.appendChild(el('span', 'pln-verdict-word', v.headline.replace(/^\d+\s/, '')));
    } else { headWrap.appendChild(el('span', 'pln-verdict-word pln-verdict-word-full', v.headline)); }
    verdict.appendChild(headWrap);
    verdict.appendChild(el('div', 'pln-verdict-sub', v.sub));
    var tally = el('div', 'pln-tally');
    tally.appendChild(tallyPill('ok', (v.total - v.attention), 'clear'));
    if (v.warn) tally.appendChild(tallyPill('warn', v.warn, 'watch'));
    if (v.crit) tally.appendChild(tallyPill('crit', v.crit, 'critical'));
    verdict.appendChild(tally); screen.appendChild(verdict);
    var grid = el('div', 'pln-grid');
    sortSensors(family.sensors || []).forEach(function (s) { grid.appendChild(buildCard(s, family.key, onToggle, onOpen)); });
    screen.appendChild(grid);
    return { node: screen, verdict: verdict };
  }
  function countUp(node, target, dur) {
    if (prefersReduced()) { node.textContent = String(target); return; }
    var start = null;
    function step(ts) { if (start == null) start = ts; var p = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - p, 3); node.textContent = String(Math.round(target * e)); if (p < 1) requestAnimationFrame(step); else node.textContent = String(target); }
    requestAnimationFrame(step);
  }
  function animateScreen(built, skipEnter) {
    var verdict = built.verdict;
    if (!prefersReduced() && !skipEnter) { verdict.classList.add('pln-enter'); void verdict.offsetWidth; requestAnimationFrame(function () { verdict.classList.remove('pln-enter'); }); }
    var numNode = verdict.querySelector('.pln-verdict-num');
    if (numNode && numNode.dataset.target != null) countUp(numNode, parseInt(numNode.dataset.target, 10), 700);
    if (!prefersReduced()) built.node.querySelectorAll('.pln-ring-fill').forEach(function (f) { if (f.dataset.target != null) requestAnimationFrame(function () { f.style.strokeDashoffset = f.dataset.target; }); });
  }

  function css() {
    var P = '#g-root';
    return [
      P + '{--bg:#0C0F13;--bg2:#0A0D10;--card:#161B22;--card-warn:#1D1A12;--card-crit:#1F1416;',
      '--line:#242B34;--line-soft:#1C222A;--ink:#EAEEF3;--ink-dim:#AAB4C0;--muted:#727E8C;',
      '--ok:#2ED27C;--ok-ink:#7BE9AF;--ok-wash:rgba(46,210,124,0.14);',
      '--warn:#FFB020;--warn-ink:#FFD07A;--warn-wash:rgba(255,176,32,0.15);',
      '--crit:#FF5B64;--crit-ink:#FFAAB0;--crit-wash:rgba(255,91,100,0.16);',
      'font-family:system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--ink);',
      'background:radial-gradient(120% 60% at 50% -10%,#12171E 0%,var(--bg) 45%,var(--bg2) 100%);',
      'min-height:100%;box-sizing:border-box;padding:14px 12px 44px;-webkit-font-smoothing:antialiased;}',
      P + ' *,' + P + ' *::before,' + P + ' *::after{box-sizing:border-box;}',
      P + ' .pln-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:2px 4px 12px;}',
      P + ' .pln-brand{font-weight:900;letter-spacing:-0.03em;font-size:19px;color:var(--ink);}',
      P + ' .pln-brand span{color:var(--ok);}',
      P + ' .pln-brand small{display:block;font-size:10px;font-weight:800;letter-spacing:0.16em;color:var(--muted);text-transform:uppercase;margin-top:2px;}',
      P + ' .pln-gen{font-size:11px;color:var(--muted);text-align:right;line-height:1.3;font-variant-numeric:tabular-nums;}',
      P + ' .pln-seg{display:flex;gap:5px;background:#12171E;border:1px solid var(--line-soft);border-radius:14px;padding:5px;margin:0 0 16px;position:sticky;top:6px;z-index:5;}',
      P + ' .pln-seg-btn{flex:1;border:0;background:transparent;cursor:pointer;font-family:inherit;font-weight:800;font-size:12.5px;letter-spacing:-0.01em;color:var(--muted);padding:8px 4px;border-radius:10px;min-height:44px;display:flex;flex-direction:column;align-items:center;gap:3px;line-height:1;transition:background .18s,color .18s;}',
      P + ' .pln-seg-btn .pln-seg-ic{width:18px;height:18px;display:block;}',
      P + ' .pln-seg-btn .pln-seg-ic svg{width:100%;height:100%;}',
      P + ' .pln-seg-btn .pln-seg-badge{font-size:9.5px;font-weight:900;line-height:1;padding:2px 6px;border-radius:20px;background:rgba(255,255,255,0.06);color:var(--muted);}',
      P + ' .pln-seg-btn[aria-selected="true"]{background:#20272F;color:var(--ink);}',
      P + ' .pln-seg-btn[data-tone="ok"][aria-selected="true"] .pln-seg-badge{background:var(--ok-wash);color:var(--ok-ink);}',
      P + ' .pln-seg-btn[data-tone="warn"] .pln-seg-badge{background:var(--warn-wash);color:var(--warn-ink);}',
      P + ' .pln-seg-btn[data-tone="critical"] .pln-seg-badge{background:var(--crit-wash);color:var(--crit-ink);}',
      P + ' .pln-seg-btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}',
      P + ' .pln-verdict{border-radius:20px;padding:20px 18px 16px;margin-bottom:16px;position:relative;overflow:hidden;color:#fff;}',
      P + ' .pln-verdict::after{content:"";position:absolute;inset:0;background:radial-gradient(80% 120% at 85% -10%,rgba(255,255,255,0.22),transparent 60%);pointer-events:none;}',
      P + ' .pln-verdict-ok{background:linear-gradient(155deg,#16B36B,#0B7A48);box-shadow:0 10px 30px -12px rgba(22,179,107,0.7);}',
      P + ' .pln-verdict-warn{background:linear-gradient(155deg,#E9A21A,#B77900);box-shadow:0 10px 30px -12px rgba(233,162,26,0.6);}',
      P + ' .pln-verdict-critical{background:linear-gradient(155deg,#F5454F,#C0212B);box-shadow:0 10px 30px -12px rgba(245,69,79,0.65);}',
      P + ' .pln-verdict-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;opacity:0.96;position:relative;z-index:1;}',
      P + ' .pln-verdict-ic{width:24px;height:24px;display:block;flex:none;}',
      P + ' .pln-verdict-ic svg{width:100%;height:100%;stroke-width:2.4;}',
      P + ' .pln-verdict-fam{font-weight:800;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;}',
      P + ' .pln-verdict-headwrap{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 10px;line-height:0.9;position:relative;z-index:1;}',
      P + ' .pln-verdict-num{font-weight:900;font-size:66px;letter-spacing:-0.05em;font-variant-numeric:tabular-nums;}',
      P + ' .pln-verdict-word{font-weight:900;font-size:32px;letter-spacing:-0.03em;}',
      P + ' .pln-verdict-word-full{font-size:46px;}',
      P + ' .pln-verdict-sub{margin-top:9px;font-weight:600;font-size:14px;opacity:0.95;position:relative;z-index:1;}',
      P + ' .pln-tally{display:flex;gap:7px;margin-top:14px;flex-wrap:wrap;position:relative;z-index:1;}',
      P + ' .pln-tp{display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,0.22);border-radius:20px;padding:4px 10px 4px 8px;font-size:11.5px;font-weight:700;}',
      P + ' .pln-tp-n{font-weight:900;font-size:13px;font-variant-numeric:tabular-nums;}',
      P + ' .pln-tp-l{opacity:0.92;letter-spacing:0.02em;}',
      P + ' .pln-verdict{transition:transform .5s cubic-bezier(.16,1,.3,1),opacity .5s ease;}',
      P + ' .pln-verdict.pln-enter{transform:scale(0.95);opacity:0;}',
      P + ' .pln-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch;}',
      P + ' .pln-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 12px 11px;position:relative;overflow:hidden;display:flex;flex-direction:column;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,0.3);}',
      P + ' .pln-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--ok);}',
      P + ' .pln-card-ok::before{background:var(--ok);}',
      P + ' .pln-card-warn::before{background:var(--warn);}',
      P + ' .pln-card-critical::before{background:var(--crit);}',
      P + ' .pln-card-warn{border-color:#3A3420;background:linear-gradient(180deg,var(--card-warn),var(--card));}',
      P + ' .pln-card-critical{border-color:#4A2226;background:linear-gradient(180deg,var(--card-crit),var(--card));}',
      P + ' .pln-card:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}',
      P + ' .pln-cardtop{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      P + ' .pln-flag{display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 6px;border-radius:16px;font-size:10px;font-weight:900;letter-spacing:0.05em;margin-left:2px;}',
      P + ' .pln-toggle{position:relative;width:42px;height:24px;flex:none;border:1px solid var(--line);background:#20272F;border-radius:14px;cursor:pointer;padding:0;transition:background .18s ease;}',
      P + ' .pln-toggle-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#8A94A2;transition:transform .2s cubic-bezier(.3,1.4,.5,1),background .18s;}',
      P + ' .pln-toggle.is-on{background:var(--ok);border-color:transparent;}',
      P + ' .pln-toggle.is-on .pln-toggle-knob{transform:translateX(18px);background:#06140C;}',
      P + ' .pln-toggle.is-disabled{opacity:.38;cursor:not-allowed;}',
      P + ' .pln-toggle:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}',
      P + ' .pln-flag-ic{width:12px;height:12px;display:block;}',
      P + ' .pln-flag-ic svg{width:100%;height:100%;stroke-width:2.6;}',
      P + ' .pln-flag-ok{background:var(--ok-wash);color:var(--ok-ink);}',
      P + ' .pln-flag-warn{background:var(--warn-wash);color:var(--warn-ink);}',
      P + ' .pln-flag-critical{background:var(--crit);color:#150607;}',
      P + ' .pln-name{margin:9px 0 0;padding-left:2px;font-size:14.5px;font-weight:800;letter-spacing:-0.01em;line-height:1.18;}',
      P + ' .pln-zone{padding-left:2px;font-size:9.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:3px;}',
      P + ' .pln-value{padding-left:2px;margin-top:9px;font-size:23px;font-weight:900;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums;word-break:break-word;}',
      P + ' .pln-value-ok{color:var(--ink);}',
      P + ' .pln-value-warn{color:var(--warn-ink);}',
      P + ' .pln-value-critical{color:var(--crit-ink);}',
      P + ' .pln-chips{display:flex;flex-direction:column;gap:5px;margin-top:9px;padding-left:2px;}',
      P + ' .pln-chip{display:inline-flex;align-items:flex-start;gap:5px;font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:9px;line-height:1.25;}',
      P + ' .pln-chip-ic{width:11px;height:11px;flex:none;display:block;margin-top:1px;}',
      P + ' .pln-chip-ic svg{width:100%;height:100%;stroke-width:2.6;}',
      P + ' .pln-chip-warn{background:var(--warn-wash);color:var(--warn-ink);}',
      P + ' .pln-chip-crit{background:var(--crit-wash);color:var(--crit-ink);}',
      P + ' .pln-meta{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:11px;padding:10px 0 1px 2px;border-top:1px solid var(--line-soft);}',
      P + ' .pln-batt{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none;}',
      P + ' .pln-ring{position:relative;width:38px;height:38px;}',
      P + ' .pln-ring-svg{width:38px;height:38px;display:block;}',
      P + ' .pln-ring-track{stroke:#2A323C;}',
      P + ' .pln-ring-fill{transition:stroke-dashoffset 1s cubic-bezier(.16,1,.3,1);}',
      P + ' .pln-ring-ok .pln-ring-fill{stroke:var(--ok);}',
      P + ' .pln-ring-warn .pln-ring-fill{stroke:var(--warn);}',
      P + ' .pln-ring-crit .pln-ring-fill{stroke:var(--crit);}',
      P + ' .pln-ring-unknown .pln-ring-track{stroke:#39424D;stroke-dasharray:3 4;}',
      P + ' .pln-ring-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:900;letter-spacing:-0.03em;color:var(--ink);}',
      P + ' .pln-ring-pct{font-size:12px;font-variant-numeric:tabular-nums;}',
      P + ' .pln-ring-label-unknown{font-size:16px;color:var(--muted);}',
      P + ' .pln-mains{width:38px;height:38px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1B222A;border:1px dashed #333C46;}',
      P + ' .pln-mains-ic{width:15px;height:15px;color:var(--ink-dim);}',
      P + ' .pln-mains-ic svg{width:100%;height:100%;stroke-width:2.2;}',
      P + ' .pln-mains-tx{font-size:8px;font-weight:900;color:var(--muted);letter-spacing:0.04em;}',
      P + ' .pln-batt-cap{font-size:8px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;}',
      P + ' .pln-when{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:3px;min-width:0;}',
      P + ' .pln-conn{display:inline-flex;align-items:center;gap:4px;font-size:9.5px;font-weight:800;letter-spacing:0.02em;}',
      P + ' .pln-conn-dot{width:6px;height:6px;border-radius:50%;display:block;}',
      P + ' .pln-conn-on{color:var(--ok-ink);}',
      P + ' .pln-conn-on .pln-conn-dot{background:var(--ok);box-shadow:0 0 0 3px var(--ok-wash);}',
      P + ' .pln-conn-off{color:var(--crit-ink);}',
      P + ' .pln-conn-off .pln-conn-dot{background:var(--crit);box-shadow:0 0 0 3px var(--crit-wash);}',
      P + ' .pln-ago{font-size:11.5px;font-weight:800;color:var(--ink);}',
      P + ' .pln-ct{font-size:9px;color:var(--muted);font-variant-numeric:tabular-nums;line-height:1.2;}',
      '@media (min-width:560px){' + P + '{padding:18px 18px 48px;}' + P + ' .pln-grid{grid-template-columns:repeat(3,1fr);gap:12px;}' + P + ' .pln-verdict-num{font-size:84px;}' + P + ' .pln-verdict-word{font-size:40px;}' + P + ' .pln-verdict-word-full{font-size:56px;}' + P + ' .pln-name{font-size:15.5px;}' + P + ' .pln-value{font-size:26px;}}',
      '@media (min-width:860px){' + P + ' .pln-grid{grid-template-columns:repeat(4,1fr);}}',
      '@media (min-width:1200px){' + P + ' .pln-grid{grid-template-columns:repeat(5,1fr);}' + P + ' .pln-wrap{max-width:1160px;margin:0 auto;}}',
      // ---- clickable footer (appearance-preserving: text unchanged; only affordances) ----
      P + ' .pln-when-click{cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:9px;padding:3px 4px 3px 8px;margin:-3px -4px -3px -8px;transition:background .15s ease;}',
      P + ' .pln-when-click:hover{background:rgba(255,255,255,0.04);}',
      P + ' .pln-when-click:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}',
      // ---- detail view ----
      P + ' .pln-detail{animation:plnfade .28s ease;}',
      '@keyframes plnfade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}',
      P + ' .pln-dhead{margin-bottom:14px;}',
      P + ' .pln-back{display:inline-flex;align-items:center;gap:5px;background:#12171E;border:1px solid var(--line-soft);color:var(--ink-dim);font-family:inherit;font-weight:800;font-size:12px;padding:8px 12px 8px 9px;border-radius:11px;cursor:pointer;min-height:40px;-webkit-tap-highlight-color:transparent;}',
      P + ' .pln-back:hover{color:var(--ink);border-color:var(--line);}',
      P + ' .pln-back:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}',
      P + ' .pln-back svg{width:16px;height:16px;stroke-width:2.4;}',
      P + ' .pln-dtitle{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;margin:14px 2px 0;}',
      P + ' .pln-dname{font-size:22px;font-weight:900;letter-spacing:-0.02em;}',
      P + ' .pln-dzone{font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.09em;}',
      P + ' .pln-dnow{display:flex;align-items:center;gap:10px;margin:9px 2px 0;}',
      P + ' .pln-dpill{font-size:10.5px;font-weight:900;letter-spacing:0.05em;padding:3px 9px;border-radius:16px;}',
      P + ' .pln-dpill-ok{background:var(--ok-wash);color:var(--ok-ink);}',
      P + ' .pln-dpill-warn{background:var(--warn-wash);color:var(--warn-ink);}',
      P + ' .pln-dpill-critical{background:var(--crit-wash);color:var(--crit-ink);}',
      P + ' .pln-dval{font-size:15px;font-weight:800;color:var(--ink-dim);font-variant-numeric:tabular-nums;}',
      P + ' .pln-dbody{margin-top:4px;}',
      P + ' .pln-loading,' + P + ' .pln-empty{padding:34px 8px;text-align:center;color:var(--muted);font-size:13px;font-weight:700;}',
      P + ' .pln-error{padding:30px 8px;text-align:center;color:var(--crit-ink);font-size:13px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:12px;}',
      P + ' .pln-retry{background:#12171E;border:1px solid var(--line);color:var(--ink);font-family:inherit;font-weight:800;font-size:12.5px;padding:9px 18px;border-radius:11px;cursor:pointer;min-height:40px;}',
      P + ' .pln-rlist{display:flex;flex-direction:column;gap:6px;}',
      P + ' .pln-rrow{display:grid;grid-template-columns:minmax(92px,1.15fr) 62px 1fr auto;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-left-width:4px;border-radius:11px;padding:9px 11px;}',
      P + ' .pln-rrow-ok{border-left-color:var(--ok);}',
      P + ' .pln-rrow-warn{border-left-color:var(--warn);background:linear-gradient(180deg,var(--card-warn),var(--card));}',
      P + ' .pln-rrow-critical{border-left-color:var(--crit);background:linear-gradient(180deg,var(--card-crit),var(--card));}',
      P + ' .pln-rhead{background:transparent;border:0;padding:2px 11px;}',
      P + ' .pln-rhead .pln-rc{font-size:9px;font-weight:900;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;}',
      P + ' .pln-rc{min-width:0;font-size:12.5px;font-weight:700;}',
      P + ' .pln-rwhen{display:flex;flex-direction:column;gap:1px;}',
      P + ' .pln-rdate{font-weight:900;font-size:12.5px;color:var(--ink);font-variant-numeric:tabular-nums;}',
      P + ' .pln-rtime{font-size:10.5px;color:var(--muted);font-variant-numeric:tabular-nums;}',
      P + ' .pln-rstatus{display:inline-flex;align-items:center;gap:5px;}',
      P + ' .pln-rdot{width:8px;height:8px;border-radius:50%;flex:none;}',
      P + ' .pln-rdot-ok{background:var(--ok);}',
      P + ' .pln-rdot-warn{background:var(--warn);}',
      P + ' .pln-rdot-critical{background:var(--crit);}',
      P + ' .pln-rstat{font-size:10.5px;font-weight:800;color:var(--ink-dim);}',
      P + ' .pln-rval{font-weight:900;font-size:13.5px;letter-spacing:-0.01em;color:var(--ink);font-variant-numeric:tabular-nums;word-break:break-word;}',
      P + ' .pln-rbatt{font-size:12px;font-weight:800;color:var(--ink-dim);text-align:right;font-variant-numeric:tabular-nums;}',
      P + ' .pln-rnote{margin:12px 2px 0;font-size:10.5px;color:var(--muted);font-weight:700;text-align:center;}',
      '@media (min-width:560px){' + P + ' .pln-rrow{grid-template-columns:minmax(120px,1fr) 90px 1.2fr auto;padding:11px 14px;}' + P + ' .pln-dname{font-size:26px;}}',
      '@media (prefers-reduced-motion: reduce){' + P + ' .pln-verdict{transition:none;}' + P + ' .pln-verdict.pln-enter{transform:none;opacity:1;}' + P + ' .pln-ring-fill{transition:none;}' + P + ' .pln-detail{animation:none;}}'
    ].join('');
  }

  // ==================================================================== element
  class GuardianDashboard extends HTMLElement {
    setConfig(config) { this._config = config || {}; }
    getCardSize() { return 12; }

    _ensureShell() {
      if (this._root) return;
      var shadow = this.attachShadow({ mode: 'open' });
      var style = document.createElement('style'); style.textContent = css(); shadow.appendChild(style);
      var root = document.createElement('div'); root.id = 'g-root';
      var wrap = document.createElement('div'); wrap.className = 'pln-wrap'; root.appendChild(wrap);
      shadow.appendChild(root);
      this._root = root; this._wrap = wrap;

      var head = el('div', 'pln-head');
      var brand = el('div', 'pln-brand'); brand.innerHTML = 'PULSE<span>.</span><small>Noir · Home Guardian</small>';
      head.appendChild(brand);
      this._gen = el('div', 'pln-gen'); head.appendChild(this._gen);
      wrap.appendChild(head);

      var seg = el('div', 'pln-seg'); seg.setAttribute('role', 'tablist'); seg.setAttribute('aria-label', 'Sensor family');
      this._buttons = []; var self = this;
      ['droplet', 'bolt', 'thermometer'].forEach(function (ic, i) {
        var btn = el('button', 'pln-seg-btn'); btn.type = 'button'; btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', 'false'); btn.setAttribute('tabindex', '-1');
        var icn = el('span', 'pln-seg-ic'); icn.innerHTML = icon(ic); btn.appendChild(icn);
        btn.appendChild(el('span', 'pln-seg-lbl', ['Water Leak', 'GFCI Canaries', 'Temperature'][i]));
        btn.appendChild(el('span', 'pln-seg-badge', ''));
        btn.addEventListener('click', function () { self._select(i, false); });
        btn.addEventListener('keydown', function (e) {
          var idx = null;
          if (e.key === 'ArrowRight') idx = (i + 1) % 3;
          else if (e.key === 'ArrowLeft') idx = (i + 2) % 3;
          if (idx != null) { e.preventDefault(); self._select(idx, false); self._buttons[idx].focus(); }
        });
        self._buttons.push(btn); seg.appendChild(btn);
      });
      wrap.appendChild(seg);
      this._stage = el('div', 'pln-stage'); wrap.appendChild(this._stage);
      this._sel = 0;
    }

    _select(i, skipEnter) {
      this._detail = null; // leaving any open detail view when a family is (re)selected
      this._sel = i;
      for (var j = 0; j < 3; j++) {
        var on = j === i;
        this._buttons[j].setAttribute('aria-selected', on ? 'true' : 'false');
        this._buttons[j].setAttribute('tabindex', on ? '0' : '-1');
      }
      this._stage.innerHTML = '';
      var self = this;
      var onToggle = function (entityId, domain) {
        if (self._hass && self._hass.callService) self._hass.callService(domain || 'light', 'toggle', { entity_id: entityId });
      };
      var onOpen = function (sensor) { self._openDetail(sensor); };
      var built = buildScreen(this._data.families[i], onToggle, onOpen);
      this._stage.appendChild(built.node);
      animateScreen(built, skipEnter);
    }

    // ---- single-sensor detail view ----
    _openDetail(sensor) {
      this._detail = sensor;
      var token = (this._detailToken = (this._detailToken || 0) + 1); // unique per open; sensor objects are reused so identity isn't enough
      this._renderDetailShell(sensor);
      var self = this;
      var startMs = Date.now() - (sensor.kind === 'temp' ? 2 : 90) * 86400000;
      this._fetchReports(sensor, startMs).then(function (rows) {
        if (self._detailToken !== token || !self._detail) return; // navigated away or reopened before fetch resolved
        self._renderRows(rows);
      }).catch(function () {
        if (self._detailToken !== token || !self._detail) return;
        self._renderError();
      });
    }

    _fetchReports(sensor, startMs) {
      var hass = this._hass;
      if (!hass || !hass.callWS) return Promise.reject(new Error('no hass.callWS'));
      var ids = [sensor.entityId];
      if (sensor.kind === 'leak' && sensor.battId) ids.push(sensor.battId);
      if (sensor.kind === 'temp' && sensor.humidityId) ids.push(sensor.humidityId);
      return hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(startMs).toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: ids, minimal_response: false, no_attributes: true, significant_changes_only: false
      }).then(function (res) { return buildReportRows(sensor, res, startMs); });
    }

    _renderDetailShell(sensor) {
      this._stage.innerHTML = '';
      var self = this;
      var wrap = el('div', 'pln-detail');
      var head = el('div', 'pln-dhead');
      var back = el('button', 'pln-back'); back.type = 'button';
      back.innerHTML = icon('back'); back.appendChild(el('span', null, 'All sensors'));
      back.setAttribute('aria-label', 'Back to all sensors');
      back.addEventListener('click', function () { self._closeDetail(); });
      head.appendChild(back);
      var titleRow = el('div', 'pln-dtitle');
      titleRow.appendChild(el('div', 'pln-dname', sensor.name));
      if (sensor.zone) titleRow.appendChild(el('div', 'pln-dzone', sensor.zone));
      head.appendChild(titleRow);
      var nowRow = el('div', 'pln-dnow');
      var h = health(sensor);
      var pill = el('span', 'pln-dpill pln-dpill-' + h, h === 'critical' ? (sensor.online ? 'CRITICAL' : 'OFFLINE') : h === 'warn' ? 'WATCH' : 'OK');
      var val = el('span', 'pln-dval', sensor.value || '');
      nowRow.appendChild(pill); nowRow.appendChild(val);
      head.appendChild(nowRow);
      wrap.appendChild(head);
      this._detailHdr = { pill: pill, val: val };
      var body = el('div', 'pln-dbody');
      body.appendChild(el('div', 'pln-loading', 'Loading recent reports…'));
      wrap.appendChild(body);
      this._detailBody = body;
      this._stage.appendChild(wrap);
      try { back.focus(); } catch (e) { /* focus optional */ }
    }

    _renderRows(rows) {
      var body = this._detailBody; if (!body) return; body.innerHTML = '';
      if (!rows || !rows.length) { body.appendChild(el('div', 'pln-empty', 'No changes recorded in this window — a steady reading is not stored as a new report.')); return; }
      var list = el('div', 'pln-rlist');
      var head = el('div', 'pln-rrow pln-rhead');
      ['When (CT)', 'Status', 'Value', 'Batt'].forEach(function (t) { head.appendChild(el('span', 'pln-rc', t)); });
      list.appendChild(head);
      rows.forEach(function (r) {
        var row = el('div', 'pln-rrow pln-rrow-' + r.status);
        var when = el('span', 'pln-rc pln-rwhen');
        when.appendChild(el('span', 'pln-rdate', r.dateCT));
        when.appendChild(el('span', 'pln-rtime', r.timeCT));
        row.appendChild(when);
        var stc = el('span', 'pln-rc pln-rstatus');
        stc.appendChild(el('span', 'pln-rdot pln-rdot-' + r.status));
        stc.appendChild(el('span', 'pln-rstat', r.status === 'critical' ? 'Alert' : r.status === 'warn' ? 'Watch' : 'OK'));
        row.appendChild(stc);
        row.appendChild(el('span', 'pln-rc pln-rval', r.valueText));
        row.appendChild(el('span', 'pln-rc pln-rbatt', r.batteryText));
        list.appendChild(row);
      });
      body.appendChild(list);
      body.appendChild(el('div', 'pln-rnote', rows.length + (rows.length === 1 ? ' report' : ' reports') + ' · most recent first'));
    }

    _renderError() {
      var body = this._detailBody; if (!body) return; body.innerHTML = '';
      var self = this, wrap = el('div', 'pln-error');
      wrap.appendChild(el('div', null, 'Couldn’t load history.'));
      var retry = el('button', 'pln-retry', 'Retry'); retry.type = 'button';
      retry.addEventListener('click', function () { if (self._detail) self._openDetail(self._detail); });
      wrap.appendChild(retry); body.appendChild(wrap);
    }

    _closeDetail() {
      this._detail = null;
      this._select(this._sel, true);
      try { this._buttons[this._sel].focus(); } catch (e) { /* focus optional */ }
    }

    // Patch just the detail header from fresh data on a background refresh (stage not rebuilt).
    _patchDetailHeader() {
      if (!this._detail || !this._detailHdr || !this._data) return;
      var eid = this._detail.entityId, fresh = null;
      this._data.families.forEach(function (f) { (f.sensors || []).forEach(function (s) { if (s.entityId === eid) fresh = s; }); });
      if (!fresh) return;
      var h = health(fresh);
      this._detailHdr.pill.className = 'pln-dpill pln-dpill-' + h;
      this._detailHdr.pill.textContent = h === 'critical' ? (fresh.online ? 'CRITICAL' : 'OFFLINE') : h === 'warn' ? 'WATCH' : 'OK';
      this._detailHdr.val.textContent = fresh.value || '';
    }

    _updateTabs() {
      for (var i = 0; i < 3; i++) {
        var v = computeVerdict(this._data.families[i]);
        this._buttons[i].setAttribute('data-tone', v.tone);
        this._buttons[i].querySelector('.pln-seg-badge').textContent =
          v.attention === 0 ? (v.total + ' ok') : (v.attention + '!');
      }
    }

    set hass(hass) {
      if (!hass) return;
      this._hass = hass;
      var res = buildData(hass);
      var firstRender = !this._root;
      this._ensureShell();
      if (res.sig === this._sig && !firstRender) { this._gen.textContent = res.data.generatedCT; return; }
      this._sig = res.sig; this._data = res.data;
      this._gen.textContent = res.data.generatedCT;
      this._updateTabs();
      if (this._detail && !firstRender) { this._patchDetailHeader(); return; } // keep open detail view; refresh its header only
      this._select(this._sel, !firstRender); // skip enter-zoom on background refreshes
    }
    get hass() { return this._hass; }
  }

  if (!customElements.get('guardian-dashboard')) customElements.define('guardian-dashboard', GuardianDashboard);

  if (!customElements.get('pulse-noir-card')) {
    try {
      class PulseNoirCard extends GuardianDashboard {}
      customElements.define('pulse-noir-card', PulseNoirCard);
      window.customCards = window.customCards || [];
      window.customCards.push({ type: 'pulse-noir-card', name: 'Pulse Noir — Home Guardian', description: 'Leak / GFCI / temperature guardian dashboard' });
    } catch (e) { /* optional */ }
  }

  // eslint-disable-next-line no-console
  console.info('%c Home Guardian — Pulse Noir %c loaded (v4 · sensor-detail) ', 'background:#0C0F13;color:#2ED27C;font-weight:700', '');
})();
