const input = document.querySelector('#csv');
const canvas = document.querySelector('#poster');
const status = document.querySelector('#status');
const dimensions = document.querySelector('#dimensions');
const ctx = canvas.getContext('2d');

function parseTable(text) {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const records = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (!quoted && cell === '') quoted = true;
      else if (quoted) quoted = false;
      else cell += char;
    } else if (!quoted && char === delimiter) {
      row.push(cell); cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); records.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (cell || row.length) { row.push(cell); records.push(row); }
  const header = (records.shift() || []).map(value => value.trim().toLowerCase());
  const columns = ['skill', 'time', 'note'].map(name => header.indexOf(name));
  if (columns.some(index => index < 0)) throw new Error('表头需要 skill、time、note 三列');
  const steps = records.map(record => ({
    skill: (record[columns[0]] || '').trim(),
    time: (record[columns[1]] || '').trim(),
    note: (record[columns[2]] || '').trim()
  })).filter(step => step.skill);
  if (!steps.length) throw new Error('至少输入一条技能');
  return steps;
}

function fill(text, x, y, font, color = '#f3f4ee', align = 'left') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function line(x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function fit(text, maxWidth, size, weight = 800) {
  while (size > 19) {
    ctx.font = `${weight} ${size}px Arial, "PingFang SC", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size--;
  }
  return `${weight} ${size}px Arial, "PingFang SC", sans-serif`;
}

function kind(skill) {
  if (/大招/.test(skill)) return '终结技';
  if (/连携/.test(skill)) return '连携技';
  if (/战技/.test(skill)) return '战技';
  if (/重击/.test(skill)) return '重击';
  if (/切/.test(skill)) return '切人';
  return '动作';
}

function drawCard(step, number, x, y, width, height) {
  const ultimate = kind(step.skill) === '终结技';
  ctx.fillStyle = ultimate ? '#dce83d' : '#242929';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = ultimate ? '#171a17' : '#dce83d';
  ctx.fillRect(x, y, 7, height);
  if (!ultimate) line(x, y + height - 1, x + width, y + height - 1, '#46504c');
  const ink = ultimate ? '#151915' : '#f3f4ee';
  const muted = ultimate ? '#3f4530' : '#9ea9a1';
  fill(String(number).padStart(2, '0'), x + 30, y + 38, '800 24px Arial', ultimate ? '#151915' : '#dce83d');
  line(x + 75, y + 20, x + 75, y + height - 20, ultimate ? '#778029' : '#454e4a');
  fill(kind(step.skill), x + width - 24, y + 34, '700 18px Arial, "PingFang SC", sans-serif', muted, 'right');
  fill(step.skill, x + 98, y + 67, fit(step.skill, width - 205, 36), ink);
  if (step.note) {
    fill(step.note, x + 100, y + 101, fit(step.note, width - 208, 21, 500), muted);
  }
  if (step.time) fill(step.time, x + width - 24, y + 101, '800 24px Arial', ink, 'right');
}

function draw(steps) {
  const width = 1440, columns = 2, rowHeight = 126, rows = Math.ceil(steps.length / columns);
  const height = Math.max(780, 320 + rows * rowHeight + 170);
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#151919'; ctx.fillRect(0, 0, width, height);

  // Quiet technical grid behind the sequence.
  for (let x = 76; x < width; x += 126) line(x, 0, x, height, '#ffffff09');
  for (let y = 0; y < height; y += 126) line(0, y, width, y, '#ffffff09');
  ctx.fillStyle = '#dce83d'; ctx.fillRect(0, 0, 16, 252);
  ctx.fillRect(76, 74, 55, 9);
  fill('ENDFIELD / TACTICAL AXIS', 76, 117, '800 22px Arial', '#dce83d');
  fill('技能释放序列', 73, 220, '900 88px Arial, "PingFang SC", sans-serif');
  line(76, 256, width - 76, 256, '#dce83d', 3);
  fill(`${String(steps.length).padStart(2, '0')} ACTIONS`, 76, 294, '800 24px Arial', '#f3f4ee');
  const times = steps.map(step => step.time).filter(Boolean);
  fill(times.length ? `${times[0]}  →  ${times[times.length - 1]}` : 'SEQUENCE / 01', width - 76, 294, '800 24px Arial', '#dce83d', 'right');

  const margin = 76, gap = 20, cardWidth = (width - margin * 2 - gap) / 2;
  steps.forEach((step, index) => {
    const x = margin + (index % 2) * (cardWidth + gap);
    const y = 322 + Math.floor(index / 2) * rowHeight;
    drawCard(step, index + 1, x, y, cardWidth, 114);
  });

  const foot = 322 + rows * rowHeight + 24;
  line(76, foot, width - 76, foot, '#59635e');
  fill('战斗轴 / COMBAT ROTATION', 76, foot + 49, '800 21px Arial, "PingFang SC", sans-serif', '#f3f4ee');
  fill('01 — END', width - 76, foot + 49, '800 20px Arial', '#dce83d', 'right');
  dimensions.textContent = `${width} × ${height} PX`;
}

function render() {
  try {
    const steps = parseTable(input.value);
    draw(steps);
    status.textContent = `已生成 ${steps.length} 条动作`; status.classList.remove('error');
    document.querySelector('#download').disabled = false;
  } catch (error) {
    status.textContent = error.message; status.classList.add('error');
    document.querySelector('#download').disabled = true;
  }
}

document.querySelector('#render').addEventListener('click', render);
document.querySelector('#file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (file) { input.value = await file.text(); render(); }
  event.target.value = '';
});
document.querySelector('#download').addEventListener('click', () => {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'endfield-axis.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});
render();
