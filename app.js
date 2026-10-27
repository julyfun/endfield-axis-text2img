const input = document.querySelector('#source');
const posterConfig = document.querySelector('#poster-config');
const canvas = document.querySelector('#poster');
const status = document.querySelector('#status');
const dimensions = document.querySelector('#dimensions');
const download = document.querySelector('#download');
const ctx = canvas.getContext('2d');
const base = 'assets/operators/';
const operators = {
  '赛希': { file: 'saixi', attack: 'attack-funnel', elements: { '普攻': '寒冷', '重击': '寒冷', '战技': '寒冷', '连携': '寒冷', '大招': '寒冷' } },
  '祀': { file: 'si', attack: 'attack-claymore', elements: { '普攻': '寒冷', '重击': '寒冷', '战技': '寒冷', '战技II': '寒冷', '战技III': '寒冷', '连携': '寒冷', '大招': '寒冷' } },
  '诀': { file: 'jue', attack: 'attack-funnel', elements: { '普攻': '自然', '重击': '自然', '战技': '自然', '连携': '自然', '大招': '自然' } },
  '提弗洛斯': { file: 'typhoea', attack: 'attack-funnel', elements: { '普攻': '自然', '重击': '自然', '战技': '自然', '连携': '自然', '大招': '自然' } }
};
const defaultParty = ['提弗洛斯', '祀', '诀', '赛希'];
const actions = new Set(['主控', '战技', '战技II', '战技III', '连携', '大招', '普攻', '重击', '处决', '切人', '其他', '闪避']);
const imageTasks = new Map(), images = new Map();
const aliasesTask = fetch('assets/aliases.toml').then(response => {
  if (!response.ok) throw new Error('无法加载干员别名');
  return response.text();
}).then(text => TOML.parse(text));
const colorsTask = fetch('assets/elements.toml').then(response => {
  if (!response.ok) throw new Error('无法加载属性配色');
  return response.text();
}).then(text => TOML.parse(text));
let aliases = {}, colors = {};

