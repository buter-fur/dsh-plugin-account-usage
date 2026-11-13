/**
 * Render smoke test for the account-usage dock row.
 *
 * Loads the shipped `lib/client.js` bundle exactly as the page does (through
 * `window.__ModuleLoader__.load`), but with stub platform modules: a tiny React
 * hook implementation, a jsx runtime that returns plain trees, and a primitives
 * table that mirrors DSH 0.2.2-rc.2's export list (which no longer has
 * `useAnchoredPosition`). Rendering the row here fails on any reference to a
 * module-table name the new build dropped, which is what broke the plugin.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';

// #region platform stubs
const created = [];
const stateSlots = [];
let openAll = false;
let idCounter = 0;

const react = {
	Fragment: Symbol('Fragment'),
	useState(initial) {
		const slot = stateSlots.length;
		stateSlots.push(typeof initial === 'function' ? initial() : initial);
		return [openAll && typeof initial === 'boolean' ? true : stateSlots[slot], (value) => { stateSlots[slot] = value; }];
	},
	useRef(initial) {
		return { current: initial };
	},
	useEffect(effect) {
		const cleanup = effect();
		return typeof cleanup === 'function' ? cleanup : undefined;
	},
	useMemo(factory) {
		return factory();
	},
	useId() {
		idCounter += 1;
		return `:r${idCounter}:`;
	},
	useSyncExternalStore(_subscribe, getSnapshot) {
		return getSnapshot();
	},
};

const reactDom = {
	createPortal(node, container) {
		return { __portal: true, container, node };
	},
};

function element(type, props, key) {
	return { type, props: props ?? {}, key };
}

const jsxRuntime = {
	Fragment: react.Fragment,
	jsx: element,
	jsxs: element,
};

const icon = (name) => function StubIcon() {
	created.push(name);
	return element('svg', { 'data-icon': name });
};

const primitives = {
	// Icons the row uses, plus the only placement helper 0.2.2 still exports.
	IconClockOutlineRegular: icon('IconClockOutlineRegular'),
	IconDataOutlineRegular: icon('IconDataOutlineRegular'),
	IconGaugeOutlineRegular: icon('IconGaugeOutlineRegular'),
	useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef) {
		created.push(`dismiss:${open}:${panelRef !== undefined}`);
	},
};

const documentStub = {
	body: { tag: 'body' },
	head: { appendChild() {} },
	querySelector() {
		return null;
	},
	createElement() {
		return { dataset: {}, textContent: '' };
	},
	addEventListener() {},
	removeEventListener() {},
};
// #endregion

// The row keeps a one-minute clock for the live billing window; a real interval
// would hold the process open after the checks finish.
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};

class NodeStub {}
globalThis.Node = NodeStub;
globalThis.document = documentStub;

let registration;
globalThis.window = {
	__DSH_BOOT__: { release: { version: '0.2.2-rc.2' } },
	__ModuleLoader__: {
		load(value) {
			registration = value;
		},
	},
};

const source = readFileSync(process.argv[2] ?? 'lib/client.js', 'utf8');
runInThisContext(source, { filename: 'client.js' });

if (registration === undefined) {
	console.error('FAIL: bundle never called window.__ModuleLoader__.load');
	process.exit(1);
}
if (registration.id !== 'dsh-plugin-account-usage') {
	console.error(`FAIL: registration id is ${registration.id}`);
	process.exit(1);
}

const table = {
	react,
	'react-dom': reactDom,
	'react/jsx-runtime': jsxRuntime,
	'@deepseek-ai/dsh-client-ui-primitives': primitives,
};
const exports = registration.factory((specifier) => {
	if (!(specifier in table)) throw new Error(`module table has no '${specifier}'`);
	return table[specifier];
});

const failures = [];
const check = (label, condition) => {
	if (!condition) failures.push(label);
	console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
};

check('factory exports a row component', typeof exports.UsageStrip === 'function');
check('factory exports apply/inject', typeof exports.apply === 'function' && Array.isArray(exports.inject));

// One session with a billed fold, one subagent under it, and a balance source.
const usage = {
	models: [
		{ model: 'deepseek-chat', provider: 'deepseek-account', window: 'peak', uncachedInputTokens: 1200, cacheReadTokens: 48000, cacheWriteTokens: 0, outputTokens: 9000 },
		{ model: 'deepseek-reasoner', provider: 'deepseek-account', window: 'offPeak', uncachedInputTokens: 400, cacheReadTokens: 9000, cacheWriteTokens: 0, outputTokens: 3000 },
	],
	years: [2026],
	offDays: ['2026-10-01'],
	papers: [],
};
const childUsage = {
	models: [{ model: 'deepseek-chat', provider: 'deepseek-account', window: 'offPeak', uncachedInputTokens: 100, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 800 }],
	years: [2026],
	offDays: ['2026-10-01'],
	papers: [],
};
const projectionsBySession = {
	'root-1': { values: { usageByModel: usage, subagentCatalog: { head: { values: [{ childId: 'child-1', label: 'reviewer', mode: 'task', origin: 'subagent' }] } } } },
	'child-1': { values: { usageByModel: childUsage } },
};
const balanceSource = {
	getSnapshot: () => ({ status: 'ready', wallets: [{ currency: 'CNY', balance: '12.34' }], bonusWallets: [] }),
	subscribe: () => () => {},
	refresh: async () => {},
};
const sessions = { refreshProjections: async () => {} };
const t = (key, params) => {
	const text = key;
	if (params === undefined) return text;
	return text.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
};
const useProjection = (key) => (key === 'tokenUsage' ? undefined : { lastUsed: { model: 'deepseek-chat' } });
const useSessions = (selector) => selector({ projectionsBySession });

const kitProps = () => ({
	balance: balanceSource,
	sessions,
	sessionId: 'root-1',
	useProjection,
	useSessions,
	t,
});

const render = () => exports.UsageStrip({
	balance: balanceSource,
	sessions,
	sessionId: 'root-1',
	useProjection,
	useSessions,
	t,
});

/**
 * Evaluate function components down to host nodes, so the tree can be searched.
 *
 * The jsx runtime stubs return component elements unevaluated, exactly like a
 * real element tree; this is the render pass that a browser's React would do.
 * @param node - element, portal stub, array, or primitive.
 * @returns the same shape with components resolved.
 */
