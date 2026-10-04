(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const history = [];
  const APP_VERSION = '2.6.0';
  let sensorApi = null;
  let sensorPlugin = null;
  let sensorDiscoveryPromise = null;
  let timer = null;
  let initialized = false;
  const discoveredSensors = { gpu:null, temp:null, vram:null, cpu:null, ram:null };

  function prop(name, fallback) {
    try {
      if (Object.prototype.hasOwnProperty.call(window, name)) {
        const v = window[name];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      const v = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
      return (v === undefined || v === null || v === '') ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }

  function number(v) {
    const n = Number.parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function serverBase() {
    return String(prop('serverUrl', 'http://127.0.0.1:18091')).trim().replace(/\/+$/, '');
  }

  function fit() {
    document.body.dataset.size = innerWidth + 'x' + innerHeight;
  }

  async function fetchText(path, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 2000);
    try {
      const response = await fetch(serverBase() + path, {
        cache: 'no-store',
        signal: controller.signal
      });
      return { ok: response.ok, status: response.status, text: await response.text() };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchJson(path, timeoutMs) {
    const result = await fetchText(path, timeoutMs);
    let data = null;
    try { data = JSON.parse(result.text); } catch (_) {}
    return Object.assign({}, result, { data });
  }

  function parsePrometheus(text) {
    let source = String(text || '');
    if (source.startsWith('"') && source.endsWith('"')) {
      try { source = JSON.parse(source); } catch (_) {}
    }
    const out = {};
    source.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const match = line.match(/^([^\s{]+)(?:\{[^}]*\})?\s+([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)$/);
      if (match) out[match[1]] = Number(match[2]);
    });
    return out;
  }

  function slotSummary(data) {
    const slots = Array.isArray(data) ? data : [];
    const active = slots.filter((s) => s && s.is_processing);
    let max = 0;
    let used = 0;
    for (const slot of (active.length ? active : slots)) {
      max = Math.max(max, Number(slot.n_ctx) || 0);
      [slot.n_past, slot.n_prompt_tokens, slot.prompt_tokens, slot.tokens_evaluated].forEach((v) => {
        used = Math.max(used, Number(v) || 0);
      });
    }
    return { active: active.length, max, used };
  }

  function setState(state) {
    const design = $('app');
    design.classList.remove('state-ready', 'state-generating', 'state-loading', 'state-offline', 'state-error');
    design.classList.add('state-' + state);
    $('stateText').textContent = (state === 'ready' || state === 'generating') ? 'READY' : state.toUpperCase();
    if ($('chartEmptyTitle')) {
      $('chartEmptyTitle').textContent = state === 'offline' || state === 'error'
        ? 'BACKEND HORS LIGNE'
        : 'EN ATTENTE DU BACKEND';
    }
  }

  function metric(id, value) {
    $(id).textContent = value === null || value === undefined ? '—' : String(Math.round(value));
  }

  function setSensorStatus(message) {
    const element = $('sensorStatus');
    if (element) element.textContent = message;
  }

  function drawChart() {
    const canvas = $('chartCanvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#243746';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    [10, h / 2, h - 10].forEach((y) => {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    });
    for (let i = 1; i < 8; i += 1) {
      const x = w * i / 8;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (history.length < 2) return;
    const peak = Math.max(60, ...history) * 1.03;
    const points = history.map((v, i) => ({
      x: (i / (history.length - 1)) * w,
      y: h - 10 - (v / peak) * (h - 20)
    }));

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(54,239,118,.55)');
    grad.addColorStop(1, 'rgba(0,147,63,.03)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, h);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = '#48ef79';
    ctx.lineWidth = 2.3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function trimHistory() {
    const seconds = Number(prop('historySeconds', '60')) || 60;
    const refresh = Number(prop('refreshSeconds', '1')) || 1;
    const maxPoints = Math.max(15, Math.round(seconds / refresh));
    while (history.length > maxPoints) history.shift();
  }

  function resetDiscoveredSensors() {
    Object.keys(discoveredSensors).forEach((key) => { discoveredSensors[key] = null; });
    sensorDiscoveryPromise = null;
  }

  function setupSensors() {
    try {
      const plugin = window.plugins && window.plugins.Sensorsdataprovider;
      if (!plugin) {
        setSensorStatus('Capteurs iCUE · en attente du fournisseur');
        return false;
      }
      if (sensorPlugin !== plugin || !sensorApi) {
        sensorPlugin = plugin;
        sensorApi = new SimpleSensorApiWrapper(plugin, 6000);
        resetDiscoveredSensors();
      }
      setSensorStatus('Capteurs iCUE · détection…');
      return true;
    } catch (_) {
      sensorPlugin = null;
      sensorApi = null;
      setSensorStatus('Capteurs iCUE · fournisseur indisponible');
      return false;
    }
  }

  function normalizedSensorId(value) {
    if (typeof value === 'string') {
      const id = value.trim();
      return id && id !== 'undefined' && id !== 'null' ? id : null;
    }
    if (value && typeof value.sensorId === 'string') return normalizedSensorId(value.sensorId);
    return null;
  }

  function sensorScore(key, info) {
    const type = info.type;
    const kind = info.kind;
    const name = info.name;
    const device = info.device;
    const all = type + ' ' + kind + ' ' + name + ' ' + device;
    const gpuDevice = /display.?adapter|gpu|nvidia|geforce|rtx|radeon/.test(device + ' ' + all);
    const temperature = /temp|temperature/.test(type + ' ' + kind);
    const utilization = /load|utili[sz]ation|usage/.test(type + ' ' + kind);

    if (key === 'temp') {
      if (/gpu.?temp|temperature.?gpu/.test(kind)) return 100;
      if (temperature && gpuDevice && /\bgpu\b/.test(name)) return 95;
      if (temperature && gpuDevice && !/memory|hot.?spot/.test(name)) return 80;
      return 0;
    }
    if (key === 'gpu') {
      if (/gpu.?load|utili[sz]ation.?gpu/.test(kind)) return 100;
      if (utilization && gpuDevice && /\bgpu\b/.test(name)) return 90;
      return 0;
    }
    if (key === 'vram') {
      if (/frame.?buffer.?load/.test(kind)) return 100;
      if (utilization && gpuDevice && /frame.?buffer|dedicated memory|vram|video memory/.test(name + ' ' + kind)) return 90;
      if (utilization && gpuDevice && /\bmemory\b/.test(name)) return 70;
      return 0;
    }
    if (key === 'cpu') {
      if (/utili[sz]ation.?cpu.?package|cpu.?load/.test(kind)) return 100;
      if (utilization && /processor|cpu|ryzen|threadripper/.test(device) && /processor|package|total/.test(name)) return 90;
      return 0;
    }
    if (key === 'ram') {
      if (/memory.?load|utili[sz]ation.?memory/.test(kind)) return 100;
      if (utilization && /physical memory load|system memory|\bram\b/.test(name + ' ' + device)) return 90;
      return 0;
    }
    return 0;
  }

  async function inspectSensor(sensorId) {
    const values = await Promise.allSettled([
      sensorApi.getSensorType(sensorId),
      sensorApi.getSensorKind(sensorId),
      sensorApi.getSensorName(sensorId),
      sensorApi.getSensorDeviceName(sensorId)
    ]);
    const value = (index) => values[index].status === 'fulfilled' ? String(values[index].value || '').toLowerCase() : '';
    return { id:sensorId, type:value(0), kind:value(1), name:value(2), device:value(3) };
  }

  async function discoverSensors() {
    if (!sensorApi && !setupSensors()) return false;
    if (sensorDiscoveryPromise) return sensorDiscoveryPromise;

    sensorDiscoveryPromise = (async () => {
      const rawIds = await sensorApi.getAllSensorIds();
      const ids = Array.isArray(rawIds) ? rawIds.map(normalizedSensorId).filter(Boolean) : [];
      if (!ids.length) throw new Error('aucun capteur publié par iCUE');

      const best = {
        gpu:{ score:0, id:null }, temp:{ score:0, id:null }, vram:{ score:0, id:null },
        cpu:{ score:0, id:null }, ram:{ score:0, id:null }
      };
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < ids.length) {
          const index = nextIndex++;
          let info;
          try { info = await inspectSensor(ids[index]); }
          catch (_) { continue; }
          Object.keys(best).forEach((key) => {
            const score = sensorScore(key, info);
            if (score > best[key].score) best[key] = { score, id:info.id };
          });
        }
      };
      const workerCount = Math.min(8, ids.length);
      await Promise.all(Array.from({ length:workerCount }, worker));
      Object.keys(best).forEach((key) => { discoveredSensors[key] = best[key].id; });

      if (!discoveredSensors.temp) throw new Error('température GPU introuvable');
      setSensorStatus('Capteurs iCUE · GPU temperature détectée');
      return true;
    })().catch((error) => {
      sensorDiscoveryPromise = null;
      setSensorStatus('Capteurs iCUE · ' + String(error && error.message ? error.message : error));
      return false;
    });
    return sensorDiscoveryPromise;
  }

  async function sensorValue(sensorId) {
    if (!sensorApi || !sensorId) return null;
    try { return number(await sensorApi.getSensorValue(sensorId)); }
    catch (_) { return null; }
  }

  async function readSensor(propertyName, fallbackKey) {
    if (!sensorApi && !setupSensors()) return null;
    const configuredId = normalizedSensorId(prop(propertyName, ''));
    if (configuredId) {
      const configuredValue = await sensorValue(configuredId);
      if (configuredValue !== null) return configuredValue;
    }
    await discoverSensors();
    return sensorValue(discoveredSensors[fallbackKey]);
  }

  async function updateHardware() {
    const values = await Promise.all([
      readSensor('gpuLoadSensor','gpu'),
      readSensor('gpuTempSensor','temp'),
      readSensor('vramLoadSensor','vram'),
      readSensor('cpuLoadSensor','cpu'),
      readSensor('ramLoadSensor','ram')
    ]);
    const gpu = values[0], temp = values[1], vram = values[2], cpu = values[3], ram = values[4];
    metric('gpuVal', gpu); metric('tempVal', temp); metric('cpuVal', cpu); metric('ramVal', ram);
    $('hwGpu').textContent = gpu == null ? '—' : Math.round(gpu) + ' %';
    $('hwTemp').textContent = temp == null ? '—' : Math.round(temp) + ' °C';
    $('hwCpu').textContent = cpu == null ? '—' : Math.round(cpu) + ' %';
    $('hwRam').textContent = ram == null ? '—' : Math.round(ram) + ' %';
    if (temp !== null) setSensorStatus('Capteurs iCUE · GPU temperature active');

    const total = Number(prop('totalVramGB', '24')) || 24;
    if (vram == null) {
      $('vramVal').textContent = '—';
      $('hwVram').textContent = '—';
    } else {
      const used = total * vram / 100;
      const label = used.toFixed(1) + ' / ' + total + ' GB';
      $('vramVal').textContent = label;
      $('hwVram').textContent = label;
    }
  }

  function modelName(props) {
    const override = String(prop('modelOverride', '')).trim();
    if (override) return override;
    const raw = props && (props.model_path || props.model);
    if (!raw) return 'Local LLM';
    return String(raw).split(/[\\/]/).pop().replace(/\.gguf$/i, '');
  }

  async function updateRuntime() {
    try {
      const health = await fetchJson('/health', 1800);
      if (!health.ok) {
        if (health.status === 503) setState('loading');
        throw new Error('llama.cpp HTTP ' + health.status);
      }

      const results = await Promise.allSettled([
        fetchText('/metrics', 1800),
        fetchJson('/slots', 1800),
        fetchJson('/props', 1800)
      ]);
      const metrics = results[0].status === 'fulfilled' && results[0].value.ok ? parsePrometheus(results[0].value.text) : {};
      const slots = results[1].status === 'fulfilled' && results[1].value.ok ? results[1].value.data : [];
      const props = results[2].status === 'fulfilled' && results[2].value.ok ? results[2].value.data : {};
      const summary = slotSummary(slots);

      const processing = Number.isFinite(metrics['llamacpp:requests_processing']) ? metrics['llamacpp:requests_processing'] : summary.active;
      const deferred = Number.isFinite(metrics['llamacpp:requests_deferred']) ? metrics['llamacpp:requests_deferred'] : 0;
      const generation = metrics['llamacpp:predicted_tokens_seconds'];
      const prompt = metrics['llamacpp:prompt_tokens_seconds'];

      $('modelText').textContent = modelName(props);
      $('backendText').textContent = String(prop('backendLabel', 'llama.cpp'));
      $('genVal').textContent = Number.isFinite(generation) ? generation.toFixed(1) : '—';
      $('promptVal').textContent = Number.isFinite(prompt) ? String(Math.round(prompt)) : '—';
      $('reqVal').textContent = String(processing || 0);
      $('queueVal').textContent = String(deferred || 0);

      const max = summary.max || Number(props && props.default_generation_settings && props.default_generation_settings.n_ctx) || 0;
      const used = summary.used || 0;
      const pct = max ? Math.max(0, Math.min(100, used / max * 100)) : null;
      metric('ctxVal', pct);
      $('hwCtx').textContent = max ? (used / 1000).toFixed(1) + ' / ' + (max / 1000).toFixed(1) + 'k' : '—';

      setState((processing || summary.active) > 0 ? 'generating' : 'ready');
      $('errVal').textContent = '0';
      $('errorState').textContent = 'HEALTH OK';
      $('errorText').textContent = 'Aucune erreur détectée.';

      if (Number.isFinite(generation)) {
        history.push(generation);
        trimHistory();
        drawChart();
      }
    } catch (error) {
      setState('offline');
      $('genVal').textContent = '—';
      $('promptVal').textContent = '—';
      $('reqVal').textContent = '—';
      $('queueVal').textContent = '—';
      $('errVal').textContent = '1';
      $('errorState').textContent = 'HEALTH FAIL';
      $('errorText').textContent = String(error && error.message ? error.message : error);
    }
  }

  async function tick() {
    await Promise.allSettled([updateRuntime(), updateHardware()]);
  }

  function schedule() {
    clearInterval(timer);
    const seconds = Number(prop('refreshSeconds', '1')) || 1;
    timer = setInterval(tick, Math.max(500, seconds * 1000));
    tick();
  }

  function setupTabs() {
    const buttons = Array.from(document.querySelectorAll('.tab'));
    const views = Array.from(document.querySelectorAll('.view'));
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        buttons.forEach((b) => b.classList.toggle('active', b === button));
        views.forEach((view) => view.classList.toggle('active', view.dataset.view === tab));
        requestAnimationFrame(drawChart);
      });
    });
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once:true });
      return;
    }
    if (initialized) return;
    initialized = true;
    fit();
    if ($('versionBadge')) $('versionBadge').textContent = 'v' + APP_VERSION;
    if ($('chartEmptyUrl')) $('chartEmptyUrl').textContent = serverBase();
    setupTabs();
    setupSensors();
    discoverSensors();
    schedule();
  }

  function onDataUpdated() {
    setupSensors();
    schedule();
  }

  window.addEventListener('resize', () => { fit(); drawChart(); });
  window.localAiMonitorInit = init;
  window.localAiMonitorDataUpdated = onDataUpdated;
  window.localAiMonitorSensorsInitialized = function () {
    setupSensors();
    resetDiscoveredSensors();
    discoverSensors().then(updateHardware);
  };

  if (typeof iCUE_initialized !== 'undefined' && iCUE_initialized) init();
  else setTimeout(init, 900);
})();
