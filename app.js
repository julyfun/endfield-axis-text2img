const input = document.querySelector('#source');
const posterConfig = document.querySelector('#poster-config');
const canvas = document.querySelector('#poster');
const status = document.querySelector('#status');
const dimensions = document.querySelector('#dimensions');
const download = document.querySelector('#download');
const errorDetails = document.querySelector('#error-details');
const ctx = canvas.getContext('2d');
const isVideoPage = location.pathname.endsWith('/video.html') || new URLSearchParams(location.search).has('video');
const base = 'assets/operators/';
let operators = {}, defaultParty = [];
const actions = new Set(['主控', '战技', '战技II', '战技III', '连携', '大招', '普攻', '重击', '处决', '切人', '其他', '闪避']);

const imageTasks = new Map(), images = new Map();
const operatorsTask = fetch('assets/operators.toml').then(response => {
  if (!response.ok) throw new Error('无法加载干员元数据');
  return response.text();
}).then(text => {
  const data = TOML.parse(text);
  defaultParty = data.default_party || [];
  operators = data.operator || {};
  return operators;
});
const aliasesTask = fetch('assets/aliases.toml').then(response => {
  if (!response.ok) throw new Error('无法加载干员别名');
  return response.text();
}).then(text => TOML.parse(text));
const colorsTask = fetch('assets/elements.toml').then(response => {
  if (!response.ok) throw new Error('无法加载属性配色');
  return response.text();
}).then(text => TOML.parse(text));
let aliases = {}, colors = {}, defaults = {}, renderStyle = {};