function resolve(node) {
	if (Array.isArray(node)) return node.map((item) => resolve(item));
	if (node === null || typeof node !== 'object') return node;
	if (node.__portal === true) return { ...node, node: resolve(node.node) };
	if (typeof node.type === 'function') return resolve(node.type(node.props));
	const props = { ...node.props };
	if ('children' in props) props.children = resolve(props.children);
	return { ...node, props };
}

function find(node, predicate, out = []) {
	if (node === null || typeof node !== 'object') return out;
	if (predicate(node)) out.push(node);
	const { props } = node;
	if (props !== undefined) {
		for (const value of Object.values(props)) {
			if (Array.isArray(value)) for (const item of value) find(item, predicate, out);
			else find(value, predicate, out);
		}
	}
	if (node.node !== undefined) find(node.node, predicate, out);
	return out;
}

const closed = resolve(render());
check('row renders without throwing', closed !== undefined && closed.type === 'div');
const roots = find(closed, (node) => node.props?.className === 'dshAccountUsage_root');
check('three pills render', roots.length === 3);
const anchorNames = roots.map((node) => node.props.style?.anchorName);
check('every pill carries an anchor name', anchorNames.every((name) => typeof name === 'string'));
check('anchor names are distinct', new Set(anchorNames).size === anchorNames.length);
check('anchor names are CSS dashed-idents', anchorNames.every((name) => /^--[A-Za-z0-9_-]+$/u.test(name)));
check('closed pills render no panel', find(closed, (node) => node.props?.className === 'dshAccountUsage_panel').length === 0);

// Open every pill: the panel must be a portal that names the trigger's anchor.
openAll = true;
stateSlots.length = 0;
const opened = resolve(render());
const panels = find(opened, (node) => node.props?.className === 'dshAccountUsage_panel');
check('open pills render one panel each', panels.length === 3);
const openAnchors = find(opened, (node) => node.props?.className === 'dshAccountUsage_root')
	.map((node) => node.props.style?.anchorName);
const panelAnchors = panels.map((node) => node.props.style?.positionAnchor);
check('panel names its trigger anchor', panelAnchors.every((name) => openAnchors.includes(name))
	&& new Set(panelAnchors).size === panelAnchors.length);
check('panel uses no JavaScript position', panels.every((node) => {
	const style = node.props.style ?? {};
	return ['left', 'top', 'right', 'bottom', 'transform', 'visibility'].every((key) => !(key in style));
}));
check('panel is portalled to the body', find(opened, (node) => node.__portal === true).length === 3);
check('panels show billed cost and window copy', JSON.stringify(opened).includes('dshAccountUsage_details'));

// #region activation
const registered = [];
const balanceCalls = [];
const injected = [];
const applyCtx = {
	logger: { warn() {}, info() {} },
	effect: (factory) => factory(),
	locale: {
		register: () => () => {},
		bind: () => (key) => key,
		getSnapshot: () => ({ active: 'zh-CN' }),
	},
	sessions: sessions,
	remote: {
		account: {
			async getBalance(request) {
				balanceCalls.push(request);
				return { ok: true, value: null };
			},
		},
	},
	slots: {
		inject(name, factory) {
			injected.push(name);
			return factory();
		},
		register(entry, component) {
			registered.push({ entry, component });
			return () => {};
		},
	},
};
exports.apply(applyCtx);
check('apply injects the composer dock row', injected.length === 1 && injected[0] === 'conversation.composer.dock');
check('apply registers one dock entry', registered.length === 1 && registered[0].entry.id === 'account-usage');
await new Promise((resolve) => {
	// The first balance read is started synchronously by apply and settles on the
	// microtask queue; one macrotask tick is enough to observe it.
	process.nextTick(() => globalThis.setImmediate(resolve));
});
check('balance read reports the running release version', balanceCalls.length === 1 && balanceCalls[0].version === '0.2.2-rc.2');
check('balance read names the active locale', balanceCalls[0]?.locale === 'zh-CN');
const registeredRow = registered[0]?.component({ ...kitProps() });
check('the registered row renders', resolve(registeredRow)?.type === 'div');
// #endregion

if (failures.length > 0) {
	console.error(`\n${failures.length} failed check(s)`);
	process.exit(1);
}
console.log('\nall render checks passed');
