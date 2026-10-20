// assets/charts.js — Code Wiki 报告图表（ECharts + Mermaid 初始化）
(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Mermaid 架构图 ---
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
  }

  // --- 图 1：源码行数分布 ---
  var linesEl = document.getElementById('chart-lines');
  if (linesEl && window.echarts) {
    var linesData = [
      { name: '_p6.js（地图）', value: 4066 },
      { name: '_p5.js（编排）', value: 2130 },
      { name: 'tpl/template.html（版式）', value: 1710 },
      { name: '_pi18n.js（i18n）', value: 1236 },
      { name: '_p5b.js（渲染）', value: 1008 },
      { name: '_p4.js（取数/评分）', value: 578 },
      { name: '_p2.js（工具/安全）', value: 352 },
      { name: '_p3.js（物理模型）', value: 253 }
    ];
    var chart1 = echarts.init(linesEl, null, { renderer: 'svg' });
    chart1.setOption({
      animation: false,
      grid: { left: 8, right: 40, top: 20, bottom: 20, containLabel: true },
      tooltip: { trigger: 'axis', appendToBody: true, axisPointer: { type: 'shadow' },
        formatter: function (p) { return p[0].name + '<br/><b>' + p[0].value.toLocaleString() + '</b> 行'; } },
      xAxis: {
        type: 'value',
        axisLabel: { color: muted, fontFamily: 'JetMono, monospace', fontSize: 11, hideOverlap: true },
        splitLine: { lineStyle: { color: rule } }
      },
      yAxis: {
        type: 'category',
        data: linesData.map(function (d) { return d.name; }).reverse(),
        axisLabel: { color: ink, fontSize: 12 },
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        data: linesData.map(function (d) { return d.value; }).reverse(),
        itemStyle: { color: accent, borderRadius: [0, 4, 4, 0] },
        barWidth: '58%',
        label: { show: true, position: 'right', color: muted, fontFamily: 'JetMono, monospace', fontSize: 11 }
      }]
    });
    window.addEventListener('resize', function () { chart1.resize(); });
  }

  // --- 图 2：探针具名断言条数 ---
  var assertEl = document.getElementById('chart-assert');
  if (assertEl && window.echarts) {
    var assertData = [
      { name: 'zoomprobe', value: 136 },
      { name: 'run_self + harness', value: 51 },
      { name: 'mapaudit', value: 50 },
      { name: 'localgrid', value: 50 },
      { name: 'uiprobe', value: 45 },
      { name: 'mobileprobe', value: 36 },
      { name: 'tutorialprobe', value: 34 },
      { name: 'calibprobe', value: 25 },
      { name: 'snapprobe', value: 24 },
      { name: 'i18nprobe', value: 23 },
      { name: '404probe', value: 21 },
      { name: 'spotprobe', value: 21 }
    ];
    var chart2 = echarts.init(assertEl, null, { renderer: 'svg' });
    chart2.setOption({
      animation: false,
      grid: { left: 8, right: 30, top: 20, bottom: 20, containLabel: true },
      tooltip: { trigger: 'axis', appendToBody: true, axisPointer: { type: 'shadow' },
        formatter: function (p) { return p[0].name + '<br/><b>' + p[0].value + '</b> 条具名断言'; } },
      xAxis: {
        type: 'value',
        axisLabel: { color: muted, fontFamily: 'JetMono, monospace', fontSize: 11, hideOverlap: true },
        splitLine: { lineStyle: { color: rule } }
      },
      yAxis: {
        type: 'category',
        data: assertData.map(function (d) { return d.name; }).reverse(),
        axisLabel: { color: ink, fontFamily: 'JetMono, monospace', fontSize: 11 },
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        data: assertData.map(function (d) { return d.value; }).reverse(),
        itemStyle: {
          color: function (params) { return params.value >= 50 ? accent2 : accent; },
          borderRadius: [0, 4, 4, 0]
        },
        barWidth: '58%',
        label: { show: true, position: 'right', color: muted, fontFamily: 'JetMono, monospace', fontSize: 11 }
      }]
    });
    window.addEventListener('resize', function () { chart2.resize(); });
  }
})();
