const input = document.querySelector('#source');
const canvas = document.querySelector('#poster');
const status = document.querySelector('#status');
const dimensions = document.querySelector('#dimensions');
const download = document.querySelector('#download');
const ctx = canvas.getContext('2d');
const base = 'assets/operators/';
const operators = {
  '赛希': { file: 'saixi', attack: 'attack-funnel' },
  '祀': { file: 'si', attack: 'attack-claymore' },
  '诀': { file: 'jue', attack: 'attack-funnel' },
  '提弗洛斯': { file: 'typhoea', attack: 'attack-funnel' }
};
const actions = new Set(['attack', 'skill', 'combo', 'ultimate', 'switch']);
const elements = new Set(['物理', '寒冷', '灼热', '自然', '电磁', '无']);
const imageTasks = new Map(), images = new Map();
const colorsTask = fetch('assets/elements.yaml').then(response => {
  if (!response.ok) throw new Error('无法加载属性配色');
  return response.text();
}).then(text => jsyaml.load(text));
let colors = {};

function parseDocument(source) {
  const document = jsyaml.load(source);
  if (!document || !Array.isArray(document.steps)) throw new Error('YAML 需要 steps 列表');
  const rowSeconds = document.row_seconds ?? 10;
  const title = document.title || '战斗技能时间轴';
  if (!Number.isInteger(rowSeconds) || rowSeconds < 1 || rowSeconds > 60) throw new Error('row_seconds 需要 1–60 的整数');
  if (typeof title !== 'string' || [...title].length > 14) throw new Error('title 最多 14 个字');
  let previous = Infinity;
  const steps = document.steps.map((record, index) => {
    if (!Array.isArray(record) || record.length < 5 || record.length > 6) throw new Error(`第 ${index + 1} 个节点需要 5–6 列`);
    const [operator, action, label, rawTime, element, note = ''] = record;
    if (!operators[operator]) throw new Error(`第 ${index + 1} 个节点：未知干员 ${operator || '（空）'}`);
    if (!actions.has(action)) throw new Error(`第 ${index + 1} 个节点：未知动作 ${action || '（空）'}`);
    if (typeof label !== 'string' || !label || [...label].length > 7) throw new Error(`第 ${index + 1} 个节点：标签需要 1–7 个字`);
    if (!elements.has(element)) throw new Error(`第 ${index + 1} 个节点：未知属性 ${element || '（空）'}`);
    if (typeof note !== 'string' || [...note].length > 36) throw new Error(`第 ${index + 1} 个节点：备注最多 36 个字`);
    let time = null;
    if (rawTime !== null && rawTime !== undefined && rawTime !== '') {
      if (typeof rawTime !== 'string') throw new Error(`第 ${index + 1} 个节点：时间需加引号`);
      const match = /^(\d+):([0-5]\d)$/.exec(rawTime);
      if (!match) throw new Error(`第 ${index + 1} 个节点：时间格式应为 6:57`);
      time = Number(match[1]) * 60 + Number(match[2]);
      if (time > previous) throw new Error(`第 ${index + 1} 个节点：时间不能上升`);
      previous = time;
    }
    return { operator, action, label, time, element, note };
  });
  if (!steps.length || steps.every(step => step.time === null)) throw new Error('至少需要一条动作和一个时间');
  const known = steps.map((step, i) => step.time === null ? -1 : i).filter(i => i >= 0);
  steps.forEach((step, i) => {
    if (step.time !== null) { step.position = step.time; return; }
    const before = known.findLast(k => k < i), after = known.find(k => k > i);
    if (before === undefined) step.position = steps[after].time;
    else if (after === undefined) step.position = steps[before].time;
    else step.position = steps[before].time + (steps[after].time - steps[before].time) * (i - before) / (after - before);
  });
  return { title, rowSeconds, steps };
}

function assetName(step) {
  const op = operators[step.operator];
  return step.action === 'attack' ? op.attack : `${op.file}-${step.action}`;
}

