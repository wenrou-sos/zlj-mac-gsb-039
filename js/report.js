/* ============================================================
 * 周报模块：自动生成每周边坡监测报告
 * - 周窗口位移统计 / 报警事件汇总 / 自动结论与建议
 * - 纸面样式渲染，支持打印与 HTML 下载
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.MineData;
  var REPORTS = [];            // 已生成报告缓存
  var currentReport = null;
  var reportChart = null;

  /* 报告纸张样式（页面内与下载文件共用） */
  var REPORT_CSS = [
    '.report-paper{background:#fff;color:#1e293b;padding:40px 44px;font-size:13px;line-height:1.7;',
    '  font-family:"Microsoft YaHei","PingFang SC",sans-serif;}',
    '.report-paper h1{font-size:22px;text-align:center;margin:0 0 6px;color:#0f172a;letter-spacing:2px;}',
    '.report-paper .rp-sub{text-align:center;color:#64748b;font-size:12px;margin-bottom:4px;}',
    '.report-paper .rp-meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px 16px;',
    '  border-top:2px solid #0f172a;border-bottom:1px solid #cbd5e1;padding:8px 2px;margin:10px 0 18px;font-size:12px;color:#334155;}',
    '.report-paper h2{font-size:15px;color:#0f172a;border-left:4px solid #2563eb;padding-left:8px;margin:22px 0 10px;}',
    '.report-paper p{margin:6px 0;text-indent:2em;}',
    '.report-paper table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11.5px;}',
    '.report-paper th,.report-paper td{border:1px solid #cbd5e1;padding:5px 6px;text-align:center;}',
    '.report-paper th{background:#f1f5f9;color:#0f172a;font-weight:600;}',
    '.report-paper .tag{display:inline-block;padding:1px 8px;border-radius:8px;color:#fff;font-size:11px;}',
    '.report-paper .rp-note{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px 14px;margin:8px 0;}',
    '.report-paper ol{margin:6px 0 6px 1.2em;padding:0;}',
    '.report-paper ol li{margin:5px 0;}',
    '.report-paper .rp-footer{margin-top:28px;padding-top:10px;border-top:1px solid #cbd5e1;',
    '  display:flex;justify-content:space-between;color:#475569;font-size:12px;}',
    '.report-paper .rp-chart{width:100%;height:260px;margin:6px 0;}',
    '.report-paper .rp-chart img{width:100%;}'
  ].join('\n');

  function injectCSS() {
    var st = document.createElement('style');
    st.textContent = REPORT_CSS;
    document.head.appendChild(st);
  }

  /* ---------------- 工具 ---------------- */
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDate(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtDT(t) {
    var d = new Date(t);
    return fmtDate(t) + ' ' + pad2(d.getHours()) + ':00';
  }
  function isoWeek(t) {
    var d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    var week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  /* ---------------- 周统计 ---------------- */
  function weekRows(endT) {
    var startT = endT - 7 * 24 * 3600000;
    var rows = [];
    D.POINTS.forEach(function (p) {
      var win = p.series.filter(function (r) { return r.t > startT && r.t <= endT; });
      if (win.length < 2) return;
      var first = win[0], last = win[win.length - 1];
      var maxRate = 0, sum = 0, half = Math.floor(win.length / 2);
      var sum1 = 0, sum2 = 0;
      win.forEach(function (r, i) {
        maxRate = Math.max(maxRate, r.rate);
        sum += r.rate;
        if (i < half) sum1 += r.rate; else sum2 += r.rate;
      });
      rows.push({
        p: p,
        ddh: last.dh - first.dh,
        ddv: last.dv - first.dv,
        dtot: Math.hypot(last.dh, last.dv) - Math.hypot(first.dh, first.dv),
        endTot: Math.hypot(last.dh, last.dv),
        maxRate: maxRate,
        avgRate: sum / win.length,
        trend: (sum2 / Math.max(win.length - half, 1)) - (sum1 / Math.max(half, 1)),
        status: D.statusOf(last.rate),
        n: win.length
      });
    });
    return { rows: rows, startT: startT, endT: endT };
  }

  /* ---------------- 结论与建议自动生成 ---------------- */
  function buildConclusions(rows, alarms) {
    var list = [];
    function names(rs) { return rs.map(function (r) { return r.p.name; }).join('、'); }
    var reds = rows.filter(function (r) { return r.maxRate >= 10; });
    var oranges = rows.filter(function (r) { return r.maxRate >= 5 && r.maxRate < 10; });
    var yellows = rows.filter(function (r) { return r.maxRate >= 2 && r.maxRate < 5; });
    var accel = rows.filter(function (r) { return r.trend > 1.0; });

    if (reds.length) {
      list.push({
        lv: 'alarm',
        text: names(reds) + ' 本周最大位移速率达 ' +
          Math.max.apply(null, reds.map(function (r) { return r.maxRate; })).toFixed(1) +
          ' mm/d，已超过 10 mm/d 报警阈值，坡体处于加速变形阶段，存在滑坡风险。建议立即停止受影响台阶下方全部作业，撤离人员与设备，启动边坡滑坡应急预案，监测频次加密至 10 分钟级，并组织专家现场查勘，必要时实施削坡减载或加固工程。'
      });
    }
    if (oranges.length) {
      list.push({
        lv: 'alert',
        text: names(oranges) + ' 位移速率处于 5~10 mm/d 警示区间，变形持续发展。建议对上述测点所在台阶实施每日巡查，限制坡脚开挖与重型设备作业，复核台阶坡面角与排土参数，做好截排水设施检查。'
      });
    }
    if (yellows.length) {
      list.push({
        lv: 'warn',
        text: names(yellows) + ' 处于 2~5 mm/d 预警区间，建议保持现有监测频次，关注速率变化趋势，雨后及时复查。'
      });
    }
    if (accel.length) {
      list.push({
        lv: 'alert',
        text: names(accel) + ' 本周速率呈加速趋势（后半周均值明显高于前半周），符合蠕变加速特征，需重点跟踪，若持续加速应按红色报警流程处置。'
      });
    }
    if (!reds.length && !oranges.length && !yellows.length) {
      list.push({ lv: 'safe', text: '本周全部测点位移速率均小于 2 mm/d，采场边坡与排土场边坡整体处于稳定状态，可按常规频次（1 次/小时）继续监测。' });
    }
    var alarmCnt = alarms.filter(function (a) { return a.level.key === 'alarm'; }).length;
    list.push({
      lv: 'safe',
      text: '本周 GNSS 监测系统与雷达边坡监测系统运行正常，数据完整率约 ' +
        (D.POINTS.reduce(function (a, p) { return a + p.uptime; }, 0) / D.POINTS.length * 100).toFixed(1) +
        '%；共触发预警及以上事件 ' + alarms.length + ' 次（其中报警 ' + alarmCnt + ' 次），均已记录并推送。'
    });
    list.push({
      lv: 'warn',
      text: '当前处于汛期尾期，降雨可能诱发坡体位移加速，建议雨后对采场高陡边坡及排土场坡脚及时巡查，保持截排水沟畅通。'
    });
    return list;
  }

  /* ---------------- 报告生成 ---------------- */
  function generate(endT) {
    var ws = weekRows(endT);
    var alarms = D.ALARMS.filter(function (a) { return a.t > ws.startT && a.t <= ws.endT; });
    var year = new Date(endT).getFullYear();
    var wk = isoWeek(endT);
    var st = { safe: 0, warn: 0, alert: 0, alarm: 0 };
    ws.rows.forEach(function (r) { st[r.status.key]++; });
    var report = {
      no: 'YL-' + year + '-W' + pad2(wk),
      weekLabel: year + '年第' + wk + '周',
      startT: ws.startT, endT: ws.endT,
      genTime: Date.now(),
      rows: ws.rows,
      alarms: alarms,
      stats: st,
      conclusions: buildConclusions(ws.rows, alarms)
    };
    // 缓存（按报告编号去重）
    for (var i = 0; i < REPORTS.length; i++) {
      if (REPORTS[i].no === report.no) { REPORTS[i] = report; return report; }
    }
    REPORTS.unshift(report);
    REPORTS.sort(function (a, b) { return b.endT - a.endT; });
    return report;
  }

  /* 启动时自动生成最近 4 周报告 */
  function autoGenerate() {
    var now = D.currentDataTime();
    for (var k = 0; k < 4; k++) generate(now - k * 7 * 24 * 3600000);
    return REPORTS[0];
  }

  /* ---------------- HTML 渲染 ---------------- */
  var LV_COLOR = { safe: '#22c55e', warn: '#eab308', alert: '#f97316', alarm: '#ef4444' };

  function tag(status) {
    return '<span class="tag" style="background:' + status.color + '">' + status.label + '</span>';
  }

  function reportHTML(r) {
    var h = '';
    h += '<h1>' + D.CONFIG.mineName + '边坡安全监测周报</h1>';
    h += '<div class="rp-sub">（GNSS 位移监测 · 雷达边坡监测 联合系统 · 自动生成）</div>';
    h += '<div class="rp-meta"><span>报告编号：' + r.no + '</span><span>报告期：' + r.weekLabel +
      '（' + fmtDate(r.startT) + ' ~ ' + fmtDate(r.endT) + '）</span><span>生成时间：' + fmtDT(r.genTime) + '</span></div>';

    // 一、监测概况
    h += '<h2>一、监测概况</h2>';
    h += '<p>本报告期内在运行监测点共 ' + r.rows.length + ' 个，其中采场边坡 ' +
      r.rows.filter(function (x) { return x.p.area === '采场边坡'; }).length +
      ' 个（含雷达虚拟测点 ' + r.rows.filter(function (x) { return x.p.type === '雷达'; }).length +
      ' 个）、排土场边坡 ' + r.rows.filter(function (x) { return x.p.area === '排土场边坡'; }).length +
      ' 个。数据上报频次为 1 次/小时，监测要素包括水平位移、垂直位移与位移速率。</p>';
    h += '<p>报告期末安全等级分布：<b style="color:#16a34a">安全 ' + r.stats.safe + ' 个</b>、' +
      '<b style="color:#ca8a04">预警 ' + r.stats.warn + ' 个</b>、' +
      '<b style="color:#ea580c">警示 ' + r.stats.alert + ' 个</b>、' +
      '<b style="color:#dc2626">报警 ' + r.stats.alarm + ' 个</b>。</p>';

    // 二、位移监测成果
    h += '<h2>二、位移监测成果统计</h2>';
    h += '<table><thead><tr><th>测点</th><th>监测区</th><th>类型</th>' +
      '<th>周水平位移<br>(mm)</th><th>周垂直位移<br>(mm)</th><th>周合位移<br>(mm)</th>' +
      '<th>期末累计<br>(mm)</th><th>周均速率<br>(mm/d)</th><th>周最大速率<br>(mm/d)</th><th>状态</th></tr></thead><tbody>';
    var sorted = r.rows.slice().sort(function (a, b) { return b.maxRate - a.maxRate; });
    sorted.forEach(function (w) {
      h += '<tr><td>' + w.p.name + '</td><td>' + w.p.area + '</td><td>' + w.p.type + '</td>' +
        '<td>' + w.ddh.toFixed(1) + '</td><td>' + w.ddv.toFixed(1) + '</td>' +
        '<td>' + w.dtot.toFixed(1) + '</td><td>' + w.endTot.toFixed(1) + '</td>' +
        '<td>' + w.avgRate.toFixed(2) + '</td>' +
        '<td' + (w.maxRate >= 10 ? ' style="color:#dc2626;font-weight:700"' : w.maxRate >= 5 ? ' style="color:#ea580c;font-weight:700"' : '') +
        '>' + w.maxRate.toFixed(2) + '</td><td>' + tag(w.status) + '</td></tr>';
    });
    h += '</tbody></table>';

    // 三、重点测点分析
    var top = sorted[0];
    h += '<h2>三、重点测点分析</h2>';
    h += '<p>本周位移速率最大的测点为 <b>' + top.p.name + '</b>（' + top.p.area + '，' + top.p.type +
      '），周最大速率 ' + top.maxRate.toFixed(2) + ' mm/d，周均速率 ' + top.avgRate.toFixed(2) +
      ' mm/d，周合位移增量 ' + top.dtot.toFixed(1) + ' mm，30 天累计合位移 ' + top.endTot.toFixed(1) +
      ' mm，变形趋势判定为「' + (top.trend > 1 ? '加速发展' : top.trend > 0.2 ? '缓慢发展' : '基本平稳') + '」。其本周速率-时间曲线如下：</p>';
    h += '<div class="rp-chart" id="reportChart"></div>';

    // 四、报警事件
    h += '<h2>四、报警事件统计</h2>';
    if (r.alarms.length) {
      h += '<table><thead><tr><th>时间</th><th>测点</th><th>监测区</th><th>级别</th><th>触发速率(mm/d)</th></tr></thead><tbody>';
      r.alarms.slice(0, 20).forEach(function (a) {
        h += '<tr><td>' + fmtDT(a.t) + '</td><td>' + a.name + '</td><td>' + a.area + '</td>' +
          '<td>' + tag(a.level) + '</td><td>' + a.rate.toFixed(2) + '</td></tr>';
      });
      h += '</tbody></table>';
      if (r.alarms.length > 20) h += '<p style="text-indent:0;color:#64748b">注：仅列出最近 20 条，本周共 ' + r.alarms.length + ' 条。</p>';
    } else {
      h += '<p>本周未发生预警及以上级别事件。</p>';
    }

    // 五、结论与建议
    h += '<h2>五、结论与建议</h2><ol>';
    r.conclusions.forEach(function (c) {
      h += '<li><b style="color:' + LV_COLOR[c.lv] + '">●</b> ' + c.text + '</li>';
    });
    h += '</ol>';

    h += '<div class="rp-footer"><span>编制：边坡安全监测自动化系统</span><span>审核：__________</span><span>批准：__________</span></div>';
    return h;
  }

  /* ---------------- 展示 / 打印 / 下载 ---------------- */
  function show(report) {
    currentReport = report;
    document.getElementById('reportPaper').innerHTML = reportHTML(report);
    document.getElementById('reportModal').classList.add('open');
    setTimeout(function () {
      var el = document.getElementById('reportChart');
      if (!el) return;
      if (reportChart) { reportChart.dispose(); reportChart = null; }
      reportChart = echarts.init(el);
      var top = report.rows.slice().sort(function (a, b) { return b.maxRate - a.maxRate; })[0];
      var data = top.p.series
        .filter(function (r) { return r.t > report.startT && r.t <= report.endT; })
        .map(function (r) { return [r.t, +r.rate.toFixed(2)]; });
      reportChart.setOption({
        backgroundColor: '#fff',
        grid: { left: 50, right: 16, top: 30, bottom: 24 },
        title: { text: top.p.name + ' 本周位移速率曲线', left: 6, top: 2,
          textStyle: { fontSize: 12, color: '#334155' } },
        tooltip: { trigger: 'axis', valueFormatter: function (v) { return v + ' mm/d'; } },
        xAxis: { type: 'time', axisLabel: { fontSize: 10, color: '#64748b' } },
        yAxis: { type: 'value', name: 'mm/d', nameTextStyle: { fontSize: 10, color: '#64748b' },
          axisLabel: { fontSize: 10, color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
        series: [{
          type: 'line', data: data, symbol: 'none', smooth: 0.2,
          lineStyle: { color: '#2563eb', width: 1.8 }, itemStyle: { color: '#2563eb' },
          markLine: { symbol: 'none', data: [
            { yAxis: 2, lineStyle: { color: '#eab308', type: 'dashed' }, label: { formatter: '预警2', fontSize: 9, color: '#a16207' } },
            { yAxis: 5, lineStyle: { color: '#f97316', type: 'dashed' }, label: { formatter: '警示5', fontSize: 9, color: '#c2410c' } },
            { yAxis: 10, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: '报警10', fontSize: 9, color: '#b91c1c' } }
          ] }
        }]
      });
      reportChart.resize();
    }, 30);
  }

  function close() {
    document.getElementById('reportModal').classList.remove('open');
  }

  function print() {
    window.print();
  }

  function download() {
    if (!currentReport) return;
    var html = document.getElementById('reportPaper').innerHTML;
    // 图表转图片嵌入
    if (reportChart) {
      var img = reportChart.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' });
      html = html.replace(/<div class="rp-chart" id="reportChart"><\/div>/,
        '<div class="rp-chart"><img src="' + img + '"/></div>');
      // echarts 渲染后的 div 内容不为空，做通用替换
      html = html.replace(/<div class="rp-chart" id="reportChart"[^>]*>[\s\S]*?<\/div>\s*(?=<h2>四)/,
        '<div class="rp-chart"><img src="' + img + '"/></div>');
    }
    var doc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' +
      currentReport.no + ' 边坡监测周报</title><style>' + REPORT_CSS +
      '\nbody{background:#e2e8f0;margin:0;padding:24px;}.report-paper{max-width:900px;margin:0 auto;box-shadow:0 2px 12px rgba(0,0,0,.15);}</style></head><body><div class="report-paper">' +
      html + '</div></body></html>';
    var blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = D.CONFIG.mineName + '_边坡监测周报_' + currentReport.no + '.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function list() { return REPORTS; }

  global.MineReport = {
    injectCSS: injectCSS,
    generate: generate,
    autoGenerate: autoGenerate,
    show: show, close: close, print: print, download: download,
    list: list,
    current: function () { return currentReport; }
  };
})(window);
