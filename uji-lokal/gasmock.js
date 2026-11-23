// Mock minimal layanan Google Apps Script untuk menguji kode .gs di Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function signed(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }
function unsigned(arr) { return Buffer.from(arr.map(b => (b < 0 ? b + 256 : b))); }

function parseUserEntered(v) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);          // perilaku Sheets: teks angka jadi angka
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  if (v.startsWith('=')) return '#FORMULA:' + v;              // tandai jika rumus lolos
  return v;
}

let idSeq = 0;
const nextId = p => p + (++idSeq).toString(36) + crypto.randomBytes(4).toString('hex');

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const line = this.sheet.data[this.r - 1 + i] || [];
        const v = line[this.c - 1 + j];
        row.push(v === undefined || v === null ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues dimension mismatch');
    for (let i = 0; i < this.nr; i++) {
      const ri = this.r - 1 + i;
      while (this.sheet.data.length <= ri) this.sheet.data.push([]);
      for (let j = 0; j < this.nc; j++) this.sheet.data[ri][this.c - 1 + j] = parseUserEntered(vals[i][j]);
    }
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) {
      const line = this.sheet.data[this.r - 1 + i];
      if (line) for (let j = 0; j < this.nc; j++) line[this.c - 1 + j] = '';
    }
    // pangkas baris kosong di akhir
    while (this.sheet.data.length && this.sheet.data[this.sheet.data.length - 1].every(v => v === '' || v === undefined)) this.sheet.data.pop();
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  appendRow(arr) { this.data.push(arr.map(parseUserEntered)); this.appends = (this.appends || 0) + 1; }
  setFrozenRows() {}
}