function parseDocument(source, configSource) {
  const config = TOML.parse(configSource.trim());
  const rowSeconds = config.row_seconds ?? 10;
  const title = config.title || '战斗技能时间轴';
  const timeline = config.timeline ?? '';
  if (!Number.isInteger(rowSeconds) || rowSeconds < 1 || rowSeconds > 60) throw new Error('row_seconds 需要 1–60 的整数');
  if (typeof title !== 'string' || [...title].length > 14) throw new Error('title 最多 14 个字');
  if (typeof timeline !== 'string' || [...timeline].length > 40) throw new Error('timeline 需要不超过 40 个字的字符串');
  if (config.aliases) throw new Error('干员别名请写在 assets/aliases.toml');
  const resolve = name => aliases[name] || name;
  const party = config.operators ?? defaultParty;
  if (!Array.isArray(party)) throw new Error('operators 需要四名干员的数组');
  const slots = party.map(resolve);
  if (slots.length !== 4 || new Set(slots).size !== 4 || slots.some(name => !operators[name])) throw new Error('operators 需要四名不重复的已知干员');
  const parsed = Papa.parse(source, { header: true, skipEmptyLines: 'greedy', transformHeader: value => value.trim() });
  if (parsed.errors.length) throw new Error(`CSV 第 ${parsed.errors[0].row + 2} 行：${parsed.errors[0].message}`);
  if (!['operator', 'action', 'time', 'note'].every(name => parsed.meta.fields?.includes(name))) throw new Error('CSV 表头需要 operator,action,time,note');
  let previous = Infinity;
  const steps = parsed.data.map((record, index) => {
    const operator = resolve(record.operator?.trim());
    const action = record.action?.trim(), rawTime = record.time?.trim(), note = record.note?.trim() || '';
    if (!operators[operator]) throw new Error(`第 ${index + 2} 行：未知干员 ${operator || '（空）'}`);
    if (!slots.includes(operator)) throw new Error(`第 ${index + 2} 行：${operator} 不在 operators 中`);
    if (!actions.has(action)) throw new Error(`第 ${index + 2} 行：未知动作 ${action || '（空）'}`);
    if (action === '其他' && [...note].length > 7) throw new Error(`第 ${index + 2} 行：其他动作的备注最多 7 个字`);
    if ([...note].length > 36) throw new Error(`第 ${index + 2} 行：备注最多 36 个字`);
    let time = previous;
    if (rawTime) {
      const match = /^(\d+):([0-5]\d)(?:\.(\d+))?$/.exec(rawTime);
      if (!match) throw new Error(`第 ${index + 2} 行：时间格式应为 6:57 或 6:42.012`);
      time = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`);
      if (time > previous) throw new Error(`第 ${index + 2} 行：时间不能上升`);
      previous = time;
    } else if (index === 0) {
      throw new Error('第 2 行：首条动作必须填写时间');
    }
    return { operator, action, time, position: time, specifiedTime: Boolean(rawTime), note, slot: slots.indexOf(operator) + 1, element: operators[operator].elements[action === '处决' ? '重击' : action] || null };
  });
  if (!steps.length) throw new Error('至少需要一条动作');
  return { title, rowSeconds, timeline: timeline.trim(), steps };
}

function assetName(step) {
  const op = operators[step.operator];
  if (step.action === '普攻' || step.action === '重击' || step.action === '处决') return op.attack;
  if (step.operator === '祀' && step.action === '战技II') return 'si-skill-ii';
  if (step.operator === '祀' && step.action === '战技III') return 'si-skill-iii';
  const type = { '战技': 'skill', '战技II': 'skill', '战技III': 'skill', '连携': 'combo', '大招': 'ultimate' }[step.action];
  return type ? `${op.file}-${type}` : null;
}

function loadImage(name) {
  if (!imageTasks.has(name)) imageTasks.set(name, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法加载图片：${name}`));
    image.src = name === 'endfield-logo' ? 'assets/endfield-logo.svg' : name.startsWith('mouse-') ? `assets/keys/${name}.svg` : `${base}${name}.png`;
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

function closeTogether(a, b) { return a.position - b.position <= .3 + 1e-10; }
function nodeGap(a, b) { return closeTogether(a, b) ? 136 : 184; }

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

function drawNode(node, y, showTime) {
  const x = node.x, portrait = images.get(`${operators[node.operator].file}-portrait`);
  const accent = node.action === '大招' ? '#dce83d' : '#f4f5ee';
  const badge = assetName(node), cx = x + 43, cy = y + 44;
  ctx.fillStyle = '#1e2422'; ctx.beginPath(); ctx.arc(x, y, 67, 0, Math.PI * 2); ctx.fill();
  circleImage(portrait, x, y, 59, true);
  ctx.strokeStyle = accent; ctx.lineWidth = node.action === '大招' ? 6 : 3;
  ctx.beginPath(); ctx.arc(x, y, 61, 0, Math.PI * 2); ctx.stroke();
  if (badge || node.action === '切人' || node.action === '闪避') {
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, 31, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#171b19'; ctx.fillRect(cx - 31, cy - 31, 62, 62);
    if (node.element && badge) {
      ctx.fillStyle = colors[node.element]; ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, 31, Math.PI / 6, Math.PI * 5 / 6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = '#f4f5ee'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 31, 0, Math.PI * 2); ctx.stroke();
    if (badge) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, 29, 0, Math.PI * 2); ctx.clip();
      ctx.shadowColor = 'rgba(0, 0, 0, .85)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 3;
      ctx.drawImage(images.get(badge), cx - 26, cy - 26, 52, 52);
      ctx.restore();
    }
    else text(node.action === '切人' ? '⇄' : '闪', cx, cy + 11, '800 31px Arial, "PingFang SC"', '#f4f5ee', 'center');
  }
  const label = node.action === '其他' ? node.note || node.action : node.action;
  text(label, x, y + 110, '800 30px Arial, "PingFang SC", sans-serif', '#f4f5ee', 'center');
  const keyX = x + ctx.measureText(label).width / 2 + 18, keyY = y + 102;
  if (node.action === '普攻' || node.action === '重击' || node.action === '处决' || node.action === '闪避') {
    const mouse = node.action === '闪避' ? 'mouse-right' : 'mouse-left';
    ctx.drawImage(images.get(mouse), keyX - 12, keyY - 12, 24, 24);
  } else if (node.action === '大招') {
    ctx.strokeStyle = '#dce83d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(keyX, keyY, 13, 0, Math.PI * 2); ctx.stroke();
    text(String(node.slot), keyX, keyY + 8, '800 24px Arial', '#dce83d', 'center');
  } else {
    const key = node.action === '切人' ? `F${node.slot}` : node.action === '连携' ? 'E' : node.action.startsWith('战技') ? String(node.slot) : '';
    if (key) text(key, keyX, keyY + 8, '800 30px Arial', '#dce83d', 'center');
  }
  if (showTime) text(timeLabel(node.time), x, y + 142, '800 27px Arial', '#dce83d', 'center');
  const chars = [...(node.action === '其他' ? '' : node.note)];
  for (let i = 0; i < chars.length; i += 9) text(chars.slice(i, i + 9).join(''), x, y + 169 + i / 9 * 18, '600 20px Arial, "PingFang SC", sans-serif', '#bac4bb', 'center');
}

