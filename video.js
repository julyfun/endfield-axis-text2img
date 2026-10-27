let videoState;

async function prepareVideo(source, configSource) {
  aliases = await aliasesTask;
  const config = TOML.parse(configSource.trim());
  const width = config.width ?? 1920, height = config.height ?? 1080, fps = config.fps ?? 30;
  const offset = config.sync_offset_seconds ?? 0;
  if (!Number.isInteger(width) || width < 320 || width > 3840 || !Number.isInteger(height) || height < 240 || height > 2160) throw new Error('视频宽高需要在 320×240 到 3840×2160 之间');
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('fps 需要 1–60 的整数');
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) throw new Error('sync_offset_seconds 需要非负数');
  const { steps } = parseDocument(source, configSource);
  await prepareAssets(steps);
  const seen = new Set(), triggers = [];
  steps.forEach((step, i) => {
    const second = Math.floor(step.time);
    step.showTime = step.specifiedTime && !seen.has(second);
    if (step.showTime) seen.add(second);
    const raw = offset + steps[0].time - step.time;
    triggers.push(Number((i ? Math.max(raw, triggers[i - 1] + .15) : raw).toFixed(6)));
  });
  canvas.width = width; canvas.height = height;
  videoState = { steps, triggers, width, height, fps };
  return { width, height, fps, triggers, frameCount: Math.ceil((triggers.at(-1) + 1) * fps) };
}

function easeInOut(progress) {
  return progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function drawVideoFrame(time) {
  const { steps, triggers, width, height } = videoState;
  let active = -1;
  while (active + 1 < steps.length && time >= triggers[active + 1]) active++;
  let camera = Math.max(active, 0);
  let focus = active;
  if (active >= 0 && active + 1 < steps.length) {
    const end = triggers[active + 1], start = Math.max(triggers[active], end - .42);
    if (time >= start) {
      focus = active + 1;
      camera = active + easeInOut(Math.min(1, (time - start) / (end - start)));
    }
  }
  const scale = Math.min(width / 1920, height / 1080);
  const viewWidth = width / scale, viewHeight = height / scale;
  const y = viewHeight - 240, spacing = 196;
  ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(16, 21, 20, .66)';
  ctx.fillRect(0, y - 96, viewWidth, viewHeight - y + 96);
  line(0, y - 96, viewWidth, y - 96, 'rgba(220, 232, 61, .55)', 2);
  ctx.save(); ctx.globalAlpha = .4;
  for (let i = 1; i < steps.length; i++) {
    const x1 = viewWidth / 2 + (i - 1 - camera) * spacing + 78;
    const x2 = viewWidth / 2 + (i - camera) * spacing - 78;
    if (x2 < 0 || x1 > viewWidth) continue;
    if (closeTogether(steps[i - 1], steps[i])) line(x1, y, x2, y, '#dce83d', 3);
    else arrow(x1, y, x2, y);
  }
  ctx.restore();
  steps.forEach((step, i) => {
    const x = viewWidth / 2 + (i - camera) * spacing;
    if (x < -100 || x > viewWidth + 100) return;
    ctx.save(); ctx.globalAlpha = i === focus ? 1 : .38;
    drawNode({ ...step, x }, y, step.showTime, -1, false);
    ctx.restore();
  });
  ctx.restore();
  return { active, focus, camera };
}
