
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

/* ---------------- 地图统一色阶：天色色阶（V1 换肤） ----------------
   旧尺是"热力图"式的 白→黄→橙→红：低分＝白，靠**亮度递减**表达强弱。
   地图换成了**天色色阶** —— 颜色就是天空颜色：差＝天色已暗（暮蓝）→
   一般＝暮灰 → 良＝金 → 优＝橙红 → 深红。它与首屏天色带（--dusk-*）同语汇，
   "地图颜色即天空颜色"这件事第一次成立。
   语义变了，断言必须整套重写：旧尺的"通道单调递减 / 色相 60°→0° /
   白端最亮"在新尺下**全部不成立** —— 新尺的亮度是**弧线**（中段暮灰最亮，
   两端暗），通道先升后降。拿着旧断言改期望值等于没测。
   新设计式的不变量（每条都先用 _scratch/measure_ramp.py 实测过再落笔）：
    ① 端点与身份锚点逐值对齐（暮蓝 / 暮灰 / 金 / 深橙 / 深红）；
    ② 朝霞/晚霞同一把尺（地图不区分早晚霞，与首屏天色带同构）；
    ③ 1% 步进无跳变（相邻插值不出现 >8 的通道阶跃）；
    ④ 亮度弧线：峰落在中段暮灰带（30–55%），两端各低于峰 40 以上；
    ⑤ 上暖下冷：v≤40 蓝≥红（冷），v≥60 红>蓝（暖），分界在 45% 附近；
    ⑥ 暖端色相**单向**向红（实测 36.8°→14.3°，不容回摆）；
       冷端色相稳在蓝带（实测 207.9–219.3°）—— 冷端不做单调要求：
       sRGB 上"暮蓝→暮灰"的直线不是等色相线，会有几度漂移；
    ⑦ 顶端确为红色；3/7 处是**中性**暮灰（低饱和，色相无定义）；
       4/7 处确为金色；
    ⑧ 双模对比度下限：白底最差 ≥2.5（图例画在卡片上）、
       深色底图（#3a424e）最差 ≥1.2 —— 后者是方案里记账的"深色模式代价"，
       立下限是为了将来换色时**必须显式**越过这条线，而不是悄悄滑坡。 */
