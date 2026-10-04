const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) {
    if (force === undefined) force = !this.values.has(value);
    if (force) this.values.add(value); else this.values.delete(value);
    return force;
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.textContent = '';
    this.dataset = {};
    this.classList = new FakeClassList();
    this.width = 0;
    this.height = 0;
  }
  addEventListener() {}
  getBoundingClientRect() { return { width: 760, height: 118 }; }
  getContext() {
    return {
      setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, closePath() {}, fill() {}, createLinearGradient() {
        return { addColorStop() {} };
      }
    };
  }
}

const ids = [
  'app', 'versionBadge', 'sensorStatus', 'stateText', 'modelText', 'backendText',
  'chartEmpty', 'chartEmptyTitle', 'chartEmptyUrl',
  'chartCanvas', 'genVal', 'promptVal', 'reqVal', 'queueVal', 'gpuVal', 'vramVal',
  'ctxVal', 'tempVal', 'cpuVal', 'ramVal', 'errVal', 'hwGpu', 'hwVram', 'hwTemp',
  'hwCpu', 'hwRam', 'hwCtx', 'errorState', 'errorText'
];
const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));

global.window = global;
global.document = {
  readyState: 'complete',
  body: { dataset: {} },
  getElementById: (id) => elements[id] || (elements[id] = new FakeElement(id)),
  querySelectorAll: () => [],
  addEventListener() {}
};
global.innerWidth = 840;
global.innerHeight = 344;
global.devicePixelRatio = 1;
global.addEventListener = () => {};
global.requestAnimationFrame = (callback) => callback();
global.iCUE_initialized = true;
global.fetch = async (url) => {
  if (url.endsWith('/health')) return new Response('{"status":"ok"}', { status: 200 });
  if (url.endsWith('/metrics')) return new Response('llamacpp:predicted_tokens_seconds 51.2\nllamacpp:prompt_tokens_seconds 437.7\n', { status: 200 });
  if (url.endsWith('/slots')) return new Response('[]', { status: 200 });
  if (url.endsWith('/props')) return new Response('{"model":"smoke.gguf"}', { status: 200 });
  return new Response('', { status: 404 });
};

const sensorData = {
  broken: { type:'Temperature', kind:'Default', name:'Broken', device:'Unknown', value:0 },
  gpuTemp: { type:'Temperature', kind:'TemperatureGpu', name:'GPU', device:'NVIDIA GeForce RTX 4090', value:64 },
  gpuLoad: { type:'Utilization', kind:'UtilizationGpu', name:'GPU', device:'NVIDIA GeForce RTX 4090', value:37 },
  vram: { type:'Utilization', kind:'Unknown', name:'Frame Buffer', device:'NVIDIA GeForce RTX 4090', value:50 },
  cpu: { type:'Utilization', kind:'UtilizationCpuPackage', name:'Processor', device:'AMD Ryzen Threadripper PRO', value:18 },
  ram: { type:'Utilization', kind:'UtilizationMemory', name:'Physical Memory Load', device:'System', value:42 }
};
let asyncConnections = 0;
const responseCallbacks = [];
const respond = (requestId, value) => setTimeout(() => responseCallbacks.forEach((callback) => callback(requestId, value)), 0);
const plugin = {
  asyncResponse: { connect(callback) { asyncConnections += 1; responseCallbacks.push(callback); } },
  getAllSensorIds(requestId) { respond(requestId, Object.keys(sensorData)); },
  getSensorType(requestId, id) { respond(requestId, sensorData[id].type); },
  getSensorKind(requestId, id) { respond(requestId, sensorData[id].kind); },
  getSensorName(requestId, id) {
    if (id === 'broken') throw new Error('simulated metadata failure');
    respond(requestId, sensorData[id].name);
  },
  getSensorDeviceName(requestId, id) { respond(requestId, sensorData[id].device); },
  getSensorValue(requestId, id) { respond(requestId, sensorData[id].value); },
  getSensorUnits(requestId) { respond(requestId, ''); },
  sensorIsConnected(requestId) { respond(requestId, true); }
};
global.plugins = { Sensorsdataprovider: plugin };

const sourceRoot = path.resolve(__dirname, '..');
for (const relative of ['common/plugins/IcueWidgetApiWrapper.js', 'common/plugins/SimpleSensorApiWrapper.js', 'scripts/main.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(sourceRoot, relative), 'utf8'), { filename: relative });
}

setTimeout(() => {
  try {
    assert.equal(elements.versionBadge.textContent, 'v2.6.0');
    assert.equal(elements.tempVal.textContent, '64');
    assert.equal(elements.hwTemp.textContent, '64 °C');
    assert.equal(elements.gpuVal.textContent, '37');
    assert.equal(elements.cpuVal.textContent, '18');
    assert.equal(elements.ramVal.textContent, '42');
    assert.equal(elements.vramVal.textContent, '12.0 / 24 GB');
    assert.match(elements.sensorStatus.textContent, /GPU temperature active/);
    assert.equal(asyncConnections, 1, 'the Sensors plugin must only be wrapped once');
    console.log('PASS runtime smoke: GPU temperature and hardware metrics are populated');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 1800);
