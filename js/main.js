/* ============================================================
 * 主控：UI 渲染 + 实时上报模拟 + 交互联动
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.MineData;
  var rowEls = {};          // id -> 行元素
  var selectedId = null;
  var lastAlarmT = 0;
  var started = false;

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtHM(t) {
    var d = new Date(t);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':00';
  }

  /* ---------------- 左侧：统计 + 测点列表 ---------------- */
  function renderStats() {
    var c = D.stats();
    $('statSafe').textContent = c.safe;
    $('statWarn').textContent = c.warn;
    $('statAlert').textContent = c.alert;
    $('statAlarm').textContent = c.alarm;
    $('statTotal').textContent = D.POINTS.length;
    // 综合状态
    var worst = D.stats();
    var badge = $('overallBadge');
    var key = worst.alarm ? 'alarm' : worst.alert ? 'alert' : worst.warn ? 'warn' : 'safe';
    var st = D.STATUS.filter(function (s) { return s.key === key; })[0];
    badge.textContent = '综合状态：' + st.label;
    badge.style.background = st.color + '22';
    badge.style.color = st.color;
    badge.style.borderColor = st.color;
  }

  function buildList() {
    var box = $('pointList');
    box.innerHTML = '';
    var groups = [
      { name: '采场边坡（GNSS + 雷达）', filter: function (p) { return p.area === '采场边坡'; } },
      { name: '排土场边坡（GNSS）', filter: function (p) { return p.area === '排土场边坡'; } }
    ];
    groups.forEach(function (g) {
      var pts = D.POINTS.filter(g.filter).sort(function (a, b) { return b.cur.rate - a.cur.rate; });
      var gh = document.createElement('div');
      gh.className = 'pl-group';
      gh.textContent = g.name;
      box.appendChild(gh);
      pts.forEach(function (p) {
        var row = document.createElement('div');
        row.className = 'pl-row';
        row.dataset.id = p.id;
        row.innerHTML =
          '<span class="pl-dot"></span>' +
          '<span class="pl-name"></span>' +
          '<span class="pl-type"></span>' +
          '<span class="pl-rate"></span>' +
          '<button class="pl-btn" title="查看曲线">📈</button>';
        row.querySelector('.pl-name').textContent = p.name;
        row.querySelector('.pl-type').textContent = p.type;
        row.addEventListener('click', function (e) {
          if (e.target.classList.contains('pl-btn')) {
            selectPoint(p.id);
            global.MineCharts.open(p.id);
          } else {
            selectPoint(p.id);
            Scene3D.focusPoint(p.id);
          }
        });
        box.appendChild(row);
        rowEls[p.id] = row;
      });
    });
    updateList();
  }

  function updateList() {
    D.POINTS.forEach(function (p) {
      var row = rowEls[p.id];
      if (!row) return;
      row.querySelector('.pl-dot').style.background = p.cur.status.color;
      row.querySelector('.pl-dot').style.boxShadow = '0 0 6px ' + p.cur.status.color;
      var rateEl = row.querySelector('.pl-rate');
      rateEl.textContent = p.cur.rate.toFixed(1) + ' mm/d';
      rateEl.style.color = p.cur.status.color;
      row.classList.toggle('blink', p.cur.status.key === 'alarm');
    });
  }

  /* ---------------- 右侧：详情卡 ---------------- */
  function selectPoint(id) {
    selectedId = id;
    Scene3D.selectPoint(id);
    Object.keys(rowEls).forEach(function (k) {
      rowEls[k].classList.toggle('active', k === id);
    });
    updateDetails();
  }

  function updateDetails() {
    var p = D.getPoint(selectedId);
    if (!p) return;
    $('dName').textContent = p.name;
    $('dMeta').textContent = p.area + ' · ' + p.type + ' · ' +
      (p.area === '采场边坡' ? '台阶L' + p.lvl : '排土场L' + p.lvl) + ' · 标高 ' + p.y.toFixed(1) + 'm';
    $('dDH').textContent = p.cur.dh.toFixed(1) + ' mm';
    $('dDV').textContent = p.cur.dv.toFixed(1) + ' mm';
    $('dTot').textContent = p.cur.tot.toFixed(1) + ' mm';
    var rEl = $('dRate');
    rEl.textContent = p.cur.rate.toFixed(2) + ' mm/d';
    rEl.style.color = p.cur.status.color;
    var st = $('dStatus');
    st.textContent = p.cur.status.label;
    st.style.background = p.cur.status.color;
    $('dTime').textContent = fmtHM(p.cur.time);
    $('dUptime').textContent = (p.uptime * 100).toFixed(1) + '%';
  }

  /* ---------------- 右侧：报警 + 日志 ---------------- */
  function renderAlarms() {
    var box = $('alarmList');
    box.innerHTML = '';
    var list = D.ALARMS.slice(0, 12);
    if (!list.length) {
      box.innerHTML = '<div class="empty">暂无报警事件</div>';
      return;
    }
    list.forEach(function (a) {
      var div = document.createElement('div');
      div.className = 'alarm-item' + (a.t > lastAlarmT ? ' new' : '');
      div.innerHTML =
        '<span class="alarm-lv" style="background:' + a.level.color + '">' + a.level.label + '</span>' +
        '<span class="alarm-name">' + a.name + '</span>' +
        '<span class="alarm-rate">' + a.rate.toFixed(1) + 'mm/d</span>' +
        '<span class="alarm-time">' + fmtHM(a.t) + '</span>';
      box.appendChild(div);
    });
    lastAlarmT = D.ALARMS.length ? D.ALARMS[0].t : 0;
  }

  function addLog(msg, cls) {
    var box = $('logList');
    var div = document.createElement('div');
    div.className = 'log-item' + (cls ? ' ' + cls : '');
    div.textContent = msg;
    box.insertBefore(div, box.firstChild);
    while (box.children.length > 40) box.removeChild(box.lastChild);
  }

  /* ---------------- 报告下拉 ---------------- */
  function renderReportList() {
    var menu = $('reportList');
    menu.innerHTML = '';
    MineReport.list().forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'dd-item';
      item.innerHTML = '<b>' + r.weekLabel + '周报</b><span>' + r.no + '</span>';
      item.addEventListener('click', function () {
        menu.classList.remove('open');
        MineReport.show(r);
      });
      menu.appendChild(item);
    });
    $('reportBadge').textContent = MineReport.list().length;
  }

  /* ---------------- 逐小时上报循环 ---------------- */
  function tick() {
    var now = D.tick();
    Scene3D.updateAll();
    updateList();
    renderStats();
    updateDetails();
    renderAlarms();
    MineCharts.refreshIfOpen();
    $('dataClock').textContent = '数据时间 ' + fmtHM(now) + '（演示加速）';

    // 上报日志
    var warnPlus = D.POINTS.filter(function (p) { return p.cur.status.key !== 'safe'; });
    addLog('[' + fmtHM(now) + '] 收到 ' + D.POINTS.length + ' 个测点整点数据包（水平/垂直/速率）');
    warnPlus.forEach(function (p) {
      addLog('[' + fmtHM(now) + '] ' + p.name + ' 上报：水平 ' + p.cur.dh.toFixed(1) +
        'mm 垂直 ' + p.cur.dv.toFixed(1) + 'mm 速率 ' + p.cur.rate.toFixed(1) + 'mm/d 【' +
        p.cur.status.label + '】', 'log-' + p.cur.status.key);
    });
    // 新报警提示
    D.ALARMS.forEach(function (a) {
      if (a.t > now - 3600000 && a.t <= now) {
        addLog('[' + fmtHM(a.t) + '] ⚠ ' + a.name + ' 触发' + a.level.label + '，速率 ' +
          a.rate.toFixed(1) + 'mm/d', 'log-' + a.level.key);
      }
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    D.buildSeries();
    D.detectAllAlarms();

    Scene3D.init($('scene3d'));
    Scene3D.onPointClick = function (id) {
      selectPoint(id);
      MineCharts.open(id);
    };

    buildList();
    renderStats();
    lastAlarmT = D.ALARMS.length ? D.ALARMS[0].t : 0;   // 历史报警不做闪烁动画
    renderAlarms();
    selectPoint(D.worstPoint().id);

    // 周报：启动自动生成最近 4 周
    MineReport.injectCSS();
    var latest = MineReport.autoGenerate();
    renderReportList();
    addLog('系统已自动生成 ' + latest.weekLabel + ' 边坡监测周报（共 ' + MineReport.list().length + ' 期可查）', 'log-sys');

    // 时钟
    setInterval(function () {
      var d = new Date();
      $('realClock').textContent = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' +
        pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }, 1000);
    $('dataClock').textContent = '数据时间 ' + fmtHM(D.currentDataTime()) + '（演示加速）';

    // 页脚
    var gnss = D.POINTS.filter(function (p) { return p.type === 'GNSS'; }).length;
    var up = D.POINTS.reduce(function (a, p) { return a + p.uptime; }, 0) / D.POINTS.length * 100;
    $('footerStatus').textContent =
      'GNSS接收机 ' + gnss + '/' + gnss + ' 在线 · 边坡雷达 2/2 在线 · 数据完整率 ' +
      up.toFixed(1) + '% · 上报周期 1h · 演示模式（3秒=1小时）';

    bindUI();
    started = true;
    setInterval(tick, D.CONFIG.tickMs);
  }

  function bindUI() {
    // 视角切换
    document.querySelectorAll('[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { Scene3D.flyTo(btn.dataset.view); });
    });
    // 报告
    $('btnReports').addEventListener('click', function (e) {
      e.stopPropagation();
      $('reportList').classList.toggle('open');
    });
    document.addEventListener('click', function () {
      $('reportList').classList.remove('open');
    });
    $('btnGenReport').addEventListener('click', function () {
      var r = MineReport.generate(D.currentDataTime());
      renderReportList();
      addLog('已生成 ' + r.weekLabel + ' 边坡监测周报', 'log-sys');
      MineReport.show(r);
    });
    $('btnReportClose').addEventListener('click', MineReport.close);
    $('btnReportPrint').addEventListener('click', MineReport.print);
    $('btnReportDownload').addEventListener('click', MineReport.download);
    // 图表面板
    $('btnChartClose').addEventListener('click', MineCharts.close);
    $('chartModal').addEventListener('click', function (e) {
      if (e.target === $('chartModal')) MineCharts.close();
    });
    $('reportModal').addEventListener('click', function (e) {
      if (e.target === $('reportModal')) MineReport.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { MineCharts.close(); MineReport.close(); }
    });
    // 详情卡按钮
    $('btnShowChart').addEventListener('click', function () {
      if (selectedId) MineCharts.open(selectedId);
    });
    $('btnLocate').addEventListener('click', function () {
      if (selectedId) Scene3D.focusPoint(selectedId);
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})(window);
