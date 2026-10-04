// Client half of @tuoluosuan/dsh-peak-badge.
//
// Shows whether DeepSeek's API pricing is in its peak or off-peak window right
// now, as a compact chip at the left of the composer tool row. Clicking it
// expands the schedule behind the verdict.
//
// The whole policy is a pure function of the Beijing wall clock plus the
// statutory holiday table below, so this half is self-contained: no network, no
// host RPC. It must never load a clock or a timer from the ambient globals —
// browser timers are trapped in a client half, and the disposable interval comes
// from the `timer` service instead.
//
// Policy (api-docs.deepseek.com/zh-cn/quick_start/pricing):
//   "北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
//    其余时段，包括周末及中国法定节假日全天均为空闲时段。"
//   "空闲时段价格为高峰时段价格的一半。"
// The English page says the same thing in UTC ("01:00 - 04:00 and 06:00 - 10:00
// UTC, Monday through Friday, excluding Chinese public holidays" = the two local
// windows above) and repeats that weekends and holidays are off-peak in full.
// So weekends really have no peak window at all: do not "fix" this file into a
// seven-day schedule.

// The factory scope is the only safe place for a binding: bundle files are
// concatenated into page-global `<script>`s, and every shipped bundle keeps its
// top level to the single `load(...)` call for exactly that reason. Hence the id
// appears twice — this call and the `PACKAGE_ID` inside the factory — and the two
// must be changed together.
window.__ModuleLoader__.load({
  id: '@tuoluosuan/dsh-peak-badge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PACKAGE_ID = '@tuoluosuan/dsh-peak-badge';

    // #region policy

    const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
    const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];
    const TICK_MS = 30000;

    /**
     * One single source of truth per year.
     *
     * The table carries its own year so the coverage check in `peakState` cannot
     * drift from the data: `HOLIDAY_COVERAGE` is derived from these rows rather
     * than maintained beside them. Adding a year's rows *is* extending coverage,
     * which makes a half-finished year bump impossible.
     *
     * Sources:
     *   2026 — 国务院办公厅关于2026年部分节假日安排的通知, 国办发明电〔2025〕7号
     *          https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
     *
     * Holiday ranges are inclusive and written `[month, day]`; each row stays one
     * line so a future year's notice can replace its block wholesale.
     */
    const HOLIDAY_TABLE = {
      '2026': {
        year: 2026,
        rows: [
          ['元旦', [[1, 1], [1, 3]]],
          ['春节', [[2, 15], [2, 23]]],
          ['清明节', [[4, 4], [4, 6]]],
          ['劳动节', [[5, 1], [5, 5]]],
          ['端午节', [[6, 19], [6, 21]]],
          ['中秋节', [[9, 25], [9, 27]]],
          ['国庆节', [[10, 1], [10, 7]]],
        ],
        // 调休上班日. DeepSeek's rule keys on 「周一至周五」 and names weekends
        // off-peak in full, so these make-up workdays that land on a weekend stay
        // OFF-PEAK. They are kept only so the expanded card can say so out loud
        // instead of leaving the reader to guess.
        makeUp: [[1, 4], [2, 14], [2, 28], [5, 9], [9, 20], [10, 10]],
      },
    };

    /** Years the table above covers, in declaration order. */
    const HOLIDAY_COVERAGE = Object.values(HOLIDAY_TABLE)
      .map((entry) => entry.year)
      .sort((a, b) => a - b);
    const LATEST_COVERED_YEAR = HOLIDAY_COVERAGE[HOLIDAY_COVERAGE.length - 1];

    /** Month-day key. Built as a string, so no leading-zero or octal trap exists. */
    function mdKey(month, day) {
      return `${month}/${day}`;
    }

    /** Flatten one year's rows into a key -> holiday name table. */
    function buildHolidayTable(entry) {
      const table = new Map();
      for (const [name, [from, to]] of entry.rows) {
        const cursor = new Date(Date.UTC(entry.year, from[0] - 1, from[1]));
        const last = new Date(Date.UTC(entry.year, to[0] - 1, to[1]));
        while (cursor.getTime() <= last.getTime()) {
          table.set(mdKey(cursor.getUTCMonth() + 1, cursor.getUTCDate()), name);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
      return table;
    }

    /**
     * One year's flattened table and make-up set, built on first use and cached
     * on the entry, so the year object stays the only thing a maintainer edits.
     *
     * @returns undefined when the year is not in the table at all.
     */
    function holidayYear(year) {
      const entry = HOLIDAY_TABLE[String(year)];
      if (entry === undefined) return undefined;
      if (entry.table === undefined) {
        entry.table = buildHolidayTable(entry);
        entry.makeUpKeys = new Set(entry.makeUp.map(([m, d]) => mdKey(m, d)));
      }
      return entry;
    }

    /**
     * The holiday record for one Beijing civil date, or undefined.
     *
     * Two different "undefined"s matter here and they are not the same question:
     * `holidayYear` answers "does the table cover this year at all", while this
     * answers "is this particular day a statutory holiday". Use the year function
     * when the walk needs to stop on unknown territory; use this one to name a
     * day off.
     *
     * Only the name comes back. Whether the day is a 调休 make-up workday is a
     * separate question — by construction such a day is never in this table — so
     * it is asked with `isMakeUpDay` below rather than smuggled in as a field that
     * could only ever be false.
     */
    function holidayLookup(year, month, day) {
      const entry = holidayYear(year);
      if (entry === undefined) return undefined;
      const name = entry.table.get(mdKey(month, day));
      if (name === undefined) return undefined;
      return { name };
    }

    /** Whether one Beijing civil date is a 调休 make-up workday (a working weekend). */
    function isMakeUpDay(year, month, day) {
      const entry = holidayYear(year);
      return entry === undefined ? false : entry.makeUpKeys.has(mdKey(month, day));
    }

    /** `minutes` past midnight as `HH:MM`. */
    function hhmm(minutes) {
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      return `${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}`;
    }

    /**
     * `2026-08-19` for a Beijing instant, backed by UTC formatting of a shifted
     * instant.
     *
     * Deliberately language-free: the weekday is returned as its number and the
     * view renders both, because the policy region must stay executable on its
     * own by `verify-policy.mjs`.
     */
    function formatCivilDate(instantMs) {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(instantMs));
      } catch {
        const date = new Date(instantMs);
        const month = date.getUTCMonth() + 1;
        const dayOfMonth = date.getUTCDate();
        return `${date.getUTCFullYear()}-${month < 10 ? '0' : ''}${month}-${dayOfMonth < 10 ? '0' : ''}${dayOfMonth}`;
      }
    }

    /** The current 谷时 window, or undefined during peak. */
    function activePeakWindow(minuteOfDay) {
      for (const [open, close] of PEAK_WINDOWS) {
        if (minuteOfDay >= open && minuteOfDay < close) return [open, close];
      }
      return undefined;
    }

    /**
     * Where the off-peak stretch containing this moment ends.
     *
     * Walks whole Beijing days forward. `inDays` counts them from the current
     * civil date, so callers describe the target as 今天 / 明天 / N 天后 without
     * recovering the offset from timestamps.
     *
     * @param nowMs - an instant already known to be off-peak.
     * @returns the next peak-window open, or a verdict that the walk found none.
     */
    function offPeakReach(nowMs) {
      const shiftedNow = new Date(nowMs + CHINA_UTC_OFFSET_MS);
      const minuteNow = shiftedNow.getUTCHours() * 60 + shiftedNow.getUTCMinutes();
      for (let inDays = 0; inDays < 400; inDays += 1) {
        // Two clocks, and both are needed. Today (`inDays === 0`) has to be judged
        // against the moment itself, or a 12:30 noon break answers "09:00 is still
        // ahead"; every later day is judged at midnight, because there the whole
        // day is ahead and the first window is the next one.
        const cursor = new Date(nowMs + CHINA_UTC_OFFSET_MS - ((nowMs + CHINA_UTC_OFFSET_MS) % 86400000) + inDays * 86400000);
        const weekday = cursor.getUTCDay();
        const entry = holidayYear(cursor.getUTCFullYear());
        // A year the table does not cover makes every day in it a working day:
        // peakState already refuses to answer there, so this only stops the walk
        // from inventing a holiday-free answer it would never be asked to show.
        if (entry === undefined) return { kind: 'later' };
        if (entry.table.has(mdKey(cursor.getUTCMonth() + 1, cursor.getUTCDate()))) continue;
        if (weekday === 0 || weekday === 6) continue;
        const minuteOfDay = inDays === 0 ? minuteNow : 0;
        for (const window of PEAK_WINDOWS) {
          if (minuteOfDay < window[0]) return { kind: 'peak', inDays, open: window[0], close: window[1] };
          if (minuteOfDay < window[1]) return { kind: 'peak', inDays, open: window[0], close: window[1] };
        }
      }
      return { kind: 'later' };
    }

    /**
     * Resolve the full badge state for one instant.
     *
     * Weekday and clock are read on the moment itself, never on its date: a
     * Beijing Friday runs off-peak past 18:00 and straight into a Saturday, so
     * the weekend rule has to win for that Friday-evening instant even though
     * the same civil date held a peak window hours earlier.
     *
     * @param nowMs - the instant to judge.
     * @returns peak / off-peak / unknown, with the schedule behind the verdict.
     */
    function peakState(nowMs) {
      // Snap to the start of the current Beijing minute. The policy is stated in
      // whole minutes, so seconds are noise; without the snap a printed gap can
      // round up by up to a minute (09:00:30 showing "3 小时" for 179.5).
      nowMs -= nowMs % 60000;
      const shifted = new Date(nowMs + CHINA_UTC_OFFSET_MS);
      const year = shifted.getUTCFullYear();
      const month = shifted.getUTCMonth() + 1;
      const day = shifted.getUTCDate();
      const weekday = shifted.getUTCDay();
      const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
      const dateText = formatCivilDate(nowMs + CHINA_UTC_OFFSET_MS);
      const schedule = PEAK_WINDOWS.map(([open, close]) => `${hhmm(open)}–${hhmm(close)}`).join(' · ');

      if (!HOLIDAY_COVERAGE.includes(year)) {
        // Years the table does not cover get a third, honest posture instead of
        // a guess dressed as a verdict.
        return {
          status: 'unknown', dateText, weekday, schedule,
          reason: 'tableExhausted',
          reasonParams: { latest: LATEST_COVERED_YEAR, year },
        };
      }

      const entry = holidayLookup(year, month, day);
      const holiday = entry === undefined ? undefined : entry.name;
      // Asked separately from `holidayLookup`: a 调休 workday is by definition not
      // a statutory holiday, so it never appears in that lookup — it is the one
      // case where "the official rule counts the weekday" needs saying out loud.
      const isMakeup = isMakeUpDay(year, month, day);
      const isWeekend = weekday === 0 || weekday === 6;

      /** One shape for every off-peak verdict; only the reasoning differs. */
      const offPeak = (reason, reasonParams, tail) => {
        const reach = offPeakReach(nowMs);
        let next;
        if (reach.kind === 'peak') {
          const targetMs = nowMs + reach.inDays * 86400000 + reach.open * 60000 - minuteOfDay * 60000;
          // Numbers, not sentences: `at` is a bare clock time, `inDays` a count
          // and `leftMinutes` a duration. The view formats all three, which is
          // what lets `verify-policy.mjs` execute this region on its own.
          next = {
            at: hhmm(reach.open),
            inDays: reach.inDays,
            leftMinutes: Math.max(1, Math.round((targetMs - nowMs) / 60000)),
          };
        }
        return {
          status: 'off',
          dateText,
          weekday,
          discount: 'rateOffPeak',
          reason,
          reasonParams,
          tail,
          schedule,
          next,
        };
      };

      // Every off-peak instant routes through the same day-walk. Doing it here
      // rather than with a special case per gap is what keeps the noon break
      // (12:00-14:00) and a Friday evening honest: both have a next peak that is
      // not "tomorrow 09:00", and both are exactly what offPeakReach computes.
      if (holiday !== undefined || isWeekend) {
        // The leading reason names the day and carries the whole explanation for
        // a make-up workday, where "it is Saturday" alone would not.
        if (isMakeup) return offPeak('makeup', { weekday }, 'allDayOff');
        if (holiday !== undefined) return offPeak('holiday', { name: holiday }, 'allDayOff');
        return offPeak('weekend', { weekday }, 'allDayOff');
      }

      const peakWindow = activePeakWindow(minuteOfDay);
      if (peakWindow !== undefined) {
        const closeAt = new Date(nowMs + CHINA_UTC_OFFSET_MS);
        closeAt.setUTCHours(Math.floor(peakWindow[1] / 60), peakWindow[1] % 60, 0, 0);
        return {
          status: 'peak',
          dateText,
          weekday,
          discount: 'rateStandard',
          reason: 'peakWorkday',
          schedule,
          next: {
            at: hhmm(peakWindow[1]),
            inDays: 0,
            leftMinutes: Math.max(1, Math.round((closeAt.getTime() - CHINA_UTC_OFFSET_MS - nowMs) / 60000)),
          },
        };
      }

      // Off-peak on a working day: either the noon break (next peak today) or the
      // evening run-out (next peak tomorrow or later). offPeakReach tells them
      // apart, so there is no need to guess which one this is. No `tail`: the one
      // sentence already says everything there is to say here.
      return offPeak('workingDayOff');
    }

    // #endregion

    // #region styles

    const STYLE_TAG_ID = `${PACKAGE_ID}/styles`;
    // Stable and package-scoped, so it is unique even though the slot is
    // per-session (one card per open conversation at most).
    const CARD_ID = `${PACKAGE_ID}-card`;
    // `off` and `unknown` restate the base colour on purpose. The off-peak chip
    // used to read --dsw-alias-state-idle-primary, which resolves to
    // --dsw-static-neutral-300 (#d4d4d4 on the light theme) — a border-grade grey
    // at 1.2:1 against the composer, visibly washed out. Declaring the token per
    // status keeps that mistake from coming back silently, and the secondary label
    // is the same neutral family one step darker (5.0:1) that follows the theme in
    // both directions.
    //
    // The chip's status dot carries an explicit `corner-shape: round` for the same
    // kind of reason. The theme installs a global
    // `*, :before, :after { corner-shape: var(--dsw-corner-shape) }` rule whose
    // variable is `superellipse(1.5)` (dsh-client-ui-theme/lib/client.js:1145), and
    // at 6px a superellipse keeps visibly flat sides — the dot renders as a rounded
    // SQUARE, not a circle. Rendering both variants at 10x under Edge confirmed it;
    // engines without `corner-shape` ignore the declaration, so it costs nothing.
    //
    // The card is 304px wide rather than the 264px it started at, because the
    // `下次切换` value has to stay on one line. Its longest form is
    // `N 天后 09:00（M 天 N 小时）`: about 200px at 12px, plus the `下次切换` label
    // (48px) and the 10px flex gap. At 264px that row wrapped, leaving a lone `）`
    // on a second line, which reads as a broken layout rather than a long value.
    // `verify-policy.mjs` guards the format; `demo/shoot.mjs` measures the row and
    // refuses to write a screenshot when a row overflows, since a wrapped row is
    // invisible in the PNG itself.
    const CSS = `
.peak-badge-root { position: relative; display: inline-flex; }
.peak-badge-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; box-sizing: border-box;
  font: inherit; font-size: 12px; line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px; cursor: pointer; white-space: nowrap;
}
.peak-badge-chip:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.peak-badge-chip[data-status="peak"] { color: var(--dsw-alias-state-warn-primary); }
.peak-badge-chip[data-status="off"] { color: var(--dsw-alias-label-secondary); }
.peak-badge-chip[data-status="unknown"] { color: var(--dsw-alias-label-secondary); }
.peak-badge-dot { width: 6px; height: 6px; border-radius: 50%; corner-shape: round; background: currentColor; flex: none; }
.peak-badge-card {
  position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 40;
  width: 304px; box-sizing: border-box; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .16);
}
.peak-badge-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; }
.peak-badge-row + .peak-badge-row { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px; }
.peak-badge-key { color: var(--dsw-alias-label-secondary); flex: none; }
/* A row is one line by contract: every value here is a short fact (a date, a
   rate, a window), and the card is sized for the longest of them. Letting one
   wrap puts an orphaned word on a second line and the row reads as a mistake. */
.peak-badge-value { text-align: right; white-space: nowrap; }
.peak-badge-value[data-tone="peak"] { color: var(--dsw-alias-state-warn-primary); }
.peak-badge-value[data-tone="off"] { color: var(--dsw-alias-label-secondary); }
.peak-badge-foot { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
`;

    /**
     * Announce the stylesheet once per page.
     *
     * This is a static bundle: the factory receives only `require`, so the
     * `styles.insert` helper of the dynamic-package evaluator is not on offer and
     * the tag is injected by hand.
     *
     * The `data-plugin` stamp is not decoration. `removeOwnedStyles` in
     * dsh-client-modules (lib/client.js:194-197) tears down every
     * `style[data-plugin]` whose attribute equals the package id, on factory
     * failure and on revision change; a tag without it survives unload and the
     * next revision renders against stale rules.
     */
    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector(`style[data-plugin="${PACKAGE_ID}"]`) !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = PACKAGE_ID;
      tag.dataset.dshPeakBadge = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.append(tag);
    }

    // #endregion

    // #region text

    // One source for the Chinese labels, so `localize` can restore them wholesale
    // instead of re-listing every key. A hand-copied second literal drifts: the
    // first version of this file already lacked `beyondHorizon` in the restore
    // path, which would have left the English string on screen after switching
    // back to Chinese.
    const TEXT_ZH = {
      peak: '峰时',
      off: '谷时',
      unknown: '未知',
      title: 'DeepSeek 峰谷时段',
      state: '当前',
      discount: '计费',
      next: '下次切换',
      schedule: '高峰时段',
      pending: '待定',
      beyondHorizon: '一年内没有可判断的高峰时段',
      clockError: '无法读取本机时钟。',
      hour: '小时',
      minute: '分钟',
      day: '天',
      today: '今天',
      tomorrow: '明天',
      dayAfter: '后天',
      daysAfter: '天后',
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
      rateStandard: '标准价',
      rateOffPeak: '5 折 · 半价',
    };
    const TEXT_EN = {
      peak: 'Peak',
      off: 'Off-peak',
      unknown: 'Unknown',
      title: 'DeepSeek peak / off-peak',
      state: 'Now',
      discount: 'Rate',
      next: 'Next switch',
      schedule: 'Peak hours',
      pending: 'Unknown',
      beyondHorizon: 'No assessable peak window within a year',
      clockError: 'The local clock could not be read.',
      hour: 'h',
      minute: 'min',
      day: 'd',
      today: 'today',
      tomorrow: 'tomorrow',
      dayAfter: 'in 2 days',
      daysAfter: 'days from now',
      weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      rateStandard: 'standard rate',
      rateOffPeak: '50% · half price',
    };

    // The policy region returns a reason *key* plus its parameters; the sentence
    // lives here because the sentence is language. Anything unknown falls back to
    // Chinese rather than printing `undefined` in the card.
    const REASON_ZH = {
      holiday: '法定节假日：{name}',
      weekend: '{weekday}',
      makeup: '调休上班日，但官方规则按周几算，周末一律空闲（{weekday}）',
      allDayOff: '全天按空闲时段计价。',
      workingDayOff: '工作日非高峰时段，当前按空闲时段计价。',
      peakWorkday: '工作日高峰时段，当前按标准价计价。',
      tableExhausted: '节日表只到 {latest} 年，{year} 年的法定节假日无从判断。',
    };
    const REASON_EN = {
      holiday: 'statutory holiday: {name}',
      weekend: '{weekday}',
      makeup: 'a 调休 make-up workday, but the official rule counts the weekday, and weekends stay off-peak ({weekday})',
      allDayOff: 'billed off-peak all day.',
      workingDayOff: 'off-peak window on a working day, currently billed at the off-peak rate.',
      peakWorkday: 'peak window on a working day, currently billed at the standard rate.',
      tableExhausted: 'the holiday table only reaches {latest}, so the statutory holidays of {year} cannot be determined.',
    };
    const REASON = { zh: REASON_ZH, en: REASON_EN };
    // The active language lives in a mutable holder rather than in a closing-over
    // `let`. Not because a bare `let` is illegal here — it is legal, and
    // `verify-policy.mjs` extracts this region into a plain function body that has
    // no trouble with one either. It is a holder because there is nothing in this
    // region that wants to rebind a binding: `localize` mutates the tables'
    // contents and this one field, so `Object.freeze` would be the only thing a
    // bare `let` bought, and the two readers below stay pure lookups.
    const i18n = { lang: 'zh' };

    /** Fill `{name}`-style slots; a missing key is left visible on purpose. */
    function fill(template, params) {
      if (params === undefined) return template;
      return template.replace(/\{(\w+)\}/g, (whole, key) => (
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole
      ));
    }

    /** The sentence for one reason key, tolerating a plain string. */
    function reasonText(state) {
      if (typeof state.reason !== 'string') return '';
      const template = REASON[i18n.lang][state.reason];
      if (template === undefined) return state.reason;
      const params = state.reasonParams;
      return fill(template, params === undefined ? undefined : Object.assign({}, params, {
        // A weekday arrives as a number so the policy region stays language-free.
        weekday: typeof params.weekday === 'number' ? text.weekday[params.weekday] : params.weekday,
      }));
    }

    /** The card's opening sentence: the reason, plus its closing note. */
    function reasonSentence(state) {
      const head = reasonText(state);
      const tail = state.tail === undefined ? '' : reasonText({ reason: state.tail });
      // English reason templates are written lowercase so they can be embedded
      // mid-sentence; here they always open one, so the first letter is lifted.
      const cap = (sentence) => `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
      if (tail === '') return i18n.lang === 'en' ? cap(head) : head;
      if (head === '') return i18n.lang === 'en' ? cap(tail) : tail;
      return i18n.lang === 'en' ? `${cap(head)}. ${cap(tail)}` : `${head}，${tail}`;
    }

    const text = Object.assign({}, TEXT_ZH);

    /**
     * A minute count as `X 天 Y 小时` / `X 小时 Y 分钟` / `Y 分钟`.
     *
     * This is a size decision as much as a wording one. The `下次切换` row has to
     * stay on one line: `94 小时 19 分钟` is both wide and harder to read than
     * `3 天 22 小时`, and once the gap is a day or more the exact minute is noise
     * on a card that already prints the absolute switch time.
     */
    function formatGap(minutes) {
      const total = Math.max(0, Math.ceil(minutes));
      const days = Math.floor(total / 1440);
      const hours = Math.floor((total % 1440) / 60);
      const rest = total % 60;
      const unit = (count, label) => `${count} ${label}`;
      const parts = [];
      if (days > 0) parts.push(unit(days, text.day));
      if (hours > 0 || days > 0) parts.push(unit(hours, text.hour));
      if (days === 0) parts.push(unit(rest, text.minute));
      return parts.join(' ');
    }

    /** How many Beijing days ahead a peak window is, in words. */
    function dayOffsetLabel(dayOffset) {
      if (dayOffset <= 0) return text.today;
      if (dayOffset === 1) return text.tomorrow;
      if (dayOffset === 2) return text.dayAfter;
      return `${dayOffset} ${text.daysAfter}`;
    }

    /** Point the labels at the active language, if one is on offer. */
    function localize(ctx) {
      const locale = ctx.get('locale');
      if (locale === undefined || typeof locale.getLocale !== 'function') return { active: 'zh' };
      try {
        const active = locale.getLocale().active;
        const english = typeof active === 'string' && active.toLowerCase().startsWith('en');
        i18n.lang = english ? 'en' : 'zh';
        Object.assign(text, english ? TEXT_EN : TEXT_ZH);
        return { active };
      } catch {
        i18n.lang = 'zh';
        Object.assign(text, TEXT_ZH);
        return { active: 'zh' };
      }
    }

    // #endregion

    // #region view

    function Row(props) {
      return h('div', { className: 'peak-badge-row' },
        h('span', { className: 'peak-badge-key' }, props.label),
        h('span', { className: 'peak-badge-value', 'data-tone': props.tone }, props.value));
    }

    /** One label/value pair inside the expanded card; nulls render nothing. */
    function Detail(props) {
      if (props.value === null || props.value === undefined) return null;
      return h(Row, { label: props.label, value: props.value, tone: props.tone });
    }

    const Main = React.memo(function PeakBadge() {
      // The tick exists to re-render on schedule; the verdict is computed during
      // render so the first paint is already correct.
      const [tick, setTick] = React.useState(0);
      const [open, setOpen] = React.useState(false);

      React.useEffect(() => {
        ensureStyles();
      }, []);

      React.useEffect(() => {
        // `localize` is a one-shot at apply time, so a language switch at runtime
        // would otherwise leave the chip in whichever language was active when the
        // plugin loaded. The locale service is observable and `subscribe` returns
        // its own unsubscriber, which is exactly the cleanup contract of an effect.
        // No eager call here: `apply` already localized before this entry mounted,
        // so the first paint is correct.
        let unsubscribe = null;
        try {
          const locale = pluginCtx === null ? undefined : pluginCtx.get('locale');
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined;
          unsubscribe = locale.subscribe(() => {
            localize(pluginCtx);
            setTick((value) => value + 1);
          });
        } catch (error) {
          console.error('[peak-badge] locale subscription unavailable', error);
          return undefined;
        }
        return () => {
          if (typeof unsubscribe === 'function') unsubscribe();
        };
      }, []);

      React.useEffect(() => {
        // Both the service lookup and the interval must sit inside the guard: a
        // disposed context throws INACTIVE_EFFECT (assertActive, called by
        // ctx.effect, which backs every timer method) rather than returning
        // nothing. Unmount normally races that disposal.
        let dispose = null;
        try {
          const timer = pluginCtx === null ? undefined : pluginCtx.get('timer');
          if (timer === undefined || typeof timer.interval !== 'function') return undefined;
          dispose = timer.interval(() => {
            setTick((value) => value + 1);
          }, TICK_MS);
        } catch (error) {
          // A badge that never refreshes still beats a crashed composer row:
          // the verdict stays right until the next unrelated re-render.
          console.error('[peak-badge] interval unavailable', error);
          return undefined;
        }
        return () => {
          if (typeof dispose === 'function') dispose();
        };
      }, []);

      let state;
      try {
        state = peakState(Date.now());
      } catch (error) {
        console.error('[peak-badge] failed to resolve the current window', error);
        state = { status: 'unknown', dateText: '', schedule: '', reason: text.clockError };
      }
      void tick;

      const status = state.status;
      const label = status === 'peak' ? text.peak : status === 'off' ? text.off : text.unknown;
      const rate = status === 'unknown' ? null : text[state.discount] || state.discount;
      // `next` is absent only when the day-walk found no peak window it is
      // willing to name: either the year is not covered by the holiday table, or
      // the walk hit its own horizon. Both are "not within the next year", never
      // "the next workday" — on weekends and holidays the whole day is off-peak,
      // so the next peak is by definition a later day.
      const nextText = state.next === undefined
        ? (status === 'off' ? text.beyondHorizon : text.pending)
         : i18n.lang === 'en'
          ? `${dayOffsetLabel(state.next.inDays)} ${state.next.at} (${formatGap(state.next.leftMinutes)})`
          : `${dayOffsetLabel(state.next.inDays)} ${state.next.at}（${formatGap(state.next.leftMinutes)}）`;

      return h('div', {
        className: 'peak-badge-root',
        tabIndex: -1,
        // Focus-based dismissal rather than a document-level click listener:
        // React's synthetic click has already run by the time the chip flips the
        // flag, and a native listener would read the open card as "outside".
        //
        // `relatedTarget === null` means focus left the document (an outside
        // mouse click), not that it moved to a sibling: closing there would
        // unmount the card before its own mouseup, so anything clickable inside
        // it could never be clicked. Keep the card open in that case and let the
        // chip's own click or Escape close it.
        onBlur: (event) => {
          const next = event.relatedTarget;
          if (next === null || event.currentTarget.contains(next)) return;
          setOpen(false);
        },
        onKeyDown: (event) => {
          if (event.key === 'Escape') setOpen(false);
        },
      },
        h('button', {
          type: 'button',
          className: 'peak-badge-chip',
          'data-status': status,
          'data-dsh-peak-badge': 'chip',
          title: `${text.title}${i18n.lang === 'en' ? ': ' : '：'}${label}`,
          'aria-expanded': open,
          'aria-haspopup': 'dialog',
          'aria-controls': open ? CARD_ID : undefined,
          onClick: () => setOpen((value) => !value),
        },
          h('span', { className: 'peak-badge-dot', 'aria-hidden': true }),
          h('span', null, label)),
        open
          ? h('div', {
              id: CARD_ID,
              className: 'peak-badge-card',
              'data-dsh-peak-badge': 'card',
              role: 'dialog',
              'aria-label': text.title,
            },
              // `state.dateText` is a bare ISO date on purpose; the weekday is
              // rendered here so it follows the language.
              h(Row, { label: text.state, value: `${label} · ${state.dateText}${state.weekday === undefined ? '' : ` ${text.weekday[state.weekday]}`}`, tone: status }),
              h(Detail, { label: text.discount, value: rate, tone: status }),
              h(Detail, { label: text.next, value: nextText }),
              h(Detail, { label: text.schedule, value: status === 'unknown' ? null : state.schedule }),
              h('div', { className: 'peak-badge-foot' }, reasonSentence(state)))
          : null);
    });

    // #endregion

    // Set by `apply`, read by the mounted entry. The component mounts only while
    // this plugin's fiber is alive, so a closure read is safer than threading the
    // context through the slot's inject surface.
    let pluginCtx = null;

    return {
      inject: ['slots'],
      apply(ctx) {
        pluginCtx = ctx;
        localize(ctx);
        // The `try` matters even though this is the plugin's own mount path: an
        // `apply` that throws takes the whole entry down, and a slot can be
        // *declared by another package* whose entry is not active (the settings
        // shell and the conversation columns are both disableable), in which case
        // `inject` never fires. A chip that fails to appear is a bad outcome; a
        // plugin that fails to apply because of it is a worse one, and it is the
        // kind of failure that shows up as "this plugin broke that plugin".
        try {
          ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
            name: 'conversation.input.left',
            id: 'peak-badge',
            order: 20,
          }, Main));
        } catch (error) {
          console.error('[peak-badge] the composer seat could not be registered', error);
        }
      },
    };
  },
});