class Spreadsheet {
  constructor(name) { this.id = nextId('ss'); this.name = name; this.sheets = [new Sheet('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone() {}
}

function makeGlobals(state) {
  const files = state.files; // id -> {kind, name, parent, blob, trashed, created}
  const mkFolder = (name, parent) => {
    const id = nextId('fd');
    files[id] = { kind: 'folder', id, name, parent, created: new Date() };
    return folderObj(id);
  };
  const fileObj = id => {
    const f = files[id];
    if (!f || f.kind === 'folder') throw new Error('File not found: ' + id);
    return {
      getId: () => id, getName: () => f.name, getDateCreated: () => f.created,
      moveTo: folder => { f.parent = folder.getId(); },
      setTrashed: t => { f.trashed = t; },
      getBlob: () => blobObj(f.bytes, f.mime, f.name),
      makeCopy: (name, folder) => {
        const nid = nextId('fl');
        files[nid] = { ...f, id: nid, name, parent: folder.getId(), created: new Date(Date.now() + idSeq) };
        if (f.ss) files[nid].ss = f.ss;
        return fileObj(nid);
      }
    };
  };
  const folderObj = id => {
    const f = files[id];
    if (!f || f.kind !== 'folder' || f.trashed) throw new Error('Folder not found: ' + id);
    return {
      getId: () => id, getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      createFolder: n => mkFolder(n, id),
      createFile: blob => {
        const nid = nextId('fl');
        files[nid] = { kind: 'file', id: nid, name: blob.getName(), mime: blob.getContentType(), bytes: blob.getBytes(), parent: id, created: new Date() };
        return fileObj(nid);
      },
      getFiles: () => {
        const list = Object.values(files).filter(x => x.kind !== 'folder' && x.parent === id && !x.trashed).map(x => fileObj(x.id));
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      }
    };
  };
  const blobObj = (bytes, mime, name) => ({
    getBytes: () => bytes, getContentType: () => mime, getName: () => name
  });

  const cacheStore = state.cache;
  const cache = {
    get: k => {
      const e = cacheStore[k];
      if (!e || e.exp < Date.now()) return null;
      return e.v;
    },
    put: (k, v, ttl) => {
      if (typeof v !== 'string') throw new Error('cache value must be string');
      if (v.length > 100 * 1024) throw new Error('Argument too large');
      if (ttl > 21600) throw new Error('ttl too large');
      cacheStore[k] = { v, exp: Date.now() + (ttl || 600) * 1000 };
    },
    putAll: (values, ttl) => Object.keys(values).forEach(k => cache.put(k, values[k], ttl)),
    getAll: keys => { const o = {}; keys.forEach(k => { const v = cache.get(k); if (v !== null) o[k] = v; }); return o; },
    remove: k => { delete cacheStore[k]; },
    removeAll: keys => keys.forEach(k => delete cacheStore[k])
  };

  const fmtJakarta = (d, tz, fmt) => {
    const t = new Date(d.getTime() + 7 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    const Y = t.getUTCFullYear(), M = p(t.getUTCMonth() + 1), D = p(t.getUTCDate()), h = p(t.getUTCHours()), m = p(t.getUTCMinutes()), s = p(t.getUTCSeconds());
    if (fmt === "yyyy-MM-dd'T'HH:mm:ssXXX") return `${Y}-${M}-${D}T${h}:${m}:${s}+07:00`;
    if (fmt === 'yyyy-MM-dd_HHmm') return `${Y}-${M}-${D}_${h}${m}`;
    if (fmt === 'u') return String(((t.getUTCDay() + 6) % 7) + 1);
    if (fmt === 'dd/MM HH.mm') return `${D}/${M} ${h}.${m}`;
    throw new Error('format not mocked: ' + fmt);
  };

  return {
    console: { log: () => {}, error: (...a) => state.errors.push(a.join(' ')), warn: () => {} },
    Logger: { log: m => state.logs.push(String(m)) },
    SpreadsheetApp: {
      create: name => {
        const ss = new Spreadsheet(name);
        state.spreadsheets[ss.id] = ss;
        files[ss.id] = { kind: 'file', id: ss.id, name, parent: null, created: new Date(), ss };
        return ss;
      },
      openById: id => { const ss = state.spreadsheets[id]; if (!ss) throw new Error('no ss'); return ss; },
      flush: () => {}
    },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); }
      })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => signed(crypto.createHash(alg).update(String(text), 'utf8').digest()),
      computeHmacSha256Signature: (value, key) => {
        state.hmacCalls = (state.hmacCalls || 0) + 1;
        return signed(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest());
      },
      formatDate: fmtJakarta,
      base64Decode: s => signed(Buffer.from(s, 'base64')),
      base64Encode: bytes => unsigned(bytes).toString('base64'),
      newBlob: (bytes, mime, name) => blobObj(bytes, mime, name)
    },
    DriveApp: {
      createFolder: n => mkFolder(n, null),
      getFolderById: id => folderObj(id),
      getFileById: id => fileObj(id)
    },
    MailApp: {
      getRemainingDailyQuota: () => state.mailQuota,
      sendEmail: o => { state.mails.push(o); state.mailQuota--; }
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: t => { state.triggers = state.triggers.filter(x => x !== t); },
      newTrigger: fn => {
        const b = { timeBased: () => b, everyDays: () => b, everyHours: () => b, atHour: () => b, create: () => { const t = { getHandlerFunction: () => fn }; state.triggers.push(t); return t; } };
        return b;
      }
    },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: name => ({ getContent: () => fs.readFileSync(path.join(state.srcDir, name + '.html'), 'utf8') }),
      createTemplateFromFile: name => {
        const tpl = { _src: fs.readFileSync(path.join(state.srcDir, name + '.html'), 'utf8') };
        tpl.evaluate = () => {
          const ctx = state.ctx;
          const html = tpl._src.replace(/<\?!=\s*([\s\S]*?)\s*;?\s*\?>/g, (_, expr) => {
            if (/^bootJson$/.test(expr.trim())) return tpl.bootJson;
            return vm.runInContext(expr.replace(/;$/, ''), ctx);
          });
          const out = {
            content: html, getContent: () => html,
            setTitle: t => { out.title = t; return out; },
            addMetaTag: (n, c) => { out.meta = { n, c }; return out; },
            setXFrameOptionsMode: () => out
          };
          return out;
        };
        return tpl;
      }
    }
  };
}

function load(srcDir) {
  const state = {
    srcDir, files: {}, cache: {}, props: {}, spreadsheets: {}, logs: [], errors: [], mails: [],
    mailQuota: 100, triggers: []
  };
  const ctx = vm.createContext(makeGlobals(state));
  state.ctx = ctx;
  const gs = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs')).sort();
  // GAS menggabungkan semua file .gs dalam satu ruang global.
  const code = gs.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, ctx, { filename: 'project.gs' });
  return { ctx, state, call: (fn, ...args) => ctx[fn](...args) };
}

module.exports = { load };
