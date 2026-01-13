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
      <div class="field-row">
        <label class="field">
          <span>Buffer (meters)</span>
          <input id="buffer" type="number" min="0" step="1" placeholder="0" value="0" />
        </label>
        <label class="field">
          <span>Simplify tolerance (meters)</span>
          <input
            id="simplify"
            type="number"
            min="0"
            step="1"
            placeholder="25"
            value="25"
          />
        </label>
      </div>
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
const bufferInput = document.querySelector('#buffer');
const simplifyInput = document.querySelector('#simplify');
const copyButton = document.querySelector('#copy');
const datalist = document.querySelector('#gemeinde-list');

const roundToDecimals = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const roundGeoJsonCoordinates = (node, decimals) => {
  if (Array.isArray(node)) {
    if (typeof node[0] === 'number') {
      return node.map((value) => roundToDecimals(value, decimals));
    }
    return node.map((child) => roundGeoJsonCoordinates(child, decimals));
  }
  if (node && typeof node === 'object') {
    const next = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'coordinates') {
        next[key] = roundGeoJsonCoordinates(value, decimals);
      } else {
        next[key] = value;
      }
    }
    return next;
  }
  return node;
};

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

const fetchGeoJson = async (name, bufferMeters, simplifyTolerance) => {
  const stmt = await conn.prepare(
    `WITH source AS (
       SELECT geometry
       FROM read_parquet('swissboundaries.parquet')
       WHERE text = ?
       LIMIT 1
     ),
     projected AS (
       SELECT CASE
         WHEN ABS(ST_X(ST_Centroid(geometry))) > 1000
           OR ABS(ST_Y(ST_Centroid(geometry))) > 1000
           THEN geometry
         ELSE ST_Transform(geometry, 'EPSG:4326', 'EPSG:2056')
       END AS geometry
       FROM source
     ),
     buffered AS (
       SELECT CASE
         WHEN ? > 0 THEN ST_Buffer(geometry, ?)
         ELSE geometry
       END AS geometry
       FROM projected
     ),
     simplified AS (
       SELECT CASE
         WHEN ? > 0 THEN ST_Simplify(geometry, ?)
         ELSE geometry
       END AS geometry
       FROM buffered
     )
     SELECT ST_AsGeoJSON(
       CASE
         WHEN ABS(ST_X(ST_Centroid(geometry))) > 1000
           OR ABS(ST_Y(ST_Centroid(geometry))) > 1000
           THEN ST_Transform(geometry, 'EPSG:2056', 'EPSG:4326')
         ELSE geometry
       END
     ) AS geojson
     FROM simplified`
  );
  const result = await stmt.query(
    name,
    bufferMeters,
    bufferMeters,
    simplifyTolerance,
    simplifyTolerance
  );
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

  const bufferMeters = Math.max(0, Number.parseFloat(bufferInput.value) || 0);
  const simplifyTolerance = Math.max(
    0,
    Number.parseFloat(simplifyInput.value) || 0
  );

  try {
    setStatus('Initializing...');
    await initDuckDb();
    setStatus('Querying...');
    const geojson = await fetchGeoJson(
      name,
      bufferMeters,
      simplifyTolerance
    );
    if (!geojson) {
      output.textContent = `No match for "${name}".`;
    } else {
      try {
        const parsed = JSON.parse(geojson);
        const rounded = roundGeoJsonCoordinates(parsed, 5);
        output.textContent = JSON.stringify(rounded);
      } catch (parseErr) {
        output.textContent = geojson;
      }
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