function loadImage(name) {
  if (!imageTasks.has(name)) imageTasks.set(name, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法加载图片：${name}`));
    image.src = name.startsWith('element-') ? `assets/elements/${name.slice(8)}.png` : `${base}${name}.png`;
  }));
  return imageTasks.get(name);
}

function text(value, x, y, font, color = '#f4f5ee', align = 'left') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align;
  ctx.fillText(value, x, y);
}

function line(x1, y1, x2, y2, color = '#66706b', width = 2) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function arrow(x1, y1, x2, y2) {
  const direction = Math.sign(x2 - x1);
  line(x1, y1, x2, y2, '#dce83d', 3);
  ctx.fillStyle = '#dce83d'; ctx.beginPath();
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - direction * 13, y2 - 7);
  ctx.lineTo(x2 - direction * 13, y2 + 7); ctx.fill();
}

function timeLabel(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function sameSecond(a, b) { return a.time !== null && a.time === b.time; }
function nodeGap(a, b) { return sameSecond(a, b) ? 144 : 184; }

function layout(steps, width, rowSeconds) {
  const start = Math.floor(steps[0].position / rowSeconds);
  const end = Math.floor(steps.at(-1).position / rowSeconds);
  const lanes = Array.from({ length: start - end + 1 }, (_, i) => ({ bucket: start - i, nodes: [] }));
  steps.forEach(step => lanes[start - Math.floor(step.position / rowSeconds)].nodes.push({ ...step }));
  const left = 145, right = width - 145;
  lanes.forEach((lane, row) => {
    const low = lane.bucket * rowSeconds;
    lane.nodes.forEach((node, i) => {
      const target = left + ((low + rowSeconds - node.position) / rowSeconds) * (right - left);
      node.u = i ? Math.max(target, lane.nodes[i - 1].u + nodeGap(lane.nodes[i - 1], node)) : Math.max(left, target);
    });
    if (lane.nodes.length) {
      lane.nodes.at(-1).u = Math.min(right, lane.nodes.at(-1).u);
      for (let i = lane.nodes.length - 2; i >= 0; i--) lane.nodes[i].u = Math.min(lane.nodes[i].u, lane.nodes[i + 1].u - nodeGap(lane.nodes[i], lane.nodes[i + 1]));
      if (lane.nodes[0].u < left) {
        const span = lane.nodes.slice(1).reduce((sum, node, i) => sum + nodeGap(lane.nodes[i], node), 0);
        let x = Math.max(left, Math.min(left + ((low + rowSeconds - lane.nodes[0].position) / rowSeconds) * (right - left), right - span));
        lane.nodes.forEach((node, i) => { x += i ? nodeGap(lane.nodes[i - 1], node) : 0; node.u = x; });
      }
    }
    lane.nodes.forEach(node => { node.x = row % 2 ? width - node.u : node.u; });
  });
  return lanes;
}

function circleImage(image, x, y, radius, portrait = false) {
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#343b38'; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  if (portrait) {
    const crop = Math.min(image.width, image.height * .76);
    ctx.drawImage(image, (image.width - crop) / 2, 5, crop, crop, x - radius, y - radius, radius * 2, radius * 2);
  } else ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawNode(node, y) {
  const x = node.x, portrait = images.get(`${operators[node.operator].file}-portrait`);
  const accent = node.action === 'ultimate' ? '#dce83d' : '#f4f5ee';
  const color = colors[node.element] || '#7e8780';
  ctx.fillStyle = '#1e2422'; ctx.beginPath(); ctx.arc(x, y, 67, 0, Math.PI * 2); ctx.fill();
  circleImage(portrait, x, y, 59, true);
  ctx.strokeStyle = accent; ctx.lineWidth = node.action === 'ultimate' ? 6 : 3;
  ctx.beginPath(); ctx.arc(x, y, 61, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#171b19'; ctx.beginPath(); ctx.arc(x + 43, y + 44, 31, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke();
  if (node.action === 'switch') text('⇄', x + 43, y + 55, '800 34px Arial', '#f4f5ee', 'center');
  else circleImage(images.get(assetName(node)), x + 43, y + 44, 23);
  if (node.element !== '无') {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + 17, y + 70, 16, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(images.get(`element-${node.element}`), x + 5, y + 58, 24, 24);
  }
  text(node.label, x, y + 110, '800 23px Arial, "PingFang SC", sans-serif', '#f4f5ee', 'center');
  if (node.time !== null) text(timeLabel(node.time), x, y + 138, '800 20px Arial', '#dce83d', 'center');
  const chars = [...node.note];
  for (let i = 0; i < chars.length; i += 9) text(chars.slice(i, i + 9).join(''), x, y + 163 + i / 9 * 18, '600 15px Arial, "PingFang SC", sans-serif', '#bac4bb', 'center');
}

function draw({ title, rowSeconds, steps }) {
  const groups = new Map();
  steps.forEach(step => { const key = Math.floor(step.position / rowSeconds); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(step); });
  const span = Math.max(...[...groups.values()].map(group => group.slice(1).reduce((sum, node, i) => sum + nodeGap(group[i], node), 0)));
  const width = Math.max(1800, span + 360);
  const lanes = layout(steps, width, rowSeconds);
  const height = 300 + lanes.length * 340 + 100;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#151919'; ctx.fillRect(0, 0, width, height);
  for (let x = 70; x < width; x += 120) line(x, 0, x, height, '#ffffff0b', 1);
  for (let y = 0; y < height; y += 120) line(0, y, width, y, '#ffffff0b', 1);
  ctx.fillStyle = '#dce83d'; ctx.fillRect(0, 0, 15, 240); ctx.fillRect(75, 69, 64, 9);
  text('ENDFIELD / TACTICAL AXIS', 75, 111, '800 22px Arial', '#dce83d');
  text(title, 72, 214, '900 88px Arial, "PingFang SC", sans-serif');
  line(75, 251, width - 75, 251, '#dce83d', 3);
  text(`${String(steps.length).padStart(2, '0')} ACTIONS`, 75, 288, '800 23px Arial');
  text(`${timeLabel(steps[0].position)}  →  ${timeLabel(steps.at(-1).position)}`, width - 75, 288, '800 23px Arial', '#dce83d', 'right');
  let previous = null;
  lanes.forEach((lane, row) => {
    const top = 320 + row * 340, y = top + 86;
    const direction = row % 2 ? -1 : 1;
    ctx.fillStyle = row % 2 ? '#202624' : '#1c2220'; ctx.fillRect(75, top, width - 150, 320);
    if (previous && lane.nodes.length) {
      const routeX = row % 2 ? width - 38 : 38;
      line(previous.x + previous.direction * 68, previous.y, routeX, previous.y, '#dce83d', 3);
      line(routeX, previous.y, routeX, y, '#dce83d', 3);
      arrow(routeX, y, lane.nodes[0].x - direction * 70, y);
    }
    lane.nodes.forEach((node, i) => { if (i && !sameSecond(lane.nodes[i - 1], node)) arrow(lane.nodes[i - 1].x + direction * 69, y, node.x - direction * 70, y); });
    lane.nodes.forEach(node => drawNode(node, y));
    if (lane.nodes.length) previous = { x: lane.nodes.at(-1).x, y, direction };
  });
  const foot = height - 65;
  line(75, foot - 26, width - 75, foot - 26, '#5b665e');
  text('战斗轴 / COMBAT ROTATION', 75, foot + 13, '800 20px Arial, "PingFang SC", sans-serif');
  text('ART: AKEDATA  /  FAN TOOL', width - 75, foot + 13, '700 17px Arial', '#dce83d', 'right');
  dimensions.textContent = `${width} × ${height} PX`;
}

async function render() {
  download.disabled = true;
  try {
    const data = parseDocument(input.value);
    const { steps, rowSeconds } = data;
    status.textContent = '正在加载本地图片…'; status.classList.remove('error');
    const names = new Set(steps.flatMap(step => [`${operators[step.operator].file}-portrait`, ...(step.action === 'switch' ? [] : [assetName(step)]), ...(step.element === '无' ? [] : [`element-${step.element}`])]));
    colors = await colorsTask;
    await Promise.all([...names].map(async name => images.set(name, await loadImage(name))));
    draw(data);
    document.querySelector('#row-seconds').textContent = `${rowSeconds} SEC / LINE`;
    status.textContent = `已生成 ${steps.length} 个节点`;
    download.disabled = false;
  } catch (error) { status.textContent = error.reason || error.message; status.classList.add('error'); }
}

document.querySelector('#render').addEventListener('click', render);
document.querySelector('#file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (file) { input.value = await file.text(); render(); }
  event.target.value = '';
});
download.addEventListener('click', () => {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'endfield-axis.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});
if (location.protocol === 'file:') status.textContent = '请通过本地服务打开页面';
else fetch('examples/rotation.yaml').then(response => response.text()).then(source => {
  if (!input.value) input.value = source;
  render();
}).catch(error => { status.textContent = error.message; status.classList.add('error'); });
