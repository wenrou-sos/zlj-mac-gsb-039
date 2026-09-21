/* ============================================================
 * 数据层：露天矿边坡监测模拟数据
 * - 采场边坡 / 排土场边坡 地形参数
 * - GNSS 测点 + 雷达虚拟测点定义
 * - 30 天 × 24 小时 逐小时位移数据（水平/垂直/速率）
 * - 安全等级判定、报警事件检测、逐小时数据上报模拟
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 安全等级配置 ---------------- */
  var STATUS = [
    { key: 'safe',  label: '安全', color: '#22c55e', min: 0,  max: 2 },
    { key: 'warn',  label: '预警', color: '#eab308', min: 2,  max: 5 },
    { key: 'alert', label: '警示', color: '#f97316', min: 5,  max: 10 },
    { key: 'alarm', label: '报警', color: '#ef4444', min: 10, max: Infinity }
  ];

  function statusOf(rate) {
    for (var i = 0; i < STATUS.length; i++) {
      if (rate >= STATUS[i].min && rate < STATUS[i].max) return STATUS[i];
    }
    return STATUS[STATUS.length - 1];
  }

  /* ---------------- 地形参数 ---------------- */
  var CONFIG = {
    mineName: '云岭露天矿',
    hours: 720,                 // 30 天逐小时
    tickMs: 3000,               // 演示模式：3 秒 = 1 小时
    pit:  { cx: -140, cz: -60, radius: 250, benchH: 12, benchW: 24, maxDepth: 132 },
    dump: { cx: 230, cz: 150, radius: 170, benchH: 10, benchW: 26, maxH: 60 }
  };

  /* 地形高度函数（采场台阶式凹陷 + 排土场台阶式堆体） */
  function terrainHeight(x, z) {
    var h = 1.6 * Math.sin(x * 0.011) * Math.cos(z * 0.013)
          + 0.9 * Math.sin(x * 0.031 + 1.7) * Math.sin(z * 0.027);
    var p = CONFIG.pit, d = CONFIG.dump;
    var dp = Math.hypot(x - p.cx, z - p.cz);
    if (dp < p.radius) {
      var lvl = Math.floor((p.radius - dp) / p.benchW);
      h -= Math.min(lvl * p.benchH, p.maxDepth);
    }
    var dd = Math.hypot(x - d.cx, z - d.cz);
    if (dd < d.radius) {
      var ld = Math.floor((d.radius - dd) / d.benchW);
      h += Math.min(ld * d.benchH, d.maxH);
    }
    return h;
  }

  /* ---------------- 确定性伪随机 ---------------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(20260920);

  /* ---------------- 测点布设 ---------------- */
  // kind: normal(平稳) / accel(加速蠕变) / spike(曾超限后回落)
  var POINTS = [];

  function pitPos(azDeg, lvl) {
    var az = azDeg * Math.PI / 180;
    var r = CONFIG.pit.radius - (lvl + 0.5) * CONFIG.pit.benchW;
    var x = CONFIG.pit.cx + r * Math.cos(az);
    var z = CONFIG.pit.cz + r * Math.sin(az);
    return { x: x, z: z, y: terrainHeight(x, z) };
  }
  function dumpPos(azDeg, lvl) {
    var az = azDeg * Math.PI / 180;
    var r = CONFIG.dump.radius - (lvl + 0.5) * CONFIG.dump.benchW;
    var x = CONFIG.dump.cx + r * Math.cos(az);
    var z = CONFIG.dump.cz + r * Math.sin(az);
    return { x: x, z: z, y: terrainHeight(x, z) };
  }

  // [编号, 方位角°, 台阶 level, 当前基准速率 mm/d, kind]
  var PIT_GNSS = [
    ['P01',  45, 3, 1.1, 'normal'],
    ['P02',  70, 3, 2.8, 'normal'],
    ['P03', 100, 3, 0.8, 'normal'],
    ['P04',  55, 5, 6.8, 'spike'],
    ['P05',  85, 5, 3.6, 'normal'],
    ['P06', 120, 5, 1.5, 'normal'],
    ['P07',  40, 7, 0.9, 'normal'],
    ['P08',  75, 7, 11.5, 'accel'],   // 重点危险点：加速蠕变
    ['P09', 110, 7, 1.9, 'normal'],
    ['P10',  90, 9, 0.6, 'normal']
  ];
  var PIT_RADAR = [
    ['R01',  62, 4, 1.4, 'normal'],
    ['R02',  80, 4, 4.1, 'normal'],
    ['R03',  95, 6, 0.9, 'normal'],
    ['R04', 112, 6, 2.3, 'normal']
  ];
  var DUMP_GNSS = [
    ['D01', 200, 1, 1.2, 'normal'],
    ['D02', 235, 2, 0.7, 'normal'],
    ['D03', 265, 3, 6.2, 'normal'],
    ['D04', 295, 3, 1.6, 'normal'],
    ['D05', 325, 4, 3.1, 'normal'],
    ['D06', 250, 5, 0.5, 'normal']
  ];

  function makePoint(id, name, area, type, pos, lvl, baseRate, kind) {
    return {
      id: id, name: name, area: area, type: type,
      x: pos.x, y: pos.y, z: pos.z, lvl: lvl,
      baseRate: baseRate, kind: kind,
      alpha: (15 + rng() * 30) * Math.PI / 180, // 垂直分量占比
      phase1: rng() * Math.PI * 2,
      phase2: rng() * Math.PI * 2,
      drift: 0.9 + rng() * 0.2,
      uptime: 0.985 + rng() * 0.015,
      dh0: 10 + rng() * 60,
      dv0: 5 + rng() * 30,
      series: [],          // {t, rate, dh, dv}
      cur: null            // 当前状态缓存
    };
  }

  PIT_GNSS.forEach(function (d) {
    POINTS.push(makePoint(d[0], '采场-' + d[0], '采场边坡', 'GNSS',
      pitPos(d[1], d[2]), d[2], d[3], d[4]));
  });
  PIT_RADAR.forEach(function (d) {
    POINTS.push(makePoint(d[0], '雷达-' + d[0], '采场边坡', '雷达',
      pitPos(d[1], d[2]), d[2], d[3], d[4]));
  });
  DUMP_GNSS.forEach(function (d) {
    POINTS.push(makePoint(d[0], '排土场-' + d[0], '排土场边坡', 'GNSS',
      dumpPos(d[1], d[2]), d[2], d[3], d[4]));
  });

  /* ---------------- 速率模型（mm/d，逐小时采样） ---------------- */
  function rateAt(p, tHour) {
    var r;
    if (p.kind === 'accel') {
      // 加速蠕变：由 ~3 mm/d 指数型加速至 ~12 mm/d
      r = 3.0 + 9.0 / (1 + Math.exp(-(tHour + 150) / 60));
      r += 0.4 * Math.sin(tHour * 0.26 + p.phase1);
      r += (rngNoise(p, tHour) - 0.5) * 0.8;
    } else {
      var trend = p.drift + (1 - p.drift) * 2 * (tHour + 720) / 720; // 缓慢漂移
      r = p.baseRate * trend
        * (1 + 0.22 * Math.sin(2 * Math.PI * tHour / 24 + p.phase1)
             + 0.18 * Math.sin(2 * Math.PI * tHour / 216 + p.phase2));
      r += (rngNoise(p, tHour) - 0.5) * 0.6;
      if (p.kind === 'spike') {
        // 约 17 天前出现一次短时超限（已回落）
        var g = (tHour + 400) / 26;
        r += 3.6 * Math.exp(-g * g);
      }
    }
    return Math.max(0.05, r);
  }
  // 可复现的逐点逐时噪声
  function rngNoise(p, tHour) {
    var s = Math.sin(tHour * 127.1 + p.id.charCodeAt(0) * 311.7 + p.id.charCodeAt(1) * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /* ---------------- 数据序列生成 ---------------- */
  var simHour = 0;        // 相对小时数（0 = 当前）
  var simTime = 0;        // 当前模拟时间戳 ms

  function roundToHour(ms) { return Math.floor(ms / 3600000) * 3600000; }

  function appendHour(p) {
    var t = simTime + simHour * 3600000;
    var rate = rateAt(p, simHour);
    var last = p.series[p.series.length - 1];
    var jit = 0.85 + rngNoise(p, simHour * 7 + 3) * 0.3;
    var dh = last.dh + rate / 24 * Math.cos(p.alpha) * jit;
    var dv = last.dv + rate / 24 * Math.sin(p.alpha) * jit;
    p.series.push({ t: t, rate: rate, dh: dh, dv: dv });
    if (p.series.length > CONFIG.hours) p.series.shift();
    var n = p.series.length;
    var smooth = (p.series[n - 1].rate + (p.series[n - 2] || p.series[n - 1]).rate +
                  (p.series[n - 3] || p.series[n - 1]).rate) / 3;
    p.cur = {
      rate: smooth, dh: dh, dv: dv, tot: Math.hypot(dh, dv),
      status: statusOf(smooth), time: t
    };
  }

  function buildSeries() {
    simTime = roundToHour(Date.now());
    POINTS.forEach(function (p) {
      p.series = [{
        t: simTime - CONFIG.hours * 3600000,
        rate: p.baseRate, dh: p.dh0, dv: p.dv0
      }];
      for (var h = -CONFIG.hours + 1; h <= 0; h++) {
        simHour = h;
        appendHour(p);
      }
    });
    simHour = 0;
  }

  /* ---------------- 报警事件 ---------------- */
  var ALARMS = [];

  function levelIndex(rate) {
    var s = statusOf(rate);
    for (var i = 0; i < STATUS.length; i++) if (STATUS[i].key === s.key) return i;
    return 0;
  }

  // 进入更高等级（且高于前 6 小时最高等级）时记一次事件，防止抖动刷屏
  function detectAlarms(p, fromIdx) {
    var s = p.series;
    for (var i = Math.max(1, fromIdx); i < s.length; i++) {
      var lv = levelIndex(s[i].rate);
      if (lv === 0) continue;
      var prevMax = 0;
      for (var j = Math.max(0, i - 6); j < i; j++) prevMax = Math.max(prevMax, levelIndex(s[j].rate));
      if (lv > prevMax) {
        ALARMS.push({ t: s[i].t, pointId: p.id, name: p.name, area: p.area, level: STATUS[lv], rate: s[i].rate });
      }
    }
    ALARMS.sort(function (a, b) { return b.t - a.t; });
    if (ALARMS.length > 200) ALARMS.length = 200;
  }

  function detectAllAlarms() {
    ALARMS.length = 0;   // 原地清空，保持导出引用有效
    POINTS.forEach(function (p) { detectAlarms(p, 1); });
  }

  /* ---------------- 逐小时上报（演示推进） ---------------- */
  function tick() {
    simHour++;
    POINTS.forEach(function (p) {
      var before = p.series.length;
      appendHour(p);
      detectAlarms(p, before - 1);
    });
    return simTime + simHour * 3600000;
  }

  function currentDataTime() { return simTime + simHour * 3600000; }

  /* ---------------- 统计 ---------------- */
  function stats() {
    var c = { safe: 0, warn: 0, alert: 0, alarm: 0 };
    POINTS.forEach(function (p) { c[p.cur.status.key]++; });
    return c;
  }

  function worstPoint() {
    var w = POINTS[0];
    POINTS.forEach(function (p) { if (p.cur.rate > w.cur.rate) w = p; });
    return w;
  }

  function getPoint(id) {
    for (var i = 0; i < POINTS.length; i++) if (POINTS[i].id === id) return POINTS[i];
    return null;
  }

  /* ---------------- 导出 ---------------- */
  global.MineData = {
    CONFIG: CONFIG, STATUS: STATUS, POINTS: POINTS, ALARMS: ALARMS,
    statusOf: statusOf, terrainHeight: terrainHeight,
    buildSeries: buildSeries, detectAllAlarms: detectAllAlarms,
    tick: tick, currentDataTime: currentDataTime,
    stats: stats, worstPoint: worstPoint, getPoint: getPoint
  };
})(typeof window !== 'undefined' ? window : globalThis);
