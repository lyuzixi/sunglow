
function eq(name, got, exp, tol){const ok=(typeof exp==="boolean")?got===exp:Math.abs(got-exp)<=tol;console.log((ok?"PASS":"FAIL"),name,"=",(typeof got==="number"?got.toFixed(4):got),"期望≈",exp);}
const ev=sunEvents(Date.UTC(2026,9,8),31.2304,121.4737);
console.log("上海日出",(((ev.riseMs+8*3600000)/3600000%24+24)%24).toFixed(4),"日落",(((ev.setMs+8*3600000)/3600000%24+24)%24).toFixed(4),"（接口:05:51/17:30）");
eq("Heq(AOD0.15,Hs0.5) 表4.1",equivGroundHeight(0.15,0.5),1.35,0.02);
eq("Heq(AOD0.15,Hs1.0) 表4.1",equivGroundHeight(0.15,1.0),2.01,0.02);
eq("Heq(AOD0.15,Hs1.5) 表4.1",equivGroundHeight(0.15,1.5),2.41,0.02);
eq("Heq(AOD0.15,Hs2.0) 表4.1",equivGroundHeight(0.15,2.0),2.64,0.02);
eq("Heq(AOD0.15,Hs2.5) 表4.1",equivGroundHeight(0.15,2.5),2.74,0.02);
eq("Heq(AOD0.15,Hs3.0) 表4.1",equivGroundHeight(0.15,3.0),2.75,0.02);
eq("Heq(AOD0.15,Hs3.5) 表4.1",equivGroundHeight(0.15,3.5),2.66,0.02);
eq("Heq(AOD0.15,Hs4.0) 表4.1",equivGroundHeight(0.15,4.0),2.51,0.02);
eq("xMax(h=2km) 教程319.23",fireGeometry(2,200,21,0.2286).xMax,319.27,0.3);
eq("xMax(h=6km) 教程552.78",fireGeometry(6,200,21,0.2286).xMax,552.78,0.5);
eq("xMax(h=8km) 教程638.21",fireGeometry(8,200,21,0.2286).xMax,638.21,0.5);
const g=fireGeometry(2,200,21,0.2286);console.log("  深圳案例: 近边界",g.thNearDeg.toFixed(2),"远边界",g.thFarDeg.toFixed(2),"持续",g.dur.toFixed(2),"分（教程2.8分）");
eq("v(31.25N,10/20)教程20",sunsetSpeedKmph(31.25,new Date(Date.UTC(2026,9,20))),19.7,0.6);
eq("v(22.5N,10/13)教程21",sunsetSpeedKmph(22.5,new Date(Date.UTC(2026,9,13))),21.0,0.6);

function show(l,h,t,a,Hs){const c=rayTraceColor(h,-t*Math.PI/180,a,Hs);console.log("  ",l,"tau=",c.tau550.toFixed(2),"T550=",c.T550.toExponential(2),"lumRel=",c.lumRel.toExponential(2),"冲淡=",c.wash.toFixed(3),"色",c.hex,c.name,"饱和",(c.sat*100).toFixed(0)+"%","色度",c.chroma.toFixed(3));return c;}
const c1=show("h=2km θ0.9° AOD0.15",2,0.9,0.15,1.5);
const c2=show("h=7km θ1.75° AOD0.14",7.2,1.75,0.14,1.5);
const c3=show("h=8km θ1° AOD0.05(洁净)",8,1.0,0.05,1.5);
const c4=show("h=8km θ1° AOD0.30",8,1.0,0.30,1.5);
const c5=show("h=8km θ1° AOD0.90(重霾)",8,1.0,0.90,1.5);
console.log("  饱和度随AOD单调下降:", (c3.sat>c4.sat&&c4.sat>c5.sat)?"PASS":"FAIL");
console.log("  感知色度随AOD单调下降:", (c3.chroma>c4.chroma&&c4.chroma>c5.chroma)?"PASS":"FAIL");
console.log("  洁净天霞光偏橙红:", (c3.hue<45?"PASS":"FAIL"), " hue=",c3.hue.toFixed(0));
const c6=show("h=8km θ1° AOD1.8(极端)",8,1.0,1.8,1.5);

