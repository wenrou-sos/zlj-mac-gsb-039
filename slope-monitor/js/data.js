/* ============================================================
 * data.js — 露天矿边坡监测数据模型
 * 模拟 16 个 GNSS 监测点 + 1 套雷达边坡监测系统，
 * 每小时上报一次：水平位移(累计,mm)、垂直位移(累计,mm)、位移速率(mm/d)
 * 数据窗口：最近 30 天（720 条/点），随机种子固定，刷新结果一致。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 随机数（定长种子，保证可复现） ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------- 时间轴：最近 30 天，逐小时 ---------- */
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const N = 30 * 24;                                   // 720 个整点
  const END = Math.floor(Date.now() / HOUR) * HOUR;    // 最近一个整点
  const START = END - (N - 1) * HOUR;
  const TIMES = [];
  for (let i = 0; i < N; i++) TIMES.push(START + i * HOUR);

  /* ---------- 地形模型：采场(下凹台阶) + 排土场(上凸台阶) ---------- */
  const PIT  = { cx: -38, cy: -22, R: 48, depth: 42, bench: 6 };  // 采场：7 个台阶
  const DUMP = { cx:  58, cy:  48, R: 38, height: 30, bench: 6 }; // 排土场：5 个台阶
  const DATUM = 1420;                                            // 地表基准高程(m)

  function pitDepth(x, y) {
    const r = Math.hypot(x - PIT.cx, y - PIT.cy);
    if (r >= PIT.R) return 0;
    const d = PIT.depth * (1 - r / PIT.R);
    return PIT.bench * Math.floor(d / PIT.bench);
  }
  function dumpHeight(x, y) {
    const r = Math.hypot(x - DUMP.cx, y - DUMP.cy);
    if (r >= DUMP.R) return 0;
    const h = DUMP.height * (1 - r / DUMP.R);
    return DUMP.bench * Math.floor(h / DUMP.bench);
  }
  function terrainZ(x, y) {
    return dumpHeight(x, y) - pitDepth(x, y) + 1.1 * Math.sin(x / 26) * Math.cos(y / 31);
  }
  // 坡面某台阶方位上的布点（az: 0=北 90=东；bench: 0=最上台阶）
  function pitPos(azDeg, bench) {
    const rad = azDeg * Math.PI / 180;
    const r = PIT.R * (1 - (bench + 0.5) * PIT.bench / PIT.depth);
    const x = PIT.cx + r * Math.sin(rad), y = PIT.cy + r * Math.cos(rad);
    return { x: x, y: y, z: terrainZ(x, y) + 0.7 };
  }
  function dumpPos(azDeg, bench) {
    const rad = azDeg * Math.PI / 180;
    const r = DUMP.R * (1 - (bench + 0.5) * DUMP.bench / DUMP.height);
    const x = DUMP.cx + r * Math.sin(rad), y = DUMP.cy + r * Math.cos(rad);
    return { x: x, y: y, z: terrainZ(x, y) + 0.7 };
  }
  function windName(az) {
    const names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return names[Math.round(az / 45) % 8];
  }

  /* ---------- 安全等级 ---------- */
  const LEVELS = [
    { key: 'safe',  label: '安全', color: '#22c55e', desc: '<2 mm/d'   },
    { key: 'warn',  label: '预警', color: '#eab308', desc: '2~5 mm/d'  },
    { key: 'alert', label: '警示', color: '#f97316', desc: '5~10 mm/d' },
    { key: 'alarm', label: '报警', color: '#ef4444', desc: '>10 mm/d'  }
  ];
  function levelIdx(rate) { return rate < 2 ? 0 : rate < 5 ? 1 : rate < 10 ? 2 : 3; }
  function levelOf(rate)  { return LEVELS[levelIdx(rate)]; }

  /* ---------- 监测点定义（base: 基准速率 mm/d） ---------- */
  const DEFS = [
    // 采场边坡 GNSS
    { id: 'GP-01', area: 'pit', az:  40, bench: 1, base: 0.8 },
    { id: 'GP-02', area: 'pit', az:  75, bench: 3, base: 1.4 },
    { id: 'GP-03', area: 'pit', az: 355, bench: 2, base: 1.2, accel: { t0: 27 * 24, target: 12.5 } }, // 北坡临滑加速
    { id: 'GP-04', area: 'pit', az:  25, bench: 4, base: 1.1 },
    { id: 'GP-05', area: 'pit', az: 120, bench: 3, base: 3.1 },
    { id: 'GP-06', area: 'pit', az: 160, bench: 2, base: 0.6 },
    { id: 'GP-07', area: 'pit', az: 200, bench: 4, base: 6.4 },
    { id: 'GP-08', area: 'pit', az: 245, bench: 2, base: 1.6 },
    { id: 'GP-09', area: 'pit', az: 300, bench: 3, base: 2.6 },
    { id: 'GP-10', area: 'pit', az: 185, bench: 5, base: 0.9 },
    // 排土场边坡 GNSS
    { id: 'GD-01', area: 'dump', az:  20, bench: 1, base: 1.2 },
    { id: 'GD-02', area: 'dump', az:  70, bench: 2, base: 0, rise: { a: 3.6, k: 0.0028 } }, // 缓慢抬升，月末越限
    { id: 'GD-03', area: 'dump', az: 130, bench: 3, base: 0.7 },
    { id: 'GD-04', area: 'dump', az: 190, bench: 2, base: 2.9 },
    { id: 'GD-05', area: 'dump', az: 250, bench: 1, base: 1.0 },
    { id: 'GD-06', area: 'dump', az: 320, bench: 4, base: 0.5 }
  ];

  /* ---------- 逐点生成 30 天逐小时序列 ---------- */
  function genSeries(def, rng) {
    const rate = new Array(N), h = new Array(N), v = new Array(N);
    const phase = rng() * Math.PI * 2;
    const kv = 0.25 + rng() * 0.3;                 // 垂直/水平耦合系数
    let ch = 0;
    for (let i = 0; i < N; i++) {
      let b = def.base;
      if (def.rise) b = def.rise.a + def.rise.k * i;
      if (def.accel && i >= def.accel.t0) {        // 临滑加速段（指数）
        const g = Math.log(def.accel.target / def.base) / (N - 1 - def.accel.t0);
        b = Math.min(16, def.base * Math.exp(g * (i - def.accel.t0)));
      }
      const diurnal = 1 + 0.18 * Math.sin(2 * Math.PI * (i % 24) / 24 + phase); // 日照温度效应
      let r = b * diurnal + (rng() - 0.5) * 0.5 * Math.max(0.6, b * 0.25);
      r = Math.max(0.05, r);
      rate[i] = r;
      ch += r / 24 + (rng() - 0.5) * 0.05;
      ch = Math.max(0, ch);
      h[i] = ch;
      v[i] = -kv * ch + (rng() - 0.5) * 0.4;       // 垂直以沉降为主(负)
    }
    return { rate: rate, h: h, v: v };
  }

  const points = [];
  DEFS.forEach(function (def) {
    const rng = mulberry32(hashStr(def.id));
    const pos = def.area === 'pit' ? pitPos(def.az, def.bench) : dumpPos(def.az, def.bench);
    const areaName = def.area === 'pit' ? '采场' : '排土场';
    points.push({
      id: def.id, type: 'gnss', area: def.area,
      x: pos.x, y: pos.y, z: pos.z,
      desc: areaName + windName(def.az) + '坡 ' + Math.round(DATUM + pos.z) + 'm 平台',
      series: genSeries(def, rng),
      completeness: 98.5 + rng() * 1.4             // 数据完整率 %
    });
  });

  /* ---------- 雷达边坡监测系统（面监测，与 GP-03 所在北坡变形相关） ---------- */
  (function () {
    const rng = mulberry32(hashStr('RD-01'));
    const gp03 = points.filter(function (p) { return p.id === 'GP-03'; })[0].series;
    const rx = PIT.cx, ry = PIT.cy - PIT.R - 22;   // 采场南侧，对北坡扫描
    const rate = new Array(N), h = new Array(N), v = new Array(N);
    let ch = 0;
    for (let i = 0; i < N; i++) {
      const r = Math.max(0.05, 0.5 * gp03.rate[i] + 0.9 + (rng() - 0.5) * 0.5);
      rate[i] = r;
      ch += r / 24 + (rng() - 0.5) * 0.04;
      h[i] = ch;
      v[i] = -0.35 * ch + (rng() - 0.5) * 0.3;
    }
    points.push({
      id: 'RD-01', type: 'radar', area: 'radar',
      x: rx, y: ry, z: terrainZ(rx, ry) + 1.5,
      desc: '采场北坡 · 雷达面监测（区域平均变形）',
      series: { rate: rate, h: h, v: v },
      completeness: 99.6
    });
  })();

  /* ---------- 统计：当前状态 / 本周 / 上周 ---------- */
  const W = 7 * 24;                                // 一周 168 小时
  const iE = N - 1, iW = N - W, iP = N - 2 * W;    // 周末/周初/上周初下标

  function mean(arr, a, b) { let s = 0; for (let i = a; i <= b; i++) s += arr[i]; return s / (b - a + 1); }
  function max(arr, a, b)  { let m = -1e9; for (let i = a; i <= b; i++) if (arr[i] > m) m = arr[i]; return m; }

  points.forEach(function (p) {
    const s = p.series;
    p.curRate = s.rate[iE];
    p.cumH = s.h[iE];
    p.cumV = s.v[iE];
    p.level = levelOf(p.curRate);
    p.levelIdx = levelIdx(p.curRate);
    // 本周
    p.weekMaxRate = max(s.rate, iW, iE);
    p.weekMeanRate = mean(s.rate, iW, iE);
    p.weekCumH = s.h[iE] - s.h[iW];
    p.weekCumV = s.v[iE] - s.v[iW];
    p.weekLevel = levelOf(p.weekMaxRate);
    // 上周（环比）
    p.prevCumH = s.h[iW] - s.h[iP];
    p.prevMeanRate = mean(s.rate, iP, iW - 1);
    const ratio = p.weekMeanRate / Math.max(0.05, p.prevMeanRate);
    p.trend = ratio > 1.25 ? '上升' : ratio < 0.8 ? '下降' : '平稳';
    p.trendUp = ratio > 1.25;
    // 30 天
    p.maxRate30 = max(s.rate, 0, iE);
  });

  /* ---------- 报警事件：近 7 天等级跃升记录 ---------- */
  const alarms = [];
  points.forEach(function (p) {
    const s = p.series;
    for (let i = iW + 1; i <= iE; i++) {
      const li = levelIdx(s.rate[i]), lp = levelIdx(s.rate[i - 1]);
      if (li > lp) alarms.push({ t: TIMES[i], id: p.id, desc: p.desc, level: LEVELS[li], rate: s.rate[i] });
    }
  });
  alarms.sort(function (a, b) { return b.t - a.t; });

  /* ---------- 格式化 ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtTime(ts) { const d = new Date(ts); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':00'; }
  function fmtFull(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
           pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  const SMD = {
    N: N, TIMES: TIMES, START: START, END: END, DAY: DAY,
    PIT: PIT, DUMP: DUMP, DATUM: DATUM,
    terrainZ: terrainZ, pitPos: pitPos, dumpPos: dumpPos,
    LEVELS: LEVELS, levelOf: levelOf, levelIdx: levelIdx,
    points: points, alarms: alarms,
    weekStart: TIMES[iW],
    fmtDate: fmtDate, fmtTime: fmtTime, fmtFull: fmtFull,
    byId: {}
  };
  points.forEach(function (p) { SMD.byId[p.id] = p; });

  if (typeof window !== 'undefined') window.SMD = SMD;
  if (typeof module !== 'undefined') module.exports = SMD;
})();
