/* ============================================================
 * app.js — 面板交互：3D 场景 / 监测点列表 / 位移曲线 / 周报
 * ============================================================ */
(function () {
  'use strict';
  const SMD = window.SMD;
  const $ = function (id) { return document.getElementById(id); };

  /* ================= 页头：时钟 + 状态统计 ================= */
  function tickClock() { $('clock').textContent = SMD.fmtFull(Date.now()); }
  setInterval(tickClock, 1000); tickClock();
  $('last-update').textContent = '最近数据 ' + SMD.fmtTime(SMD.END) + ' · 每小时整点上报';

  (function renderChips() {
    const cnt = [0, 0, 0, 0];
    SMD.points.forEach(function (p) { cnt[p.levelIdx]++; });
    $('chips').innerHTML = SMD.LEVELS.map(function (lv, i) {
      return '<span class="chip" style="--c:' + lv.color + '"><i></i>' + lv.label + ' <b>' + cnt[i] + '</b></span>';
    }).join('');
  })();

  /* ================= 图例 ================= */
  (function renderLegend() {
    let html = '<div class="lg-row">' + SMD.LEVELS.map(function (lv) {
      return '<span class="lg-item"><i style="background:' + lv.color + '"></i>' + lv.label + ' ' + lv.desc + '</span>';
    }).join('') + '</div>';
    html += '<div class="lg-row mut"><span class="lg-item"><i class="mk circle"></i>GNSS 监测点</span>' +
            '<span class="lg-item"><i class="mk diamond"></i>雷达监测站</span>' +
            '<span class="lg-item"><i class="mk fan"></i>雷达扫描范围</span></div>';
    $('legend').innerHTML = html;
  })();

  /* ================= 3D 场景 ================= */
  let scene = null, rotating = true;

  function buildScene() {
    scene = echarts.init($('scene3d'));

    // 地形网格
    const MIN = -110, MAX = 110, STEP = 1.6;
    const surf = [];
    for (let x = MIN; x <= MAX; x += STEP)
      for (let y = MIN; y <= MAX; y += STEP)
        surf.push([x, y, SMD.terrainZ(x, y)]);

    // 监测点
    const gnssData = [], radarData = [];
    SMD.points.forEach(function (p) {
      const item = {
        name: p.id, value: [p.x, p.y, p.z],
        itemStyle: { color: p.level.color, opacity: 0.95, borderColor: 'rgba(255,255,255,.7)', borderWidth: 0.6 }
      };
      (p.type === 'radar' ? radarData : gnssData).push(item);
    });

    // 雷达扫描射线（指向采场北坡）
    const rd = SMD.byId['RD-01'];
    const fan = [-24, -12, 0, 12, 24].map(function (az) {
      const t = SMD.pitPos(az + 0, 3);
      return {
        type: 'line3D', name: '雷达扫描', silent: true,
        data: [[rd.x, rd.y, rd.z], [t.x, t.y, t.z]],
        lineStyle: { color: 'rgba(34,211,238,.65)', width: 2.5 }
      };
    });

    const axisStyle = {
      axisLine: { lineStyle: { color: '#3b4f6b' } },
      axisTick: { show: false },
      axisLabel: { color: '#7d93ad', fontSize: 9 },
      splitLine: { lineStyle: { color: 'rgba(71,85,105,.22)' } },
      axisPointer: { show: false }
    };

    scene.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: 'rgba(10,17,30,.94)', borderColor: '#2b3f5c',
        textStyle: { color: '#dbe6f3', fontSize: 12 },
        formatter: function (pr) {
          const p = SMD.byId[pr.data && pr.data.name];
          if (!p) return '';
          return '<b style="color:' + p.level.color + '">● ' + p.id + '</b>　' + p.desc +
                 '<br>当前速率：<b>' + p.curRate.toFixed(1) + ' mm/d</b>（' + p.level.label + '）' +
                 '<br>累计水平位移：' + p.cumH.toFixed(1) + ' mm' +
                 '<br>累计垂直位移：' + p.cumV.toFixed(1) + ' mm' +
                 '<br><span style="color:#7d93ad">点击查看 30 天位移曲线</span>';
        }
      },
      visualMap: {
        show: false, seriesIndex: 0, dimension: 2, min: -45, max: 32,
        inRange: { color: ['#33291f', '#4a3826', '#63492c', '#7d5c34', '#97703d', '#a8854a', '#8f9a63'] }
      },
      xAxis3D: Object.assign({ name: '东西/m', type: 'value', min: MIN, max: MAX }, axisStyle),
      yAxis3D: Object.assign({ name: '南北/m', type: 'value', min: MIN, max: MAX }, axisStyle),
      zAxis3D: Object.assign({ name: '高程/m', type: 'value', min: -50, max: 42 }, axisStyle),
      grid3D: {
        boxWidth: 215, boxDepth: 215, boxHeight: 105, top: '4%',
        light: { main: { intensity: 1.25, alpha: 35, beta: -25 }, ambient: { intensity: 0.45 } },
        viewControl: {
          projection: 'perspective', autoRotate: true, autoRotateSpeed: 5,
          distance: 265, alpha: 24, beta: 32, minAlpha: 5, maxAlpha: 85, minDistance: 90, maxDistance: 520
        }
      },
      series: [
        { type: 'surface', name: '地形', data: surf, shading: 'lambert', silent: true, itemStyle: { opacity: 0.97 } },
        {
          type: 'scatter3D', name: 'GNSS监测点', symbol: 'circle', symbolSize: 12, data: gnssData,
          label: {
            show: true, formatter: function (pr) { return pr.data.name; }, position: 'top', distance: 1.2,
            textStyle: { fontSize: 10, color: '#e6eefb', backgroundColor: 'rgba(10,17,30,.6)', padding: [1, 4], borderRadius: 3 }
          },
          emphasis: { label: { textStyle: { fontSize: 13, fontWeight: 'bold' } } }
        },
        {
          type: 'scatter3D', name: '雷达监测站', symbol: 'diamond', symbolSize: 17, data: radarData,
          label: {
            show: true, formatter: function (pr) { return pr.data.name; }, position: 'bottom', distance: 1.2,
            textStyle: { fontSize: 10, color: '#7de9fc', backgroundColor: 'rgba(10,17,30,.6)', padding: [1, 4], borderRadius: 3 }
          }
        }
      ].concat(fan)
    });

    scene.on('click', function (pr) {
      if (pr.seriesName === 'GNSS监测点' || pr.seriesName === '雷达监测站') openModal(pr.data.name);
    });
  }

  $('btn-rotate').addEventListener('click', function () {
    rotating = !rotating;
    scene.setOption({ grid3D: { viewControl: { autoRotate: rotating } } });
    this.textContent = rotating ? '⏸ 暂停旋转' : '▶ 自动旋转';
  });

  /* ================= 监测点列表 ================= */
  function renderList() {
    const groups = [
      ['pit', '采场边坡 · GNSS'], ['dump', '排土场边坡 · GNSS'], ['radar', '雷达边坡监测系统']
    ];
    $('point-list').innerHTML = groups.map(function (g) {
      const pts = SMD.points.filter(function (p) { return p.area === g[0]; })
        .sort(function (a, b) { return b.levelIdx - a.levelIdx || b.curRate - a.curRate; });
      return '<div class="grp"><div class="grp-t">' + g[1] + '<span>' + pts.length + ' 点</span></div>' +
        pts.map(function (p) {
          return '<div class="pt" data-id="' + p.id + '">' +
            '<i class="dot" style="background:' + p.level.color + ';box-shadow:0 0 8px ' + p.level.color + '"></i>' +
            '<div class="pt-m"><b>' + p.id + '</b><em>' + p.desc + '</em></div>' +
            '<div class="pt-v"><b style="color:' + p.level.color + '">' + p.curRate.toFixed(1) + '</b><em>mm/d</em></div>' +
            '<div class="pt-c"><b>' + p.cumH.toFixed(0) + '</b><em>累计mm</em></div></div>';
        }).join('') + '</div>';
    }).join('');

    Array.prototype.forEach.call(document.querySelectorAll('#point-list .pt'), function (el) {
      el.addEventListener('click', function () { openModal(el.getAttribute('data-id')); });
    });
  }

  /* ================= 报警事件列表 ================= */
  function renderAlarms() {
    const list = SMD.alarms.slice(0, 10);
    $('alarm-list').innerHTML = list.length ? list.map(function (a) {
      return '<div class="al" data-id="' + a.id + '">' +
        '<i class="dot" style="background:' + a.level.color + '"></i>' +
        '<div class="al-m"><b>' + a.id + ' <span style="color:' + a.level.color + '">' + a.level.label + '</span></b>' +
        '<em>' + SMD.fmtTime(a.t) + ' · 速率达 ' + a.rate.toFixed(1) + ' mm/d</em></div></div>';
    }).join('') : '<div class="mut" style="padding:8px">近 7 天无报警事件</div>';

    Array.prototype.forEach.call(document.querySelectorAll('#alarm-list .al'), function (el) {
      el.addEventListener('click', function () { openModal(el.getAttribute('data-id')); });
    });
  }

  /* ================= 监测点详情弹窗 ================= */
  let modalChart = null, curPoint = null;

  function buildPointOption(p) {
    const T = SMD.TIMES, s = p.series;
    const hData = [], vData = [], rData = [];
    for (let i = 0; i < SMD.N; i++) {
      hData.push([T[i], +s.h[i].toFixed(2)]);
      vData.push([T[i], +s.v[i].toFixed(2)]);
      rData.push([T[i], +s.rate[i].toFixed(2)]);
    }
    const axisCommon = {
      axisLine: { lineStyle: { color: '#3b4f6b' } },
      axisLabel: { color: '#7d93ad', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(71,85,105,.2)' } }
    };
    return {
      backgroundColor: 'transparent',
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#64748b' } },
      tooltip: {
        trigger: 'axis', backgroundColor: 'rgba(10,17,30,.94)', borderColor: '#2b3f5c',
        textStyle: { color: '#dbe6f3', fontSize: 12 },
        valueFormatter: function (v) { return v == null ? '-' : (+v).toFixed(1); }
      },
      legend: {
        data: ['水平位移', '垂直位移', '位移速率'], top: 0,
        textStyle: { color: '#9fb3cc', fontSize: 11 }, itemWidth: 14, itemHeight: 8
      },
      grid: [
        { left: 62, right: 24, top: 34, height: '30%' },
        { left: 62, right: 24, top: '50%', height: '33%' }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1] },
        { type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 16,
          borderColor: '#2b3f5c', backgroundColor: 'rgba(15,25,42,.6)',
          fillerColor: 'rgba(34,211,238,.15)', textStyle: { color: '#7d93ad', fontSize: 9 } }
      ],
      xAxis: [
        { type: 'time', gridIndex: 0, axisLabel: { show: false }, axisLine: axisCommon.axisLine, splitLine: { show: false } },
        { type: 'time', gridIndex: 1, axisLabel: axisCommon.axisLabel, axisLine: axisCommon.axisLine, splitLine: { show: false } }
      ],
      yAxis: [
        Object.assign({ type: 'value', name: '累计位移 (mm)', gridIndex: 0, scale: true,
          nameTextStyle: { color: '#7d93ad', fontSize: 10 } }, axisCommon),
        Object.assign({ type: 'value', name: '速率 (mm/d)', gridIndex: 1, min: 0,
          nameTextStyle: { color: '#7d93ad', fontSize: 10 } }, axisCommon)
      ],
      visualMap: {
        show: false, seriesIndex: 2, dimension: 1,
        pieces: [
          { lt: 2, color: '#22c55e' }, { gte: 2, lt: 5, color: '#eab308' },
          { gte: 5, lt: 10, color: '#f97316' }, { gte: 10, color: '#ef4444' }
        ]
      },
      series: [
        { name: '水平位移', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: hData,
          showSymbol: false, lineStyle: { width: 1.6, color: '#38bdf8' }, itemStyle: { color: '#38bdf8' } },
        { name: '垂直位移', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: vData,
          showSymbol: false, lineStyle: { width: 1.6, color: '#a78bfa' }, itemStyle: { color: '#a78bfa' } },
        {
          name: '位移速率', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: rData,
          showSymbol: false, lineStyle: { width: 1.6 },
          markLine: {
            symbol: 'none', animation: false,
            data: [
              { yAxis: 2,  lineStyle: { color: '#eab308', type: 'dashed' }, label: { formatter: '预警 2',  color: '#eab308', fontSize: 10, position: 'insideEndTop' } },
              { yAxis: 5,  lineStyle: { color: '#f97316', type: 'dashed' }, label: { formatter: '警示 5',  color: '#f97316', fontSize: 10, position: 'insideEndTop' } },
              { yAxis: 10, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: '报警 10', color: '#ef4444', fontSize: 10, position: 'insideEndTop' } }
            ]
          }
        }
      ]
    };
  }

  function openModal(id) {
    const p = SMD.byId[id]; if (!p) return;
    curPoint = p;
    $('m-id').textContent = p.id + (p.type === 'radar' ? '（雷达）' : '（GNSS）');
    $('m-desc').textContent = p.desc;
    const b = $('m-badge');
    b.textContent = p.level.label + ' ' + p.curRate.toFixed(1) + ' mm/d';
    b.style.background = p.level.color;

    const stats = [
      ['当前速率', p.curRate.toFixed(1) + ' mm/d', p.level.color],
      ['30天累计水平位移', p.cumH.toFixed(1) + ' mm', '#38bdf8'],
      ['30天累计垂直位移', p.cumV.toFixed(1) + ' mm', '#a78bfa'],
      ['近7天最大速率', p.weekMaxRate.toFixed(1) + ' mm/d', SMD.levelOf(p.weekMaxRate).color],
      ['30天最大速率', p.maxRate30.toFixed(1) + ' mm/d', SMD.levelOf(p.maxRate30).color],
      ['数据完整率', p.completeness.toFixed(1) + ' %', '#7d93ad']
    ];
    $('m-stats').innerHTML = stats.map(function (s) {
      return '<div class="stat"><em>' + s[0] + '</em><b style="color:' + s[2] + '">' + s[1] + '</b></div>';
    }).join('');

    $('modal').classList.add('show');
    if (!modalChart) modalChart = echarts.init($('modal-chart'));
    modalChart.setOption(buildPointOption(p), true);
    setTimeout(function () { modalChart.resize(); }, 60);
  }
  function closeModal() { $('modal').classList.remove('show'); }

  $('m-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  $('m-csv').addEventListener('click', function () {
    if (!curPoint) return;
    const p = curPoint, s = p.series;
    let csv = 'time,horizontal_mm,vertical_mm,rate_mm_per_day\n';
    for (let i = 0; i < SMD.N; i++) {
      csv += SMD.fmtFull(SMD.TIMES[i]) + ',' + s.h[i].toFixed(2) + ',' + s.v[i].toFixed(2) + ',' + s.rate[i].toFixed(2) + '\n';
    }
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), p.id + '_近30天逐小时数据.csv');
  });

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  }

  /* ================= 周报自动生成 ================= */
  function tagHtml(lv) {
    return '<span class="tag" style="background:' + lv.color + '">' + lv.label + '</span>';
  }
  function arrow(up) { return up ? '<span style="color:#ef4444">↑</span>' : '<span style="color:#22c55e">↓</span>'; }

  function areaTable(area, title) {
    const pts = SMD.points.filter(function (p) { return p.area === area; })
      .sort(function (a, b) { return b.weekMaxRate - a.weekMaxRate; });
    let rows = pts.map(function (p) {
      const d = p.weekCumH - p.prevCumH;
      return '<tr><td><b>' + p.id + '</b></td><td>' + p.desc + '</td>' +
        '<td>' + p.weekMaxRate.toFixed(1) + '</td>' +
        '<td>' + p.weekCumH.toFixed(1) + ' / ' + p.weekCumV.toFixed(1) + '</td>' +
        '<td>' + (d >= 0 ? '+' : '') + d.toFixed(1) + ' mm ' + (d > 0.5 ? arrow(true) : d < -0.5 ? arrow(false) : '—') + '</td>' +
        '<td>' + p.trend + '</td><td>' + tagHtml(p.weekLevel) + '</td></tr>';
    }).join('');
    return '<h2>' + title + '</h2><table class="rt"><thead><tr>' +
      '<th>点号</th><th>位置</th><th>本周最大速率<br>(mm/d)</th><th>本周位移增量<br>水平/垂直 (mm)</th>' +
      '<th>环比上周</th><th>趋势</th><th>本周最高等级</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function buildReport() {
    const w0 = SMD.weekStart, w1 = SMD.END;
    const period = SMD.fmtDate(w0) + ' 至 ' + SMD.fmtDate(w1);
    $('report-period').textContent = '（报告期：' + period + '，每小时数据 × ' + SMD.points.length + ' 点）';

    // 等级统计（按本周最高等级）
    const byLevel = [[], [], [], []];
    SMD.points.forEach(function (p) { byLevel[SMD.levelIdx(p.weekMaxRate)].push(p); });

    // 超阈值"点·时"统计
    const hours = [0, 0, 0];
    SMD.points.forEach(function (p) {
      const s = p.series;
      for (let i = SMD.N - 168; i < SMD.N; i++) {
        if (s.rate[i] >= 10) hours[2]++;
        else if (s.rate[i] >= 5) hours[1]++;
        else if (s.rate[i] >= 2) hours[0]++;
      }
    });

    const avgComp = SMD.points.reduce(function (s, p) { return s + p.completeness; }, 0) / SMD.points.length;

    // 结论与建议
    const concl = [];
    if (byLevel[3].length) {
      concl.push('<b style="color:#ef4444">红色报警：</b>' +
        byLevel[3].map(function (p) { return p.id + '（' + p.desc + '，本周最大 ' + p.weekMaxRate.toFixed(1) + ' mm/d）'; }).join('、') +
        ' 位移速率超过 10 mm/d，边坡处于加速变形阶段，存在滑坡风险。建议：① 立即停止报警区域及坡脚一切作业，撤离人员与设备；' +
        '② 启动边坡灾害应急预案，划定警戒区并设专人值守；③ 监测频次加密至 10 min/次，雷达连续跟踪扫描；' +
        '④ 组织专家现场踏勘论证，必要时实施削坡减载或压脚工程。');
    }
    if (byLevel[2].length) {
      concl.push('<b style="color:#f97316">橙色警示：</b>' +
        byLevel[2].map(function (p) { return p.id; }).join('、') +
        ' 速率达 5~10 mm/d。建议加强巡查（每日不少于 2 次），控制坡顶堆载与爆破振动，分析变形诱因并复核边坡稳定性。');
    }
    if (byLevel[1].length) {
      concl.push('<b style="color:#eab308">黄色预警：</b>' +
        byLevel[1].map(function (p) { return p.id; }).join('、') +
        ' 速率达 2~5 mm/d，建议密切关注变形发展，保持常规巡查与监测频次。');
    }
    if (!byLevel[3].length && !byLevel[2].length && !byLevel[1].length) {
      concl.push('<b style="color:#22c55e">全部监测点处于绿色安全等级</b>，本期边坡整体稳定，建议保持现有监测频次与巡查制度。');
    }
    concl.push('其余各点位移速率均小于 2 mm/d，变形平稳。');

    const alarmRows = SMD.alarms.slice(0, 12).map(function (a) {
      return '<tr><td>' + SMD.fmtTime(a.t) + '</td><td>' + a.id + '</td><td>' + a.desc + '</td><td>' +
        tagHtml(a.level) + '</td><td>' + a.rate.toFixed(1) + '</td></tr>';
    }).join('');

    $('report-body').innerHTML =
      '<h1>露天矿边坡安全监测周报</h1>' +
      '<div class="r-meta">报告期：' + period + '　|　编制：边坡安全监测系统（自动生成）　|　生成时间：' + SMD.fmtFull(Date.now()) + '</div>' +

      '<h2>一、总体情况</h2>' +
      '<p>本期在册监测点 <b>' + SMD.points.length + '</b> 个（采场边坡 GNSS 10 点、排土场边坡 GNSS 6 点、雷达边坡监测系统 1 套），' +
      '数据上报周期 1 小时，平均数据完整率 <b>' + avgComp.toFixed(1) + '%</b>。' +
      '按本周最大位移速率统计：' +
      byLevel.map(function (arr, i) {
        return '<span class="tag" style="background:' + SMD.LEVELS[i].color + '">' + SMD.LEVELS[i].label + ' ' + arr.length + '</span>';
      }).join('　') + '。</p>' +
      '<p>超阈值累计：黄色预警 <b>' + hours[0] + '</b> 点·时，橙色警示 <b>' + hours[1] + '</b> 点·时，红色报警 <b>' + hours[2] + '</b> 点·时；' +
      '等级跃升事件 <b>' + SMD.alarms.length + '</b> 起。</p>' +

      areaTable('pit', '二、采场边坡监测情况') +
      areaTable('dump', '三、排土场边坡监测情况') +
      areaTable('radar', '四、雷达边坡监测系统') +

      '<h2>五、报警事件记录（近 7 天）</h2>' +
      (SMD.alarms.length
        ? '<table class="rt"><thead><tr><th>时间</th><th>点号</th><th>位置</th><th>等级</th><th>速率 (mm/d)</th></tr></thead><tbody>' +
          alarmRows + '</tbody></table>'
        : '<p>本期无报警事件。</p>') +

      '<h2>六、结论与建议</h2><ol class="concl">' +
      concl.map(function (c) { return '<li>' + c + '</li>'; }).join('') + '</ol>' +
      '<div class="r-foot">附：位移速率阈值 —— 绿色安全 &lt;2 mm/d；黄色预警 2~5 mm/d；橙色警示 5~10 mm/d；红色报警 &gt;10 mm/d。' +
      '本报告由监测系统依据逐小时观测数据自动生成。</div>';
  }

  $('btn-regen').addEventListener('click', buildReport);
  $('btn-print').addEventListener('click', function () { window.print(); });
  $('btn-dl').addEventListener('click', function () {
    const css = 'body{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#1e293b;max-width:960px;margin:24px auto;padding:0 18px;line-height:1.6}' +
      'h1{font-size:22px;text-align:center}h2{font-size:16px;margin:22px 0 8px;border-left:4px solid #0284c7;padding-left:8px}' +
      'table{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0}td,th{border:1px solid #cbd5e1;padding:5px 8px;text-align:left}' +
      'th{background:#f1f5f9}.tag{padding:1px 8px;border-radius:9px;color:#fff;font-size:11.5px;white-space:nowrap}' +
      '.r-meta{color:#64748b;font-size:12.5px;text-align:center;margin-bottom:8px}.r-foot{margin-top:18px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;padding-top:8px}' +
      '.concl li{margin:6px 0}';
    const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>边坡监测周报</title><style>' + css + '</style></head><body>' +
      $('report-body').innerHTML + '</body></html>';
    download(new Blob([html], { type: 'text/html;charset=utf-8' }),
      '边坡监测周报_' + SMD.fmtDate(SMD.END).replace(/-/g, '') + '.html');
  });

  /* ================= 启动 ================= */
  buildScene();
  renderList();
  renderAlarms();
  buildReport();

  // 支持 #point=GP-03 直达点位详情
  const m = /[#&]point=([A-Za-z0-9-]+)/.exec(location.hash || '');
  if (m && SMD.byId[m[1]]) openModal(m[1]);

  window.addEventListener('resize', function () {
    if (scene) scene.resize();
    if (modalChart && $('modal').classList.contains('show')) modalChart.resize();
  });
})();