function mkEnv(o){return Object.assign({T:22,Td:8,RH:60,cTot:70,cLow:5,cMid:10,cHigh:70,vis:30000,P:1015,Pmsl:1018,ws:8,wd:250,gust:12,fz:4500,blh:800,precip:0,cape:0,aod:0.12,missing:[]},o);}
function mkTr(lvl,cov,dEnd,env){
  env=env||{};
  const a=[];
  for(let d=0;d<=400;d+=25)a.push({d:d,cLow:0,cMid:0,cHigh:0,vis:(env.vis!=null?env.vis:30000),rh:(env.RH!=null?env.RH:60),aod:(env.aod!=null?env.aod:0.12)});
  for(const p of a){if(p.d<=dEnd)p[lvl]=cov;}
  return a;
}
const ctx={v:20,omega:0.22,aod:0.12,dP:0.3};
function caseRun(lbl,env,lvl,cov,dEnd){
  const tr=mkTr(lvl,cov,dEnd,env);const a=analyseTransect(tr,lvl);
  const s=scoreStat(env,a,ctx);const rt=scoreRay(env,a,ctx);
  const parts=[{P:s.P,Q:s.Q,w:0.30},{P:s.P,Q:s.Q,w:0.34},{P:rt.P,Q:rt.Q,w:0.36}];
  const P=wgeo(parts.map(x=>[x.P,x.w])), Q=wgeo(parts.map(x=>[x.Q,x.w]));
  console.log("  ["+lbl+"] 统计P="+s.P.toFixed(0)+" Q="+s.Q.toFixed(0)+" | 光追P="+rt.P.toFixed(0)+" Q="+rt.Q.toFixed(0)+
    " | aeroF="+(rt.aeroF!=null?rt.aeroF.toFixed(2):"-")+" | hEff="+s.hEff.toFixed(2)+" d="+(a.dFar?a.dFar.toFixed(0):"无")+" xMax="+s.geom.xMax.toFixed(0)+
    " 持续="+rt.geom.dur.toFixed(1)+"min 色="+rt.peak.name+" T550="+rt.peak.T550.toExponential(1)+" | 综合P="+P.toFixed(0)+" Q="+Q.toFixed(0)+" ("+gradeOf(Q)+")");
  return {P,Q,s,rt};
}
caseRun("优:卷层云70%云底7.4km",mkEnv({}),"cHigh",70,200);
caseRun("良:高积云50%云底2.6km",mkEnv({cHigh:35,cMid:50,fz:3000,Td:5}),"cMid",50,150);
caseRun("一般:层积云60%云底1.7km",mkEnv({cHigh:10,cMid:20,cLow:60,Td:11,fz:3500}),"cLow",60,300);
caseRun("差:低云封天95%",mkEnv({cHigh:0,cMid:0,cLow:95,T:15,Td:14.6}),"cLow",95,400);
caseRun("无云",mkEnv({cLow:0,cMid:0,cHigh:0}),"cHigh",0,0);
caseRun("重霾AOD0.8高云60%",mkEnv({cHigh:60,cLow:5,Td:6,aod:0.8,vis:6000}),"cHigh",60,250);
caseRun("极通透AOD0.05高云45%",mkEnv({cHigh:45,cLow:2,Td:4,vis:40000,aod:0.05}),"cHigh",45,120);
caseRun("暴雨层云AOD0.35",mkEnv({cHigh:0,cMid:0,cLow:90,Td:16,T:17,precip:6,vis:3000,aod:0.35}),"cLow",90,400);
console.log("  检索 'shanghai' ->",searchCity("shanghai",3).map(c=>c.name).join(","));
console.log("  检索 'hangzhou' ->",searchCity("hangzhou",3).map(c=>c.name).join(","));
console.log("  检索 'changzhou' ->",searchCity("changzhou",3).map(c=>c.name).join(","));
console.log("  检索 'hang' ->",searchCity("hang",5).map(c=>c.name).join(","));
console.log("  检索 'hz' ->",searchCity("hz",3).map(c=>c.name).join(","));
console.log("  检索 'zhou' ->",searchCity("zhou",5).map(c=>c.name).join(","));
console.log("  检索 '北京' ->",searchCity("北京",3).map(c=>c.name).join(","));
console.log("  检索 '州' ->",searchCity("州",5).map(c=>c.name).join(","));
console.log("  检索 '东京' ->",searchCity("东京",3).map(c=>c.name).join(","));
console.log("  检索 'newyork' ->",searchCity("newyork",3).map(c=>c.name).join(","));
console.log("  检索 'tokyo' ->",searchCity("tokyo",3).map(c=>c.name).join(","));
console.log("  检索 'london' ->",searchCity("london",3).map(c=>c.name).join(","));
console.log("  检索 'losangeles' ->",searchCity("losangeles",3).map(c=>c.name).join(","));
console.log("  检索 'paris' ->",searchCity("paris",3).map(c=>c.name).join(","));
console.log("  检索 'hongkong' ->",searchCity("hongkong",3).map(c=>c.name).join(","));
console.log("  检索 'sydney' ->",searchCity("sydney",3).map(c=>c.name).join(","));
console.log("  检索 'nyc' ->",searchCity("nyc",3).map(c=>c.name).join(","));
console.log("  检索 'wulumuqi' ->",searchCity("wulumuqi",2).map(c=>c.name).join(","));
console.log("  检索 'sanya' ->",searchCity("sanya",3).map(c=>c.name).join(","));
console.log("  检索库总数",ALL_CITIES.length);
console.log("  最近城市(31.23,121.47) ->",JSON.stringify((function(){const n=nearestCity(31.23,121.47,CN_CITIES);return [n.city.name,Math.round(n.distKm)];})()));

