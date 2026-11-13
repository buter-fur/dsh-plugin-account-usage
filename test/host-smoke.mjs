/**
 * Activation test for the Host half.
 *
 * Loads `lib/index.js` as the loader would and calls `apply` with a context that
 * mimics DSH 0.2.2: `sessionProjections.register` resolves asynchronously to a
 * handle (and is still callable, which upstream deprecates), `ctx.effect`
 * registers a disposer, and `ctx.get('web')` answers a fetch. The point is that
 * registration still happens, the schema guard still passes, and a refusal is
 * reported instead of escaping as an unhandled rejection.
 */
import { readFileSync } from 'node:fs';
import { CALENDAR, KEY, apply, inject, isRegistrable, usageByModelProjection, windowOf } from '../lib/index.js';

const failures = [];
const check = (label, condition) => {
	if (!condition) failures.push(label);
	console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
};

// A plugin lives outside the dsh installation, so Node resolves a bare import
// from the plugin's own directory upward: any npm specifier is MODULE_NOT_FOUND
// and takes the whole bundle down. Only `node:` builtins and relative paths.
for (const file of ['lib/index.js', 'lib/holiday-calendar.js', 'lib/client.js']) {
	const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
	const specifiers = [...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gmu)].map((match) => match[1]);
	const bare = specifiers.filter((specifier) => !specifier.startsWith('node:')
		&& !specifier.startsWith('./') && !specifier.startsWith('../'));
	check(`${file} imports only node: and relative paths`, bare.length === 0);
}

check('projection key', KEY === 'usageByModel');
check('inject declares the registry', Array.isArray(inject) && inject.includes('sessionProjections'));
check('definition is registrable under the new schema rules', isRegistrable(usageByModelProjection));
check('definition carries a state version', Number.isInteger(usageByModelProjection.stateVersion) && usageByModelProjection.stateVersion > 0);
check('definition exposes a working stateSchema.parse', typeof usageByModelProjection.stateSchema?.parse === 'function');
check('definition exposes a working wire.viewSchema.parse', typeof usageByModelProjection.wire?.viewSchema?.parse === 'function');

const view = usageByModelProjection.wire.view(usageByModelProjection.init());
check('initial view is a model list', Array.isArray(view.models));
check('initial view reports the covered years', Array.isArray(view.years) && view.years.includes(2026));
check('calendar covers 2026', Array.isArray(CALENDAR.coveredYears) && CALENDAR.coveredYears.includes(2026));
check('calendar ships 2026 off-days', CALENDAR.offDays?.size > 0 && CALENDAR.offDays.has('2026-10-01'));
check('windowOf still answers', windowOf(Date.parse('2026-11-13T02:00:00Z'), CALENDAR) === 'peak'
	&& windowOf(Date.parse('2026-11-13T05:00:00Z'), CALENDAR) === 'offPeak');

const registered = [];
const warnings = [];
const effects = [];
const ctx = {
	logger: { warn: (...args) => warnings.push(args), info: () => {}, error: (...args) => warnings.push(args) },
	effect(factory, label) {
		effects.push(label);
		return factory();
	},
	get(service) {
		if (service === 'web') return { fetch: async () => ({ statusCode: 404, body: { text: '' } }) };
		return undefined;
	},
	sessionProjections: {
		register(definition) {
			registered.push(definition);
			// 0.2.2 runtime: a callable thenable resolving to the handle.
			const handle = { stateOf: () => undefined, dispose: async () => {} };
			const thenable = () => handle;
			thenable.then = (resolve) => Promise.resolve(handle).then(resolve);
			return thenable;
		},
	},
};

apply(ctx);
check('apply registers exactly one projection', registered.length === 1 && registered[0] === usageByModelProjection);
check('apply registers its calendar-refresh effect', effects.some((label) => String(label).includes('holiday calendar refresh')));
check('apply warns on nothing when registration is accepted', warnings.length === 0);

// A registry that refuses must not throw out of apply, and must not leave an
// unhandled rejection behind: 0.2.2 reports registration failure asynchronously.
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));
const refusing = {
	logger: { warn: () => {}, info: () => {} },
	effect: (factory) => factory(),
	get: () => undefined,
	sessionProjections: {
		register() {
			const thenable = () => {};
			thenable.then = (resolve, reject) => Promise.reject(new Error('refused')).then(resolve, reject);
			return thenable;
		},
	},
};
let escaped;
try {
	apply(refusing);
} catch (error) {
	escaped = error;
}
check('a refusing registry does not throw out of apply', escaped === undefined);
await new Promise((resolve) => setTimeout(resolve, 20));
check('a refusing registry leaves no unhandled rejection', unhandled.length === 0);
process.removeAllListeners('unhandledRejection');

if (failures.length > 0) {
	console.error(`\n${failures.length} failed check(s)`);
	process.exit(1);
}
console.log('\nall activation checks passed');
