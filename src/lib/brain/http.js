// Small fetch wrapper for the live-info tools: timeouts and plain-English errors the AI can relay.
async function get(url, as) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`The service returned an error (${r.status}).`);
    return as === 'text' ? await r.text() : await r.json();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('The request timed out.');
    if (e instanceof TypeError) throw new Error('No internet connection.');
    throw e;
  } finally { clearTimeout(timer); }
}
export const http = { json: url => get(url, 'json'), text: url => get(url, 'text') };