/* ---------------- 热力图统一色阶：白 → 黄 → 橙 → 红 ---------------- */
(function(){
  const lum = c => { const r=hex2rgb(c); return 0.2126*r[0]+0.7152*r[1]+0.0722*r[2]; };
  const hueOf = c => { const r=hex2rgb(c); const R=r[0]/255,G=r[1]/255,B=r[2]/255;
    const mx=Math.max(R,G,B), mn=Math.min(R,G,B), d=mx-mn;
    if(d<1e-9) return NaN; let h;
    if(mx===R) h=60*(((G-B)/d)%6); else if(mx===G) h=60*((B-R)/d+2); else h=60*((R-G)/d+4);
    return (h+360)%360; };
  const eqc=(n,a,b)=>console.log((a===b?"PASS":"FAIL"),n,"=",a,"期望",b);

  eqc("色阶起点＝白", rampColor("pm",0), "#ffffff");
  eqc("色阶终点＝红", rampColor("pm",100), "#d51313");
  eqc("朝霞起点＝白", rampColor("am",0), "#ffffff");
  eqc("朝霞终点＝红", rampColor("am",100), "#d51313");

  let same=true, monoG=true, monoB=true, monoR=true, monoHue=true, cont=true;
  let prev=null, prevHue=null;
  for(let i=0;i<=100;i++){
    const c=rampColor("pm",i);
    if(c!==rampColor("am",i)) same=false;
    const r=hex2rgb(c);
    if(prev){
      if(r[1]>prev[1]) monoG=false;
      if(r[2]>prev[2]) monoB=false;
      if(r[0]>prev[0]) monoR=false;
      if(Math.abs(r[0]-prev[0])>8||Math.abs(r[1]-prev[1])>8||Math.abs(r[2]-prev[2])>8) cont=false;
    }
    /* 白色附近彩度极低，色相在数值上不稳定；而且 sRGB 上"白→黄"的直线本身不是等色相线，
       离开白端时会带来零点几度的色相摆动（肉眼不可辨）。所以：
       ① 只在确实有色（相对彩度 > 0.15）的区间检查；
       ② 容差 1.5°——插入绿/紫等其他色相会立刻跳几十度，这个阈值足够抓出真回归。 */
    const h=hueOf(c), sat=(Math.max.apply(null,r)-Math.min.apply(null,r))/Math.max.apply(null,r);
    if(!isNaN(h) && sat>0.15){ if(prevHue!=null && h>prevHue+1.5) monoHue=false; prevHue=h; }
    prev=r;
  }
  console.log((same?"PASS":"FAIL"),"朝霞/晚霞色阶完全一致（统一色阶）");
  console.log((monoG?"PASS":"FAIL"),"绿通道随数值单调不增");
  console.log((monoB?"PASS":"FAIL"),"蓝通道随数值单调不增");
  console.log((monoR?"PASS":"FAIL"),"红通道随数值单调不增");
  console.log((monoHue?"PASS":"FAIL"),"色相单调向红推进（60°→0°）");
  console.log((cont?"PASS":"FAIL"),"1% 步进无跳变（连续渐变）");
  console.log((lum(rampColor("pm",0))>lum(rampColor("pm",100))?"PASS":"FAIL"),
    "亮度：白端("+lum(rampColor("pm",0)).toFixed(1)+") > 红端("+lum(rampColor("pm",100)).toFixed(1)+")");
  const top=hex2rgb(rampColor("pm",100));
  console.log((top[0]>150&&top[0]-top[1]>120&&top[0]-top[2]>120?"PASS":"FAIL"),
    "最高值确为红色 rgb("+top.join(",")+")");
  const mid=hex2rgb(rampColor("pm",33));
  const or_=hex2rgb(rampColor("pm",67));
  /* 锚点位置逐一核对：8 档均分，第 k 档位于 100k/7 % */
  const at=k=>rampColor("pm",100*k/7);
  eqc("锚点1/7＝黄", at(2), "#ffe44d");
  eqc("锚点2/7＝琥珀", at(3), "#ffc220");
  eqc("锚点3/7＝橙", at(4), "#ff9520");
  eqc("锚点4/7＝深橙", at(5), "#fa6a16");
  console.log((hueOf(at(2))>45&&hueOf(at(2))<62?"PASS":"FAIL"),
    "1/7 处确为黄色  色相 "+hueOf(at(2)).toFixed(0)+"°  rgb("+hex2rgb(at(2)).join(",")+")");
  console.log((hueOf(at(4))>22&&hueOf(at(4))<38?"PASS":"FAIL"),
    "3/7 处确为橙色  色相 "+hueOf(at(4)).toFixed(0)+"°  rgb("+hex2rgb(at(4)).join(",")+")");
  console.log((hueOf(at(7))<6?"PASS":"FAIL"),
    "末端确为红色  色相 "+hueOf(at(7)).toFixed(0)+"°  rgb("+hex2rgb(at(7)).join(",")+")");
  console.log("  中间取样 33% rgb("+mid.join(",")+") 色相 "+hueOf(rampColor("pm",33)).toFixed(0)+
    "° | 67% rgb("+or_.join(",")+") 色相 "+hueOf(rampColor("pm",67)).toFixed(0)+"°");
  /* CSS 渐变串必须与 rampColor 逐锚点一致，否则图例和地图会不同色 */
  const css=heatGradientCss();
  const stops=css.replace(/^linear-gradient\(90deg,/,"").replace(/\)$/,"").split(",");
  let cssOK = stops.length===HEAT_RAMP.length;
  stops.forEach((s,i)=>{ const [col,pct]=s.trim().split(" ");
    if(col!==HEAT_RAMP[i]) cssOK=false;
    const want=(i/(HEAT_RAMP.length-1)*100).toFixed(2)+"%";
    if(pct!==want) cssOK=false; });
  console.log((cssOK?"PASS":"FAIL"),"图例 CSS 渐变的 8 个锚点与色阶表逐一对齐 -> "+css.slice(0,58)+"…");
})();

