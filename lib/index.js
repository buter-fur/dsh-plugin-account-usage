/**
 * Account usage strip plugin, node half.
 *
 * The strip's cost figure has to price each request at the model that actually
 * served it, and the browser only receives session *projections* — it never
 * sees the durable log. So this half registers one more projection,
 * `usageByModel`, folded on the Host where the whole log is available: the
 * running model comes from each request's own header, and every provider usage
 * sample is charged to that model with the same replace-or-append rule the
 * shipped `tokenUsage` unit uses, so a retried or rewritten step is never
 * counted twice.
 *
 * The browser half reads the projection through the session-projection seam and
 * only splits its cost row once more than one model has billed the session.
 *
 * This half imports NOTHING, and that is a hard constraint. Node resolves an
 * import from the importing file's own directory, and this package sits outside
 * the dsh installation, so no `@deepseek-ai/*` or bare npm specifier is
 * reachable from here: one import fails the entire plugin at load, Host half
 * and browser half together. Everything needed arrives as a `ctx` service, and
 * the schemas below are built by hand because the registry calls `parse` on
 * them (see `identical` below).
 *
 * @module dsh-plugin-account-usage
 */

import { calendarVersion, covers, isOffDay, loadCalendar, refresh } from "./holiday-calendar.js";

/** The projection key this plugin owns. */
const KEY = "usageByModel";

/** The model a sample is charged to when its event carries no model. */
const UNKNOWN_MODEL = "unknown";

/** The billing window a sample falls in when its instant is unknown. */
const UNKNOWN_WINDOW = "offPeak";

/** Beijing-time offset from UTC, in milliseconds. */
const BEIJING_OFFSET_MS = 8 * 3600000;

/**
 * Peak windows as minutes from Beijing midnight: 09:00-12:00 and 14:00-18:00.
 * Weekday-only. Chinese public holidays bill off-peak all day and this plugin
 * carries no holiday calendar, so a holiday sample is charged at peak rates.
 */
const PEAK_WINDOWS = [
	[9 * 60, 12 * 60],
	[14 * 60, 18 * 60]
];

/**
 * The billing window one instant falls in.
 *
 * The platform prices a request when it runs, so attribution needs the verdict
 * on the sample's own instant rather than on the reader's. The browser applies
 * the same rule to "now" and this is the Host's copy of it, because the durable
 * `time` on the usage event lives here.
 * @param time - millisecond timestamp of the usage event.
 * @param calendar - statutory holiday calendar from `loadCalendar`.
 * @returns `"peak"` or `"offPeak"`.
 */
function windowOf(time, calendar) {
	if (typeof time !== "number" || !Number.isFinite(time)) return UNKNOWN_WINDOW;
	// Shift to Beijing wall time, then read weekday, date, and minute from UTC getters.
	const beijing = new Date(time + BEIJING_OFFSET_MS);
	const weekday = beijing.getUTCDay();
	if (weekday === 0 || weekday === 6) return "offPeak";
	const date = beijing.toISOString().slice(0, 10);
	// A statutory day off is off-peak all day, whatever the clock says.
	if (covers(calendar, date) && isOffDay(calendar, date)) return "offPeak";
	const minuteOfDay = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
	return PEAK_WINDOWS.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end) ? "peak" : "offPeak";
}

/**
 * A schema the projection registry can call.
 *
 * The registry runs `def.stateSchema.parse(row.val)` over persisted rows and
 * `def.wire.viewSchema.parse(def.wire.view(state))` for EVERY registration when
 * it builds a snapshot — so a registration whose schema lacks `parse` does not
 * merely break its own key, it breaks every session-history read in the
 * process. This plugin cannot import schemastery (see the module note), so it
 * supplies the one method the registry actually calls, and it is identity: the
 * fold already produces exactly the published shape, and a transform here would
 * have to be kept in step with the fold by hand.
 * @returns a `parse` contract that returns its input unchanged.
 */
const identical = () => Object.freeze({
	/** @param value - fold state or wire view. @returns the same value. */
	parse: (value) => value
});

/** The wire view: one line per model that billed the session, in first-use order. */
const viewSchema = identical();

/** Fold state: one cell per model, each carrying the sample its own slot replaced. */
const stateSchema = identical();

/**
 * The statutory holiday calendar this process folds with.
 *
 * Read once, synchronously, at materialization: the fold runs while the Host
 * restores a session and cannot await a refresh. `calendarVersion` below turns
 * its content into the projection's state version, so a calendar correction
 * refolds history instead of leaving amounts priced from the old dates.
 */
const CALENDAR = loadCalendar([]);

/** An empty bucket set. */
const zeroBuckets = () => ({
	uncachedInputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	outputTokens: 0
});