async function loadDefaults() {
  const response = await fetch(`assets/default.toml?ts=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('无法加载默认渲染参数');
  defaults = TOML.parse(await response.text());
  return defaults;
}

function showError(error) {
  const message = error.reason || error.message || String(error);
  if (status) { status.textContent = message; status.classList.remove('warning'); status.classList.add('error'); }
  if (errorDetails) { errorDetails.hidden = false; errorDetails.textContent = error.stack || message; }
}

function mergeConfig(raw, mode) {
  const sections = ['common', 'style', mode];
  const config = sections.reduce((result, section) => Object.assign(result, defaults[section] || {}, raw[section] || {}), {});
  Object.keys(raw).filter(key => !['common', 'style', 'poster', 'video'].includes(key)).forEach(key => { config[key] = raw[key]; });
  return config;
}

function configWarnings(raw, mode) {
  const known = new Set([...Object.keys(defaults.common || {}), ...Object.keys(defaults.style || {}), ...Object.keys(defaults[mode] || {})]);
  const warnings = [];
  Object.keys(raw).forEach(key => {
    if (['common', 'style', mode].includes(key)) {
      Object.keys(raw[key] || {}).filter(field => !Object.prototype.hasOwnProperty.call(defaults[key] || {}, field)).forEach(field => warnings.push(`TOML [${key}] 多余字段：${field}`));
    } else if (['poster', 'video'].includes(key)) warnings.push(`TOML 当前模式多余字段：${key}`);
    else if (!known.has(key)) warnings.push(`TOML 当前模式多余字段：${key}`);
  });
  return warnings;
}

function parseDocument(source, configSource, mode = 'poster') {
  const rawConfig = TOML.parse(configSource.trim());
  const config = mergeConfig(rawConfig, mode);
  const warnings = configWarnings(rawConfig, mode);
  const rowSeconds = config.row_seconds;
  const title = config.title || '战斗技能时间轴';
  const timeline = config.timeline ?? '';
  if (mode === 'poster' && (!Number.isInteger(rowSeconds) || rowSeconds < 1 || rowSeconds > 60)) throw new Error('row_seconds 需要 1–60 的整数');
  if (![config.group_threshold, config.close_node_gap, config.min_group_gap, config.max_group_gap].every(value => Number.isFinite(value) && value >= 0)) throw new Error('默认间距参数需要是非负数字');
  if (config.max_group_gap < config.min_group_gap) throw new Error('max_group_gap 不能小于 min_group_gap');
  if (mode === 'poster' && (typeof title !== 'string' || [...title].length > 14)) throw new Error('title 最多 14 个字');
  if (mode === 'poster' && (typeof timeline !== 'string' || [...timeline].length > 40)) throw new Error('timeline 需要不超过 40 个字的字符串');
  if (rawConfig.aliases) throw new Error('干员别名请写在 assets/aliases.toml');
  const resolve = name => aliases[name] || name;
  const party = config.operators ?? defaultParty;
  if (!Array.isArray(party)) throw new Error('operators 需要四名干员的数组');
  const slots = party.map(resolve);
  if (slots.length !== 4 || new Set(slots).size !== 4 || slots.some(name => !operators[name])) throw new Error('operators 需要四名不重复的已知干员');
  const parsed = Papa.parse(source, { header: true, skipEmptyLines: 'greedy', transformHeader: value => value.trim() });
  if (parsed.errors.length) throw new Error(`CSV 第 ${parsed.errors[0].row + 2} 行：${parsed.errors[0].message}`);
  const fields = parsed.meta.fields || [];
  if (!['operator', 'action', 'time', 'note'].every(name => fields.includes(name))) throw new Error('CSV 表头需要 operator,action,time,note');
  fields.filter(name => !['operator', 'action', 'time', 'note'].includes(name)).forEach(name => warnings.push(`CSV 多余字段：${name}`));
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
    const element = operators[operator].elements?.[action === '处决' ? '重击' : action] || operators[operator].element || null;
    return { operator, action, time, position: time, specifiedTime: Boolean(rawTime), note, slot: slots.indexOf(operator) + 1, element };

  });
  if (!steps.length) throw new Error('至少需要一条动作');
  return { title, rowSeconds, timeline: timeline.trim(), steps, style: config, warnings };
}

function assetName(step) {
  const op = operators[step.operator];
  if (step.action === '普攻' || step.action === '重击' || step.action === '处决') return op.attack;
  return op.assets?.[step.action] || null;

}

function loadImage(name) {
  if (!imageTasks.has(name)) imageTasks.set(name, new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { imageTasks.delete(name); reject(new Error(`无法加载图片：${name}`)); };
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

function closeTogether(a, b) { return a.position - b.position <= renderStyle.group_threshold + 1e-10; }
function nodeGap(a, b) {
  return closeTogether(a, b) ? renderStyle.close_node_gap : renderStyle.min_group_gap + renderStyle.node_radius * 2;
}

function layout(steps, width, rowSeconds) {
  const start = Math.floor(steps[0].position / rowSeconds);
  const end = Math.floor(steps.at(-1).position / rowSeconds);
  const lanes = Array.from({ length: start - end + 1 }, (_, i) => ({ bucket: start - i, nodes: [] }));
  steps.forEach(step => lanes[start - Math.floor(step.position / rowSeconds)].nodes.push({ ...step }));
  const left = renderStyle.lane_margin, right = width - renderStyle.lane_margin;
  lanes.forEach((lane, row) => {
    const low = lane.bucket * rowSeconds;
    lane.nodes.forEach((node, i) => {
      const target = left + ((low + rowSeconds - node.position) / rowSeconds) * (right - left);
      if (i) {
        const gap = nodeGap(lane.nodes[i - 1], node);
        node.u = Math.max(Math.min(target, lane.nodes[i - 1].u + renderStyle.max_group_gap + renderStyle.node_radius * 2), lane.nodes[i - 1].u + gap);
      } else node.u = Math.max(left, target);
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
  ctx.fillStyle = renderStyle.portrait_fill; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  if (portrait) {
    const crop = Math.min(image.width, image.height * .76);
    ctx.drawImage(image, (image.width - crop) / 2, 5, crop, crop, x - radius, y - radius, radius * 2, radius * 2);
  } else ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawKey(node, x, y) {
  const key = node.action === '切人' ? `F${node.slot}` : node.action === '连携' ? 'E' : node.action.startsWith('战技') ? String(node.slot) : '';
  const mouse = node.action === '闪避' ? 'mouse-right' : ['普攻', '重击', '处决'].includes(node.action) ? 'mouse-left' : null;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, .85)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = renderStyle.key_shadow_x; ctx.shadowOffsetY = renderStyle.key_shadow_y;
  if (mouse) ctx.drawImage(images.get(mouse), x - 18, y - 18, 36, 36);
  else if (node.action === '大招') {
    ctx.strokeStyle = renderStyle.key_color; ctx.lineWidth = renderStyle.badge_border_width;
    ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.stroke();
    text(String(node.slot), x, y + 9, renderStyle.key_font, renderStyle.key_color, 'center');
  } else if (key) text(key, x, y + 11, renderStyle.key_font, renderStyle.key_color, 'center');
  ctx.restore();
}

function drawNode(node, y, showTime, direction = 1, showNote = true) {
  const x = node.x, portrait = images.get(`${operators[node.operator].file}-portrait`);
  const accent = node.action === '大招' ? renderStyle.ultimate_accent : renderStyle.node_border;
  const badge = assetName(node), cx = x + renderStyle.badge_offset, cy = y + renderStyle.badge_offset;
  ctx.fillStyle = renderStyle.node_fill; ctx.beginPath(); ctx.arc(x, y, renderStyle.node_radius, 0, Math.PI * 2); ctx.fill();
  circleImage(portrait, x, y, renderStyle.portrait_radius, true);
  ctx.strokeStyle = accent; ctx.lineWidth = node.action === '大招' ? renderStyle.ultimate_border_width : renderStyle.node_border_width;
  ctx.beginPath(); ctx.arc(x, y, renderStyle.node_border_radius, 0, Math.PI * 2); ctx.stroke();
  if (badge || node.action === '切人' || node.action === '闪避') {
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, renderStyle.badge_radius, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = renderStyle.badge_fill; ctx.fillRect(cx - renderStyle.badge_radius, cy - renderStyle.badge_radius, renderStyle.badge_radius * 2, renderStyle.badge_radius * 2);
    if (node.element && badge) {
      ctx.fillStyle = colors[node.element]; ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, renderStyle.badge_radius, Math.PI / 6, Math.PI * 5 / 6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = renderStyle.badge_border; ctx.lineWidth = renderStyle.badge_border_width;
    ctx.beginPath(); ctx.arc(cx, cy, renderStyle.badge_radius, 0, Math.PI * 2); ctx.stroke();
    if (badge) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, renderStyle.badge_inner_radius, 0, Math.PI * 2); ctx.clip();
      ctx.shadowColor = 'rgba(0, 0, 0, .85)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 3;
      ctx.drawImage(images.get(badge), cx - renderStyle.badge_image_size / 2, cy - renderStyle.badge_image_size / 2, renderStyle.badge_image_size, renderStyle.badge_image_size);
      ctx.restore();
    }
    else text(node.action === '切人' ? '⇄' : '闪', cx, cy + 11, renderStyle.key_font, renderStyle.label_color, 'center');
  }
  const label = node.action === '其他' ? node.note || node.action : node.action;
  ctx.font = renderStyle.label_font;
  const labelWidth = ctx.measureText(label).width;
  text(label, x, y - renderStyle.label_y_offset, renderStyle.label_font, renderStyle.label_color, 'center');
  if (showTime) {
    const timeX = direction > 0 ? x - labelWidth / 2 - 12 : x + labelWidth / 2 + 12;
    text(timeLabel(node.time), timeX, y - renderStyle.label_y_offset, renderStyle.time_font, renderStyle.ultimate_accent, direction > 0 ? 'right' : 'left');
  }
  drawKey(node, x, y + 98);
  if (showNote) {
    const chars = [...(node.action === '其他' ? '' : node.note)];
    for (let i = 0; i < chars.length; i += 9) text(chars.slice(i, i + 9).join(''), x, y + 145 + i / 9 * 18, renderStyle.note_font, renderStyle.note_color, 'center');
  }
}

function draw({ title, rowSeconds, timeline, steps, style }) {
  renderStyle = style;
  let groupIndex = -1;
  steps.forEach((step, i) => {
    if (i === 0 || !closeTogether(steps[i - 1], step)) groupIndex++;
    step.groupIndex = groupIndex;
  });
  const groups = new Map();
  steps.forEach(step => { const key = Math.floor(step.position / rowSeconds); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(step); });
  const span = Math.max(...[...groups.values()].map(group => group.slice(1).reduce((sum, node, i) => sum + nodeGap(group[i], node), 0)));
  const width = Math.max(renderStyle.min_width, span + renderStyle.width_padding);
  const lanes = layout(steps, width, rowSeconds);
  const height = renderStyle.header_height + lanes.length * renderStyle.lane_step + renderStyle.footer_height;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#151919'; ctx.fillRect(0, 0, width, height);
  for (let x = 70; x < width; x += renderStyle.grid_step) line(x, 0, x, height, '#ffffff0b', 1);
  for (let y = 0; y < height; y += renderStyle.grid_step) line(0, y, width, y, '#ffffff0b', 1);
  ctx.fillStyle = '#dce83d'; ctx.fillRect(0, 0, 15, 240); ctx.fillRect(75, 69, 64, 9);
  text('ENDFIELD / TACTICAL AXIS', 75, 111, '800 22px Arial', '#dce83d');
  text(title, 72, 214, '900 88px Arial, "PingFang SC", sans-serif');
  line(75, 251, width - 75, 251, '#dce83d', 3);
  text(`${String(steps.length).padStart(2, '0')} ACTIONS`, 75, 288, '800 23px Arial');
  const duration = steps[0].position - steps.at(-1).position;
  text(`${Number(duration.toFixed(3))} SEC`, width - 75, 288, '800 23px Arial', '#dce83d', 'right');
  let previous = null;
  const shownGroups = new Set();
  lanes.forEach((lane, row) => {
    const top = renderStyle.header_height + row * renderStyle.lane_step, y = top + 86;
    const direction = row % 2 ? -1 : 1;
    ctx.fillStyle = row % 2 ? '#202624' : '#1c2220'; ctx.fillRect(75, top, width - 150, renderStyle.lane_height);
    if (previous && lane.nodes.length) {
      const routeX = row % 2 ? width - 38 : 38;
      line(previous.x + previous.direction * 68, previous.y, routeX, previous.y, '#dce83d', 3);
      line(routeX, previous.y, routeX, y, '#dce83d', 3);
      if (closeTogether(previous, lane.nodes[0])) line(routeX, y, lane.nodes[0].x - direction * 70, y, '#dce83d', 3);
      else arrow(routeX, y, lane.nodes[0].x - direction * 70, y);
    }
    lane.nodes.forEach((node, i) => { if (i && !closeTogether(lane.nodes[i - 1], node)) arrow(lane.nodes[i - 1].x + direction * 69, y, node.x - direction * 70, y); });
    lane.nodes.forEach(node => {
      const showTime = node.specifiedTime && !shownGroups.has(node.groupIndex);
      if (showTime) shownGroups.add(node.groupIndex);
      drawNode(node, y, showTime, direction, true);
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

async function prepareAssets(steps, includeLogo = false) {
  const names = new Set(steps.flatMap(step => [`${operators[step.operator].file}-portrait`, assetName(step)].filter(Boolean)));
  if (includeLogo) names.add('endfield-logo');
  if (steps.some(step => ['普攻', '重击', '处决'].includes(step.action))) names.add('mouse-left');
  if (steps.some(step => step.action === '闪避')) names.add('mouse-right');
  colors = await colorsTask;
  await Promise.all([...names].map(async name => images.set(name, await loadImage(name))));
}

async function render() {
  download.disabled = true;
  try {
    [aliases] = await Promise.all([aliasesTask, operatorsTask, loadDefaults()]);
    const data = parseDocument(input.value, posterConfig.value);
    const { steps, rowSeconds } = data;
    status.textContent = '正在加载本地图片…'; status.classList.remove('error', 'warning');
    if (errorDetails) { errorDetails.hidden = true; errorDetails.textContent = ''; }
    await prepareAssets(steps, true);
    draw(data);
    document.querySelector('#row-seconds').textContent = `${rowSeconds} SEC / LINE`;
    status.classList.toggle('warning', data.warnings.length > 0);
    status.textContent = `已生成 ${steps.length} 个节点${data.warnings.length ? `；警告：${data.warnings.join('；')}` : ''}`;
    download.disabled = false;
  } catch (error) { showError(error); }
}

document.querySelector('#render')?.addEventListener('click', render);
if (!isVideoPage) document.addEventListener('editor-file-loaded', render);
download?.addEventListener('click', () => {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'endfield-axis.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});
if (location.protocol === 'file:') status.textContent = '请通过本地服务打开页面';
else if (!isVideoPage) Promise.all(['examples/rotation.csv', 'examples/poster.toml'].map(async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法加载示例：${url}`);
  return response.text();
})).then(([source, config]) => {
  if (!input.value) input.value = source;
  if (!posterConfig.value) posterConfig.value = config;
  render();
}).catch(error => { showError(error); });
