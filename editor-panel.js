const editorPanel = document.querySelector('[data-editor-panel]');

function saveEditorText(text, filename, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

if (editorPanel) {
  const videoMode = editorPanel.dataset.editorMode === 'video';
  editorPanel.innerHTML = `
    <div class="section-heading"><span class="index">01 / INPUT</span>${videoMode ? '' : '<h1>技能顺序</h1>'}</div>
    <p class="field-label"><span class="field-name">CSV <span>operator · action · time · note</span></span><span class="file-name" id="csv-name"></span></p>
    <textarea id="source" spellcheck="false" aria-label="技能顺序 CSV"></textarea>
    <div class="editor-actions">
      <label class="button button-secondary" for="file">导入 CSV</label>
      <input id="file" type="file" accept=".csv,text/csv,text/plain" hidden>
      <button class="button button-secondary" id="csv-save" type="button" disabled>保存</button>
      <button class="button button-secondary" id="csv-save-as" type="button">另存为</button>
    </div>
    <p class="field-label config-label"><span class="field-name">TOML <span>${videoMode ? '视频参数' : '海报参数'}</span></span><span class="file-name" id="toml-name"></span></p>
    <textarea id="poster-config" class="config-source" spellcheck="false" aria-label="${videoMode ? '视频' : '海报'} TOML"></textarea>
    <div class="editor-actions">
      <label class="button button-secondary" for="config-file">导入 TOML</label>
      <input id="config-file" type="file" accept=".toml,text/plain" hidden>
      <button class="button button-secondary" id="toml-save" type="button" disabled>保存</button>
      <button class="button button-secondary" id="toml-save-as" type="button">另存为</button>
      ${videoMode ? '' : '<button class="button button-primary" id="render" type="button">生成预览 <span aria-hidden="true">↗</span></button>'}
    </div>
    <p class="status" id="status" role="status"></p>
    <pre class="error-details" id="error-details" hidden></pre>
    <div class="editor-foot"><span>UTF-8</span>${videoMode ? '<span>时间倒序</span>' : '<span id="row-seconds">10 SEC / LINE</span><span>时间倒序</span>'}</div>
  `;

  const fields = [
    { type: 'csv', input: editorPanel.querySelector('#source'), picker: editorPanel.querySelector('#file'), name: editorPanel.querySelector('#csv-name'), save: editorPanel.querySelector('#csv-save'), saveAs: editorPanel.querySelector('#csv-save-as'), fallback: 'endfield-axis.csv', mime: 'text/csv;charset=utf-8' },
    { type: 'toml', input: editorPanel.querySelector('#poster-config'), picker: editorPanel.querySelector('#config-file'), name: editorPanel.querySelector('#toml-name'), save: editorPanel.querySelector('#toml-save'), saveAs: editorPanel.querySelector('#toml-save-as'), fallback: 'endfield-axis.toml', mime: 'text/plain;charset=utf-8' }
  ];
  fields.forEach(field => {
    let importedName = '';
    field.picker.addEventListener('change', async event => {
      const file = event.target.files[0];
      if (file) {
        field.input.value = await file.text();
        importedName = file.name;
        field.name.textContent = importedName;
        field.save.disabled = false;
        document.dispatchEvent(new CustomEvent('editor-file-loaded', { detail: { type: field.type, name: importedName } }));
      }
      event.target.value = '';
    });
    field.save.addEventListener('click', () => saveEditorText(field.input.value, importedName, field.mime));
    field.saveAs.addEventListener('click', () => saveEditorText(field.input.value, field.fallback, field.mime));
  });
}
