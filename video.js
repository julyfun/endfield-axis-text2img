let videoState;

async function prepareVideo(source, configSource) {
  [aliases] = await Promise.all([aliasesTask, operatorsTask]);
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
  });
  const groups = [];
  steps.forEach(step => {
    const group = groups.at(-1);
    if (group && closeTogether(group.steps.at(-1), step)) group.steps.push(step);
    else groups.push({ time: step.time, steps: [step] });
  });
  const timeScale = 240, nodeSpacing = 136;
  groups.forEach((group, groupIndex) => {
    group.trigger = Number((offset + steps[0].time - group.time).toFixed(6));
    group.world = (steps[0].time - group.time) * timeScale;
    group.steps.forEach((step, i) => { step.groupIndex = groupIndex; step.world = group.world + (i - (group.steps.length - 1) / 2) * nodeSpacing; });
    triggers.push(group.trigger);
  });
  canvas.width = width; canvas.height = height;
  videoState = { steps, groups, triggers, width, height, fps, timeScale, nodeSpacing };
  return { width, height, fps, triggers, frameCount: Math.ceil((triggers.at(-1) + 1) * fps), groups: groups.length, actions: steps.length };
}

function easeInOut(progress) {
  return progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function drawVideoFrame(time) {
  const { steps, groups, triggers, width, height } = videoState;
  let active = -1;
  while (active + 1 < groups.length && time >= triggers[active + 1]) active++;
  let camera = active >= 0 ? groups[active].world : 0;
  let focus = active;
  if (active >= 0 && active + 1 < groups.length) {
    const end = triggers[active + 1], start = Math.max(triggers[active], end - .42);
    if (time >= start) {
      focus = active + 1;
      const progress = easeInOut(Math.min(1, (time - start) / (end - start)));
      camera = groups[active].world + (groups[active + 1].world - groups[active].world) * progress;
    }
  }
  const scale = Math.min(width / 1920, height / 1080);
  const viewWidth = width / scale, viewHeight = height / scale;
  const y = viewHeight - 240;
  ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(16, 21, 20, .66)';
  ctx.fillRect(0, y - 96, viewWidth, viewHeight - y + 96);
  line(0, y - 96, viewWidth, y - 96, 'rgba(220, 232, 61, .55)', 2);
  ctx.save(); ctx.globalAlpha = .4;
  for (let i = 1; i < steps.length; i++) {
    const x1 = viewWidth / 2 + steps[i - 1].world - camera + 78;
    const x2 = viewWidth / 2 + steps[i].world - camera - 78;
    if (x2 < 0 || x1 > viewWidth) continue;
    if (steps[i - 1].groupIndex === steps[i].groupIndex) line(x1, y, x2, y, '#dce83d', 3);
    else arrow(x1, y, x2, y);
  }
  ctx.restore();
  steps.forEach((step, i) => {
    const x = viewWidth / 2 + step.world - camera;
    if (x < -100 || x > viewWidth + 100) return;
    ctx.save(); ctx.globalAlpha = i === focus ? 1 : .38;
    drawNode({ ...step, x }, y, step.showTime, -1, false);
    ctx.restore();
  });
  if (active >= 0) {
    const elapsed = time - triggers[active], pulseDuration = .48;
    if (elapsed >= 0 && elapsed < pulseDuration) {
      const progress = elapsed / pulseDuration;
      groups[active].steps.forEach(step => {
        const x = viewWidth / 2 + step.world - camera;
        if (x < -100 || x > viewWidth + 100) return;
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - progress})`;
        ctx.lineWidth = 5 - progress * 3;
        ctx.beginPath(); ctx.arc(x, y, 67 + progress * 70, 0, Math.PI * 2); ctx.stroke();
      });
    }
  }
  ctx.restore();
  return { active, focus, camera };
}
