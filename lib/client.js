/**
 * Account usage strip — browser half.
 *
 * One `conversation.composer.dock` row that joins the existing session
 * statistics pills with three read-only figures:
 *
 *   • balance — the signed-in account's wallet, read once on mount and then
 *     polled while the page is visible (a turn is the only thing that spends
 *     money, so a one-minute poll is enough and clicked refresh is instant);
 *   • cost — what this session's billed tokens cost at the published price of
 *     the model the session is using, in the billing window in effect right
 *     now. Every figure is recomputed from the durable `tokenUsage` projection,
 *     so it never double counts a retried or replaced step;
 *   • window — whether the platform is currently billing peak or off-peak,
 *     with the countdown to the next switch. Peak is Beijing time Monday to
 *     Friday 09:00–12:00 and 14:00–18:00; every other instant (including
 *     weekends and Chinese public holidays) is off-peak at half price.
 *
 * No service, no mutation, no session event: the row reads projections and one
 * Remote method, so it is inert when the account is signed out and costs
 * nothing while unmounted.
 *
 * @module dsh-plugin-account-usage/client
 */

window.__ModuleLoader__.load({
	// A bare (unscoped) package name is the resolved package's own name.
	id: "dsh-plugin-account-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region copy
		/** Dictionary namespace owned by this plugin. */
		const NS = "account-usage";
		/** Chinese copy — the key set the English dictionary is checked against. */
		const zh = {
			"pill.balance.loading": "余额读取中…",
			"pill.balance.signedOut": "未登录",
			"pill.balance.failed": "余额不可用",
			"pill.balance.title": "账户余额",
			"pill.balance.wallet": "充值余额",
			"pill.balance.bonus": "赠送余额",
			"pill.cost.label": "本任务 {amount}",
			"pill.cost.pending": "本任务计费中",
			"pill.cost.title": "本任务花费（估算）",
			"pill.cost.model": "计费模型",
			"pill.cost.cacheHit": "缓存命中输入",
			"pill.cost.cacheMiss": "缓存未命中输入",
			"pill.cost.output": "输出",
			"pill.cost.total": "合计",
			"pill.cost.tokens": "{count} tok",
			"pill.cost.note": "按当前时段单价估算；时段切换后历史用量仍按切换后的单价重算。",
			"pill.cost.splitNote": "按各模型实际服务的用量的价目估算；时段切换后历史用量仍按切换后的单价重算。",
			"pill.cost.modelSummary": "{count} 个模型",
			"pill.cost.ownSession": "本会话花费",
			"pill.cost.subagents": "子代理花费（{count} 个）",
			"pill.cost.ownBuckets": "本会话明细：命中 {hit} · 未命中 {miss} · 输出 {output}",
			"pill.cost.treeNote": "含全部子代理；子代理各自按它运行的模型与时段计价。",
			"pill.cost.windowSummary": "跨高峰与空闲两个时段",
			"pill.cost.oneWindow": "单一计费时段",
			"pill.window.peak": "高峰时段",
			"pill.window.offPeak": "空闲时段",
			"pill.window.title": "用量波峰波谷",
			"pill.window.rates": "命中 {hit} · 未命中 {miss} · 输出 {output}",
			"pill.window.next": "距下次切换",
			"pill.window.schedule": "高峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00；其余时段（含周末与法定节假日）为空闲时段，单价为高峰的一半。",
			"pill.window.holidayKnown": "法定节假日全天按空闲时段计费，节假日日历已内置。",
			"pill.window.holidayKnownYears": "法定节假日全天按空闲时段计费；节假日日历已覆盖 {years} 年。",
			"pill.window.holidayUnknown": "法定节假日全天按空闲时段计费；该年放假安排国务院尚未公布，暂按工作日规则估算。",
			"number.hour": "{hours} 小时",
			"number.minute": "{minutes} 分"
		};
		/** English copy, checked against the Chinese key set. */
		const en = {
			"pill.balance.loading": "Reading balance…",
			"pill.balance.signedOut": "Signed out",
			"pill.balance.failed": "Balance unavailable",
			"pill.balance.title": "Account balance",
			"pill.balance.wallet": "Topped-up",
			"pill.balance.bonus": "Granted",
			"pill.cost.label": "Task {amount}",
			"pill.cost.pending": "Metering task",
			"pill.cost.title": "Task cost (estimate)",
			"pill.cost.model": "Billing model",
			"pill.cost.cacheHit": "Cache-hit input",
			"pill.cost.cacheMiss": "Cache-miss input",
			"pill.cost.output": "Output",
			"pill.cost.total": "Total",
			"pill.cost.tokens": "{count} tok",
			"pill.cost.note": "Estimated at the price of the window in effect now; usage is re-priced when the window changes.",
			"pill.cost.splitNote": "Each model priced from the usage it actually served; usage is re-priced when the window changes.",
			"pill.cost.modelSummary": "{count} models",
			"pill.cost.ownSession": "This session",
			"pill.cost.subagents": "Subagents ({count})",
			"pill.cost.ownBuckets": "This session: hit {hit} · miss {miss} · out {output}",
			"pill.cost.treeNote": "Includes every subagent, each priced at the model and window it ran under.",
			"pill.cost.windowSummary": "Both windows billed",
			"pill.cost.oneWindow": "Single billing window",
			"pill.window.peak": "Peak",
			"pill.window.offPeak": "Off-peak",
			"pill.window.title": "Billing window",
			"pill.window.rates": "hit {hit} · miss {miss} · out {output}",
			"pill.window.next": "Next switch",
			"pill.window.schedule": "Peak is Beijing time Monday–Friday 09:00–12:00 and 14:00–18:00. Every other instant, including weekends and Chinese public holidays, is off-peak at half price.",
			"pill.window.holidayKnown": "Chinese public holidays bill off-peak all day; the holiday calendar is built in.",
			"pill.window.holidayKnownYears": "Chinese public holidays bill off-peak all day; the holiday calendar covers {years}.",
			"pill.window.holidayUnknown": "Chinese public holidays bill off-peak all day; the State Council has not published this year's days off, so the weekday rule applies.",
			"number.hour": "{hours}h",
			"number.minute": "{minutes}m"
		};
		//#endregion

		//#region pricing
		/**
		 * Published prices per one million tokens, in CNY, by model id.
		 *
		 * `peak` and `offPeak` carry the same three buckets: `cacheHit` is a
		 * prompt token read from the provider cache, `cacheMiss` a prompt token
		 * that had to be processed (which is also what a cache write costs), and
		 * `output` a completion token. The platform halves every figure outside
		 * the peak windows, which is why the table lists both columns rather
		 * than deriving one from the other.
		 */
		const PRICES = {
			"deepseek-flash": {
				peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
				offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
			},
			"deepseek-v4-pro": {
				peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
				offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
			}
		};
		/** Billing model assumed while the session reports no selection yet. */
		const DEFAULT_MODEL = "deepseek-flash";
		/** Peak windows as minutes from midnight in Beijing time: 09:00–12:00, 14:00–18:00. */
		const PEAK_WINDOWS = [
			[9 * 60, 12 * 60],
			[14 * 60, 18 * 60]
		];
		/** Milliseconds in one Beijing-time day, used to wrap the search for the next switch. */
		const DAY_MS = 86400000;
		/** Milliseconds the strip re-reads the cheapest clock figure at. */
		const TICK_MS = 30000;
		/** Milliseconds between balance polls while the document is visible. */
		const BALANCE_POLL_MS = 60000;
		/** Client build version reported to the account Remote, matching the running runtime. */
		const CLIENT_VERSION = "0.2.0-rc.2";

		/**
		 * Resolve the Beijing-time weekday and minute-of-day of an instant.
		 * @param date - instant to read.
		 * @returns weekday (0 = Sunday) and minutes from Beijing midnight.
		 */
		function beijingClock(date) {
			const shifted = new Date(date.getTime() + 8 * 3600000);
			return {
				weekday: shifted.getUTCDay(),
				minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
			};
		}

		/**
		 * Beijing-time calendar date of an instant, as the fold writes it.
		 * @param date - instant to read.
		 * @returns `YYYY-MM-DD`.
		 */
		function beijingDate(date) {
			return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
		}

		/**
		 * Whether an instant bills at peak rates.
		 *
		 * The holiday list comes from the `usageByModel` wire view — the same list
		 * the Host priced the amounts with — so the live pill cannot disagree with
		 * the rows about a statutory day off.
		 * @param date - instant to test.
		 * @param calendar - wire view's `offDays`/`years`, or undefined when absent.
		 * @returns true inside a weekday peak window.
		 */
		function isPeak(date, calendar) {
			const { weekday, minuteOfDay } = beijingClock(date);
			if (weekday === 0 || weekday === 6) return false;
			const offDays = calendar?.offDays;
			if (Array.isArray(offDays) && offDays.includes(beijingDate(date))) return false;
			return PEAK_WINDOWS.some(([start, end]) => minuteOfDay >= start && minuteOfDay < end);
		}

		/**
		 * Whether the calendar covers the year of an instant.
		 * @param date - instant to test.
		 * @param calendar - wire view's `offDays`/`years`, or undefined when absent.
		 * @returns true when a day-off verdict for that year is known.
		 */
		function calendarCovers(date, calendar) {
			const years = calendar?.years;
			return Array.isArray(years) && years.includes(Number(beijingDate(date).slice(0, 4)));
		}

		/**
		 * Find the next instant whose peak/off-peak verdict differs from now.
		 * @param date - instant to search from.
		 * @returns the next switch instant.
		 */
		function nextSwitch(date, calendar) {
			const current = isPeak(date, calendar);
			let candidate = date.getTime();
			for (let step = 0; step <= 15 * 24 * 60; step += 1) {
				candidate += 60000 - (candidate % 60000);
				if (isPeak(new Date(candidate), calendar) !== current) return new Date(candidate);
			}
			/* v8 ignore next -- unreachable: a weekend is always within a week */
			return new Date(date.getTime() + DAY_MS);
		}

		/**
		 * Read the price table row a model bills at, falling back to the default
		 * model so an unknown id still yields a figure instead of a blank pill.
		 * @param model - session model id, possibly undefined.
		 * @returns the resolved price row.
		 */
		function priceRow(model) {
			return PRICES[model] ?? PRICES[DEFAULT_MODEL];
		}

		/**
		 * Cost of one billing bucket.
		 * @param tokens - billed token count.
		 * @param rate - price per one million tokens.
		 * @returns cost in the table's currency.
		 */
		function bucketCost(tokens, rate) {
			return ((tokens ?? 0) / 1e6) * rate;
		}

		/**
		 * Price a usage snapshot's three disjoint billing buckets.
		 * @param usage - durable `tokenUsage` projection value.
		 * @param model - session model id.
		 * @param peak - whether peak rates apply.
		 * @returns per-bucket and total cost, with the rates that produced them.
		 */
		function priceUsage(usage, model, peak) {
			const row = priceRow(model);
			const rates = peak ? row.peak : row.offPeak;
			const cacheHitTokens = usage?.cacheReadTokens ?? 0;
			// A cache write is billed as a cache miss: the prompt was processed, then stored.
			const cacheMissTokens = (usage?.uncachedInputTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
			const outputTokens = usage?.outputTokens ?? 0;
			const parts = {
				cacheHit: { tokens: cacheHitTokens, rate: rates.cacheHit, cost: bucketCost(cacheHitTokens, rates.cacheHit) },
				cacheMiss: { tokens: cacheMissTokens, rate: rates.cacheMiss, cost: bucketCost(cacheMissTokens, rates.cacheMiss) },
				output: { tokens: outputTokens, rate: rates.output, cost: bucketCost(outputTokens, rates.output) }
			};
			return {
				parts,
				rates,
				model,
				peak,
				total: parts.cacheHit.cost + parts.cacheMiss.cost + parts.output.cost,
				tokens: cacheHitTokens + cacheMissTokens + outputTokens
			};
		}

		/** Tokens of one fold record that bill at the cache-hit rate. */
		const recordReadTokens = (record) => record.cacheReadTokens ?? 0;

		/** Tokens of one fold record that bill at the cache-miss rate. */
		const recordMissTokens = (record) => (record.uncachedInputTokens ?? 0) + (record.cacheWriteTokens ?? 0);

		/** Tokens of one fold record that bill at the output rate. */
		const recordOutputTokens = (record) => record.outputTokens ?? 0;

		/** Billed tokens of one fold record. */
		const recordTokens = (record) => recordReadTokens(record) + recordMissTokens(record) + recordOutputTokens(record);

		/** Whether a fold line was billed at peak rates. */
		const isPeakRecord = (record) => record.window === "peak";

		/**
		 * Price one fold line at the rate its own window carried.
		 *
		 * The fold decides the window per sample, so this never consults the
		 * clock: re-pricing history at the rate in effect now is the error this
		 * exists to avoid.
		 * @param record - one `usageByModel` line, carrying `model` and `window`.
		 * @returns tokens and cost for that line.
		 */
		function priceRecord(record) {
			const peak = isPeakRecord(record);
			const rates = priceRow(record.model)[peak ? "peak" : "offPeak"];
			const cost = bucketCost(recordReadTokens(record), rates.cacheHit)
				+ bucketCost(recordMissTokens(record), rates.cacheMiss)
				+ bucketCost(recordOutputTokens(record), rates.output);
			return { record, rates, peak, tokens: recordTokens(record), cost };
		}

		/**
		 * Price every line the session billed.
		 * @param records - `usageByModel` lines, in first-use order.
		 * @returns per-line costs, their total, and whether to split the panel.
		 */
		function priceRecords(records) {
			const priced = records.map((record) => priceRecord(record));
			const billed = priced.filter((entry) => entry.tokens > 0);
			const models = new Set(billed.map((entry) => entry.record.model));
			const windows = new Set(billed.map((entry) => (entry.peak ? "peak" : "offPeak")));
			return {
				priced,
				// One model in one window needs no split; anything else does, because
				// a single blended figure would hide which rate applied to what.
				split: billed.length > 1 && (models.size > 1 || windows.size > 1),
				total: billed.reduce((sum, entry) => sum + entry.cost, 0),
				tokens: billed.reduce((sum, entry) => sum + entry.tokens, 0),
				models: models.size,
				windows: windows.size
			};
		}

		/**
		 * Format a cost the way Platform Web formats wallet amounts: two decimals
		 * for anything from a cent up, and `<0.01` below that.
		 * @param value - cost in yuan.
		 * @returns display text without a currency symbol.
		 */
		function formatCost(value) {
			if (!(value > 0)) return "0.00";
			if (value < 0.01) return "<0.01";
			return value.toFixed(2);
		}

		/**
		 * Format a yuan amount with the currency mark.
		 * @param value - amount in yuan.
		 * @returns display text.
		 */
		function formatYuan(value) {
			return `¥${formatCost(value)}`;
		}

		/**
		 * Currency mark for a wallet, matching the Platform Web convention.
		 * @param currency - wallet currency code.
		 * @returns the mark.
		 */
		function currencyMark(currency) {
			return currency === "USD" ? "$" : "¥";
		}

		/**
		 * Format one wallet for a details row.
		 * @param wallet - wallet record from the account Remote.
		 * @returns display text.
		 */
		function formatWallet(wallet) {
			return `${currencyMark(wallet.currency)}${formatCost(Number(wallet.balance ?? 0))}`;
		}

		/**
		 * Format a token count with digit grouping, matching the session stats
		 * dialog's own figures.
		 * @param value - token count.
		 * @param t - namespaced translator.
		 * @returns display text.
		 */
		function formatExactTokens(value, t) {
			return t("pill.cost.tokens", { count: Number(value ?? 0).toLocaleString("en-US") });
		}

		/**
		 * Format one published per-million rate without trailing zeros.
		 * @param value - rate in yuan per million tokens.
		 * @returns display text.
		 */
		function formatRate(value) {
			return `¥${Number(value).toString()}`;
		}

		/**
		 * Format a countdown as coarse Beijing-time-friendly text.
		 * @param ms - milliseconds remaining.
		 * @param t - namespaced translator.
		 * @returns display text.
		 */
		function formatCountdown(ms, t) {
			const minutes = Math.max(1, Math.round(ms / 60000));
			if (minutes < 60) return t("number.minute", { minutes });
			const hours = Math.floor(minutes / 60);
			const rest = minutes % 60;
			// Keep both units: a switch 8h42m away reading as "8 小时" loses the thing
			// the reader opened the panel for.
			return rest === 0 ? t("number.hour", { hours }) : `${t("number.hour", { hours })} ${t("number.minute", { minutes: rest })}`;
		}
		//#endregion

		//#region account balance
		/**
		 * Observable wrapper over the account Remote's wallet read.
		 *
		 * The transport is pull-only for this figure, so the source owns its own
		 * schedule: one read at construction, one after each visible-tab interval,
		 * and one whenever a pill asks. A read that fails leaves the last good
		 * amount in place and only marks the snapshot stale, so an account whose
		 * network blipped keeps showing the balance it had.
		 */
		function createBalanceSource(ctx) {
			let snapshot = { status: "loading" };
			const listeners = new Set();
			let disposed = false;
			let running;
			let timer;

			const publish = (value) => {
				snapshot = value;
				for (const listener of listeners) {
					try {
						listener();
					} catch (error) {
						ctx.logger?.warn(error);
					}
				}
			};

			const read = async () => {
				if (disposed) return;
				if (running !== undefined) return running;
				const request = (async () => {
					let result;
					try {
						result = await ctx.remote.account.getBalance({
							version: CLIENT_VERSION,
							locale: ctx.locale.getSnapshot().active,
							timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
						});
					} catch (_error) {
						result = { ok: false };
					}
					if (disposed) return;
					if (result?.ok === true) {
						const value = result.value;
						if (value === null) publish({ status: "signedOut" });
						else if (value.status === "ready") publish({ status: "ready", wallets: value.value, bonusWallets: value.bonusWallets ?? [] });
						else publish({ status: "failed" });
					} else publish({ status: "failed" });
				})();
				running = request;
				request.finally(() => {
					if (running === request) running = undefined;
				});
				return request;
			};

			const schedule = () => {
				if (disposed) return;
				timer = setTimeout(async () => {
					timer = undefined;
					try {
						if (document.visibilityState === "visible") await read();
					} finally {
						schedule();
					}
				}, BALANCE_POLL_MS);
				// A pending poll must not keep the renderer alive on its own.
				timer.unref?.();
			};

			void read();
			schedule();

			ctx.effect(() => () => {
				disposed = true;
				if (timer !== undefined) clearTimeout(timer);
			}, "account-usage: balance poll");

			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				refresh: read
			};
		}
		//#endregion

		//#region presentation
		/**
		 * This plugin's own stylesheet, injected once at materialization.
		 *
		 * The panel copies the shell's statistics dialog (`ui-chat`'s
		 * `stat-dialog.module.css` and `TurnUsagePanel.module.css`) class for
		 * class: the same opaque `--dsw-specific-menu` fill over the same
		 * backdrop blur, the same radius, elevation shadow, 12/18px type, and the
		 * same label/value detail grid. Only the class prefix differs, so the two
		 * surfaces cannot style each other.
		 */
		const CSS = [
			".dshAccountUsage_row{box-sizing:border-box;min-width:0;max-width:100%;justify-content:center;align-items:center;gap:12px;display:flex;",
			"font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}",
			".dshAccountUsage_root{min-width:0;display:inline-flex}",
			".dshAccountUsage_trigger{min-width:0;height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);",
			"color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;",
			"line-height:calc(24px + var(--dsh-content-font-delta,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;",
			"align-items:center;gap:4px;padding:6px 8px;display:inline-flex}",
			".dshAccountUsage_trigger svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));flex:none}",
			".dshAccountUsage_trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}",
			".dshAccountUsage_label{min-width:0;text-overflow:ellipsis;overflow:hidden}",
			".dshAccountUsage_panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);",
			"width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);",
			"--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);",
			"cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;position:fixed}",
			".dshAccountUsage_unplaced{visibility:hidden;left:0;top:0}",
			".dshAccountUsage_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}",
			".dshAccountUsage_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}",
			".dshAccountUsage_titleLabel svg{flex:none;width:14px;height:14px}",
			".dshAccountUsage_titleValue{font-variant-numeric:tabular-nums}",
			".dshAccountUsage_rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}",
			".dshAccountUsage_details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}",
			".dshAccountUsage_details dt,.dshAccountUsage_details dd{min-width:0;margin:0}",
			".dshAccountUsage_details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}",
			".dshAccountUsage_note{color:var(--dsw-alias-label-tertiary);margin-top:10px;grid-column:1 / -1}",
			".dshAccountUsage_strong{color:var(--dsw-alias-label-primary);font-weight:500}",
			"@media (width<=480px){.dshAccountUsage_trigger{width:calc(28px + var(--dsh-content-font-delta,0px));justify-content:center;padding:6px}",
			".dshAccountUsage_label{display:none}}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-plugin-account-usage/client.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-account-usage";
			tag.dataset.pluginCss = "dsh-plugin-account-usage/client.css";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		/** Distance between the trigger's top edge and the panel's bottom, as the shell dialogs use. */
		const PANEL_GAP = 8;
		/** Viewport margin the placement clamp keeps, as the shell dialogs use. */
		const PANEL_MARGIN = 12;
		//#endregion

		//#region pills
		/**
		 * Render one dock pill with an optional details panel above it.
		 *
		 * Placement and dismissal are the shipped primitives the statistics
		 * dialogs already use, so the panel appears in the same place with the
		 * same clamp and closes on the same gestures.
		 * @param props - icon, label, title, and panel content.
		 * @returns the pill trigger and, while open, its portal panel.
		 */
		function Pill({ icon, label, title, panel }) {
			const rootRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const [open, setOpen] = react.useState(false);
			const position = primitives.useAnchoredPosition({
				open,
				anchorRef: rootRef,
				panelRef,
				side: "top",
				gap: PANEL_GAP,
				margin: PANEL_MARGIN
			});
			primitives.useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
			react.useEffect(() => {
				if (!open) return undefined;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [open]);
			const disabled = panel === undefined;
			return react_jsx_runtime.jsxs("span", {
				ref: disabled ? undefined : rootRef,
				className: "dshAccountUsage_root",
				children: [
					react_jsx_runtime.jsxs("button", {
						type: "button",
						className: "dshAccountUsage_trigger",
						title,
						"aria-haspopup": disabled ? undefined : "dialog",
						"aria-expanded": disabled ? undefined : open,
						onClick: disabled ? undefined : () => setOpen(!open),
						children: [
							react_jsx_runtime.jsx(icon, {}),
							react_jsx_runtime.jsx("span", { className: "dshAccountUsage_label", children: label })
						]
					}),
					open && react_dom.createPortal(
						react_jsx_runtime.jsx("div", {
							ref: panelRef,
							role: "dialog",
							className: "dshAccountUsage_panel",
							style: position ?? { visibility: "hidden", left: 0, top: 0 },
							children: panel
						}),
						document.body
					)
				]
			});
		}

		/**
		 * Panel heading: icon, title, and an optional hero figure on the right.
		 * @param props - icon, title copy, and the figure the panel is about.
		 * @returns the heading block and its separator.
		 */
		function PanelHeader({ icon, title, value }) {
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "dshAccountUsage_title",
						children: [
							react_jsx_runtime.jsxs("span", {
								className: "dshAccountUsage_titleLabel",
								children: [react_jsx_runtime.jsx(icon, {}), title]
							}),
							value !== undefined && react_jsx_runtime.jsx("span", { className: "dshAccountUsage_titleValue", children: value })
						]
					}),
					react_jsx_runtime.jsx("div", { className: "dshAccountUsage_rule" })
				]
			});
		}

		/**
		 * Detail list holding one row per figure, in the shell dialog's grid.
		 * @param props - the rows to render, as `dt`/`dd` pairs.
		 * @returns the description list.
		 */
		function DetailList({ children }) {
			return react_jsx_runtime.jsx("dl", { className: "dshAccountUsage_details", children });
		}

		/**
		 * One `dt`/`dd` pair inside a detail list.
		 * @param props - row copy and an optional emphasis flag.
		 * @returns the pair.
		 */
		function DetailRow({ label, value, strong }) {
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsx("dt", { children: label }),
					react_jsx_runtime.jsx("dd", { className: strong ? "dshAccountUsage_strong" : undefined, children: value })
				]
			});
		}

		/**
		 * Account balance pill: the wallet total, plus the panel listing every
		 * wallet the account holds.
		 * @param props - balance source and translator.
		 * @returns the pill.
		 */
		function BalancePill({ source, t }) {
			const snapshot = react.useSyncExternalStore(source.subscribe, source.getSnapshot);
			const wallets = snapshot.status === "ready" ? snapshot.wallets ?? [] : [];
			const total = wallets.reduce((sum, wallet) => sum + Number(wallet.balance ?? 0), 0);
			const currency = wallets[0]?.currency === "USD" ? "$" : "¥";
			const label = snapshot.status === "ready"
				? `${currency}${formatCost(total)}`
				: snapshot.status === "signedOut"
					? t("pill.balance.signedOut")
					: snapshot.status === "failed"
						? t("pill.balance.failed")
						: t("pill.balance.loading");
			const bonus = (snapshot.status === "ready" ? snapshot.bonusWallets ?? [] : []).filter((wallet) => Number(wallet.balance ?? 0) > 0);
			const panel = react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsx(PanelHeader, {
						icon: primitives.IconDataOutlineRegular,
						title: t("pill.balance.title"),
						value: snapshot.status === "ready" ? `${currency}${formatCost(total)}` : label
					}),
					react_jsx_runtime.jsxs(DetailList, {
						children: [
							...wallets.map((wallet) => react_jsx_runtime.jsx(DetailRow, {
								label: t("pill.balance.wallet"),
								value: formatWallet(wallet)
							}, `wallet-${wallet.currency}`)),
							...bonus.map((wallet) => react_jsx_runtime.jsx(DetailRow, {
								label: t("pill.balance.bonus"),
								value: formatWallet(wallet)
							}, `bonus-${wallet.currency}`)),
							wallets.length === 0 && react_jsx_runtime.jsx(DetailRow, { label: t("pill.balance.title"), value: label })
						]
					})
				]
			});
			return react_jsx_runtime.jsx(Pill, {
				icon: primitives.IconDataOutlineRegular,
				label,
				title: t("pill.balance.title"),
				panel
			});
		}

		/**
		 * Tokens of one model line as a short `31.2M tok`-style figure.
		 * @param tokens - billed token count.
		 * @param t - namespaced translator.
		 * @returns display text.
		 */
		function formatTokens(tokens, t) {
			if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M tok`;
			if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}K tok`;
			return t("pill.cost.tokens", { count: tokens });
		}

		/**
		 * Task cost pill: this session's billed tokens priced at the model that
		 * served them.
		 *
		 * One model keeps the original three-bucket breakdown. As soon as a
		 * second model has billed the session — the user switched mid-session —
		 * the panel prices each model separately, because charging the earlier
		 * requests to the model in use now is exactly the error worth avoiding.
		 * @param props - usage projections, session model, translator.
		 * @returns the pill.
		 */
		/**
		 * Task cost pill: this session's billed tokens together with every
		 * subagent's, priced at the model and billing window each line actually ran
		 * under.
		 *
		 * A subagent writes its own session, so its tokens never appear in the
		 * parent's log; they arrive from each child's own fold. One model in one
		 * window keeps the original three-bucket breakdown; anything else — a model
		 * switch, a window crossing, or a subagent — is itemised, because a single
		 * blended figure would hide which rate applied to what.
		 * @param props - usage projection, rolled-up fold, session model, translator.
		 * @returns the pill.
		 */
		function CostPill({ usage, rolled, model, t }) {
			const [now, setNow] = react.useState(() => new Date());
			react.useEffect(() => {
				const timer = setInterval(() => setNow(new Date()), TICK_MS);
				return () => clearInterval(timer);
			}, []);
			const treeLines = Array.isArray(rolled?.tree) ? rolled.tree : [];
			const ownLines = Array.isArray(rolled?.own) ? rolled.own : [];
			const tree = priceRecords(treeLines);
			const own = priceRecords(ownLines);
			const descendants = Array.isArray(rolled?.descendants) ? rolled.descendants : [];
			const subagents = descendants.length;
			// The fold is served per session; the plain projection is the fallback
			// while it is absent (an older Host, or a session not open yet), and it
			// has only the current window to go on: `tokenUsage` carries neither a
			// per-request time nor any subagent usage.
			const fallback = tree.tokens === 0 && usage !== undefined ? priceUsage(usage, model, isPeak(now)) : undefined;
			const treeTotal = tree.tokens > 0 ? tree.total : fallback?.total;
			if (treeTotal === undefined || treeTotal === 0) return null;
			const subagentTotal = Math.max(0, tree.total - own.total);
			const amount = formatYuan(treeTotal);
			const splitOwn = own.split;
			const splitTree = tree.split;
			const subagentRows = priceSubagents(rolled?.projectionsBySession, rolled?.rootSessionId, descendants, t);
			const panel = react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsx(PanelHeader, {
						icon: primitives.IconGaugeOutlineRegular,
						title: t("pill.cost.title"),
						value: amount
					}),
					react_jsx_runtime.jsxs(DetailList, {
						children: [
							// This session's own figure: three buckets when that is all there
							// is, otherwise one line per model and window.
							react_jsx_runtime.jsx(DetailRow, {
								label: t("pill.cost.ownSession"),
								value: own.tokens > 0 ? formatYuan(own.total) : "—",
								strong: true
							}),
							splitOwn
								? own.priced
									.filter((entry) => entry.tokens > 0)
									.map((entry) => react_jsx_runtime.jsx(DetailRow, {
										label: `${entry.record.model} · ${formatTokens(entry.tokens, t)} · ${t(entry.peak ? "pill.window.peak" : "pill.window.offPeak")}`,
										value: formatYuan(entry.cost)
									}, `own-${entry.record.model}-${entry.record.window ?? "unknown"}`))
								: react_jsx_runtime.jsx(DetailRow, {
									label: t("pill.cost.model"),
									value: `${modelNameOf(model, fallback, treeLines)} · ${t((fallback?.peak ?? own.priced[0]?.peak) ? "pill.window.peak" : "pill.window.offPeak")}`
								}),
							// The subagents: one line each when their own folds are known, and
							// otherwise their single summed figure.
							subagents > 0 && react_jsx_runtime.jsx(DetailRow, {
								label: t("pill.cost.subagents", { count: subagents }),
								value: formatYuan(subagentTotal),
								strong: true
							}),
							...subagentRows.map((entry) => react_jsx_runtime.jsx(DetailRow, {
								label: `↳ ${entry.label ?? entry.id.slice(0, 8)} · ${shortTokens(entry.tokens, t)}`,
								value: formatYuan(entry.cost)
							}, `sub-${entry.id}`)),
							// Cache buckets are only meaningful when one model in one window
							// produced the whole figure.
							!splitTree && own.tokens > 0 && own.priced.length === 1 && react_jsx_runtime.jsx("div", { className: "dshAccountUsage_note", children: t("pill.cost.ownBuckets", {
								hit: `${formatExactTokens(own.priced[0]?.parts?.cacheHit?.tokens ?? 0, t)} · ${formatYuan(own.priced[0]?.parts?.cacheHit?.cost ?? 0)}`,
								miss: `${formatExactTokens(own.priced[0]?.parts?.cacheMiss?.tokens ?? 0, t)} · ${formatYuan(own.priced[0]?.parts?.cacheMiss?.cost ?? 0)}`,
								output: `${formatExactTokens(own.priced[0]?.parts?.output?.tokens ?? 0, t)} · ${formatYuan(own.priced[0]?.parts?.output?.cost ?? 0)}`
							}) }),
							react_jsx_runtime.jsx(DetailRow, { label: t("pill.cost.total"), value: amount, strong: true }),
							react_jsx_runtime.jsx("div", {
								className: "dshAccountUsage_note",
								children: subagents > 0 ? t("pill.cost.treeNote") : t("pill.cost.note")
							})
						]
					})
				]
			});
			return react_jsx_runtime.jsx(Pill, {
				icon: primitives.IconGaugeOutlineRegular,
				label: t("pill.cost.label", { amount }),
				title: t("pill.cost.title"),
				panel
			});
		}

		/**
		 * Billing-window pill: peak or off-peak now, the countdown to the next
		 * switch, and the rates in effect.
		 * @param props - session model, the rolled calendar, and translator.
		 * @returns the pill.
		 */
		function WindowPill({ model, calendar, t }) {
			const [now, setNow] = react.useState(() => new Date());
			react.useEffect(() => {
				const timer = setInterval(() => setNow(new Date()), TICK_MS);
				return () => clearInterval(timer);
			}, []);
			const peak = isPeak(now, calendar);
			const next = nextSwitch(now, calendar);
			const countdown = formatCountdown(next.getTime() - now.getTime(), t);
			const modelName = PRICES[model] === undefined ? DEFAULT_MODEL : model;
			const coveredYears = Array.isArray(calendar?.coveredYears) && calendar.coveredYears.length > 0 ? calendar.coveredYears.join("、") : undefined;
			const panel = react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsx(PanelHeader, {
						icon: primitives.IconClockOutlineRegular,
						title: t("pill.window.title"),
						value: t(peak ? "pill.window.peak" : "pill.window.offPeak")
					}),
					react_jsx_runtime.jsxs(DetailList, {
						children: [
							react_jsx_runtime.jsx(DetailRow, {
								label: t("pill.window.next"),
								value: `${countdown} · ${t(peak ? "pill.window.offPeak" : "pill.window.peak")}`,
								strong: true
							}),
							// Both windows with the one in effect marked, so the figures are
							// never a list whose order the reader has to infer.
							...[true, false].map((wanted) => {
								const rowRates = priceRow(modelName)[wanted ? "peak" : "offPeak"];
								return react_jsx_runtime.jsx(DetailRow, {
									label: `${wanted === peak ? "●" : "○"} ${t(wanted ? "pill.window.peak" : "pill.window.offPeak")}`,
									value: t("pill.window.rates", {
										hit: formatRate(rowRates.cacheHit),
										miss: formatRate(rowRates.cacheMiss),
										output: formatRate(rowRates.output)
									}),
									strong: wanted === peak
								}, `rates-${wanted ? "peak" : "offPeak"}`);
							}),
							react_jsx_runtime.jsx("div", { className: "dshAccountUsage_note", children: t("pill.window.schedule") }),
							react_jsx_runtime.jsx("div", {
								className: "dshAccountUsage_note",
								children: coveredYears === undefined ? t("pill.window.holidayUnknown") : t("pill.window.holidayKnownYears", { years: coveredYears })
							})
						]
					})
				]
			});
			return react_jsx_runtime.jsx(Pill, {
				icon: primitives.IconClockOutlineRegular,
				label: t(peak ? "pill.window.peak" : "pill.window.offPeak"),
				title: t("pill.window.title"),
				panel
			});
		}

		/** One fold line's tokens as a short `31.2M tok`-style figure. */
		function shortTokens(tokens, t) {
			if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M tok`;
			if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(1)}K tok`;
			return t("pill.cost.tokens", { count: tokens });
		}

		/**
		 * Price each descendant session on its own, so the panel can name what each
		 * subagent cost instead of only a single combined figure.
		 * @param projectionsBySession - sessions store's per-session projections.
		 * @param descendantIds - descendant session ids, parents first.
		 * @param t - namespaced translator.
		 * @returns one entry per descendant that reported usage.
		 */
		function priceSubagents(projectionsBySession, rootSessionId, descendantIds, t) {
			// A catalog names its own direct children, so a descendant's label is read
			// from its parent's catalog — including the drawn session, which describes
			// the top level of the tree.
			const labels = new Map();
			for (const owner of [rootSessionId, ...descendantIds]) {
				for (const [childId, label] of childLabelsOf(projectionsBySession, owner)) labels.set(childId, label);
			}
			const rows = [];
			for (const id of descendantIds) {
				const view = projectionsBySession?.[id]?.values?.usageByModel;
				if (view === undefined) continue;
				const priced = priceRecords(Array.isArray(view.models) ? view.models : []);
				if (priced.tokens === 0) continue;
				rows.push({
					id,
					tokens: priced.tokens,
					cost: priced.total,
					// The delegation's own label reads better than a raw session id.
					label: labels.get(id)
				});
			}
			return rows;
		}

		/**
		 * The dock row: three pills on one line, matching the statistics strip.
		 *
		 * `useProjection`, `sessionId`, and `useSessions` are the session-scope
		 * slot's built-ins. The session-width hook is what makes the subagent
		 * rollup possible: it carries every session's projections, so a child's
		 * own fold is readable without opening its conversation.
		 * @param props - account source, session-scope hooks, and translator.
		 * @returns the row.
		 */
		function UsageStrip({ balance, sessions, sessionId, useProjection, useSessions, t }) {
			const usage = useProjection("tokenUsage");
			const selection = useProjection("modelSelection");
			const model = selection?.next?.model ?? selection?.lastUsed?.model ?? DEFAULT_MODEL;
			const projectionsBySession = useSessionList(sessions, useSessions);
			const rolled = react.useMemo(
				() => rollupUsage(projectionsBySession, sessionId),
				[projectionsBySession, sessionId]
			);
			useSubagentProjections(sessions, projectionsBySession, rolled.descendants);
			return react_jsx_runtime.jsxs("div", {
				className: "dshAccountUsage_row",
				"data-account-usage": true,
				children: [
					react_jsx_runtime.jsx(BalancePill, { source: balance, t }),
					react_jsx_runtime.jsx(CostPill, { usage, rolled, model, t }),
					react_jsx_runtime.jsx(WindowPill, { model, calendar: rolled, t })
				]
			});
		}

		/**
		 * Roll one session's own usage together with every subagent under it.
		 *
		 * A subagent writes its own session, so its tokens never reach the parent's
		 * log; each child's own fold is the only place they exist, and it is what
		 * keeps them priced at the model and window the child actually ran under.
		 * @param projectionsBySession - sessions store's per-session projections.
		 * @param rootSessionId - session the strip is drawn for.
		 * @returns own and tree lines, descendant ids, and the calendar the
		 *   contributing sessions agree on.
		 */
		function rollupUsage(projectionsBySession, rootSessionId) {
			if (rootSessionId === undefined) return { own: [], tree: [], descendants: [], coveredYears: [], rootSessionId, projectionsBySession: {} };
			const descendants = descendantIdsOf(projectionsBySession, rootSessionId);
			const own = new Map();
			const tree = new Map();
			const calendars = [];
			const ownView = projectionsBySession?.[rootSessionId]?.values?.usageByModel;
			if (ownView !== undefined) {
				calendars.push(ownView);
				mergeUsage(own, ownView);
				mergeUsage(tree, ownView);
			}
			for (const id of descendants) {
				const view = projectionsBySession?.[id]?.values?.usageByModel;
				if (view === undefined) continue;
				calendars.push(view);
				mergeUsage(tree, view);
			}
			// A year counts as covered only when every contributing session covered
			// it, so a child folded before a notice landed cannot be judged by
			// another session's calendar.
			const coveredYears = calendars.length === 0
				? []
				: calendars.reduce(
					(shared, view) => shared.filter((year) => (Array.isArray(view.years) ? view.years : []).includes(year)),
					Array.isArray(calendars[0].years) ? calendars[0].years : []
				);
			return {
				own: [...own.values()],
				tree: [...tree.values()],
				descendants,
				coveredYears,
				rootSessionId,
				projectionsBySession
			};
		}

		/**
		 * Show which model a fallback figure was attributed to.
		 * @param model - session model id.
		 * @param fallback - priced fallback, when the fold is absent.
		 * @param lines - priced fold lines.
		 * @returns the model id to display.
		 */
		function modelNameOf(model, fallback, lines) {
			if (fallback !== undefined) return PRICES[model] === undefined ? DEFAULT_MODEL : model;
			const names = [...new Set(lines.map((row) => row.model))];
			return names.length > 0 ? names.join(", ") : model;
		}

		/**
		 * Subscribe to one selection of the client session list store.
		 *
		 * The slot already hands the row `useSessions`; this keeps the selector
		 * local to the strip.
		 * @param sessions - client `sessions` service, possibly absent.
		 * @param useSessions - session-width selector hook from the slot.
		 * @returns the selected snapshot slice.
		 */
		function useSessionList(sessions, useSessions) {
			return useSessions((state) => state.projectionsBySession);
		}

		/**
		 * Ask the host for a descendant's projection baseline when the client holds
		 * none yet.
		 *
		 * `refreshProjections` is the documented read for a session that is not
		 * open — "a Session that may exist only in a loaded subagent catalog" — and
		 * it is idempotent per connection, so this asks once per still-missing
		 * session and retries only after a failure.
		 * @param sessions - client `sessions` service, possibly absent.
		 * @param projectionsBySession - current per-session projection values.
		 * @param descendantIds - descendant session ids of the drawn session.
		 */
		function useSubagentProjections(sessions, projectionsBySession, descendantIds) {
			const requested = react.useRef(new Set());
			react.useEffect(() => {
				if (sessions === undefined || typeof sessions.refreshProjections !== "function") return;
				for (const id of descendantIds) {
					if (projectionsBySession?.[id]?.values?.usageByModel !== undefined) continue;
					if (requested.current.has(id)) continue;
					requested.current.add(id);
					Promise.resolve(sessions.refreshProjections(id)).catch(() => requested.current.delete(id));
				}
			}, [sessions, projectionsBySession, descendantIds]);
		}

		/**
		 * Direct children of a session, from the catalog the parent's own log
		 * carries. Membership is authoritative there: the parent records each
		 * delegation, so this needs no scan of the session list.
		 * @param projectionsBySession - sessions store's per-session projections.
		 * @param sessionId - parent session id.
		 * @returns child session ids, in catalog order.
		 */
		function childEntriesOf(projectionsBySession, sessionId) {
			const catalog = projectionsBySession?.[sessionId]?.values?.subagentCatalog;
			// The wire value is a versioned envelope: `{ head: { values: [...] } }`,
			// and a row names its child as `childId`. A bare array is accepted too,
			// because that is the shape this plugin's own tests feed it.
			const values = Array.isArray(catalog) ? catalog : catalog?.head?.values;
			if (!Array.isArray(values)) return [];
			const entries = [];
			for (const entry of values) {
				if (entry === null || typeof entry !== "object") continue;
				const id = typeof entry.childId === "string" ? entry.childId : entry.id;
				if (typeof id !== "string" || id === "") continue;
				entries.push({ id, label: typeof entry.label === "string" && entry.label !== "" ? entry.label : undefined });
			}
			return entries;
		}

		/**
		 * Direct child session ids of a session.
		 * @param projectionsBySession - sessions store's per-session projections.
		 * @param sessionId - parent session id.
		 * @returns child session ids, in catalog order.
		 */
		function childIdsOf(projectionsBySession, sessionId) {
			return childEntriesOf(projectionsBySession, sessionId).map((entry) => entry.id);
		}

		/**
		 * Catalog labels of a session's direct children, by child id.
		 * @param projectionsBySession - sessions store's per-session projections.
		 * @param sessionId - parent session id.
		 * @returns label lookup for the rows directly under that session.
		 */
		function childLabelsOf(projectionsBySession, sessionId) {
			const labels = new Map();
			for (const entry of childEntriesOf(projectionsBySession, sessionId)) {
				if (entry.label !== undefined) labels.set(entry.id, entry.label);
			}
			return labels;
		}

		/**
		 * Every descendant session of a root, breadth-first.
		 *
		 * A child may itself delegate, so the walk recurses through each
		 * descendant's own catalog. Visited ids guard against a corrupt catalog
		 * cycle and against a session appearing twice.
		 * @param projectionsBySession - sessions store's per-session projections.
		 * @param rootSessionId - session the strip is drawn for.
		 * @returns descendant session ids, parents before their own children.
		 */
		function descendantIdsOf(projectionsBySession, rootSessionId) {
			const seen = new Set([rootSessionId]);
			const queue = childIdsOf(projectionsBySession, rootSessionId);
			const ids = [];
			while (queue.length > 0) {
				const id = queue.shift();
				if (typeof id !== "string" || seen.has(id)) continue;
				seen.add(id);
				ids.push(id);
				queue.push(...childIdsOf(projectionsBySession, id));
			}
			return ids;
		}

		/**
		 * Merge one session's usage lines into an accumulator keyed by model and
		 * billing window. A line missing either key is skipped, so an older fold
		 * contributes nothing rather than a wrong window.
		 * @param merged - Map from `model` + window to the merged line.
		 * @param view - one session's `usageByModel` value.
		 */
		function mergeUsage(merged, view) {
			if (view === undefined || !Array.isArray(view.models)) return;
			for (const line of view.models) {
				if (line === null || typeof line !== "object" || typeof line.model !== "string") continue;
				if (line.window !== "peak" && line.window !== "offPeak") continue;
				const key = `${line.model}\u0000${line.window}`;
				const current = merged.get(key);
				if (current === undefined) {
					merged.set(key, {
						model: line.model,
						provider: line.provider ?? "",
						window: line.window,
						uncachedInputTokens: line.uncachedInputTokens ?? 0,
						cacheReadTokens: line.cacheReadTokens ?? 0,
						cacheWriteTokens: line.cacheWriteTokens ?? 0,
						outputTokens: line.outputTokens ?? 0
					});
					continue;
				}
				current.uncachedInputTokens += line.uncachedInputTokens ?? 0;
				current.cacheReadTokens += line.cacheReadTokens ?? 0;
				current.cacheWriteTokens += line.cacheWriteTokens ?? 0;
				current.outputTokens += line.outputTokens ?? 0;
			}
		}
		//#endregion

		//#region activation
		/** Services required by the dock row. */
		const inject = ["slots", "locale", "remote", "remote.account", "sessions"];

		/**
		 * Mount the dock row.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "account-usage: dictionaries");
			const translate = ctx.locale.bind(NS);
			/**
			 * Translate one of this plugin's keys.
			 *
			 * A dictionary miss returns the key itself, which would paint a raw
			 * `pill.*` string into the strip, so a miss falls back to the Chinese
			 * dictionary — the key set both dictionaries are checked against.
			 * @param key - namespaced key owned by this plugin.
			 * @param params - `{slot}` values to interpolate.
			 * @returns display copy.
			 */
			const t = (key, params) => {
				const text = translate(key, params);
				if (text !== key) return text;
				const fallback = zh[key] ?? key;
				if (params === undefined) return fallback;
				return fallback.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
			};
			const balance = createBalanceSource(ctx);
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "account-usage",
				order: 10,
				locale: NS
			}, (props) => react_jsx_runtime.jsx(UsageStrip, { ...props, balance, sessions: ctx.sessions, t })));
		}
		//#endregion

		exports.UsageStrip = UsageStrip;
		// Exported for the plugin's own regression check: pricing is the part that
		// has to be provably right, and it is pure.
		exports.priceRecords = priceRecords;
		// The live window verdict is pure and must agree with the Host's; exported so
		// a regression check can compare the two implementations directly.
		exports.isPeak = isPeak;
		exports.calendarCovers = calendarCovers;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
