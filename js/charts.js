/* ============================================================
 * 图表模块：测点近 30 天位移-时间曲线（含报警阈值线）
 * 依赖: echarts (全局), MineData
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.MineData;
  var chartDisp = null, chartRate = null;
  var openPointId = null;

  var AXIS_STYLE = {
    axisLine: { lineStyle: { color: '#334155' } },
    axisLabel: { color: '#94a3b8', fontSize: 11 },
    splitLine: { lineStyle: { color: 'rgba(51,65,85,0.4)' } }
  };

  function fmtTime(t) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':00';
  }

  /* ---------- 位移-时间曲线（含速率阈值参考斜线） ---------- */
  function dispOption(p) {
    var s = p.series;
    var dh = [], dv = [], tot = [];
    s.forEach(function (r) {
      dh.push([r.t, +r.dh.toFixed(2)]);
      dv.push([r.t, +r.dv.toFixed(2)]);
      tot.push([r.t, +Math.hypot(r.dh, r.dv).toFixed(2)]);
    });
    var t0 = s[0].t, t1 = s[s.length - 1].t;
    var v0 = Math.hypot(s[0].dh, s[0].dv);
    // 阈值参考斜线：从窗口起点出发，斜率 = 2/5/10 mm/d
    function slopeLine(k) {
      return [[t0, +v0.toFixed(2)], [t1, +(v0 + k * 30).toFixed(2)]];
    }
    function refSeries(k, color, name) {
      return {
        name: name, type: 'line', data: slopeLine(k), symbol: 'none',
        lineStyle: { color: color, width: 1.5, type: 'dashed', opacity: 0.85 },
        tooltip: { show: false }, silent: true, z: 1
      };
    }
    return {
      backgroundColor: 'transparent',
      animation: false,
      title: { text: '累计位移 — 时间曲线', left: 8, top: 4,
        textStyle: { color: '#cbd5e1', fontSize: 13, fontWeight: 600 } },
      grid: { left: 56, right: 20, top: 40, bottom: 46 },
      legend: { top: 4, right: 10, textStyle: { color: '#94a3b8', fontSize: 11 }, itemWidth: 14 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,23,42,0.95)', borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        valueFormatter: function (v) { return v == null ? '-' : v.toFixed(2) + ' mm'; }
      },
      xAxis: Object.assign({ type: 'time' }, AXIS_STYLE),
      yAxis: Object.assign({ type: 'value', name: '位移(mm)', nameTextStyle: { color: '#64748b' } }, AXIS_STYLE),
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 16, bottom: 8, borderColor: '#334155',
          backgroundColor: 'rgba(15,23,42,0.6)', fillerColor: 'rgba(56,189,248,0.15)',
          textStyle: { color: '#64748b', fontSize: 10 } }
      ],
      series: [
        { name: '水平位移', type: 'line', data: dh, symbol: 'none', smooth: 0.2,
          lineStyle: { color: '#38bdf8', width: 2 }, itemStyle: { color: '#38bdf8' } },
        { name: '垂直位移', type: 'line', data: dv, symbol: 'none', smooth: 0.2,
          lineStyle: { color: '#a78bfa', width: 2 }, itemStyle: { color: '#a78bfa' } },
        { name: '合位移', type: 'line', data: tot, symbol: 'none', smooth: 0.2,
          lineStyle: { color: '#f1f5f9', width: 2.5 }, itemStyle: { color: '#f1f5f9' } },
        refSeries(2, '#eab308', '预警参考 2mm/d'),
        refSeries(5, '#f97316', '警示参考 5mm/d'),
        refSeries(10, '#ef4444', '报警参考 10mm/d')
      ]
    };
  }

  /* ---------- 速率-时间曲线（含报警阈值线） ---------- */
  function rateOption(p) {
    var s = p.series;
    var rate = [];
    s.forEach(function (r) { rate.push([r.t, +r.rate.toFixed(2)]); });
    return {
      backgroundColor: 'transparent',
      animation: false,
      title: { text: '位移速率 — 时间曲线（报警阈值）', left: 8, top: 4,
        textStyle: { color: '#cbd5e1', fontSize: 13, fontWeight: 600 } },
      grid: { left: 56, right: 20, top: 40, bottom: 46 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,23,42,0.95)', borderColor: '#334155',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        valueFormatter: function (v) { return v == null ? '-' : v.toFixed(2) + ' mm/d'; }
      },
      xAxis: Object.assign({ type: 'time' }, AXIS_STYLE),
      yAxis: Object.assign({ type: 'value', name: '速率(mm/d)', nameTextStyle: { color: '#64748b' } }, AXIS_STYLE),
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 16, bottom: 8, borderColor: '#334155',
          backgroundColor: 'rgba(15,23,42,0.6)', fillerColor: 'rgba(56,189,248,0.15)',
          textStyle: { color: '#64748b', fontSize: 10 } }
      ],
      series: [{
        name: '位移速率', type: 'line', data: rate, symbol: 'none', smooth: 0.15,
        lineStyle: { color: '#fbbf24', width: 2 },
        itemStyle: { color: '#fbbf24' },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(251,191,36,0.35)' },
              { offset: 1, color: 'rgba(251,191,36,0.02)' }
            ]
          }
        },
        markLine: {
          symbol: 'none',
          data: [
            { yAxis: 2,  lineStyle: { color: '#eab308', type: 'dashed', width: 1.5 },
              label: { formatter: '预警 2mm/d', color: '#eab308', fontSize: 10, position: 'insideEndTop' } },
            { yAxis: 5,  lineStyle: { color: '#f97316', type: 'dashed', width: 1.5 },
              label: { formatter: '警示 5mm/d', color: '#f97316', fontSize: 10, position: 'insideEndTop' } },
            { yAxis: 10, lineStyle: { color: '#ef4444', type: 'dashed', width: 2 },
              label: { formatter: '报警 10mm/d', color: '#ef4444', fontSize: 10, position: 'insideEndTop' } }
          ]
        },
        markArea: {
          silent: true,
          data: [[
            { yAxis: 10, itemStyle: { color: 'rgba(239,68,68,0.07)' } },
            { yAxis: 'max' }
          ]]
        }
      }]
    };
  }

  /* ---------- 打开 / 关闭 / 刷新 ---------- */
  function open(pointId) {
    openPointId = pointId;
    var p = D.getPoint(pointId);
    if (!p) return;
    var modal = document.getElementById('chartModal');
    modal.classList.add('open');

    var badge = document.getElementById('chartModalBadge');
    badge.textContent = p.cur.status.label;
    badge.style.background = p.cur.status.color;
    document.getElementById('chartModalTitle').textContent =
      p.name + '（' + p.type + '）近30天位移监测曲线';
    document.getElementById('chartModalSub').textContent =
      '数据区间 ' + fmtTime(p.series[0].t) + ' ~ ' + fmtTime(p.series[p.series.length - 1].t) +
      ' · 逐小时上报 · 当前速率 ' + p.cur.rate.toFixed(2) + ' mm/d';

    setTimeout(function () {
      if (!chartDisp) chartDisp = echarts.init(document.getElementById('chartDisp'));
      if (!chartRate) chartRate = echarts.init(document.getElementById('chartRate'));
      chartDisp.setOption(dispOption(p), true);
      chartRate.setOption(rateOption(p), true);
      chartDisp.resize();
      chartRate.resize();
    }, 30);
  }

  function close() {
    openPointId = null;
    document.getElementById('chartModal').classList.remove('open');
  }

  function refreshIfOpen() {
    if (!openPointId || !chartDisp) return;
    var p = D.getPoint(openPointId);
    if (!p) return;
    chartDisp.setOption(dispOption(p));
    chartRate.setOption(rateOption(p));
    document.getElementById('chartModalSub').textContent =
      '数据区间 ' + fmtTime(p.series[0].t) + ' ~ ' + fmtTime(p.series[p.series.length - 1].t) +
      ' · 逐小时上报 · 当前速率 ' + p.cur.rate.toFixed(2) + ' mm/d';
  }

  function isOpen() { return openPointId !== null; }
  function currentPoint() { return openPointId; }

  global.MineCharts = {
    open: open, close: close,
    refreshIfOpen: refreshIfOpen, isOpen: isOpen, currentPoint: currentPoint,
    dispOption: dispOption, rateOption: rateOption   // 报告模块复用
  };
})(window);
