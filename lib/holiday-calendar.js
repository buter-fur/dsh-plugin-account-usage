/**
 * Chinese statutory holiday calendar for the `usageByModel` fold.
 *
 * The platform bills off-peak "all day on Chinese public holidays", so a peak
 * verdict needs the State Council's day-off list, not just the weekday. This
 * module owns that list on the Host half and keeps it current without a build
 * step:
 *
 *   1. the cache directory (`holiday-cache/`, written by this module) wins;
 *   2. then the snapshot that ships beside this file;
 *   3. a year neither source covers falls back to the weekday rule, and the
 *      coverage is published so the panel can say so.
 *
 * Reading is synchronous and offline by design, because the fold runs while the
 * Host restores a session and cannot await anything. Refresh happens at
 * startup through `refresh()`, which uses the composition's web fetch service
 * and writes what it learns into the cache for the next start.
 *
 * Only the day-off flag matters here. Make-up workdays (`isOffDay: false`) are
 * deliberately ignored: the price page's own summary keeps weekends off-peak in
 * full ("including weekends ... off-peak all day"), and the regulation says a
 * make-up weekend is not rescheduled, so a working Saturday stays off-peak.
 *
 * @module dsh-plugin-account-usage/holiday-calendar
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cache directory beside this file: `lib/holiday-calendar.js` -> `<plugin>/holiday-cache`.
 * Paths, not `file:` URLs with a trailing slash: `new URL(name, dir)` keeps that
 * slash and resolves the file name as a sibling of the directory instead.
 */
const CACHE_DIR = fileURLToPath(new URL("../holiday-cache/", import.meta.url));

/** Bundled snapshot directory: `lib/holiday-calendar.js` -> `<plugin>/data`. */
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

/** Raw-file source for one year, verbatim from the `holiday-cn` dataset. */
const SOURCE_URL = "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/";

/** Bundled fallback year(s): this plugin ships one year and caches the rest. */
const BUNDLED_YEARS = [2026];

/** Milliseconds one refresh request may take before it is abandoned. */
const FETCH_TIMEOUT_MS = 8000;

/**
 * Parse one year file into day-off dates.
 *
 * Shape comes from `holiday-cn`'s schema: `{ year, papers, days: [{ date, name, isOffDay }] }`,
 * where `papers` cites the State Council notice the dates were read from.
 * @param value - parsed JSON of one year file.
 * @returns `{ year, offDays, papers }`, or undefined when the payload is not usable.
 */
function parseYearFile(value) {
	if (value === null || typeof value !== "object") return undefined;
	const year = value.year;
	if (!Number.isInteger(year)) return undefined;
	if (!Array.isArray(value.days)) return undefined;
	const offDays = new Set();
	for (const day of value.days) {
		if (day === null || typeof day !== "object") continue;
		// Only a day off moves the verdict; a make-up workday leaves it to the weekday rule.
		if (day.isOffDay !== true || typeof day.date !== "string") continue;
		offDays.add(day.date);
	}
	return {
		year,
		offDays,
		papers: Array.isArray(value.papers) ? value.papers.filter((entry) => typeof entry === "string") : []
	};
}

/**
 * Read and parse one directory entry, tolerating an absent or corrupt file.
 * @param directory - absolute directory path to read.
 * @param name - file name inside it.
 * @returns the parsed year, or undefined.
 */
function readYearFile(directory, name) {
	try {
		const text = readFileSync(join(directory, name), "utf8");
		return parseYearFile(JSON.parse(text));
	} catch (_error) {
		// A missing directory, a missing year, or a half-written file all mean "not this source".
		return undefined;
	}
}

/**
 * Load the calendar from the cache, falling back to the bundled snapshot.
 *
 * The cache wins per year rather than wholesale, so a freshly fetched 2027
 * coexists with a bundled 2026 instead of shadowing it.
 * @param years - years the caller cares about, for the coverage report.
 * @returns `{ offDays, byYear, papers, coveredYears, nextMissingYear }`.
 */
function loadCalendar(years) {
	const wanted = [...new Set([...BUNDLED_YEARS, ...years])].sort((left, right) => left - right);
	const offDays = new Set();
	const byYear = new Map();
	const papers = [];
	for (const year of wanted) {
		const name = `holiday-${String(year)}.json`;
		const source = readYearFile(CACHE_DIR, name) ?? readYearFile(DATA_DIR, name);
		if (source === undefined) continue;
		byYear.set(year, source.offDays);
		for (const date of source.offDays) offDays.add(date);
		papers.push(...source.papers);
	}
	const yearsCovered = [...byYear.keys()].sort((left, right) => left - right);
	const lastCovered = yearsCovered.at(-1);
	return {
		offDays,
		byYear,
		papers,
		coveredYears: yearsCovered,
		nextMissingYear: lastCovered === undefined ? undefined : lastCovered + 1
	};
}