/* ---------------- 观赏质量等级：阈值唯一来源（S3 / B8） ----------------
   阈值此前散在三处（gradeOf、结论卡片文案、地图图例），任何一处单独改动都会
   让"同一个分数在不同位置显示成不同等级"。这里把三处的一致性固定成断言。 */
(function(){
  const eqc=(n,a,b)=>console.log((a===b?"PASS":"FAIL"),n,"=",a,"期望",b);
  const bands=QUALITY_BANDS;
  eqc("等级档数", bands.length, 4);
  eqc("档位按 min 降序", bands.map(b=>b.min).join(","), "80,65,45,0");
  eqc("最高档封顶 100", bands[0].max, 100);
  /* 区间文案只覆盖整数分；相邻档之间必须无缝（下一档上界 = 本档下界 − 1） */
  eqc("区间文案无缝衔接", bands.every((b,i)=> i===bands.length-1 || bands[i+1].max === b.min - 1), true);

  /* 与改造前的 if/else 链逐点等价 —— 这是"重构不改行为"最直接的证明。
     注意跨档边界：分数保留一位小数，79.5 属于「良」而不是「优」，
     与旧实现完全一致（旧实现也只有下界比较）。 */
  const oldGrade=q=>{ if(q>=80) return "优"; if(q>=65) return "良"; if(q>=45) return "一般"; return "差"; };
  let diff=0, n=0, firstDiff="";
  for(let q=-5;q<=105;q+=0.1){
    n++;
    const a=gradeOf(q), b=oldGrade(q);
    if(a!==b){ diff++; if(!firstDiff) firstDiff=" q="+q.toFixed(1)+" 新="+a+" 旧="+b; }
  }
  eqc("与旧 if/else 链逐点等价（"+n+" 个采样点）"+firstDiff, diff, 0);
  /* 落档边界语义：只有 min 决定归属 */
  eqc("79.5 仍属良（旧实现同此）", gradeOf(79.5), "良");
  eqc("非数值入参退回最低档", gradeOf(NaN), "差");

  /* 结论卡片文案：由 gradeOf + QUALITY_LABEL 拼出，必须与旧文案完全一致 */
  const txt=q=>"观赏质量"+(QUALITY_LABEL[gradeOf(q)]||"");
  eqc("文案 85", txt(85), "观赏质量优秀");
  eqc("文案 70", txt(70), "观赏质量良好");
  eqc("文案 50", txt(50), "观赏质量一般");
  eqc("文案 20", txt(20), "观赏质量较差");

  /* 等级色：gradeColor 必须取自同一处定义 */
  eqc("等级色一致性", bands.map(b=>gradeColor(b.key)).join("|"), bands.map(b=>b.color).join("|"));
  eqc("未知等级退默认灰", gradeColor("不存在"), "#8892a0");

  /* 图例代表色位置＝区间中点 */
  eqc("图例代表位置", bands.map(bandMid).join(","), "90,72,54.5,22");
  eqc("图例区间文案", bands.map(b=>bandRangeHtml(b,"分")).join(" / "),
    "80–100 分 / 65–79 分 / 45–64 分 / &lt;45 分");
})();