function draw({ title, rowSeconds, timeline, steps }) {
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
  const duration = steps[0].position - steps.at(-1).position;
  text(`${Number(duration.toFixed(3))} SEC`, width - 75, 288, '800 23px Arial', '#dce83d', 'right');
  let previous = null;
  const shownTimes = new Set();
  lanes.forEach((lane, row) => {
    const top = 320 + row * 340, y = top + 86;
    const direction = row % 2 ? -1 : 1;
    ctx.fillStyle = row % 2 ? '#202624' : '#1c2220'; ctx.fillRect(75, top, width - 150, 320);
    if (previous && lane.nodes.length) {
      const routeX = row % 2 ? width - 38 : 38;
      line(previous.x + previous.direction * 68, previous.y, routeX, previous.y, '#dce83d', 3);
      line(routeX, previous.y, routeX, y, '#dce83d', 3);
      if (closeTogether(previous, lane.nodes[0])) line(routeX, y, lane.nodes[0].x - direction * 70, y, '#dce83d', 3);
      else arrow(routeX, y, lane.nodes[0].x - direction * 70, y);
    }
    lane.nodes.forEach((node, i) => { if (i && !closeTogether(lane.nodes[i - 1], node)) arrow(lane.nodes[i - 1].x + direction * 69, y, node.x - direction * 70, y); });
    lane.nodes.forEach(node => {
      const second = Math.floor(node.position);
      const showTime = node.specifiedTime && !shownTimes.has(second);
      if (showTime) shownTimes.add(second);
      drawNode(node, y, showTime);
    });
    if (lane.nodes.length) previous = { x: lane.nodes.at(-1).x, y, direction, position: lane.nodes.at(-1).position };
  });
  const foot = height - 65;
  line(75, foot - 26, width - 75, foot - 26, '#5b665e');
  text(`制作：@菲比是拉拉${timeline ? ` | Timeline：${timeline}` : ''}`, 75, foot + 13, '800 20px Arial, "PingFang SC", sans-serif');
  const logo = images.get('endfield-logo'), logoWidth = 205;
  ctx.save(); ctx.filter = 'invert(1)';
  ctx.drawImage(logo, width - 75 - logoWidth, foot - 22, logoWidth, logoWidth * logo.height / logo.width);
  ctx.restore();
  dimensions.textContent = `${width} × ${height} PX`;
}

async function render() {
  download.disabled = true;
  try {
    aliases = await aliasesTask;
    const data = parseDocument(input.value, posterConfig.value);
    const { steps, rowSeconds } = data;
    status.textContent = '正在加载本地图片…'; status.classList.remove('error');
    const names = new Set(steps.flatMap(step => [`${operators[step.operator].file}-portrait`, assetName(step)].filter(Boolean)));
    names.add('endfield-logo');
    if (steps.some(step => ['普攻', '重击', '处决'].includes(step.action))) names.add('mouse-left');
    if (steps.some(step => step.action === '闪避')) names.add('mouse-right');
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
document.querySelector('#config-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (file) { posterConfig.value = await file.text(); render(); }
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
else Promise.all(['examples/rotation.csv', 'examples/poster.toml'].map(async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载示例：${url}`);
  return response.text();
})).then(([source, config]) => {
  if (!input.value) input.value = source;
  if (!posterConfig.value) posterConfig.value = config;
  render();
}).catch(error => { status.textContent = error.message; status.classList.add('error'); });
