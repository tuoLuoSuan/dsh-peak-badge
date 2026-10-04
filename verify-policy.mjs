// Verification for the @tuoluosuan/dsh-peak-badge policy.
//
//   node verify-policy.mjs            # run the cases
//   node verify-policy.mjs --dump     # also print the extracted code
//
// Why this reads client.js as text instead of importing it: the policy lives
// inside the `window.__ModuleLoader__.load({ factory })` closure, which only
// exists in a browser bundle. Everything between the `#region policy` and
// `#endregion` markers is pure JavaScript with no React, no DOM and no client
// services, so it can be extracted and executed here directly. That is the whole
// point — the arithmetic is the risky part and it is the part that is testable.
//
// Exit codes follow the house convention (see .learnings/LRN-20261003-001):
//   0  every case passed
//   1  an assertion failed — the code is wrong
//   2  the verification itself could not run — says nothing about the code

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function fail(code, message) {
  console.error(message);
  process.exitCode = code;
}

let source;
try {
  source = readFileSync(join(HERE, 'client.js'), 'utf8');
} catch (error) {
  fail(2, `could not read client.js next to this script: ${error.message}`);
}

let policy;
if (source !== undefined) {
  const start = source.indexOf('// #region policy');
  const end = source.indexOf('// #endregion', start);
  if (start < 0 || end < 0) {
    fail(2, 'client.js no longer has a "#region policy" ... "#endregion" block, so the policy could not be extracted. This says nothing about whether it is correct.');
  } else {
    try {
      policy = new Function(`${source.slice(start, end)}\nreturn { peakState, offPeakReach, holidayLookup, HOLIDAY_TABLE, HOLIDAY_COVERAGE, LATEST_COVERED_YEAR, PEAK_WINDOWS, mdKey, hhmm };`)();
    } catch (error) {
      fail(1, `the extracted policy does not evaluate: ${error.message}`);
    }
  }
}

