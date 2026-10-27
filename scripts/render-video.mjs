import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [csvPath, configPath, outputPath] = process.argv.slice(2);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.toml': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function main() {
  if (!csvPath || !configPath || !outputPath || extname(outputPath).toLowerCase() !== '.mov') throw new Error('用法：npm run video -- 输入.csv 配置.toml 输出.mov');
  const [source, configSource] = await Promise.all([readFile(csvPath, 'utf8'), readFile(configPath, 'utf8')]);
  const output = resolve(outputPath);
  if (await stat(output).catch(() => null)) throw new Error(`输出文件已存在：${output}`);
  await mkdir(dirname(output), { recursive: true });
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
  let encoder;
  try {
    const page = await browser.newPage();
    await page.route('http://axis.local/**', async route => {
      const path = resolve(root, '.' + decodeURIComponent(new URL(route.request().url()).pathname));
      if (path !== root && !path.startsWith(root + sep)) return route.fulfill({ status: 403 });
      try { await route.fulfill({ body: await readFile(path), contentType: mime[extname(path)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404 }); }
    });
    await page.goto('http://axis.local/index.html?video');
    await page.addScriptTag({ path: join(root, 'video.js') });
    const { fps, frameCount, triggers, actions, groups } = await page.evaluate(({ source, configSource }) => prepareVideo(source, configSource), { source, configSource });
    encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-framerate', String(fps), '-f', 'image2pipe', '-vcodec', 'png', '-i', 'pipe:0', '-an', '-c:v', 'qtrle', '-pix_fmt', 'argb', output], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    let writeError;
    encoder.stderr.on('data', chunk => { stderr += chunk; });
    encoder.stdin.on('error', error => { writeError = error; });
    const done = new Promise((resolveDone, rejectDone) => {
      encoder.once('error', rejectDone);
      encoder.once('close', code => code === 0 ? resolveDone() : rejectDone(new Error(stderr || `ffmpeg 退出码 ${code}`)));
    });
    for (let frame = 0; frame < frameCount; frame++) {
      if (writeError) throw writeError;
      const png = Buffer.from(await page.evaluate(time => {
        drawVideoFrame(time);
        return canvas.toDataURL('image/png').split(',')[1];
      }, frame / fps), 'base64');
      if (!encoder.stdin.write(png)) await Promise.race([once(encoder.stdin, 'drain'), done.then(() => { throw new Error('ffmpeg 提前结束'); })]);
      if (frame % fps === 0 || frame === frameCount - 1) process.stderr.write(`\r渲染 ${frame + 1}/${frameCount} 帧`);
    }
    encoder.stdin.end();
    await done;
    process.stderr.write('\n');
    console.log(`已生成 ${output}（${actions} 个动作，${groups} 个触发组）`);
  } finally {
    if (encoder?.exitCode === null) encoder.kill();
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