/**
 * Stable identity of a calendar's content.
 *
 * The fold carries this in its state version, so a calendar change — a new
 * State Council notice, a corrected date — makes the persisted row stale and
 * the registry refolds history with the better calendar instead of serving
 * amounts priced from the old one.
 * @param calendar - value from {@link loadCalendar}.
 * @returns a short deterministic string.
 */
function calendarVersion(calendar) {
	const digest = [...calendar.byYear.entries()]
		.sort(([left], [right]) => left - right)
		.map(([year, days]) => `${String(year)}:${String(days.size)}:${[...days].sort().join(",")}`)
		.join("|");
	// Small FNV-1a over the digest: deterministic across processes, short enough for a state version.
	let hash = 2166136261;
	for (let index = 0; index < digest.length; index += 1) {
		hash ^= digest.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

/**
 * Whether the calendar covers one date.
 * @param calendar - value from {@link loadCalendar}.
 * @param date - `YYYY-MM-DD` in Beijing time.
 * @returns true when a day-off verdict for that date is known.
 */
function covers(calendar, date) {
	return calendar.byYear.get(Number(date.slice(0, 4))) !== undefined;
}

/**
 * Whether one date is a statutory day off.
 *
 * A date outside the covered years answers false, which leaves the verdict to
 * the weekday rule — the same fallback the panel discloses.
 * @param calendar - value from {@link loadCalendar}.
 * @param date - `YYYY-MM-DD` in Beijing time.
 * @returns true on a published day off.
 */
function isOffDay(calendar, date) {
	return calendar.offDays.has(date);
}

/**
 * Fetch one year from the dataset and cache it.
 * @param ctx - Host context, used for the web service and diagnostics.
 * @param year - calendar year to fetch.
 * @returns whether a usable file was written.
 */
async function fetchYear(ctx, year) {
	const web = ctx.get("web");
	if (web === undefined || typeof web.fetch !== "function") return false;
	const target = `${SOURCE_URL}${String(year)}.json`;
	let page;
	try {
		// The composition's web service, not `globalThis.fetch`: it validates the
		// destination, caps the body, and sends no credentials. It throws WebError
		// for a failure to retrieve, and reports HTTP status as data.
		page = await web.fetch({ url: target, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch (error) {
		ctx.logger?.info("account-usage: holiday calendar fetch failed for %d (%s)", year, String(error));
		return false;
	}
	if (page === undefined || page.statusCode !== 200) return false;
	const text = page.body?.text;
	if (typeof text !== "string") return false;
	const parsed = parseYearFile(safeJson(text));
	// An empty year file is what the dataset serves before the notice is published.
	if (parsed === undefined || parsed.offDays.size === 0) return false;
	try {
		const destination = join(CACHE_DIR, `holiday-${String(year)}.json`);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, text, "utf8");
	} catch (error) {
		ctx.logger?.info("account-usage: holiday calendar cache write failed (%s)", String(error));
		return false;
	}
	return true;
}

/** JSON.parse that answers undefined instead of throwing. */
function safeJson(text) {
	try {
		return JSON.parse(text);
	} catch (_error) {
		return undefined;
	}
}

/**
 * Refresh the cache for the years that matter, in the background.
 *
 * Called once at startup; every failure is a diagnostic, never a boot error,
 * because the calendar is an accuracy refinement over the weekday rule.
 * @param ctx - Host context carrying the web service.
 * @param years - years to ensure, oldest first.
 * @returns the year names that were newly cached.
 */
async function refresh(ctx, years) {
	const written = [];
	for (const year of years) {
		const cached = readYearFile(CACHE_DIR, `holiday-${String(year)}.json`);
		if (cached !== undefined && cached.offDays.size > 0) continue;
		if (await fetchYear(ctx, year)) written.push(year);
	}
	return written;
}

export {
	BUNDLED_YEARS,
	CACHE_DIR,
	calendarVersion,
	covers,
	fetchYear,
	isOffDay,
	loadCalendar,
	parseYearFile,
	refresh
};