(function(){
  const lum = c => { const r=hex2rgb(c); return 0.2126*r[0]+0.7152*r[1]+0.0722*r[2]; };
  const hueOf = c => { const r=hex2rgb(c); const R=r[0]/255,G=r[1]/255,B=r[2]/255;
    const mx=Math.max(R,G,B), mn=Math.min(R,G,B), d=mx-mn;
    if(d<1e-9) return NaN; let h;
    if(mx===R) h=60*(((G-B)/d)%6); else if(mx===G) h=60*((B-R)/d+2); else h=60*((R-G)/d+4);
    return (h+360)%360; };
  const satOf = c => { const r=hex2rgb(c); return (Math.max.apply(null,r)-Math.min.apply(null,r))/Math.max.apply(null,r); };
  const eqc=(n,a,b)=>console.log((a===b?"PASS":"FAIL"),n,"=",a,"期望",b);
  const ok=(n,c,d)=>console.log((c?"PASS":"FAIL"),n,d==null?"":" "+d);

  eqc("色阶起点＝暮蓝", rampColor("pm",0), "#3c5178");
  eqc("色阶终点＝深红", rampColor("pm",100), "#d14418");
  eqc("朝霞起点＝暮蓝", rampColor("am",0), "#3c5178");
  eqc("朝霞终点＝深红", rampColor("am",100), "#d14418");

  let same=true, cont=true;
  let prev=null;
  for(let i=0;i<=100;i++){
    const c=rampColor("pm",i);
    if(c!==rampColor("am",i)) same=false;
    const r=hex2rgb(c);
    if(prev && (Math.abs(r[0]-prev[0])>8||Math.abs(r[1]-prev[1])>8||Math.abs(r[2]-prev[2])>8)) cont=false;
    prev=r;
  }
  ok("朝霞/晚霞色阶完全一致（统一色阶）", same);
  ok("1% 步进无跳变（连续渐变）", cont);

  /* ④ 亮度弧线：中段最亮、两端暗。旧尺的判据是"白端 > 红端"（单调），
     新尺必须整套换成弧线判据。 */
  const L=[]; for(let i=0;i<=100;i++) L.push(lum(rampColor("pm",i)));
  let lmax=-1, lmaxAt=0;
  for(let i=0;i<=100;i++) if(L[i]>lmax){ lmax=L[i]; lmaxAt=i; }
  ok("亮度峰落在中段暮灰带（30–55%）", lmaxAt>=30 && lmaxAt<=55,
     "峰 "+lmax.toFixed(1)+" @"+lmaxAt+"%");
  ok("亮度弧线：两端各低于峰 40 以上", lmax-L[0]>=40 && lmax-L[100]>=40,
     "峰-起 "+(lmax-L[0]).toFixed(1)+" / 峰-终 "+(lmax-L[100]).toFixed(1));

  /* ⑤ 上暖下冷 + ⑥ 色相分带。sat>0.15 的门与旧尺相同：白色附近彩度极低，
     色相在数值上不稳定，拿它断单调是自找假失败。 */
  let coldAll=true, warmAll=true, firstWarm=-1;
  for(let i=0;i<=100;i++){
    const r=hex2rgb(rampColor("pm",i));
    if(i<=40 && r[2]<r[0]) coldAll=false;
    if(i>=60 && !(r[0]>r[2])) warmAll=false;
    if(firstWarm<0 && r[0]>r[2]) firstWarm=i;
  }
  ok("上暖下冷：v≤40 全冷（蓝≥红）", coldAll);
  ok("上暖下冷：v≥60 全暖（红>蓝）", warmAll);
  ok("冷暖分界在 45% 附近", firstWarm>=40 && firstWarm<=55, "首个暖点 @"+firstWarm+"%");

  let warmBack=0, coldBand=true, prevH=null;
  for(let i=60;i<=100;i++){
    const c=rampColor("pm",i), h=hueOf(c);
    if(!isNaN(h) && satOf(c)>0.15){ if(prevH!=null && h>prevH+1.5) warmBack++; prevH=h; }
  }
  ok("暖端色相单向向红（不容回摆）", warmBack===0, "回摆 "+warmBack+" 次");
  prevH=null;
  for(let i=0;i<=35;i++){
    const c=rampColor("pm",i), h=hueOf(c);
    if(!isNaN(h) && satOf(c)>0.15){
      if(h<195 || h>230) coldBand=false;
      prevH=h;
    }
  }
  ok("冷端色相稳在蓝带（195–230°）", coldBand);

  /* ⑦ 身份锚点：中性暮灰 / 金 / 红端 */
  const at=k=>rampColor("pm",100*k/7);
  eqc("锚点3/7＝暮灰", at(3), "#9b97a4");
  eqc("锚点4/7＝金", at(4), "#b8924a");
  eqc("锚点6/7＝深橙", at(6), "#e05a1f");
  ok("3/7 处为中性暮灰（低饱和）", satOf(at(3))<0.2, "饱和 "+satOf(at(3)).toFixed(3));
  ok("4/7 处确为金色", hueOf(at(4))>=30 && hueOf(at(4))<=48,
     "色相 "+hueOf(at(4)).toFixed(0)+"°  rgb("+hex2rgb(at(4)).join(",")+")");
  ok("末端确为红色", hueOf(at(7))<20, "色相 "+hueOf(at(7)).toFixed(0)+"°");
  const top=hex2rgb(rampColor("pm",100));
  ok("最高值确为红色 rgb("+top.join(",")+")", top[0]>150&&top[0]-top[1]>120&&top[0]-top[2]>120);

  /* ⑧ 双模对比度下限（WCAG）。白底对应图例/卡片，深色底对应压暗后的底图。 */
  const cr=(a,b)=>{ const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);};
    const L1=f(a[0])*0.2126+f(a[1])*0.7152+f(a[2])*0.0722, L2=f(b[0])*0.2126+f(b[1])*0.7152+f(b[2])*0.0722;
    const hi=Math.max(L1,L2), lo=Math.min(L1,L2); return (hi+0.05)/(lo+0.05); };
  let wWorst=1e9, dWorst=1e9;
  HEAT_RAMP.forEach(h=>{ wWorst=Math.min(wWorst,cr(hex2rgb(h),[255,255,255]));
    dWorst=Math.min(dWorst,cr(hex2rgb(h),[58,66,78])); });
  ok("白底最差对比度 ≥2.5（图例在卡片上）", wWorst>=2.5, "实测 "+wWorst.toFixed(2));
  ok("深色底图最差对比度 ≥1.2（已记账的代价下限）", dWorst>=1.2, "实测 "+dWorst.toFixed(2));

  const mid=hex2rgb(rampColor("pm",33)), or_=hex2rgb(rampColor("pm",67));
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
