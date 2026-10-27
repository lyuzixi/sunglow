# -*- coding: utf-8 -*-
"""生成浏览器端联调页：真实业务代码 + 腾讯地图 SDK 桩（真机底图需运行时替换占位符）

桩的职责是当"如实的预言机"，而不是当"好看的假图"：
  · Heat 按官方语义实现为【密度累加 + 阈值归一】，而不是"每点取自身值" ——
    上一轮正是因为桩做成了后者，才把"热力图整片同色 / 放大后没颜色"这两个真实缺陷掩盖掉了。
  · 视口可缩放（?z= 或 window.__TMAP_SETVIEW），projectToContainer / unprojectFromContainer
    与 _paint 共用同一套投影，保证"取值位置"与"画出来的位置"必然一致。
"""
import io, os, re
BASE = os.path.dirname(os.path.abspath(__file__))
def rd(p): return io.open(os.path.join(BASE, p), encoding="utf-8", newline="").read()
def wr(p, s): io.open(os.path.join(BASE, p), "w", encoding="utf-8", newline="").write(s)

t = rd("index.html")

STUB = """
<script>
/* ===== 仅在联调页使用的腾讯地图 SDK 桩 =====
   1) 可缩放视口 + projectToContainer / unprojectFromContainer（等距圆柱投影，仅联调用）
   2) Heat 按官方语义：每点以 radius 为半径做核函数叠加，颜色 = clamp(累加值, min, max) 映射渐变色
   3) MultiPolygon 省级色块（降级路径）
   真机底图仍由腾讯地图 GL JS 提供。 ===== */
(function(){
  var LOG = window.__TMAP_CALLS = [];
  function rec(n){ LOG.push(n); }
  function LatLng(lat, lng){ this.lat=lat; this.lng=lng; }
  LatLng.prototype.getLat=function(){return this.lat;};
  LatLng.prototype.getLng=function(){return this.lng;};
  function Point(x,y){ this.x=x; this.y=y; }
  Point.prototype.getX=function(){return this.x;};
  Point.prototype.getY=function(){return this.y;};

  /* ---- 颜色工具 ---- */
  function hex2arr(h){ h=String(h).trim();
    if(h.indexOf('rgb')===0){ var n=h.replace(/[^0-9.,]/g,'').split(','); return [ +n[0], +n[1], +n[2] ]; }
    h=h.replace('#',''); if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
  function mixArr(a,b,t){ return [ a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t ]; }
  function gradAt(stops,t){
    var ks=Object.keys(stops).map(Number).sort(function(x,y){return x-y;});
    if(t<=ks[0]) return hex2arr(stops[ks[0]]);
    for(var i=1;i<ks.length;i++){ if(t<=ks[i]){
      var f=(t-ks[i-1])/((ks[i]-ks[i-1])||1); return mixArr(hex2arr(stops[ks[i-1]]),hex2arr(stops[ks[i]]),f); } }
    return hex2arr(stops[ks[ks.length-1]]);
  }

  function Map(box, opts){
    rec('Map');
    this.box=box; this.opts=opts||{}; this._h={};
    this._polys=null; this._heat=null;
    this._center=this.opts.center||new LatLng(35.2,105.0);
    this._zoom=(this.opts.zoom==null?4:this.opts.zoom);
    var c=this._c=document.createElement('canvas');
    c.width=box.clientWidth||640; c.height=box.clientHeight||420;
    c.style.position='absolute'; c.style.left='0'; c.style.top='0';
    c.style.width='100%'; c.style.height='100%';
    c.style.background='linear-gradient(160deg,#eef3f8,#e2eaf2)';
    box.appendChild(c);
  }
  Map.VIEW = { dppAtZoom0: 360/256 };            /* 度/像素（zoom=0，经度方向） */
  Map.prototype._dpp = function(){
    return Map.VIEW.dppAtZoom0 / Math.pow(2, this._zoom);   /* 度/像素 */
  };
  /* 可见经纬范围：与 projectToContainer / _paint 共用，保证三者绝不脱节 */
  Map.prototype.bounds = function(){
    var W=this.box.clientWidth||640, H=this.box.clientHeight||420, d=this._dpp();
    var lonSpan=d*W, latSpan=d*H;
    return { la0:this._center.lat-latSpan/2, la1:this._center.lat+latSpan/2,
             lo0:this._center.lng-lonSpan/2, lo1:this._center.lng+lonSpan/2, W:W, H:H };
  };
  Map.prototype._proj=function(ll){
    var b=this.bounds();
    return new Point((ll.lng-b.lo0)/(b.lo1-b.lo0)*b.W, (b.la1-ll.lat)/(b.la1-b.la0)*b.H);
  };
  /* ?noproj=1 时不提供 projectToContainer，用于验证「省级色块」降级渲染路径 */
  if (location.search.indexOf("noproj") < 0) {
    Map.prototype.projectToContainer=function(ll){ return this._proj(ll); };
    Map.prototype.unprojectFromContainer=function(p){
      var b=this.bounds();
      return new LatLng(b.la1-(p.y/b.H)*(b.la1-b.la0), b.lo0+(p.x/b.W)*(b.lo1-b.lo0));
    };
  }
  Map.prototype.on=function(k,f){ (this._h[k]=this._h[k]||[]).push(f); };
  Map.prototype.off=function(){};
  Map.prototype.emit=function(k,e){ (this._h[k]||[]).forEach(function(f){f(e);}); };
  Map.prototype.setCenter=function(ll){ this._center=ll; this._afterMove(); };
  Map.prototype.setZoom=function(z){ this._zoom=z; this._afterMove(); };
  Map.prototype.getZoom=function(){ return this._zoom; };
  Map.prototype.getCenter=function(){ return this._center; };
  Map.prototype.resize=function(){ this._paint(); };
  Map.prototype._afterMove=function(){
    this._paint();
    this.emit('bounds_changed',{}); this.emit('zoom_changed',{}); this.emit('idle',{});
  };
  Map.prototype._paint=function(){
    /* 跟随容器尺寸（真实 TMap 会自行 responsive，桩需手动同步） */
    var bw=this.box.clientWidth||640, bh=this.box.clientHeight||420;
    if(this._c.width!==bw || this._c.height!==bh){ this._c.width=bw; this._c.height=bh; }
    var g=this._c.getContext('2d'); g.clearRect(0,0,this._c.width,this._c.height);
    var self=this;
    if(this._polys && this._polys._g && this._polys._s){
      this._polys._g.forEach(function(geo){
        var st=self._polys._s[geo.styleId]; if(!st) return;
        g.beginPath();
        (geo.paths||[]).forEach(function(ring){
          ring.forEach(function(ll,i){ var p=self._proj(ll);
            i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y); });
          g.closePath();
        });
        g.fillStyle=st.o.color||'rgba(200,200,200,.5)'; g.fill();
        if(st.o.showBorder){ g.strokeStyle=st.o.borderColor||'#fff'; g.lineWidth=st.o.borderWidth||1; g.stroke(); }
      });
    }
    this._paintHeat(g);
  };
  /* ★ 忠实还原官方 Heat：核函数叠加 → clamp(累加值, min, max) → 渐变色 + alpha 随密度增长 */
  Map.prototype._paintHeat=function(g){
    var H=this._heat; if(!H || !H._d || !H._d.length) return;
    var W=this._c.width, Hh=this._c.height;
    var min=(H._min==null?0:H._min), max=(H._max==null?100:H._max);
    var R=H._r||36, R2=R*R;
    var buf=new Float32Array(W*Hh);
    for(var k=0;k<H._d.length;k++){
      var d=H._d[k], p=this._proj(new LatLng(d.lat,d.lng));
      var cx=p.x, cy=p.y, w=d.count||0;
      var x0=Math.max(0,Math.floor(cx-R)), x1=Math.min(W-1,Math.ceil(cx+R));
      var y0=Math.max(0,Math.floor(cy-R)), y1=Math.min(Hh-1,Math.ceil(cy+R));
      for(var y=y0;y<=y1;y++){ var dy=y-cy;
        for(var x=x0;x<=x1;x++){ var dx=x-cx; var r2=(dx*dx+dy*dy)/R2;
          if(r2>=1) continue; buf[y*W+x]+= w*(1-r2); } }
    }
    var stops=H._g||{0:'#fff',1:'#f00'};
    var img=g.createImageData(W,Hh), cov=0, n=0, s=0, s2=0, mn=1e9, mx=-1e9;
    var span=(max-min)||1;
    for(var i=0;i<buf.length;i++){
      var v=buf[i], t=(v-min)/span; if(t<0)t=0; if(t>1)t=1;
      if(v>0){ n++; s+=t; s2+=t*t; if(t<mn)mn=t; if(t>mx)mx=t; }
      if(v>=min && v>0){ cov++; }
      if(v<=0 || t<=0) continue;
      var col=gradAt(stops,t), o=i*4;
      img.data[o]=col[0]; img.data[o+1]=col[1]; img.data[o+2]=col[2];
      img.data[o+3]=Math.round(255*Math.min(1,t*1.5));
    }
    g.putImageData(img,0,0);
    var mean=n?s/n:0;
    window.__TMAP_HEAT_STATS={
      pts:H._d.length, coverage:+(cov/buf.length).toFixed(4),
      meanT:+mean.toFixed(3), minT:+(mn>1e8?0:mn).toFixed(3), maxT:+(mx<-1e8?0:mx).toFixed(3),
      stdT:+(n?Math.sqrt(Math.max(0,s2/n-mean*mean)):0).toFixed(3),
      radius:R, min:min, max:max
    };
  };
  /* 联调用：设置视口（模拟用户缩放/平移），会触发与真机同名的事件 */
  window.__TMAP_SETVIEW=function(zoom, lat, lng){
    if(!window.__TMAP_INST) return null;
    if(lat!=null && lng!=null) window.__TMAP_INST._center=new LatLng(lat,lng);
    window.__TMAP_INST._zoom=zoom;
    window.__TMAP_INST._afterMove();
    return window.__TMAP_INST.bounds();
  };
  window.__TMAP_VIEW=function(){
    if(!window.__TMAP_INST) return null;
    var b=window.__TMAP_INST.bounds();
    return {zoom:window.__TMAP_INST._zoom, la0:b.la0, la1:b.la1, lo0:b.lo0, lo1:b.lo1, W:b.W, H:b.H};
  };

  /* ---- 省级色块 ---- */
  function PolygonStyle(o){ this.o=o; }
  function MultiPolygon(o){ rec('MultiPolygon geoms=' + ((o.geometries||[]).length));
    this.o=o; this._map=o.map; this._g=o.geometries||[]; this._s=o.styles||{};
    if(o.map) o.map._polys=this; }
  MultiPolygon.prototype.setStyles=function(s){ rec('setStyles n='+Object.keys(s).length);
    /* 供测试脚本核对省级色块的着色：styleId 序列 + 每档实际颜色 */
    window.__TMAP_POLYCOLORS = Object.keys(s).map(function(k){ return k+'='+((s[k]&&s[k].o&&s[k].o.color)||''); }).join(';');
    this._s=s; if(this._map){ this._map._polys=this; this._map._paint(); } };
  MultiPolygon.prototype.setGeometries=function(g){ rec('setGeometries n='+g.length);
    /* styleId 序列是省级色块的"着色指纹"：换模型/换时段时它应当随之变化 */
    window.__TMAP_POLYSTYLES = (g||[]).map(function(x){ return x.styleId; }).join(",");
    this._g=g; if(this._map){ this._map._polys=this; this._map._paint(); } };
  MultiPolygon.prototype.setMap=function(m){ this._map=m; if(m) m._polys=this; };

  /* ---- Heat ---- */
  function Heat(o){ rec('Heat'); this.o=o; this._d=[]; this._g=null;
    this._min=(o&&o.min)||0; this._max=(o&&o.max)||100; this._r=(o&&o.radius)||36; }
  Heat.prototype.addTo=function(m){ this._map=m; m._heat=this; return this; };
  Heat.prototype.setData=function(d){ this._d=d||[]; rec('Heat.setData n='+(d?d.length:0));
    if(this._map){ this._map._heat=this; this._map._paint(); } return this; };
  Heat.prototype.setGradientColor=function(g){ this._g=g; rec('setGradientColor n='+Object.keys(g).length);
    if(this._map){ this._map._heat=this; this._map._paint(); } return this; };

  window.TMap = { Map:Map, LatLng:LatLng, Point:Point, PolygonStyle:PolygonStyle,
                  MultiPolygon:MultiPolygon };
  /* ?noheat=1 时不提供可视化库，用于验证「省级色块」降级渲染路径 */
  if (location.search.indexOf("noheat") < 0) window.TMap.visualization = { Heat:Heat };
  /* 暴露给测试脚本，用于模拟悬停/点击 */
  window.__TMAP_EMIT = function(k, lat, lng){ if (window.__TMAP_INST && window.__TMAP_INST.emit)
      window.__TMAP_INST.emit(k, { latLng: new LatLng(lat, lng) }); };
})();
</script>
"""

# 用桩替换官方 SDK 的 src 脚本标签
t2, n = re.subn(r'<script[^>]*\bsrc="https://map\.qq\.com/api/gljs[^"]*"[^>]*>\s*</script>',
                STUB.strip(), t)
assert n == 1, "未找到 TMap SDK 标签: %d" % n
# 记录 Map 实例，便于模拟事件
t2 = t2.replace("MapMod.map = new TMap.Map(box, {",
                "MapMod.map = window.__TMAP_INST = new TMap.Map(box, {")
assert "__TMAP_INST = new TMap.Map" in t2

wr("_check/preview.html", t2)
print("OK -> _check/preview.html  %d bytes" % len(t2.encode("utf-8")))
