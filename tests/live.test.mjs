import test from 'node:test';
import assert from 'node:assert/strict';
import { say, call, tools, turn, fakeDeps } from './helpers.mjs';
import { executeTool } from '../src/lib/brain/tools.js';

const calls = [];
const httpWith = routes => ({
  json: async url => { calls.push(url); const k = Object.keys(routes).find(r => url.includes(r)); if (!k) throw new Error(`unexpected ${url}`); const v = routes[k]; if (v instanceof Error) throw v; return v; },
  text: async url => { calls.push(url); const k = Object.keys(routes).find(r => url.includes(r)); if (!k) throw new Error(`unexpected ${url}`); const v = routes[k]; if (v instanceof Error) throw v; return v; },
});
const FORECAST = { current: { temperature_2m: 18.4, apparent_temperature: 17.2, weather_code: 61, wind_speed_10m: 12.6 }, daily: { time: ['2026-10-03', '2026-10-04'], temperature_2m_max: [20.1, 22], temperature_2m_min: [11.5, 12], weather_code: [61, 0], precipitation_probability_max: [70, 5] } };
const GEO = { results: [{ name: 'Paris', admin1: 'Ile-de-France', country: 'France', latitude: 48.85, longitude: 2.35 }] };

test('weather: named place -> geocode then forecast, readable conditions', async () => {
  const deps = fakeDeps({ http: httpWith({ 'geocoding-api': GEO, 'api.open-meteo.com/v1/forecast': FORECAST }) });
  const r = await executeTool('weather_get', { location: 'Paris', days: 2 }, deps);
  assert.equal(r.success, true);
  assert.equal(r.place, 'Paris, Ile-de-France, France');
  assert.deepEqual(r.now, { temperature: 18, feelsLike: 17, condition: 'light rain', wind: 13, windUnit: 'km/h' });
  assert.equal(r.forecast[1].condition, 'clear sky');
  assert.equal(r.forecast[0].rainChancePercent, 70);
  assert.equal(r.unit, 'C');
});

test('weather: fahrenheit units change the request and the unit label', async () => {
  const deps = fakeDeps({ units: 'fahrenheit', http: httpWith({ 'geocoding-api': GEO, 'api.open-meteo.com/v1/forecast': FORECAST }) });
  const r = await executeTool('weather_get', { location: 'Paris' }, deps);
  assert.equal(r.unit, 'F'); assert.equal(r.now.windUnit, 'mph');
  assert.match(calls.at(-1), /temperature_unit=fahrenheit/);
});

test('weather: no place -> uses the phone location; location failure is reported, not hidden', async () => {
  const good = fakeDeps({ phone: { getLocation: async () => ({ latitude: 1.5, longitude: 2.5 }) }, http: httpWith({ 'api.open-meteo.com/v1/forecast': FORECAST }) });
  const r = await executeTool('weather_get', {}, good);
  assert.equal(r.place, 'your location');
  assert.match(calls.at(-1), /latitude=1.5&longitude=2.5/);
  const bad = fakeDeps({ phone: { getLocation: async () => { throw new Error('Location permission is needed.'); } } });
  assert.deepEqual(await executeTool('weather_get', {}, bad), { success: false, error: 'Location permission is needed.' });
});

test('weather: unknown place and offline are honest failures', async () => {
  const none = fakeDeps({ http: httpWith({ 'geocoding-api': {} }) });
  assert.match((await executeTool('weather_get', { location: 'Zzyzx Nowhere' }, none)).error, /couldn't find a place/);
  const off = fakeDeps({ http: httpWith({ 'geocoding-api': new Error('No internet connection.') }) });
  assert.deepEqual(await executeTool('weather_get', { location: 'Paris' }, off), { success: false, error: 'No internet connection.' });
});

test('wiki: returns a short summary; uses the user language; reports nothing found', async () => {
  const deps = fakeDeps({ lang: 'fr-FR', http: httpWith({ 'w/api.php': { query: { search: [{ title: 'Tour Eiffel' }] } }, 'rest_v1/page/summary': { title: 'Tour Eiffel', extract: 'Une tour de fer.', content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Tour_Eiffel' } } } }) });
  const r = await executeTool('wiki_lookup', { query: 'eiffel' }, deps);
  assert.equal(r.title, 'Tour Eiffel'); assert.match(calls.find(u => u.includes('w/api.php')), /^https:\/\/fr\.wikipedia/);
  const empty = fakeDeps({ http: httpWith({ 'w/api.php': { query: { search: [] } } }) });
  assert.match((await executeTool('wiki_lookup', { query: 'qqqq' }, empty)).error, /nothing on Wikipedia/);
});

const RSS = `<rss><channel>
<item><title><![CDATA[Markets rally on rate hopes - Reuters]]></title><source url="x">Reuters</source><pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>Tom &amp; Jerry return - BBC News</title><pubDate>Sat, 03 Oct 2026 07:00:00 GMT</pubDate></item>
<item><title>Third story - AP</title><pubDate>x</pubDate></item></channel></rss>`;
test('news: parses, decodes, strips the source suffix and limits the count', async () => {
  const deps = fakeDeps({ http: httpWith({ 'news.google.com/rss': RSS }) });
  const r = await executeTool('news_headlines', { topic: 'markets', count: 2 }, deps);
  assert.equal(r.headlines.length, 2);
  assert.deepEqual(r.headlines[0], { title: 'Markets rally on rate hopes', source: 'Reuters', published: 'Sat, 03 Oct 2026 08:00:00 GMT' });
  assert.equal(r.headlines[1].title, 'Tom & Jerry return'); assert.equal(r.headlines[1].source, 'BBC News');
  assert.match(calls.at(-1), /search\?q=markets/);
  const none = fakeDeps({ http: httpWith({ 'news.google.com/rss': '<rss></rss>' }) });
  assert.match((await executeTool('news_headlines', {}, none)).error, /no headlines/);
});

test('agent: a weather question calls the weather tool, then answers; route=information', async () => {
  const deps = fakeDeps({ http: httpWith({ 'geocoding-api': GEO, 'api.open-meteo.com/v1/forecast': FORECAST }) });
  const { out, provider } = await turn({ deps, userText: "What's the weather in Paris?", script: [tools(call('weather_get', { location: 'Paris' })), say('It is 18 degrees and raining lightly in Paris.')] });
  assert.equal(out.route, 'information');
  assert.equal(JSON.parse(provider.seen[1].messages.at(-1).content).now.temperature, 18);
});
