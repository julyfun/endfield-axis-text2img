let videoState;

async function prepareVideo(source, configSource) {
  [aliases] = await Promise.all([aliasesTask, operatorsTask, loadDefaults()]);
  const { steps, style, warnings } = parseDocument(source, configSource, 'video');
  renderStyle = style;
  const width = style.width, height = style.height, fps = style.fps;
  const offset = style.sync_offset_seconds;
  if (!Number.isInteger(width) || width < 320 || width > 3840 || !Number.isInteger(height) || height < 240 || height > 2160) throw new Error('视频宽高需要在 320×240 到 3840×2160 之间');
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('fps 需要 1–60 的整数');
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) throw new Error('sync_offset_seconds 需要非负数');
  if (![style.time_scale, style.node_spacing, style.min_group_gap, style.max_group_gap].every(value => Number.isFinite(value) && value >= 0) || style.max_group_gap < style.min_group_gap) throw new Error('视频间距参数无效：max_group_gap 不能小于 min_group_gap');
  await prepareAssets(steps);
  const triggers = [];
  const groups = [];
  steps.forEach(step => {
    const group = groups.at(-1);
    if (group && closeTogether(group.steps.at(-1), step)) group.steps.push(step);
    else groups.push({ time: step.time, steps: [step] });
  });
  const timeScale = style.time_scale, nodeSpacing = style.node_spacing;
  const minGroupGap = style.min_group_gap, maxGroupGap = style.max_group_gap;
  let previousWorld = 0, previousTimeWorld = 0, previousExtent = 0;
  groups.forEach((group, groupIndex) => {
    group.trigger = Number((offset + steps[0].time - group.time).toFixed(6));
    group.halfWidth = (group.steps.length - 1) * nodeSpacing / 2;
    const groupExtent = group.halfWidth + style.node_radius;
    const timeWorld = (steps[0].time - group.time) * timeScale;
    const timeGap = timeWorld - previousTimeWorld - previousExtent - groupExtent;
    const boundedGap = Math.min(maxGroupGap, Math.max(minGroupGap, timeGap));
    group.world = groupIndex ? previousWorld + previousExtent + groupExtent + boundedGap : timeWorld;
    group.steps.forEach((step, i) => {
      step.groupIndex = groupIndex;
      step.showTime = i === 0 && step.specifiedTime;
      step.trigger = Number((offset + steps[0].time - step.time).toFixed(6));
      step.world = group.world + (i - (group.steps.length - 1) / 2) * nodeSpacing;
    });
    previousWorld = group.world;
    previousTimeWorld = timeWorld;
    previousExtent = groupExtent;
    triggers.push(group.trigger);
  });
  canvas.width = width; canvas.height = height;
  videoState = { steps, groups, triggers, width, height, fps, timeScale, nodeSpacing };
  return { width, height, fps, triggers, frameCount: Math.ceil((triggers.at(-1) + 1) * fps), groups: groups.length, actions: steps.length, warnings };
}

function easeInOut(progress) {
  return progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function colorWithAlpha(color, alpha) {
  const channels = color.match(/^#([0-9a-f]{6})$/i)?.[1].match(/../g);
  return channels ? `rgba(${channels.map(value => parseInt(value, 16)).join(', ')}, ${alpha})` : color;
}

function drawVideoFrame(time) {
  const { steps, groups, triggers, width, height } = videoState;
  let active = -1;
  while (active + 1 < groups.length && time >= triggers[active + 1]) active++;
  let camera = active >= 0 ? groups[active].world : 0;
  let focus = active;
  if (active >= 0 && active + 1 < groups.length) {
    const end = triggers[active + 1], start = Math.max(triggers[active], end - renderStyle.transition_seconds);
    if (time >= start) {
      focus = active + 1;
      const progress = easeInOut(Math.min(1, (time - start) / (end - start)));
      camera = groups[active].world + (groups[active + 1].world - groups[active].world) * progress;
    }
  }
  const scale = Math.min(width / renderStyle.reference_width, height / renderStyle.reference_height);
  const viewWidth = width / scale, viewHeight = height / scale;
  const y = viewHeight - renderStyle.axis_y_offset;
  ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.scale(scale, scale);
  ctx.fillStyle = renderStyle.background;
  ctx.fillRect(0, y - 96, viewWidth, viewHeight - y + 96);
  ctx.save(); ctx.globalAlpha = renderStyle.connector_alpha;
  for (let i = 1; i < steps.length; i++) {
    const x1 = viewWidth / 2 + steps[i - 1].world - camera + 78;
    const x2 = viewWidth / 2 + steps[i].world - camera - 78;
    if (x2 < 0 || x1 > viewWidth) continue;
    if (steps[i - 1].groupIndex === steps[i].groupIndex) line(x1, y, x2, y, renderStyle.connector_color, 3);
    else arrow(x1, y, x2, y);
  }
  ctx.restore();
  steps.forEach((step, i) => {
    const x = viewWidth / 2 + step.world - camera;
    if (x < -100 || x > viewWidth + 100) return;
    ctx.save(); ctx.globalAlpha = step.groupIndex === focus ? 1 : renderStyle.inactive_alpha;
    drawNode({ ...step, x }, y, step.showTime, 1, false);
    ctx.restore();
  });
  if (active >= 0) {
    const pulseDuration = renderStyle.pulse_duration;
    groups[active].steps.forEach(step => {
      const elapsed = time - step.trigger;
      if (elapsed < 0 || elapsed >= pulseDuration) return;
      const stepProgress = elapsed / pulseDuration;
      const radiusProgress = 1 - Math.pow(1 - stepProgress, renderStyle.pulse_radius_ease);
      const alpha = 1 - Math.pow(stepProgress, renderStyle.pulse_alpha_ease);
      const x = viewWidth / 2 + step.world - camera;
      if (x < -100 || x > viewWidth + 100) return;
      ctx.strokeStyle = colorWithAlpha(renderStyle.pulse_color, alpha);
      ctx.lineWidth = renderStyle.pulse_start_width + stepProgress * (renderStyle.pulse_end_width - renderStyle.pulse_start_width);
      ctx.beginPath(); ctx.arc(x, y, renderStyle.pulse_start_radius + radiusProgress * (renderStyle.pulse_end_radius - renderStyle.pulse_start_radius), 0, Math.PI * 2); ctx.stroke();
    });
  }
  ctx.restore();
  return { active, focus, camera };
}
