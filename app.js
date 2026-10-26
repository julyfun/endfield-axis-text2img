const input = document.querySelector('#csv');
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
const imageTasks = new Map(), images = new Map();

function parseTable(text) {
  const source = text.replace(/^\uFEFF/, '');
  const delimiter = source.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const records = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) quoted = false;
      else if (!cell) quoted = true;
      else cell += char;
    } else if (!quoted && char === delimiter) {
      row.push(cell); cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); records.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (cell || row.length) records.push([...row, cell]);
  const header = (records.shift() || []).map(value => value.trim().toLowerCase());
  const columns = ['operator', 'action', 'label', 'time', 'note'].map(name => header.indexOf(name));
  if (columns.some(index => index < 0)) throw new Error('表头需要 operator,action,label,time,note');
  let previous = Infinity;
  const steps = records.filter(record => record.some(value => value.trim())).map((record, index) => {
    const [operator, action, label, rawTime, note] = columns.map(i => (record[i] || '').trim());
    if (!operators[operator]) throw new Error(`第 ${index + 2} 行：未知干员 ${operator || '（空）'}`);
    if (!actions.has(action)) throw new Error(`第 ${index + 2} 行：未知动作 ${action || '（空）'}`);
    if (!label || [...label].length > 7) throw new Error(`第 ${index + 2} 行：label 需要 1–7 个字`);
    if ([...note].length > 36) throw new Error(`第 ${index + 2} 行：备注最多 36 个字`);
    let time = null;
    if (rawTime) {
      const match = /^(?:(\d*):)?(\d{1,2})$/.exec(rawTime);
      if (!match || Number(match[2]) > 59) throw new Error(`第 ${index + 2} 行：时间格式应为 :57 或 1:57`);
      time = Number(match[1] || 0) * 60 + Number(match[2]);
      if (time > previous) throw new Error(`第 ${index + 2} 行：时间不能上升`);
      previous = time;
    }
    return { operator, action, label, time, note };
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
  return steps;
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
    image.src = `${base}${name}.png`;
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
  return `${whole >= 60 ? Math.floor(whole / 60) : ''}:${String(whole % 60).padStart(2, '0')}`;
}

function layout(steps, width) {
  const start = Math.floor(steps[0].position / 10);
  const end = Math.floor(steps.at(-1).position / 10);
  const lanes = Array.from({ length: start - end + 1 }, (_, i) => ({ bucket: start - i, nodes: [] }));
  steps.forEach((step, index) => lanes[start - Math.floor(step.position / 10)].nodes.push({ ...step, index }));
  const left = 145, right = width - 145, gap = 148;
  lanes.forEach((lane, row) => {
    const low = lane.bucket * 10;
    lane.nodes.forEach((node, i) => {
      const target = left + ((low + 10 - node.position) / 10) * (right - left);
      node.u = i ? Math.max(target, lane.nodes[i - 1].u + gap) : Math.max(left, target);
    });
    if (lane.nodes.length) {
      lane.nodes.at(-1).u = Math.min(right, lane.nodes.at(-1).u);
      for (let i = lane.nodes.length - 2; i >= 0; i--) lane.nodes[i].u = Math.min(lane.nodes[i].u, lane.nodes[i + 1].u - gap);
      if (lane.nodes[0].u < left) lane.nodes.forEach((node, i) => { node.u = left + i * (right - left) / Math.max(1, lane.nodes.length - 1); });
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
  ctx.fillStyle = '#1e2422'; ctx.beginPath(); ctx.arc(x, y, 67, 0, Math.PI * 2); ctx.fill();
  circleImage(portrait, x, y, 59, true);
  ctx.strokeStyle = accent; ctx.lineWidth = node.action === 'ultimate' ? 6 : 3;
  ctx.beginPath(); ctx.arc(x, y, 61, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#dce83d'; ctx.beginPath(); ctx.arc(x - 52, y - 49, 20, 0, Math.PI * 2); ctx.fill();
  text(String(node.index + 1).padStart(2, '0'), x - 52, y - 43, '800 16px Arial', '#171a17', 'center');
  ctx.fillStyle = '#171b19'; ctx.beginPath(); ctx.arc(x + 43, y + 44, 31, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#dce83d'; ctx.lineWidth = 3; ctx.stroke();
  if (node.action === 'switch') text('⇄', x + 43, y + 55, '800 34px Arial', '#f4f5ee', 'center');
  else circleImage(images.get(assetName(node)), x + 43, y + 44, 23);
  text(node.operator, x, y + 103, '700 16px Arial, "PingFang SC", sans-serif', '#b3bdb5', 'center');
  text(node.label, x, y + 132, '800 23px Arial, "PingFang SC", sans-serif', '#f4f5ee', 'center');
  if (node.time !== null) text(timeLabel(node.time), x, y + 158, '800 20px Arial', '#dce83d', 'center');
  const chars = [...node.note];
  for (let i = 0; i < chars.length; i += 9) text(chars.slice(i, i + 9).join(''), x, y + 182 + i / 9 * 18, '600 15px Arial, "PingFang SC", sans-serif', '#bac4bb', 'center');
}

function draw(steps) {
  const counts = new Map();
  steps.forEach(step => { const key = Math.floor(step.position / 10); counts.set(key, (counts.get(key) || 0) + 1); });
  const width = Math.max(1800, Math.max(...counts.values()) * 158 + 320);
  const lanes = layout(steps, width);
  const height = 300 + lanes.length * 360 + 100;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#151919'; ctx.fillRect(0, 0, width, height);
  for (let x = 70; x < width; x += 120) line(x, 0, x, height, '#ffffff0b', 1);
  for (let y = 0; y < height; y += 120) line(0, y, width, y, '#ffffff0b', 1);
  ctx.fillStyle = '#dce83d'; ctx.fillRect(0, 0, 15, 240); ctx.fillRect(75, 69, 64, 9);
  text('ENDFIELD / TACTICAL AXIS', 75, 111, '800 22px Arial', '#dce83d');
  text('战斗技能时间轴', 72, 214, '900 88px Arial, "PingFang SC", sans-serif');
  line(75, 251, width - 75, 251, '#dce83d', 3);
  text(`${String(steps.length).padStart(2, '0')} ACTIONS`, 75, 288, '800 23px Arial');
  text(`${timeLabel(steps[0].position)}  →  ${timeLabel(steps.at(-1).position)}`, width - 75, 288, '800 23px Arial', '#dce83d', 'right');
  let previous = null;
  lanes.forEach((lane, row) => {
    const top = 320 + row * 360, y = top + 86;
    const direction = row % 2 ? -1 : 1;
    ctx.fillStyle = row % 2 ? '#202624' : '#1c2220'; ctx.fillRect(75, top, width - 150, 340);
    text(`SEGMENT ${String(row + 1).padStart(2, '0')}`, 99, top + 30, '800 17px Arial', '#9ca79e');
    const rail = top + 295;
    line(145, rail, width - 145, rail, '#859087', 2);
    for (let tick = 0; tick <= 10; tick += 5) {
      const x = direction > 0 ? 145 + (width - 290) * tick / 10 : width - 145 - (width - 290) * tick / 10;
      line(x, rail - 11, x, rail + 11, '#dce83d', 2);
      text(timeLabel(lane.bucket * 10 + 10 - tick), x, rail + 35, '700 16px Arial', '#9ca79e', 'center');
    }
    if (previous && lane.nodes.length) {
      const routeX = row % 2 ? width - 91 : 91;
      line(previous.x + previous.direction * 68, previous.y, routeX, previous.y, '#dce83d', 3);
      line(routeX, previous.y, routeX, y, '#dce83d', 3);
      arrow(routeX, y, lane.nodes[0].x - direction * 70, y);
    }
    lane.nodes.forEach((node, i) => { if (i) arrow(lane.nodes[i - 1].x + direction * 69, y, node.x - direction * 70, y); });
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
    const steps = parseTable(input.value);
    status.textContent = '正在加载本地图片…'; status.classList.remove('error');
    const names = new Set(steps.flatMap(step => [`${operators[step.operator].file}-portrait`, ...(step.action === 'switch' ? [] : [assetName(step)])]));
    await Promise.all([...names].map(async name => images.set(name, await loadImage(name))));
    draw(steps);
    const fileMode = location.protocol === 'file:';
    status.textContent = fileMode ? '请通过本地服务打开页面后下载 PNG' : `已生成 ${steps.length} 个节点`;
    download.disabled = fileMode;
  } catch (error) { status.textContent = error.message; status.classList.add('error'); }
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
render();