if (policy !== undefined) {
  const { peakState, holidayLookup, HOLIDAY_COVERAGE, LATEST_COVERED_YEAR } = policy;
  if (process.argv.includes('--dump')) {
    const start = source.indexOf('// #region policy');
    const end = source.indexOf('// #endregion', start);
    console.log(source.slice(start, end));
  }

  const beijing = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm);
  let failed = 0;
  let passed = 0;

  function check(label, actual, expected) {
    const ok = actual === expected;
    if (ok) passed += 1;
    else failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) console.log(`       expected: ${expected}\n       actual:   ${actual}`);
  }

  /**
   * `off | 0 今天 180 | rateOffPeak | weekend(6) + allDayOff` — one line, so a
   * diff is readable.
   *
   * The shape prints what the policy actually owns: the reason *keys*, the day
   * offset, the clock time and the gap in **minutes**. Sentences and 今天/明天
   * are the view's job (they change with the language), so asserting them here
   * would only be asserting the test's own copy.
   */
  const shape = (state) => {
    const when = state.next === undefined
      ? '—'
      : `${state.next.inDays} ${state.next.at} ${state.next.leftMinutes}min`;
    const why = state.reasonParams === undefined
      ? state.reason
      : `${state.reason}(${Object.values(state.reasonParams).join('/')})`;
    return `${state.status} | ${when} | ${state.discount ?? '—'} | ${why}${state.tail === undefined ? '' : ` + ${state.tail}`}`;
  };
  const at = (y, m, d, hh, mm) => shape(peakState(beijing(y, m, d, hh, mm)));

  console.log('--- the statutory holiday table ---');
  // 3 + 9 + 3 + 5 + 3 + 3 + 7 days. Ask through `holidayLookup`, the same door
  // the policy uses, so this cannot pass against a table the policy never reads.
  let holidayDays = 0;
  {
    const cursor = new Date(Date.UTC(2026, 0, 1));
    while (cursor.getUTCFullYear() === 2026) {
      if (holidayLookup(2026, cursor.getUTCMonth() + 1, cursor.getUTCDate()) !== undefined) holidayDays += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  check('2026 holiday days total 33', String(holidayDays), '33');
  const nameOn = (month, day) => {
    const found = holidayLookup(2026, month, day);
    return found === undefined ? undefined : found.name;
  };
  for (const [month, day, name] of [
    [1, 1, '元旦'], [1, 3, '元旦'], [2, 15, '春节'], [2, 23, '春节'],
    [4, 4, '清明节'], [5, 5, '劳动节'], [6, 21, '端午节'], [9, 27, '中秋节'],
    [10, 1, '国庆节'], [10, 7, '国庆节'],
  ]) {
    check(`${month}/${day} is ${name}`, nameOn(month, day), name);
  }
  for (const [month, day] of [[1, 4], [2, 14], [2, 28], [5, 9], [9, 20], [10, 10], [1, 31], [3, 1]]) {
    check(`${month}/${day} is not a holiday`, String(nameOn(month, day)), 'undefined');
  }
  check('coverage is derived from the table', HOLIDAY_COVERAGE.join(','), '2026');
  check('latest covered year', String(LATEST_COVERED_YEAR), '2026');

  console.log('\n--- peak / off-peak verdicts (Beijing wall clock) ---');
  const OFF = 'rateOffPeak';

  // ---------------------------------------------------------------------------
  // Timezone independence.
  //
  // DSH runs in whatever timezone the user's machine is set to, but every answer
  // here is about Beijing wall time. That holds because `peakState` shifts the
  // instant and then reads it through the **UTC** getters
  // (`new Date(nowMs + CHINA_UTC_OFFSET_MS).getUTCHours()`), never the local ones.
  // The values below are the ones a local-time refactor would break first, and each
  // is wrong in a different way.
  //
  // To check the whole file under another timezone, run it with `TZ` set — Node on
  // this platform reads `TZ`, so no code change is needed:
  //
  //   TZ=UTC                  node verify-policy.mjs
  //   TZ=America/New_York     node verify-policy.mjs
  //   TZ=Asia/Shanghai        node verify-policy.mjs
  //   TZ=Pacific/Kiritimati   node verify-policy.mjs
  //
  // All four pass as of this writing. Pinning `TZ` inside this file would be the
  // stronger check, but it has to happen before Node reads the zone and is not
  // portable to Windows, so the guard is this battery plus the note above.
  // ---------------------------------------------------------------------------
  console.log(`\n--- timezone independence (process TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}) ---`);
  check('10:00 Beijing is peak regardless of the process timezone', at(2026, 8, 19, 10, 0), 'peak | 0 12:00 120min | rateStandard | peakWorkday');
  check('20:00 Beijing is off-peak regardless of the process timezone', at(2026, 8, 19, 20, 0), `off | 1 09:00 780min | ${OFF} | workingDayOff`);
  check('the Beijing date is not the local date', peakState(beijing(2026, 8, 19, 1, 0)).dateText, '2026-08-19');
  check('01:00 Beijing is still 08-19 in Beijing', String(peakState(beijing(2026, 8, 19, 1, 0)).weekday), '3');
  check('23:00 Beijing keeps its own weekday, not the next one locally', String(peakState(beijing(2026, 8, 19, 23, 0)).weekday), '3');
  check('Wed 09:00 exactly — peak starts, inclusive', at(2026, 8, 19, 9, 0), 'peak | 0 12:00 180min | rateStandard | peakWorkday');
  check('Wed 10:00', at(2026, 8, 19, 10, 0), 'peak | 0 12:00 120min | rateStandard | peakWorkday');
  check('Wed 11:59', at(2026, 8, 19, 11, 59), 'peak | 0 12:00 1min | rateStandard | peakWorkday');
  check('Wed 12:00 exactly — peak ends, exclusive', at(2026, 8, 19, 12, 0), `off | 0 14:00 120min | ${OFF} | workingDayOff`);
  check('Wed 12:30 — noon break, next is TODAY 14:00', at(2026, 8, 19, 12, 30), `off | 0 14:00 90min | ${OFF} | workingDayOff`);
  check('Wed 13:59 — still the noon break', at(2026, 8, 19, 13, 59), `off | 0 14:00 1min | ${OFF} | workingDayOff`);
  check('Wed 14:00 exactly — peak resumes', at(2026, 8, 19, 14, 0), 'peak | 0 18:00 240min | rateStandard | peakWorkday');
  check('Wed 17:59', at(2026, 8, 19, 17, 59), 'peak | 0 18:00 1min | rateStandard | peakWorkday');
  check('Wed 18:00 exactly — peak ends, exclusive', at(2026, 8, 19, 18, 0), `off | 1 09:00 900min | ${OFF} | workingDayOff`);
  check('Wed 18:01', at(2026, 8, 19, 18, 1), `off | 1 09:00 899min | ${OFF} | workingDayOff`);

  // REGRESSION 2: the after-18:00 branch used to hardcode 明天 09:00 without
  // asking whether tomorrow is a working day.
  check('Fri 20:00 — next peak is MONDAY, not Saturday', at(2026, 8, 21, 20, 0), `off | 3 09:00 3660min | ${OFF} | workingDayOff`);
  check('Fri 18:30 — the whole weekend is ahead', at(2026, 8, 21, 18, 30), `off | 3 09:00 3750min | ${OFF} | workingDayOff`);
  check('Wed 2026-09-30 20:00 — 国庆 eve, next peak is after the holiday', at(2026, 9, 30, 20, 0), `off | 8 09:00 10860min | ${OFF} | workingDayOff`);

  console.log('\n--- weekends and holidays are off-peak all day ---');
  check('Sat 10:00', at(2026, 8, 22, 10, 0), `off | 2 09:00 2820min | ${OFF} | weekend(6) + allDayOff`);
  check('Sat 01:00 — midnight weekend edge', at(2026, 8, 22, 1, 0), `off | 2 09:00 3360min | ${OFF} | weekend(6) + allDayOff`);
  // Sunday 23:00 has no peak window of its own left, so the next one is Monday's
  // morning window — 10 hours away, not Monday's afternoon one.
  check('Sun 23:00 — the next peak is Monday MORNING, not Monday 14:00', at(2026, 8, 23, 23, 0), `off | 1 09:00 600min | ${OFF} | weekend(0) + allDayOff`);
  check('Thu 2026-10-01 10:00 — inside 国庆, a weekday', at(2026, 10, 1, 10, 0), `off | 7 09:00 10020min | ${OFF} | holiday(国庆节) + allDayOff`);
  // 春节 2026 runs 2/15-2/23, so the next peak after Friday 2/20 10:00 is Tuesday
  // 2/24 09:00 — four days, not "after the weekend". (2/28 is a make-up workday,
  // but no walk asserted here ever reaches it.)
  check('Fri 2026-02-20 10:00 — inside 春节, next peak clears the whole holiday', at(2026, 2, 20, 10, 0), `off | 4 09:00 5700min | ${OFF} | holiday(春节) + allDayOff`);

  console.log('\n--- the 调休 decision, stated out loud ---');
  // 2026-05-09 is a Saturday the notice marks as a make-up workday. The policy
  // follows the official literal rule, so it stays off-peak — but it must say so,
  // and it must say it *once*: asserting the key and the tail separately keeps a
  // failure attributable to the rule rather than to the wording.
  const makeup = peakState(beijing(2026, 5, 9, 10, 0));
  check('Sat 2026-05-09 (调休上班日) is OFF-PEAK', makeup.status, 'off');
  check('and explains itself with the 调休 reason', makeup.reason, 'makeup');
  check('carrying the weekday as a number', String(makeup.reasonParams.weekday), '6');
  check('and does not double up the closing note', String(makeup.tail), 'allDayOff');
  check('a normal Saturday uses the plain weekend reason', peakState(beijing(2026, 5, 16, 10, 0)).reason, 'weekend');

  console.log('\n--- seconds are snapped to the minute ---');
  // 09:00:30 used to print "3 小时" for a real 179.5 minutes.
  check('Wed 09:00:30', shape(peakState(beijing(2026, 8, 19, 9, 0) + 30000)), 'peak | 0 12:00 180min | rateStandard | peakWorkday');
  check('Wed 08:59:45 — off-peak, 15 s before the window', shape(peakState(beijing(2026, 8, 19, 9, 0) - 15000)), `off | 0 09:00 1min | ${OFF} | workingDayOff`);

  console.log('\n--- a year the table does not cover ---');
  const unknown = peakState(beijing(2027, 1, 6, 10, 0));
  check('Wed 2027-01-06 refuses to guess', unknown.status, 'unknown');
  check('it has no next-switch to offer', String(unknown.next), 'undefined');
  check('and names the limit as keys, not words', unknown.reason, 'tableExhausted');
  check('with both years as parameters', `${unknown.reasonParams.latest}/${unknown.reasonParams.year}`, '2026/2027');
  check('and an uncovered year cannot be walked into a peak', shape(peakState(beijing(2027, 1, 6, 10, 0))), 'unknown | — | — | tableExhausted(2026/2027)');

  // ---------------------------------------------------------------------------
  // The text region: the formatters and the language switch.
  //
  // The policy returns numbers and keys; every sentence a user reads is built
  // here. That makes this half just as worth testing as the arithmetic — and it
  // is testable for the same reason, because `#region text` touches no React and
  // no DOM. `localize` is handed a stub context so both languages can be driven.
  // ---------------------------------------------------------------------------
  console.log('\n--- the formatters and the language switch ---');
  {
    const textStart = source.indexOf('// #region text');
    const textEnd = source.indexOf('// #endregion', textStart);
    if (textStart < 0 || textEnd < 0) {
      fail(2, 'client.js no longer has a "#region text" ... "#endregion" block, so the formatters could not be extracted. This says nothing about whether they are correct.');
    } else {
      let view;
      try {
        view = new Function('stub', `${source.slice(textStart, textEnd)}\nreturn { text, i18n, localize, formatGap, dayOffsetLabel, reasonText, reasonSentence };`);
      } catch (error) {
        fail(1, `the extracted text region does not evaluate: ${error.message}`);
      }
      if (view !== undefined) {
        const stub = (active) => ({ get: () => ({ getLocale: () => ({ active }) }) });
        const load = (active) => {
          const api = view(stub(active));
          api.localize(stub(active));
          return api;
        };

        const zh = load('zh-CN');
        check('gap: 90 minutes', zh.formatGap(90), '1 小时 30 分钟');
        // Zero minutes are kept on purpose: the card prints a fixed set of rows,
        // and `3 小时` vs `3 小时 0 分钟` alternating between renders makes the row
        // jump. One shape per magnitude is easier to read than a shorter one.
        check('gap: 3 hours exactly keeps the minutes field', zh.formatGap(180), '3 小时 0 分钟');
        check('gap: under an hour', zh.formatGap(1), '1 分钟');
        // 94 h 19 min is the 国庆节 case the card used to wrap onto two lines:
        // days take over at 24 h, and the minutes drop once days are in play.
        check('gap: past a day switches to days', zh.formatGap(5659), '3 天 22 小时');
        check('gap: whole days keep the hours', zh.formatGap(5760), '4 天 0 小时');
        check('gap: 47 hours', zh.formatGap(2820), '1 天 23 小时');
        check('day offset: today', zh.dayOffsetLabel(0), '今天');
        check('day offset: tomorrow', zh.dayOffsetLabel(1), '明天');
        check('day offset: the day after', zh.dayOffsetLabel(2), '后天');
        check('day offset: three days out', zh.dayOffsetLabel(3), '3 天后');

        const en = load('en-US');
        check('gap in English', en.formatGap(90), '1 h 30 min');
        check('gap in English, exact hours', en.formatGap(180), '3 h 0 min');
        check('gap in English, past a day', en.formatGap(5659), '3 d 22 h');
        check('day offset in English', en.dayOffsetLabel(3), '3 days from now');

        // The sentences a user actually reads, in both languages.
        check('zh weekend sentence', zh.reasonSentence({ reason: 'weekend', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), '周六，全天按空闲时段计价。');
        check('en weekend sentence', en.reasonSentence({ reason: 'weekend', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), 'Saturday. Billed off-peak all day.');
        check('zh holiday sentence', zh.reasonSentence({ reason: 'holiday', reasonParams: { name: '春节' }, tail: 'allDayOff' }), '法定节假日：春节，全天按空闲时段计价。');
        check('en holiday sentence', en.reasonSentence({ reason: 'holiday', reasonParams: { name: '春节' }, tail: 'allDayOff' }), 'Statutory holiday: 春节. Billed off-peak all day.');
        check('zh 调休 sentence says the rule out loud', zh.reasonSentence({ reason: 'makeup', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), '调休上班日，但官方规则按周几算，周末一律空闲（周六），全天按空闲时段计价。');
        check('en 调休 sentence', en.reasonSentence({ reason: 'makeup', reasonParams: { weekday: 6 }, tail: 'allDayOff' }), 'A 调休 make-up workday, but the official rule counts the weekday, and weekends stay off-peak (Saturday). Billed off-peak all day.');
        check('working-day off-peak is one clause, not two', zh.reasonSentence({ reason: 'workingDayOff' }), '工作日非高峰时段，当前按空闲时段计价。');
        check('the exhausted-table sentence fills both years', zh.reasonSentence({ reason: 'tableExhausted', reasonParams: { latest: 2026, year: 2027 } }), '节日表只到 2026 年，2027 年的法定节假日无从判断。');
        check('no English string is missing a sentence', en.reasonSentence({ reason: 'peakWorkday' }), 'Peak window on a working day, currently billed at the standard rate.');

        // The trap that started all of this: the restore path used to be a
        // hand-copied literal that had drifted, leaving English on screen after
        // switching back to Chinese.
        check('switching en -> zh restores Chinese', (() => {
          const api = load('en-US');
          const english = api.reasonText({ reason: 'weekend', reasonParams: { weekday: 0 }, tail: 'allDayOff' });
          api.localize(stub('zh-CN'));
          const chinese = api.reasonSentence({ reason: 'weekend', reasonParams: { weekday: 0 }, tail: 'allDayOff' });
          return `${english} -> ${chinese}`;
        })(), 'Sunday -> 周日，全天按空闲时段计价。');

        // An unknown reason must not print `undefined` into the card.
        check('an unknown reason key falls back rather than printing undefined', zh.reasonText({ reason: 'notAReason' }), 'notAReason');

        // ---------------------------------------------------------------------
        // The seam between the two regions.
        //
        // Everything above tests the regions the way they are shipped: two
        // independent slices of client.js. That is also their blind spot. The
        // policy hands the text region `{ name: ... }`; if the policy renames
        // that key, or a template typos `{name}`, `fill` deliberately leaves the
        // placeholder visible — and every assertion above still passes, because
        // each side is fed by hand.
        //
        // So evaluate both slices in ONE function body and drive the card end to
        // end: peakState(...) -> reasonSentence(...). These are the only
        // assertions here that can fail on a mismatch *between* the regions.
        // ---------------------------------------------------------------------
        console.log('\n--- the policy and the text region, wired together ---');
        const policyStart = source.indexOf('// #region policy');
        const policyEnd = source.indexOf('// #endregion', policyStart);
        let whole;
        try {
          whole = new Function('stub', `${source.slice(policyStart, policyEnd)}\n${source.slice(textStart, textEnd)}\nreturn { peakState, reasonSentence, reasonText, localize };`);
        } catch (error) {
          fail(1, `the two regions do not evaluate together: ${error.message}`);
        }
        if (whole !== undefined) {
          const loadWhole = (active) => {
            const api = whole(stub(active));
            api.localize(stub(active));
            return api;
          };
          // The card builds its sentence from THIS pairing, not from hand-written
          // params, so a renamed reasonParams key can no longer hide.
          const say = (active) => (y, m, d, hh, mm) => {
            const api = loadWhole(active);
            return api.reasonSentence(api.peakState(beijing(y, m, d, hh, mm)));
          };
          const sayZh = say('zh-CN');
          const sayEn = say('en-US');

          check('end to end: a plain weekend', sayZh(2026, 8, 22, 10, 0), '周六，全天按空闲时段计价。');
          check('end to end: the same instant in English', sayEn(2026, 8, 22, 10, 0), 'Saturday. Billed off-peak all day.');
          check('end to end: a holiday carries its own name into the sentence', sayZh(2026, 2, 17, 10, 0), '法定节假日：春节，全天按空闲时段计价。');
          check('end to end: 调休 says the rule out loud', sayZh(2026, 5, 9, 10, 0), '调休上班日，但官方规则按周几算，周末一律空闲（周六），全天按空闲时段计价。');
          check('end to end: a peak window', sayZh(2026, 8, 19, 9, 30), '工作日高峰时段，当前按标准价计价。');
          check('end to end: an uncovered year fills both years', sayZh(2027, 1, 6, 10, 0), '节日表只到 2026 年，2027 年的法定节假日无从判断。');
          check('end to end: no placeholder is ever left unfilled', (() => {
            // A sweep over every reason the policy can produce: if a template and
            // its reasonParams ever disagree, `{...}` shows up here.
            const api = loadWhole('zh-CN');
            const leaked = [
              [2026, 8, 19, 9, 30], [2026, 8, 19, 12, 30], [2026, 8, 19, 20, 0],
              [2026, 8, 22, 10, 0], [2026, 5, 9, 10, 0], [2026, 2, 17, 10, 0],
              [2026, 10, 1, 10, 0], [2027, 1, 6, 10, 0],
            ]
              .map(([y, m, d, hh, mm]) => api.reasonSentence(api.peakState(beijing(y, m, d, hh, mm))))
              .filter((sentence) => /\{\w+\}/.test(sentence));
            return leaked.length === 0 ? 'no placeholders' : leaked.join(' | ');
          })(), 'no placeholders');

          // `dateText`, the weekday number and the schedule line are printed by
          // no other assertion in this file, so a broken date formatter or a
          // drifted window list would sail through everything above.
          const sample = loadWhole('zh-CN').peakState(beijing(2026, 8, 22, 10, 0));
          check('dateText is a bare ISO date for the Beijing day', sample.dateText, '2026-08-22');
          check('the weekday travels as a number', String(sample.weekday), '6');
          check('the schedule line lists both peak windows', sample.schedule, '09:00–12:00 · 14:00–18:00');
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The 调休 decision, but out where it costs something.
  //
  // The case above asks one make-up Saturday what it is. This one asks whether
  // the *walk* agrees: it starts on Friday evening and must step over the make-up
  // Saturday 5/9 (and the Sunday) to reach Monday 09:00. A walk that counted 调休
  // as a working day would answer "1 09:00 780min" — Saturday's own morning
  // window — and that is exactly the bug this case exists to catch.
  // ---------------------------------------------------------------------------
  console.log('\n--- a walk that has to cross a make-up workday ---');
  check('Fri 2026-05-08 20:00 walks to Monday, not to 调休 Saturday', at(2026, 5, 8, 20, 0), `off | 3 09:00 3660min | ${OFF} | workingDayOff`);

  console.log(`\n${passed} passed, ${failed} failed`);
  // A floor, not just `failed > 0`: a section that stops running entirely would
  // otherwise print "0 passed, 0 failed" and exit 0 — the loudest possible
  // silence. Raise it when cases are added; lowering it is the one edit that can
  // quietly disarm this tripwire, so do that only on purpose.
  const FLOOR = 92;
  if (passed < FLOOR && failed === 0) {
    console.error(`only ${passed} cases ran, below the expected floor of ${FLOOR} — a section has stopped running.`);
    process.exitCode = 1;
  }
  if (failed > 0) process.exitCode = 1;
}
