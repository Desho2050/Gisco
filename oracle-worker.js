// Parse Oracle.xlsx off the main thread
// Imports XLSX in the worker context and returns parsed JSON rows
/* eslint-disable no-undef */
importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

self.onmessage = (e) => {
  const { buffer } = e.data || {};
  try {
    const wb = XLSX.read(buffer, { type: 'array', raw: true, dense: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    self.postMessage({ ok: true, json });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};