/** The four billing buckets of one provider usage sample. */
const bucketsOf = (usage) => ({
	uncachedInputTokens: usage.inputTokens ?? 0,
	cacheReadTokens: usage.cacheReadTokens ?? 0,
	cacheWriteTokens: usage.cacheWriteTokens ?? 0,
	outputTokens: usage.outputTokens ?? 0
});

/** Positional sum, one field at a time so an unknown field cannot leak through. */
const add = (left, right) => ({
	uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
	cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
	cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
	outputTokens: left.outputTokens + right.outputTokens
});

/** Positional difference, clamped at zero so a replay cannot produce a negative counter. */
const subtract = (left, right) => ({
	uncachedInputTokens: Math.max(0, left.uncachedInputTokens - right.uncachedInputTokens),
	cacheReadTokens: Math.max(0, left.cacheReadTokens - right.cacheReadTokens),
	cacheWriteTokens: Math.max(0, left.cacheWriteTokens - right.cacheWriteTokens),
	outputTokens: Math.max(0, left.outputTokens - right.outputTokens)
});

/** The public counters of one cell, without its fold bookkeeping. */
const publicCell = (cell) => ({
	model: cell.model,
	provider: cell.provider,
	/** `"peak"` or `"offPeak"`: the window this line's tokens were billed in. */
	window: cell.window,
	uncachedInputTokens: cell.uncachedInputTokens,
	cacheReadTokens: cell.cacheReadTokens,
	cacheWriteTokens: cell.cacheWriteTokens,
	outputTokens: cell.outputTokens,
	turns: cell.turns,
	steps: cell.steps
});

/**
 * Read the route off an event that names one.
 *
 * Both carriers put the pair in `data`: `model/selection` is the selection
 * itself (`{ provider, model, reasoningEffort? }`) and `request/header`'s
 * `data.header.config` is the same shape. A missing or non-string model keeps
 * the previous attribution rather than inventing one.
 * @param data - `model/selection` data or a request header's config.
 * @returns `{ provider, model }`, or undefined when the event names no model.
 */
function routeOf(data) {
	if (data === undefined || data === null) return undefined;
	const provider = typeof data.provider === "string" ? data.provider : "";
	const model = data.model;
	if (typeof model !== "string" || model === "") return undefined;
	return { provider, model };
}

/** Whether one cell bills the given model in the given window. */
const isCell = (cell, model, window) => cell.model === model && cell.window === window;

/**
 * Rewrite one cell while keeping its position in the view.
 * @param state - fold state to read.
 * @param model - model id whose cell changes.
 * @param window - billing window whose cell changes.
 * @param change - the full next cell value.
 * @returns the next state.
 */
function withCell(state, model, window, change) {
	return {
		...state,
		models: state.models.map((cell) => (isCell(cell, model, window) ? change : cell))
	};
}

/**
 * Charge one provider usage sample to the model and billing window it belongs
 * to.
 *
 * Mirrors the shipped `tokenUsage` unit: a sample for the turn/step its own
 * cell last accepted replaces that sample's counters, anything else adds. A
 * model switch, or a request that lands in the other billing window, therefore
 * starts a new cell without disturbing the previous one, and a retried step
 * inside one cell is still counted once.
 *
 * The window is the sample's own, decided from its `time`: a session that
 * crossed 09:00 Beijing keeps its earlier tokens at off-peak rates.
 * @param state - fold state before the sample.
 * @param provider - provider the sample is attributed to.
 * @param model - model the sample is attributed to.
 * @param turn - step's turn number.
 * @param step - step number inside the turn.
 * @param time - the usage event's timestamp, which picks the billing window.
 * @param buckets - the sample's four counters.
 * @param calendar - statutory holiday calendar from `loadCalendar`.
 * @returns the next state.
 */
function addSample(state, provider, model, turn, step, time, buckets, calendar) {
	const window = windowOf(time, calendar);
	const existing = state.models.find((cell) => isCell(cell, model, window));
	if (existing === undefined) {
		return {
			...state,
			models: [...state.models, {
				model,
				provider,
				window,
				...buckets,
				turns: 1,
				steps: 1,
				lastTurn: turn,
				lastStep: step,
				slot: buckets
			}]
		};
	}
	const replaces = existing.lastTurn === turn && existing.lastStep === step;
	return withCell(state, model, window, {
		...existing,
		provider,
		...add(subtract(existing, replaces ? existing.slot : zeroBuckets()), buckets),
		turns: existing.turns + (replaces ? 0 : 1),
		steps: existing.steps + (replaces ? 0 : 1),
		lastTurn: turn,
		lastStep: step,
		slot: buckets
	});
}

/**
 * The calendar slice a session's wire view publishes.
 *
 * Every session publishes the calendar its own amounts were priced with, so a
 * reader that rolls several sessions together — a task and its subagents, say —
 * can see where their calendars disagree instead of assuming one applies to
 * all. Only recent years travel: an older notice cannot affect a live verdict.
 * @param calendar - calendar from `loadCalendar`.
 * @returns the published `years`, `offDays`, and `papers` fields.
 */
