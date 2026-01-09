import './style.css';
import * as duckdb from '@duckdb/duckdb-wasm';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="page">
    <header class="header">
      <h1>Gemeinde GeoJSON</h1>
      <div class="subhead">
        <p>
          Type a Swiss community name and get the GeoJSON back from swissBOUNDARIES3D.
        </p>
        <p>
          Paste the output into
          <a href="https://designer.topoprint.ch/pro.html" target="_blank" rel="noreferrer">
            Topoprint Designer Pro
          </a>.
        </p>
        <p class="attribution">
          Data source: swissBOUNDARIES3D (swisstopo).
        </p>
      </div>
      <a
        class="repo-link"
        href="https://github.com/ping13/ch-gemeinde-geojson"
        target="_blank"
        rel="noreferrer"
      >
        View on GitHub
      </a>
    </header>
    <section class="panel">
      <label class="field">
        <span>Gemeinde name</span>
        <input id="gemeinde" list="gemeinde-list" placeholder="Zürich" value="Zürich" />
        <datalist id="gemeinde-list"></datalist>
      </label>
      <button id="run" type="button">Query</button>
      <p class="status" id="status">Idle.</p>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>Output</h2>
        <button id="copy" type="button" class="secondary">Copy</button>
      </div>
      <pre id="output">Ready.</pre>
    </section>
  </main>
`;

const output = document.querySelector('#output');
const status = document.querySelector('#status');
const runButton = document.querySelector('#run');
const input = document.querySelector('#gemeinde');
const copyButton = document.querySelector('#copy');
const datalist = document.querySelector('#gemeinde-list');

const BUNDLES = {
  mvp: {
    mainModule: new URL(
      '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm',
      import.meta.url
    ).toString(),
    mainWorker: new URL(
      '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js',
      import.meta.url
    ).toString()
  },
  eh: {
    mainModule: new URL(
      '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm',
      import.meta.url
    ).toString(),
    mainWorker: new URL(
      '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js',
      import.meta.url
    ).toString()
  }
};

let db;
let conn;
let suggestionsLoaded = false;

const setStatus = (message) => {
  status.textContent = message;
};

const initDuckDb = async () => {
  if (db && conn) {
    return;
  }

  setStatus('Starting DuckDB-WASM...');
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker, { type: 'module' });
  db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  conn = await db.connect();
  await conn.query("SET home_directory='.';");
  await conn.query("SET extension_directory='.';");

  const parquetUrl = new URL(
    `${import.meta.env.BASE_URL}assets/swissboundaries_by_text.parquet`,
    window.location
  ).toString();
  await db.registerFileURL(
    'swissboundaries.parquet',
    parquetUrl,
    duckdb.DuckDBDataProtocol.HTTP,
    false
  );

  setStatus('Loading spatial extension...');
  try {
    await conn.query('LOAD spatial;');
  } catch (err) {
    try {
      await conn.query('INSTALL spatial;');
      await conn.query('LOAD spatial;');
    } catch (installErr) {
      throw new Error(
        `Failed to load spatial extension. ${installErr?.message || installErr}`
      );
    }
  }
};

const loadSuggestions = async () => {
  if (suggestionsLoaded) {
    return;
  }
  await initDuckDb();
  setStatus('Loading suggestions...');
  const result = await conn.query(
    `SELECT DISTINCT text
     FROM read_parquet('swissboundaries.parquet')
     ORDER BY text`
  );
  const names = result.toArray().map((row) => row.text);
  datalist.innerHTML = '';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    datalist.appendChild(option);
  }
  suggestionsLoaded = true;
  setStatus('Ready.');
};

const fetchGeoJson = async (name) => {
  const stmt = await conn.prepare(
    `SELECT ST_AsGeoJSON(geometry) AS geojson
     FROM read_parquet('swissboundaries.parquet')
     WHERE text = ?
     LIMIT 1`
  );
  const result = await stmt.query(name);
  stmt.close();

  if (!result) {
    return null;
  }
  const rows = result.toArray();
  if (rows.length === 0) {
    return null;
  }
  return rows[0].geojson;
};

runButton.addEventListener('click', async () => {
  output.textContent = '';
  const name = input.value.trim();
  if (!name) {
    output.textContent = 'Please enter a Gemeinde name.';
    return;
  }

  try {
    setStatus('Initializing...');
    await initDuckDb();
    setStatus('Querying...');
    const geojson = await fetchGeoJson(name);
    if (!geojson) {
      output.textContent = `No match for "${name}".`;
    } else {
      output.textContent = geojson;
    }
    setStatus('Done.');
  } catch (err) {
    output.textContent = `Error: ${err?.message || err}`;
    setStatus('Failed.');
  }
});

input.addEventListener('focus', () => {
  loadSuggestions().catch((err) => {
    output.textContent = `Error: ${err?.message || err}`;
    setStatus('Failed.');
  });
});

copyButton.addEventListener('click', async () => {
  const text = output.textContent || '';
  if (!text || text === 'Ready.') {
    setStatus('Nothing to copy.');
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setStatus('Copied to clipboard.');
  } catch (err) {
    setStatus(`Copy failed: ${err?.message || err}`);
  }
});
