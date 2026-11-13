/**
 * Layout regression test for the details panel, run in a real browser engine.
 *
 * The panel is placed by CSS anchor positioning: its bottom edge is pinned 8px
 * above the trigger and its left edge follows the trigger's. That invariant is
 * what a running task stress-tests — the panel's content grows (models, subagent
 * rows) while the composer itself moves up — and it is exactly what broke when
 * the panel still carried the shell dialog's "flip below the trigger" and "full
 * viewport" position fallbacks: past one round of rows the panel detached, landed
 * at the top of the window, and read as "the card vanished / flew away".
 *
 * Runs headless Chrome and skips (exit 0, with a notice) when no Chrome is
 * installed, so the suite still works on machines without one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';

const CHROME_CANDIDATES = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
];
const CHROME = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
const PLUGIN = process.argv[2] ?? 'lib/client.js';
const TEMPLATE = new URL('./panel-layout.html', import.meta.url);

const failures = [];
const check = (label, condition) => {
	if (!condition) failures.push(label);
	console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
};

/**
 * Read the stylesheet the bundle injects, without a DOM.
 * @returns the concatenated CSS text.
 */
function pluginCss() {
	const captured = [];
	globalThis.document = {
		querySelector: () => null,
		createElement: () => {
			const element = { dataset: {}, textContent: '' };
			captured.push(element);
			return element;
		},
		head: { appendChild() {} },
		body: { tag: 'body' },
		addEventListener() {},
		removeEventListener() {},
	};
	globalThis.Node = class {};
	globalThis.setInterval = () => 0;
	globalThis.clearInterval = () => {};
	globalThis.setTimeout = () => 0;
	globalThis.clearTimeout = () => {};
	let registration;
	globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value; } } };
	runInThisContext(readFileSync(PLUGIN, 'utf8'), { filename: 'client.js' });
	const passthrough = (name) => new Proxy({}, { get: () => () => undefined });
	registration.factory((specifier) => {
		if (specifier === 'react') {
			return {
				Fragment: Symbol('Fragment'),
				useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
				useRef: (initial) => ({ current: initial }),
				useEffect: () => {},
				useMemo: (factory) => factory(),
				useId: () => ':r1:',
				useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
			};
		}
		if (specifier === 'react-dom') return { createPortal: (node) => node };
		if (specifier === 'react/jsx-runtime') return { Fragment: Symbol('Fragment'), jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
		if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return passthrough();
		throw new Error(`unexpected require ${specifier}`);
	});
	const css = captured.find((element) => element.dataset?.pluginCss === 'dsh-plugin-account-usage/client.css')?.textContent;
	if (css === undefined) throw new Error('bundle injected no stylesheet');
	return css;
}

/**
 * Render the fixture at one window size and read the measurements Chrome printed.
 * @param css - plugin stylesheet.
 * @param size - `{ width, height }` of the window.
 * @returns the scenario log.
 */
function measure(css, placement, size) {
	const template = readFileSync(TEMPLATE, 'utf8');
	const page = template
		.replace('__PLUGIN_CSS__', css.replaceAll('\\', '\\\\').replaceAll("'", "\\'"))
		.replace('__PLACEMENT_SCRIPT__', placement);
	// Written outside the repository: the fixture is a build artifact of this test.
	const pageFile = new URL(`./panel-layout-${size.width}x${size.height}.html`, `file://${mkdtempSync('/tmp/account-usage-page-')}/`);
	writeFileSync(pageFile, page);
	const dom = execFileSync(CHROME, [
		'--headless=new',
		// Chrome's own sandbox cannot start inside the harness file sandbox; the
		// page under test is a local file with no remote content.
		'--no-sandbox',
		'--disable-breakpad',
		`--user-data-dir=${mkdtempSync('/tmp/account-usage-layout-')}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-gpu',
		'--hide-scrollbars',
		'--force-device-scale-factor=1',
		`--window-size=${size.width},${size.height}`,
		'--virtual-time-budget=3000',
		'--dump-dom',
		pageFile.href,
	], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90_000 });
	const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/u);
	if (match === null) throw new Error(`no result element at ${size.width}x${size.height}`);
	const json = match[1]
		.replaceAll('&quot;', '"')
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>');
	return JSON.parse(json);
}

const css = pluginCss();

// The panel is placed by measurement, not by CSS anchors: no anchor syntax and
// no position fallbacks that could flip it to the window top or below the pill.
check('panel takes its position from the placement function', /\.dshAccountUsage_panel\{[^}]*position:fixed/u.test(css));
check('no CSS anchor positioning is left', !/anchor\(|anchor-name|position-anchor|position-try/u.test(css));

const source = readFileSync(PLUGIN, 'utf8');
const region = source.match(/\/\/#region panel placement([\s\S]*?)\/\/#endregion/u);
check('the placement region is marked for this test', region !== null);
const placement = region === null ? '' : `${region[1]}\nwindow.__placePanel = placePanel;`;
check('placement keeps the trigger gap', /PANEL_GAP = 8/u.test(placement));
check('placement clamps height to the room above the trigger', /roomAbove = anchor\.top - PANEL_GAP - PANEL_MARGIN/u.test(placement));
check('placement clamps horizontally into the window', /viewportWidth - PANEL_MARGIN - width/u.test(placement));

if (CHROME === undefined) {
	console.log('\nno Chrome found — layout checks skipped (the stylesheet checks above still ran)');
	if (failures.length > 0) process.exit(1);
	process.exit(0);
}

const wide = measure(css, placement, { width: 1280, height: 800 });
const gap = (scenario) => scenario.pill.top - scenario.panel.bottom;

for (const scenario of wide) {
	const label = scenario.label;
	check(`${label}: panel is above the trigger`, scenario.panel.top < scenario.pill.top);
	check(`${label}: panel clears the trigger by 8px`, Math.abs(gap(scenario) - 8) <= 1);
	check(`${label}: panel stays inside the window`, scenario.panel.top >= 11 && scenario.panel.bottom <= scenario.viewport.height);
}
const tall = wide.filter((scenario) => scenario.label !== 'composer-grew');
check('tall content clamps instead of overflowing', tall.every((scenario) => scenario.panel.height <= scenario.viewport.height - 20));
check('tall content scrolls inside the panel', wide.some((scenario) => scenario.scrollHeight > scenario.clientHeight));

const narrow = measure(css, placement, { width: 500, height: 640 });
for (const scenario of narrow) {
	check(`narrow ${scenario.label}: panel is above the trigger`, scenario.panel.top < scenario.pill.top);
	check(`narrow ${scenario.label}: panel keeps a 12px left margin`, scenario.panel.left >= 11);
	check(`narrow ${scenario.label}: panel fits the window width`, scenario.panel.right <= scenario.viewport.width - 11);
}

if (failures.length > 0) {
	console.error(`\n${failures.length} failed check(s)`);
	process.exit(1);
}
console.log('\nall layout checks passed');