function publishedCalendar(calendar) {
	const from = new Date(Date.now() + BEIJING_OFFSET_MS).getUTCFullYear() - 1;
	return {
		years: calendar.coveredYears.filter((year) => year >= from),
		offDays: [...calendar.offDays].filter((date) => Number(date.slice(0, 4)) >= from).sort(),
		papers: calendar.papers
	};
}

/**
 * The `usageByModel` session projection: billed tokens per model, in first-use
 * order, plus the plan the session's latest request was routed under.
 *
 * Attribution has two axes and neither is carried by the sample itself: the
 * settled `assistant/message.data` holds only `turn`, `step`, `message`,
 * `usage`, `stream`, and the envelope holds `time`.
 *
 *   • model — positional: the model of the latest `model/selection` or
 *     `request/header` seen before the sample. Both carry the route in `data`
 *     (the selection directly, the request under `data.header.config`).
 *   • window — the sample's own `time`: peak and off-peak bill at different
 *     rates, so a session that crossed a boundary must keep each request at the
 *     rate it actually ran under instead of re-pricing history at the rate in
 *     effect when someone opens the panel.
 */
const usageByModelProjection = {
	key: KEY,
	// The registry refolds the whole log for this key whenever a stored row's
	// version does not match, so the version names both the schema epoch and the
	// calendar the amounts were priced with:
	//   · epoch 3 — cells keyed by model AND billing window (epoch 2 carried no
	//     window, epoch 1 no route at all);
	//   · calendar — a published or corrected holiday list changes it, which is
	//     what re-prices history that had been folded under the weekday rule.
	stateVersion: 3 + Number.parseInt(calendarVersion(CALENDAR), 36) % 1000000,
	stateSchema,
	init: () => ({ plan: "", provider: "", model: UNKNOWN_MODEL, models: [] }),
	apply: (state, event) => {
		if (event.type === "model/selection") {
			const next = routeOf(event.data);
			return next === undefined ? state : { ...state, ...next };
		}
		if (event.type === "request/header") {
			const config = event.data.header?.config ?? {};
			const next = routeOf(config);
			return {
				...state,
				...(next === undefined ? {} : next),
				plan: typeof config.modelPlan === "string" ? config.modelPlan : state.plan
			};
		}
		if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return state;
		const usage = event.data.usage;
		if (usage === undefined) return state;
		return addSample(state, state.provider, state.model, event.data.turn, event.data.step, event.time, bucketsOf(usage), CALENDAR);
	},
	wire: {
		viewSchema,
		view: (state) => ({
			plan: state.plan,
			models: state.models.map(publicCell),
			...publishedCalendar(CALENDAR)
		})
	}
};

/** Cordis plugin name. */
const name = "account-usage";

/** The projection registry is the whole reason this half exists. */
const inject = ["sessionProjections"];

/**
 * Whether this registration is safe to hand the registry.
 *
 * The registry parses every registration's schemas while it builds a session
 * snapshot, so a definition it cannot parse fails the whole session history
 * rather than one key. This refuses to register anything it cannot prove
 * parseable, and a false answer leaves the plugin inert instead of breaking
 * reads — the browser half already falls back when the key is absent.
 * @param definition - the definition about to be registered.
 * @returns true when both schemas answer `parse` on their own values.
 */
function isRegistrable(definition) {
	try {
		const state = definition.init();
		const view = definition.wire.view(state);
		return definition.stateSchema.parse(state) !== undefined
			&& definition.wire.viewSchema.parse(view) !== undefined;
	} catch (_error) {
		return false;
	}
}

/**
 * Register the per-model usage unit. Registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
function apply(ctx) {
	if (!isRegistrable(usageByModelProjection)) {
		ctx.logger?.warn("account-usage: usageByModel projection refused registration; the cost row keeps its single-model estimate");
		return;
	}
	ctx.sessionProjections.register(usageByModelProjection);
	// Keep the calendar current without a code change or a rebuild. This never
	// blocks the fold: a year fetched now is used from the next start, because the
	// fold already read the cache at materialization.
	ctx.effect(() => {
		let cancelled = false;
		void (async () => {
			const thisYear = new Date(Date.now() + BEIJING_OFFSET_MS).getUTCFullYear();
			const written = await refresh(ctx, [thisYear, thisYear + 1]);
			if (cancelled || written.length === 0) return;
			ctx.logger?.info("account-usage: cached holiday calendar for %o; it applies from the next start", written);
		})().catch((error) => {
			ctx.logger?.info("account-usage: holiday calendar refresh failed (%s)", String(error));
		});
		return () => {
			cancelled = true;
		};
	}, "account-usage: holiday calendar refresh");
}

export { CALENDAR, KEY, apply, inject, isRegistrable, name, usageByModelProjection, windowOf };
