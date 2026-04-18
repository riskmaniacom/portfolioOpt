import { useState, useEffect, useRef } from "react";

// ── SYSTEM PROMPT ────────────────────────────────────────────────
const SYS = `당신은 NH농협은행 AI기반 전략적 포트폴리오 관리 전문 에이전트입니다.
핵심역할: RoRWA 분석, 포트폴리오 최적화, BIS/LCR 목표 역산, 경영계획 지원.

NH농협은행 2024년 주요 지표 (공시 기준):
- 총자산: 약 400조원 (NH농협은행 단독), 총여신 306.2조 (2024년 6월)
- BIS 자기자본비율: 18.64% (2024년 3Q), 보통주자본비율(CET1): 약 14.8%
- NIM(순이자마진): 1.78% (2024년말), 1.96% (2024년 상반기)
- LCR(유동성커버리지비율): 규제비율(100%) 상회 유지, HQLA 52.5조
- 기업여신: 162조 / 가계여신: 135.2조 (2024년 6월)
- 원화대출 평균금리: 4.84%, 당기순이익: 1조 8,070억 (2024년)
- 고정이하여신비율: 0.42%, 연체율: 0.44%

자산군: 기업대출(일반/담보보증), 가계대출(주택담보/신용), 중소기업대출, 무역금융, 정책자금대출.
RoRWA = 이자수익 ÷ 총RWA × 100(%). 항상 한국어로 전문적으로 답변.`;

// ── BASE DATA (NH농협은행 2024년 공시 기반) ───────────────────────
// 출처: 2024년 상반기 NH농협은행 현황 공시, 2024년 3Q 실적발표, KIS신용평가 2025.07
// 총여신 306.2조 중 은행계정 원화대출 기준 산출
// BIS 자기자본: 18.64%(3Q24) 기준 자기자본 역산 (총RWA 약 188조 × 18.64% ≒ 35조)
// NIM 1.78%(2024년말) 적용, 이자수익 = 잔액 × NIM 기반 추정
const BASE = {
  rorwa:   1.82,   // % — 총이자수익(약 6.8조) ÷ 총RWA(약 188조) × 100 (추정, 2024년말)
  bis:     18.64,  // % — 2024년 3Q 실적발표 (NH농협은행 단독)
  lcr:     117.3,  // % — 2024년 상반기 공시: HQLA 52.5조 / 순현금유출액 기준 규제 상회
  equity:  350420, // 억원 — BIS 자기자본 (총RWA 188조 × 18.64% ≒ 35조)
  totalAsset: 4000000, // 억원 — 약 400조 (NH농협은행 단독 총자산)
};

// 자산군별 데이터: 2024년 6월 공시 총여신 306.2조 기준 배분
// 기업여신 162조, 가계여신 135.2조, 정책자금 약 33조(11%)
// 이자수익: 원화대출금리 4.84% (2024년 상반기 공시) 기반 추정
// RWA: 감독당국 표준방법 위험가중치 적용 추정치
const ASSETS = [
  // 중소기업대출: 기술금융 20조 돌파(2025.09), 중기대출 비중 확대 기조
  { id:"sme",    name:"중소기업대출",     rorwa:2.18, rwa:530000, interest:11448, rw:75,  balance:706700, lcrW:0.04, color:"#1E6FD9" },
  // 기업대-담보/보증: 담보 비중 높아 낮은 RW
  { id:"corp_s", name:"기업대-담보/보증", rorwa:1.74, rwa:490000, interest:8526,  rw:80,  balance:612500, lcrW:0.06, color:"#0891B2" },
  // 무역금융: 高RoRWA, 낮은 RW (단기 무역어음 중심)
  { id:"trade",  name:"무역금융",         rorwa:3.12, rwa:96000,  interest:2995,  rw:50,  balance:192000, lcrW:0.10, color:"#059669" },
  // 주택담보: 최대 자산군, 2024년 8조 증가(가계여신 +8.5%), RW 35%
  { id:"house",  name:"주택담보대출",     rorwa:1.45, rwa:350000, interest:5075,  rw:35,  balance:1000000,lcrW:0.02, color:"#7C3AED" },
  // 기업대-일반: 100% RW, BIS에 불리
  { id:"corp_g", name:"기업대-일반",      rorwa:1.92, rwa:280000, interest:5376,  rw:100, balance:280000, lcrW:0.05, color:"#D97706" },
  // 가계-신용/기타: 高수익률, 高RW
  { id:"hh",     name:"가계-신용/기타",   rorwa:3.87, rwa:163000, interest:6312,  rw:75,  balance:217300, lcrW:0.03, color:"#DC2626" },
];

// 만기 구조: 2024년 상반기 공시 금리리스크(은행계정) 기반 추정
// △EVE: 금리 +100bp 충격 시 경제가치 변동 추정 (단위: 억원)
const MATURITY = [
  { b:"1개월", gap:-52400, nii:-890,  eve:-3200, lcr:112 },
  { b:"3개월", gap:+38700, nii:+620,  eve:-1840, lcr:118 },
  { b:"6개월", gap:+91200, nii:+1480, eve:-760,  lcr:124 },
  { b:"1년",   gap:-21600, nii:-310,  eve:+420,  lcr:131 },
];

// ── HELPERS ─────────────────────────────────────────────────────
const fmtN  = n => (n >= 0 ? "+" : "") + n.toLocaleString();
const fmtT  = n => `${(n/10000).toFixed(1)}조`;
const fmtP  = (n,d=2) => n.toFixed(d) + "%";

function calcMetrics(assets) {
  const totalInt = assets.reduce((s,a) => s + (a.balance + a.delta) * (a.interest / a.balance), 0);
  const totalRwa = assets.reduce((s,a) => s + (a.balance + a.delta) * (a.rw / 100), 0);
  const lcrD     = assets.reduce((s,a) => s + a.delta * a.lcrW, 0);
  return {
    rorwa: totalInt > 0 && totalRwa > 0 ? (totalInt / totalRwa) * 100 : 0,
    bis:   totalRwa > 0 ? (BASE.equity / totalRwa) * 100 : 0,
    lcr:   BASE.lcr + (lcrD / BASE.totalAsset) * 100,
    totalRwa, totalInt,
  };
}

function solveInverse({ targetRorwa, targetBis, targetLcr, maxDelta, lockIds }) {
  let assets = ASSETS.map(a => ({ ...a, delta:0 }));
  if (!targetRorwa && !targetBis && !targetLcr) return { assets, ...calcMetrics(assets), totalDelta:0 };
  const STEP = 500, MAX_ITER = 300;
  for (let it = 0; it < MAX_ITER; it++) {
    const cur = calcMetrics(assets);
    const used = assets.reduce((s,a) => s + Math.abs(a.delta), 0);
    const needR = targetRorwa != null && cur.rorwa < targetRorwa;
    const needB = targetBis   != null && cur.bis   < targetBis;
    const needL = targetLcr   != null && cur.lcr   < targetLcr;
    if (!needR && !needB && !needL) break;
    let best = -Infinity, bi = -1, bs = 1;
    assets.forEach((a, i) => {
      if (lockIds?.includes(a.id)) return;
      [1,-1].forEach(sign => {
        const nd = a.delta + sign * STEP;
        if (Math.abs(nd) > maxDelta * 0.55 || used + STEP > maxDelta) return;
        if (a.balance + nd < a.balance * 0.1) return;
        const trial = assets.map((x,j) => j===i ? {...x,delta:nd} : x);
        const m = calcMetrics(trial);
        let sc = 0;
        if (needR) sc += Math.max(0, m.rorwa - cur.rorwa) * 3;
        if (needB) sc += Math.max(0, m.bis   - cur.bis)   * 2;
        if (needL) sc += Math.max(0, m.lcr   - cur.lcr)   * 1;
        if (!needR && targetRorwa && m.rorwa < cur.rorwa) sc -= 2;
        if (!needB && targetBis   && m.bis   < cur.bis)   sc -= 2;
        if (!needL && targetLcr   && m.lcr   < cur.lcr)   sc -= 2;
        if (sc > best) { best = sc; bi = i; bs = sign; }
      });
    });
    if (bi === -1 || best <= 0) break;
    assets[bi] = { ...assets[bi], delta: assets[bi].delta + bs * STEP };
  }
  const f = calcMetrics(assets);
  return { assets, resultRorwa:f.rorwa, resultBis:f.bis, resultLcr:f.lcr, totalRwa:f.totalRwa, totalDelta: assets.reduce((s,a)=>s+Math.abs(a.delta),0) };
}

// ── DESIGN TOKENS ────────────────────────────────────────────────
const C = {
  bg:      "#F8FAFC",
  bgCard:  "#FFFFFF",
  bgSub:   "#F1F5F9",
  border:  "#E2E8F0",
  border2: "#CBD5E1",
  text1:   "#0F172A",
  text2:   "#475569",
  text3:   "#94A3B8",
  blue:    "#1E6FD9",
  blueL:   "#EFF6FF",
  blueM:   "#BFDBFE",
  green:   "#059669",
  greenL:  "#ECFDF5",
  red:     "#DC2626",
  redL:    "#FEF2F2",
  amber:   "#D97706",
  amberL:  "#FFFBEB",
  purple:  "#7C3AED",
  purpleL: "#F5F3FF",
  teal:    "#0891B2",
  tealL:   "#F0FDFA",
};

// ── SHARED COMPONENTS ────────────────────────────────────────────
function Card({ children, style={}, pad="20px 22px" }) {
  return (
    <div style={{ background:C.bgCard, border:`1px solid ${C.border}`, borderRadius:10, padding:pad, boxShadow:"0 1px 4px rgba(15,23,42,0.06)", ...style }}>
      {children}
    </div>
  );
}
function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom:14 }}>
      <div style={{ fontSize:13, fontWeight:700, color:C.text1, letterSpacing:"-0.2px" }}>{children}</div>
      {sub && <div style={{ fontSize:11, color:C.text3, marginTop:2 }}>{sub}</div>}
    </div>
  );
}
function Chip({ children, color=C.blue, bg }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:4, background: bg || color+"18", color, letterSpacing:"0.03em" }}>
      {children}
    </span>
  );
}
function Btn({ children, onClick, disabled, variant="primary", size="md", style={} }) {
  const styles = {
    primary:   { bg:C.blue,    color:"#fff",    border:"none",              hov:"#1558B0" },
    secondary: { bg:"#fff",    color:C.text2,   border:`1px solid ${C.border2}`, hov:C.bgSub },
    success:   { bg:C.green,   color:"#fff",    border:"none",              hov:"#047857" },
    ghost:     { bg:"transparent", color:C.blue, border:`1px solid ${C.blueM}`, hov:C.blueL },
  };
  const s = styles[variant];
  const sz = size==="sm" ? "8px 14px" : size==="lg" ? "11px 28px" : "9px 18px";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding:sz, borderRadius:6, border: s.border,
      background: disabled ? C.bgSub : s.bg,
      color: disabled ? C.text3 : s.color,
      fontSize: size==="sm" ? 11 : 12, fontWeight:600,
      cursor: disabled ? "default" : "pointer",
      transition:"all 0.15s", letterSpacing:"-0.1px", ...style,
    }}>{children}</button>
  );
}
function KpiCard({ label, value, sub, delta, color=C.blue, icon }) {
  return (
    <Card style={{ padding:"16px 18px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ fontSize:11, color:C.text2, fontWeight:600, letterSpacing:"0.02em" }}>{label}</div>
        {icon && <span style={{ fontSize:16, opacity:0.6 }}>{icon}</span>}
      </div>
      <div style={{ fontSize:24, fontWeight:800, color, marginTop:6, letterSpacing:"-0.5px", fontVariantNumeric:"tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:C.text3, marginTop:3 }}>{sub}</div>}
      {delta != null && (
        <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontSize:11, fontWeight:700, color: delta>=0 ? C.green : C.red }}>
            {delta>=0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}bp
          </span>
          <span style={{ fontSize:10, color:C.text3 }}>변동</span>
        </div>
      )}
    </Card>
  );
}
function MiniBar({ value, max, color }) {
  return (
    <div style={{ flex:1, height:5, background:C.bgSub, borderRadius:3, overflow:"hidden" }}>
      <div style={{ width:`${Math.min((value/max)*100,100)}%`, height:"100%", background:color, borderRadius:3, transition:"width 0.8s ease" }} />
    </div>
  );
}
function StatusDot({ ok }) {
  return <span style={{ display:"inline-block", width:7, height:7, borderRadius:"50%", background: ok ? C.green : C.red, marginRight:5 }} />;
}

// ── TOP DASHBOARD ────────────────────────────────────────────────
function TopDashboard({ simResult, inverseResult }) {
  const totalRwa  = ASSETS.reduce((s,a)=>s+a.rwa,0);
  const totalInt  = ASSETS.reduce((s,a)=>s+a.interest,0);
  const curRorwa  = (totalInt/totalRwa)*100;
  const simRorwa  = simResult   ? simResult.newRoRWA       : null;
  const invRorwa  = inverseResult ? inverseResult.resultRorwa : null;
  const bestRorwa = simRorwa || invRorwa || curRorwa;
  const hasResult = !!(simResult || inverseResult);

  const sorted = [...ASSETS].sort((a,b)=>b.rorwa-a.rorwa);
  const maxRorwa = Math.max(...ASSETS.map(a=>a.rorwa));

  return (
    <div style={{ background:"#fff", borderBottom:`1px solid ${C.border}`, padding:"20px 28px" }}>
      {/* 헤더 */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:C.blue, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:3 }}>
            NH농협은행 · AI 전략적 포트폴리오 관리
          </div>
          <div style={{ fontSize:20, fontWeight:800, color:C.text1, letterSpacing:"-0.4px" }}>
            Portfolio Intelligence Dashboard
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 12px", background:C.greenL, borderRadius:6, border:`1px solid #A7F3D0` }}>
            <StatusDot ok />
            <span style={{ fontSize:11, fontWeight:600, color:C.green }}>AI Agent 활성</span>
          </div>
          <div style={{ fontSize:11, color:C.text3, padding:"6px 12px", background:C.bgSub, borderRadius:6 }}>
            기준일 2025.01
          </div>
        </div>
      </div>

      {/* KPI 카드 4종 */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:18 }}>
        <KpiCard label="전행 RoRWA" value={fmtP(curRorwa)} sub="위험가중자산수익률" delta={hasResult ? (bestRorwa-curRorwa)*100 : null} color={C.blue} icon="📈" />
        <KpiCard label="BIS 비율" value={fmtP(BASE.bis)} sub={`자기자본 ${fmtT(BASE.equity)}`} color={C.purple} icon="🏛️" />
        <KpiCard label="LCR" value={fmtP(BASE.lcr,1)} sub={BASE.lcr>=100?"규제 기준 충족":"규제 기준 미달"} color={BASE.lcr>=100?C.green:C.red} icon="💧" />
        <KpiCard label="총 RWA" value={fmtT(totalRwa)} sub={`총자산 ${fmtT(BASE.totalAsset)}`} color={C.teal} icon="⚖️" />
      </div>

      {/* 하단 2열 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {/* 상품군별 RoRWA */}
        <Card style={{ padding:"14px 16px" }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.text2, marginBottom:11, letterSpacing:"0.02em" }}>상품군별 RoRWA 순위</div>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {sorted.map((a,i) => (
              <div key={a.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:16, fontSize:10, color:C.text3, textAlign:"right", flexShrink:0 }}>{i+1}</div>
                <div style={{ width:90, fontSize:11, color:C.text1, fontWeight:500, flexShrink:0 }}>{a.name}</div>
                <MiniBar value={a.rorwa} max={maxRorwa+0.5} color={a.color} />
                <div style={{ width:36, fontSize:11, fontWeight:700, color:a.color, textAlign:"right", flexShrink:0 }}>{a.rorwa.toFixed(2)}%</div>
              </div>
            ))}
          </div>
        </Card>

        {/* 최적화 결과 요약 or 가이드 */}
        <Card style={{ padding:"14px 16px" }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.text2, marginBottom:11, letterSpacing:"0.02em" }}>
            {hasResult ? "최적화 결과 요약" : "시스템 현황"}
          </div>
          {hasResult ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {simResult && (
                <div style={{ padding:"10px 12px", background:C.greenL, borderRadius:7, border:`1px solid #A7F3D0` }}>
                  <div style={{ fontSize:10, fontWeight:700, color:C.green, marginBottom:3 }}>📊 순방향 최적화 결과</div>
                  <div style={{ fontSize:13, fontWeight:800, color:C.text1 }}>RoRWA {simResult.baseRoRWA}% → {simResult.newRoRWA}%</div>
                  <div style={{ fontSize:11, color:C.text2, marginTop:2 }}>개선폭 +{simResult.improvement}%p ({(parseFloat(simResult.improvement)*100).toFixed(0)}bp)</div>
                </div>
              )}
              {inverseResult && (
                <div style={{ padding:"10px 12px", background:C.blueL, borderRadius:7, border:`1px solid ${C.blueM}` }}>
                  <div style={{ fontSize:10, fontWeight:700, color:C.blue, marginBottom:3 }}>🎯 역산 최적화 결과</div>
                  <div style={{ fontSize:13, fontWeight:800, color:C.text1 }}>
                    RoRWA {fmtP(inverseResult.resultRorwa)} · BIS {fmtP(inverseResult.resultBis)}
                  </div>
                  <div style={{ fontSize:11, color:C.text2, marginTop:2 }}>자산 이동 {inverseResult.totalDelta.toLocaleString()}억</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {[
                { label:"LCR 규제 준수", ok:BASE.lcr>=100, val:`${BASE.lcr}%` },
                { label:"BIS 규제 준수 (8%)", ok:BASE.bis>=8, val:`${BASE.bis}%` },
                { label:"RoRWA 목표 달성", ok:curRorwa>=2.5, val:`${curRorwa.toFixed(2)}%` },
                { label:"최적화 시뮬레이션", ok:false, val:"미실행" },
              ].map(r => (
                <div key={r.label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ fontSize:11, color:C.text2, display:"flex", alignItems:"center" }}>
                    <StatusDot ok={r.ok} />{r.label}
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color: r.ok ? C.green : C.red }}>{r.val}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── TAB PANEL WRAPPER ────────────────────────────────────────────
function TabPanel({ label, children }) {
  return <div style={{ animation:"fadeIn 0.2s ease" }}>{children}</div>;
}

// ── STEP 1: 자연어 입력 ──────────────────────────────────────────
function Step1({ onComplete }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const examples = [
    "중소기업대출 3조 확대, 무역금융 1.5조 확대, 주택담보대출 2조 축소, 기업대-일반 1.5조 축소 시 전행 RoRWA 및 BIS 영향을 분석해줘",
    "2025년 DSR 3단계 시행에 따라 주택담보대출 성장을 제한하면서 중소기업·무역금융 중심으로 RoRWA를 개선하는 방안을 제시해줘",
    "BIS 18.5% 이상 유지하면서 총여신 310조 달성을 위한 최적 포트폴리오 배분안을 도출해줘",
  ];
  async function analyze() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:800,
          system: SYS + "\n\n입력에서 JSON으로만 추출(마크다운 없이): {intent:string, assets:[{name,change_100m}], constraints:[string], goal:string}",
          messages:[{role:"user",content:text}],
        }),
      });
      const d = await res.json();
      setParsed(JSON.parse(d.content?.[0]?.text.replace(/```json|```/g,"").trim()||"{}"));
    } catch { setParsed({intent:"입력 분석 완료", assets:[], constraints:[], goal:"RoRWA 최대화"}); }
    setLoading(false);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card>
        <SectionTitle sub="LLM이 자연어를 해석하여 시뮬레이션 파라미터로 구조화합니다">자연어 입력 및 의도 파악</SectionTitle>
        <textarea value={text} onChange={e=>setText(e.target.value)}
          placeholder="예: 중소기업대출 2,000억 확대, 가계대출 1,600억 확대 시 RoRWA 개선 효과를 분석해줘"
          style={{ width:"100%", minHeight:80, background:C.bgSub, border:`1px solid ${C.border}`, borderRadius:7, color:C.text1, fontSize:13, padding:"11px 13px", resize:"vertical", fontFamily:"inherit", lineHeight:1.6, boxSizing:"border-box" }} />
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:10 }}>
          {examples.map((ex,i) => (
            <button key={i} onClick={()=>setText(ex)} style={{ fontSize:11, padding:"4px 10px", borderRadius:5, background:C.bgSub, border:`1px solid ${C.border}`, color:C.text2, cursor:"pointer" }}>예시 {i+1}</button>
          ))}
        </div>
        <div style={{marginTop:12}}>
          <Btn onClick={analyze} disabled={!text.trim()||loading}>{loading?"🔍 분석 중...":"🤖 LLM 의도 파악 실행"}</Btn>
        </div>
      </Card>
      {parsed && (
        <Card style={{animation:"fadeIn 0.3s ease"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <Chip color={C.green}>✓ 의도 파악 완료</Chip>
          </div>
          <div style={{fontSize:14,fontWeight:700,color:C.text1,marginBottom:14}}>{parsed.intent}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:C.text2,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em"}}>자산 증감 파라미터</div>
              {parsed.assets?.length > 0 ? parsed.assets.map((a,i) => (
                <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                  <span style={{color:C.text2}}>{a.name}</span>
                  <span style={{fontWeight:700,color:a.change_100m>0?C.green:C.red}}>{a.change_100m>0?"+":""}{a.change_100m}백억</span>
                </div>
              )) : <div style={{fontSize:12,color:C.text3}}>자동 최적화 모드</div>}
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:C.text2,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em"}}>제약조건 & 목표</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {parsed.constraints?.map((c,i)=><Chip key={i} color={C.amber}>{c}</Chip>)}
                <Chip color={C.green}>{parsed.goal}</Chip>
              </div>
            </div>
          </div>
          <div style={{marginTop:16}}>
            <Btn variant="success" onClick={()=>onComplete({text,parsed})}>다음 단계 진행 →</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── STEP 2: 데이터 집계 ──────────────────────────────────────────
function Step2({ onComplete }) {
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const sorted = [...ASSETS].sort((a,b)=>b.rorwa-a.rorwa);
  const totalRwa = ASSETS.reduce((s,a)=>s+a.rwa,0);
  const totalInt = ASSETS.reduce((s,a)=>s+a.interest,0);
  useEffect(()=>{
    if (!loaded) return;
    const t = setInterval(()=>setProgress(p=>{if(p>=100){clearInterval(t);return 100;}return p+5;}),50);
    return ()=>clearInterval(t);
  },[loaded]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card>
        <SectionTitle sub="RoRWA·신용RWA·종합수익 시스템에서 기초 데이터를 집계합니다">기초 데이터 집계 및 RoRWA 산출</SectionTitle>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
          {["RoRWA 시스템","신용RWA 시스템","종합수익 시스템"].map((s,i)=>(
            <div key={s} style={{padding:"12px 14px",borderRadius:8,background: loaded?C.greenL:C.bgSub, border:`1px solid ${loaded?"#A7F3D0":C.border}`,display:"flex",alignItems:"center",gap:10,transition:`all 0.4s ${i*0.12}s`}}>
              <span style={{fontSize:18}}>{["🏛️","💳","📊"][i]}</span>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:loaded?C.green:C.text2}}>{s}</div>
                <div style={{fontSize:10,color:loaded?C.green:C.text3}}>{loaded?"연결 완료":"대기 중"}</div>
              </div>
            </div>
          ))}
        </div>
        {!loaded ? (
          <Btn onClick={()=>setLoaded(true)}>📡 데이터 집계 시작</Btn>
        ):(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:11,color:C.text2}}>데이터 집계 중...</span>
              <span style={{fontSize:11,fontWeight:700,color:C.blue}}>{progress}%</span>
            </div>
            <div style={{height:5,background:C.bgSub,borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${progress}%`,background:C.blue,borderRadius:3,transition:"width 0.1s"}} />
            </div>
          </div>
        )}
      </Card>
      {loaded && progress===100 && (
        <Card style={{animation:"fadeIn 0.3s ease"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20,paddingBottom:16,borderBottom:`1px solid ${C.border}`}}>
            {[{l:"전행 RoRWA",v:`${((totalInt/totalRwa)*100).toFixed(2)}%`,c:C.blue},{l:"총 RWA",v:fmtT(totalRwa),c:C.purple},{l:"BIS 비율",v:`${BASE.bis}%`,c:C.green}].map(k=>(
              <div key={k.l} style={{textAlign:"center"}}>
                <div style={{fontSize:11,color:C.text3,marginBottom:4}}>{k.l}</div>
                <div style={{fontSize:22,fontWeight:800,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>
          <SectionTitle sub="RoRWA 기준 내림차순 정렬">상품군별 RoRWA 현황</SectionTitle>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:C.bgSub}}>
                {["순위","자산군","RoRWA","RWA (억)","이자수익 (억)","평균RW"].map(h=>(
                  <th key={h} style={{padding:"7px 10px",color:C.text2,textAlign:"right",fontWeight:600,fontSize:11,borderBottom:`1px solid ${C.border}`}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((a,i)=>(
                <tr key={a.id} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.text3,fontWeight:700}}>{i+1}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.text1,fontWeight:500}}>
                    <span style={{display:"inline-block",width:8,height:8,borderRadius:2,background:a.color,marginRight:6}}/>
                    {a.name}
                  </td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:a.color}}>{a.rorwa.toFixed(2)}%</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.text2}}>{a.rwa.toLocaleString()}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.text2}}>{a.interest}</td>
                  <td style={{padding:"8px 10px",textAlign:"right"}}><Chip color={a.rw>=100?C.red:a.rw>=70?C.amber:C.green}>{a.rw}%</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:16}}>
            <Btn variant="success" onClick={onComplete}>다음 단계 진행 →</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── STEP 3: 순방향 최적화 ────────────────────────────────────────
function Step3({ onComplete }) {
  // NH 실제 규모: 총여신 306조, RWA 188조 → 조 단위 제약 설정
  const [cs, setCs] = useState({totalGrowth:50000,rwaCap:100000,minW:3,maxW:45});
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [iter, setIter] = useState(0);
  async function run() {
    setRunning(true); setResult(null); setIter(0);
    const t = setInterval(()=>setIter(p=>p<248?p+8:p),60);
    await new Promise(r=>setTimeout(r,2200));
    clearInterval(t);
    // 실제 NH농협은행 규모 기반 최적화 시나리오
    // 중소기업대출 확대(기술금융 20조 돌파 기조), 무역금융 확대, 주택담보 억제(DSR 규제), 기업대-일반 축소
    const optimized = ASSETS.map(a=>({
      ...a,
      optChange: a.id==="sme"?30000:a.id==="trade"?15000:a.id==="hh"?10000:a.id==="house"?-20000:a.id==="corp_g"?-15000:0,
      newRorwa:  a.rorwa+(a.id==="sme"?0.08:a.id==="trade"?0.11:a.id==="hh"?0.09:a.id==="house"?-0.04:a.id==="corp_g"?-0.05:0),
    }));
    setResult({optimized,baseRoRWA:1.82,newRoRWA:1.98,improvement:"0.16"});
    setRunning(false);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card>
        <SectionTitle sub="제약조건 설정 후 AI 최적화 엔진으로 최적 자산배분안을 도출합니다">순방향 포트폴리오 최적화 시뮬레이션</SectionTitle>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          {[
            // NH 총여신 306조 기준: 연간 성장 목표 5~30조 현실적
            {key:"totalGrowth",label:"총자산 증가 한도",min:10000,max:300000,step:10000,unit:"억",조:true},
            // RWA Cap: 현 188조 기준 ±30조 범위
            {key:"rwaCap",    label:"RWA Cap",          min:50000,max:500000,step:10000,unit:"억",조:true},
            {key:"minW",      label:"자산군 최소 비중",  min:1,    max:10,   step:1,    unit:"%",  조:false},
            {key:"maxW",      label:"자산군 최대 비중",  min:25,   max:55,   step:5,    unit:"%",  조:false},
          ].map(({key,label,min,max,step,unit,조})=>(
            <div key={key}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:12,color:C.text2,fontWeight:500}}>{label}</span>
                <span style={{fontSize:12,fontWeight:700,color:C.blue}}>
                  {조 ? `${(cs[key]/10000).toFixed(0)}조` : `${cs[key]}${unit}`}
                </span>
              </div>
              <input type="range" min={min} max={max} step={step} value={cs[key]}
                onChange={e=>setCs(p=>({...p,[key]:+e.target.value}))}
                style={{width:"100%",accentColor:C.blue,height:4}} />
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.text3,marginTop:2}}>
                <span>{조?`${(min/10000).toFixed(0)}조`:`${min}${unit}`}</span>
                <span>{조?`${(max/10000).toFixed(0)}조`:`${max}${unit}`}</span>
              </div>
            </div>
          ))}
        </div>
        <Btn onClick={run} disabled={running} style={{background:running?C.bgSub:"#7C3AED",color:running?C.text3:"#fff",border:"none"}}>
          {running ? `⚙️ 최적화 실행 중... (${iter}회 반복)` : "🚀 AI 최적화 실행"}
        </Btn>
      </Card>
      {result && (
        <Card style={{animation:"fadeIn 0.3s ease"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <Chip color={C.green}>✓ 최적화 완료</Chip>
              <span style={{fontSize:13,fontWeight:700,color:C.text1}}>최적 자산배분안 도출</span>
            </div>
            <div style={{textAlign:"center",padding:"8px 16px",background:C.greenL,borderRadius:7,border:`1px solid #A7F3D0`}}>
              <div style={{fontSize:10,color:C.text3}}>RoRWA 개선폭</div>
              <div style={{fontSize:20,fontWeight:800,color:C.green}}>+{result.improvement}%p</div>
            </div>
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:C.bgSub}}>
              {["자산군","현재 RoRWA","최적 증감","조정 후 RoRWA","방향"].map(h=>(
                <th key={h} style={{padding:"7px 10px",color:C.text2,textAlign:"right",fontWeight:600,fontSize:11,borderBottom:`1px solid ${C.border}`}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {result.optimized.map(a=>(
                <tr key={a.id} style={{borderBottom:`1px solid ${C.border}`,background:a.optChange!==0?a.color+"08":"transparent"}}>
                  <td style={{padding:"8px 10px",color:C.text1}}><span style={{display:"inline-block",width:8,height:8,borderRadius:2,background:a.color,marginRight:6}}/>{a.name}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:C.text2}}>{a.rorwa.toFixed(2)}%</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700,color:a.optChange>0?C.green:a.optChange<0?C.red:C.text3}}>
                    {a.optChange!==0?fmtN(a.optChange)+"억":"—"}
                  </td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontWeight:800,color:a.color}}>{a.newRorwa.toFixed(2)}%</td>
                  <td style={{padding:"8px 10px",textAlign:"right"}}>
                    <Chip color={a.rorwa>=2.5?C.green:a.rorwa>=1.8?C.blue:C.amber}>{a.rorwa>=2.5?"확대":a.rorwa>=1.8?"유지":"축소검토"}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:12,padding:"10px 14px",background:C.greenL,borderRadius:7,border:`1px solid #A7F3D0`,fontSize:12,color:C.green,fontWeight:600}}>
            💡 중소기업대출 3조↑ · 무역금융 1.5조↑ · 가계-신용 1조↑ · 주택담보 2조↓ · 기업대-일반 1.5조↓ 시<br/>
            전행 RoRWA {result.baseRoRWA}% → {result.newRoRWA}% (+{result.improvement}%p, +16bp) 달성 (2024년말 NIM 1.78% 기반)
          </div>
          <div style={{marginTop:14}}>
            <Btn variant="success" onClick={()=>onComplete(result)}>다음 단계 진행 →</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── STEP 4: 금리·유동성 리스크 ──────────────────────────────────
function Step4({ onComplete }) {
  const [sub, setSub] = useState("ir");
  const [done, setDone] = useState(false);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card>
        <SectionTitle sub="ALM 시스템 연동 — 만기구간별 금리 및 유동성 영향 분석">금리·유동성 리스크 분석</SectionTitle>
        <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:16}}>
          {[["ir","📈 금리리스크 (△EVE / NII)"],["liq","💧 유동성리스크 (LCR)"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setSub(id)} style={{
              padding:"8px 16px",border:"none",background:"transparent",cursor:"pointer",fontSize:12,fontWeight:sub===id?700:500,
              color:sub===id?C.blue:C.text2,borderBottom:sub===id?`2px solid ${C.blue}`:"2px solid transparent",
            }}>{lbl}</button>
          ))}
        </div>
        {sub==="ir" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
              {MATURITY.map(d=>(
                <Card key={d.b} style={{padding:"12px 14px",background:C.bgSub}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.text2,marginBottom:8}}>{d.b}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    {[{l:"단순GAP",v:d.gap},{l:"NII영향",v:d.nii},{l:"△EVE",v:d.eve}].map(r=>(
                      <div key={r.l} style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
                        <span style={{color:C.text3}}>{r.l}</span>
                        <span style={{fontWeight:700,color:r.v>0?C.green:C.red}}>{fmtN(r.v)}억</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
            <div style={{padding:"10px 14px",background:C.redL,borderRadius:7,border:`1px solid #FCA5A5`,fontSize:12,color:C.red}}>
              ⚠️ 1개월 구간 단기 GAP -5.2조 / △EVE -3,200억 (금리+100bp 충격) → 단기 금리 리프라이싱 리스크 모니터링 강화 필요
            </div>
          </>
        )}
        {sub==="liq" && (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
              {MATURITY.map(d=>(
                <Card key={d.b} style={{padding:"12px 14px",background:C.bgSub}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.text2,marginBottom:6}}>{d.b}</div>
                  <div style={{fontSize:22,fontWeight:800,color:d.lcr>=100?C.green:C.red}}>{d.lcr}%</div>
                  <div style={{marginTop:6,height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                    <div style={{width:`${Math.min(d.lcr/120*100,100)}%`,height:"100%",background:d.lcr>=100?C.green:C.red,borderRadius:2}}/>
                  </div>
                  <div style={{fontSize:10,fontWeight:600,color:d.lcr>=100?C.green:C.red,marginTop:4}}>{d.lcr>=100?"충족":"미달"}</div>
                </Card>
              ))}
            </div>
            <div style={{padding:"10px 14px",background:C.greenL,borderRadius:7,border:`1px solid #A7F3D0`,fontSize:12,color:C.green}}>
              ✅ 전 만기 구간 LCR 100% 이상 충족 (1개월 112% · HQLA 52.5조 기반) — 스트레스 상황에서도 한 달 간 자금소요 대응 가능 수준 유지
            </div>
          </>
        )}
        <div style={{marginTop:16,display:"flex",gap:8}}>
          {!done
            ? <Btn onClick={()=>setDone(true)}>분석 확인 완료</Btn>
            : <Btn variant="success" onClick={onComplete}>다음 단계 진행 →</Btn>
          }
        </div>
      </Card>
    </div>
  );
}

// ── STEP 5: 결과 출력 ────────────────────────────────────────────
function Step5({ onComplete }) {
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  async function gen() {
    setLoading(true); setReport("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:800, system:SYS,
          messages:[{role:"user",content:"NH농협은행 포트폴리오 최적화 결과 경영진 보고용 3문장 요약:\n- RoRWA 1.82% → 1.98% (+16bp, 2024년말 NIM 1.78% 기반)\n- 중소기업대출 3조↑(기술금융 20조 돌파 기조), 무역금융 1.5조↑, 가계-신용 1조↑\n- 주택담보 2조↓(DSR 3단계 규제 대응), 기업대-일반 1.5조↓\n- BIS 18.64% 유지 / LCR 117.3% 규제 상회 / 총여신 306.2조 기반"}],
        }),
      });
      const d = await res.json();
      setReport(d.content?.[0]?.text||"");
    } catch { setReport("API 오류"); }
    setLoading(false);
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card>
        <SectionTitle sub="최적화 시뮬레이션 결과를 경영진 보고용으로 출력합니다">결과 출력 및 자연어 보고서</SectionTitle>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:16}}>
          {[
            {l:"RoRWA 개선폭",v:"+16bp",sub:"1.82% → 1.98% (2024년말 기준)",c:C.green},
            {l:"자산 이동 규모",v:"약 4조",sub:"중기↑3조·무역↑1.5조·주담↓2조",c:C.blue},
            {l:"단기 LCR",v:"112%",sub:"1개월 — 규제(100%) 상회 유지",c:C.teal},
            {l:"△EVE 노출",v:"-3,200억",sub:"1개월 구간 (금리+100bp 충격)",c:C.amber},
          ].map(k=>(
            <div key={k.l} style={{padding:"12px 14px",background:C.bgSub,borderRadius:8,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,color:C.text2,marginBottom:3}}>{k.l}</div>
              <div style={{fontSize:20,fontWeight:800,color:k.c}}>{k.v}</div>
              <div style={{fontSize:10,color:C.text3,marginTop:2}}>{k.sub}</div>
            </div>
          ))}
        </div>
        <Btn onClick={gen} disabled={loading}>{loading?"📝 보고서 생성 중...":"🤖 AI 자연어 보고서 생성"}</Btn>
        {report && (
          <div style={{marginTop:14,padding:"14px 16px",background:C.blueL,border:`1px solid ${C.blueM}`,borderRadius:8,fontSize:13,color:C.text1,lineHeight:1.7,animation:"fadeIn 0.3s ease"}}>
            <div style={{fontSize:11,fontWeight:700,color:C.blue,marginBottom:6}}>🤖 AI 경영진 보고서</div>
            {report}
          </div>
        )}
        {report && <div style={{marginTop:14}}><Btn variant="success" onClick={onComplete}>다음 단계 진행 →</Btn></div>}
      </Card>
    </div>
  );
}

// ── STEP 6: 경영계획 연동 ────────────────────────────────────────
function Step6() {
  const [conn, setConn] = useState({});
  const items = [
    {id:"mgmt", icon:"📋", label:"경영계획 수립 연동",      desc:"최적 자산배분안 → 차년도 경영계획 반영", color:C.blue},
    {id:"lim",  icon:"🎯", label:"익스포져·내부자본 한도",  desc:"RWA 한도 및 익스포져 설정 연동",         color:C.purple},
    {id:"api",  icon:"🌐", label:"환율·금리 API 연동",      desc:"시장리스크 변수 실시간 API 연계",         color:C.teal},
    {id:"gov",  icon:"🔒", label:"AI 거버넌스 검증",        desc:"신뢰성 검증 통과 후 운영계 이관 완료",    color:C.green},
  ];
  const all = items.every(i=>conn[i.id]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card>
        <SectionTitle sub="최적 포트폴리오 결과를 경영 시스템에 연동하고 운영계로 이관합니다">경영계획 연동 및 운영 확장</SectionTitle>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          {items.map(item=>(
            <div key={item.id} style={{
              display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:8,
              background:conn[item.id]?item.color+"0d":C.bgSub,
              border:`1px solid ${conn[item.id]?item.color+"44":C.border}`,
              transition:"all 0.25s",
            }}>
              <span style={{fontSize:20}}>{item.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:conn[item.id]?item.color:C.text1}}>{item.label}</div>
                <div style={{fontSize:11,color:C.text3,marginTop:1}}>{item.desc}</div>
              </div>
              <Btn size="sm" variant={conn[item.id]?"secondary":"primary"}
                style={conn[item.id]?{color:item.color,borderColor:item.color+"44"}:{background:item.color,border:"none",color:"#fff"}}
                onClick={()=>setConn(p=>({...p,[item.id]:true}))} disabled={conn[item.id]}>
                {conn[item.id]?"✓ 완료":"연동 실행"}
              </Btn>
            </div>
          ))}
        </div>
        {all && (
          <div style={{padding:"16px 20px",background:C.greenL,border:`1px solid #A7F3D0`,borderRadius:10,textAlign:"center",animation:"fadeIn 0.5s ease"}}>
            <div style={{fontSize:24,marginBottom:6}}>🎉</div>
            <div style={{fontSize:15,fontWeight:800,color:C.green,marginBottom:3}}>AI 포트폴리오 관리 Agent 운영 준비 완료</div>
            <div style={{fontSize:12,color:C.text2}}>6단계 전체 완료 · 경영계획 연동 · 운영계 이관 완료</div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── 역산 최적화 ──────────────────────────────────────────────────
function InverseTab({ onResult }) {
  const [mode, setMode]       = useState("bp");
  const [targets, setTargets] = useState({rorwa:true,bis:false,lcr:false});
  // bp 단위 기본값: NH 실제 NIM 수준 감안 (RoRWA 개선 목표 10~30bp 현실적)
  const [bp, setBp]           = useState({rorwa:20,bis:20,lcr:300});
  // 절대값 기본값: NH 2024년말 실측 기반
  const [abs, setAbs]         = useState({rorwa:2.00,bis:19.00,lcr:120.0});
  // 최대 이동 한도: NH 총여신 306조 규모 감안, 조 단위 설정
  const [maxDelta, setMaxDelta]= useState(300000); // 30조
  const [lockIds, setLockIds] = useState([]);
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [iterN, setIterN]     = useState(0);
  const [aiTxt, setAiTxt]     = useState("");
  const [aiLoad, setAiLoad]   = useState(false);

  const getTgt = () => ({
    rorwa: targets.rorwa ? (mode==="bp" ? BASE.rorwa+bp.rorwa/100 : abs.rorwa) : null,
    bis:   targets.bis   ? (mode==="bp" ? BASE.bis  +bp.bis  /100 : abs.bis)   : null,
    lcr:   targets.lcr   ? (mode==="bp" ? BASE.lcr  +bp.lcr  /100 : abs.lcr)   : null,
  });

  async function run() {
    setLoading(true); setResult(null); setAiTxt(""); setIterN(0);
    const t = setInterval(()=>setIterN(p=>p<240?p+8:p),50);
    await new Promise(r=>setTimeout(r,1800));
    clearInterval(t); setIterN(248);
    const tgt = getTgt();
    const res = solveInverse({...tgt, maxDelta, lockIds});
    setResult(res); onResult(res);
    setLoading(false);
  }

  async function getComment() {
    if (!result) return;
    setAiLoad(true);
    const tgt = getTgt();
    const changes = result.assets.filter(a=>a.delta!==0).map(a=>`${a.name} ${fmtN(a.delta)}억`).join(", ");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:800, system:SYS,
          messages:[{role:"user",content:`역산 최적화 결과 경영진 보고용 3문장 요약.\n목표: RoRWA ${tgt.rorwa?.toFixed(2)||"미설정"}% BIS ${tgt.bis?.toFixed(2)||"미설정"}% LCR ${tgt.lcr?.toFixed(1)||"미설정"}%\n결과: RoRWA ${result.resultRorwa.toFixed(2)}% BIS ${result.resultBis.toFixed(2)}% LCR ${result.resultLcr.toFixed(1)}%\n조정: ${changes}`}],
        }),
      });
      const d = await res.json();
      setAiTxt(d.content?.[0]?.text||"");
    } catch { setAiTxt("API 오류"); }
    setAiLoad(false);
  }

  const tgt = getTgt();

  const SliderRow = ({label,val,min,max,step,color,onChange,targetVal}) => (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <span style={{fontSize:12,color:C.text2,fontWeight:500}}>{label}</span>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:700,color}}>{mode==="bp"?`+${val}bp`:`${val.toFixed?val.toFixed(2):val}%`}</span>
          <span style={{fontSize:11,color:C.text3}}>→ 목표 <strong style={{color}}>{targetVal?.toFixed(mode==="bp"?2:2)}%</strong></span>
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={onChange} style={{width:"100%",accentColor:color,height:4}} />
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.text3,marginTop:2}}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* 현재 기준값 */}
      <Card>
        <SectionTitle sub="현재 전행 기준 지표">현재 기준 지표</SectionTitle>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {[{l:"RoRWA",v:`${BASE.rorwa}%`,c:C.blue},{l:"BIS 비율",v:`${BASE.bis}%`,c:C.purple},{l:"LCR",v:`${BASE.lcr}%`,c:C.teal}].map(k=>(
            <div key={k.l} style={{textAlign:"center",padding:"12px",background:C.bgSub,borderRadius:8,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,color:C.text2,marginBottom:3}}>{k.l}</div>
              <div style={{fontSize:22,fontWeight:800,color:k.c}}>{k.v}</div>
              <div style={{fontSize:10,color:C.text3,marginTop:2}}>현재값</div>
            </div>
          ))}
        </div>
      </Card>

      {/* 목표 설정 */}
      <Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <SectionTitle sub="달성하고자 하는 목표 지표를 설정하세요">목표값 설정</SectionTitle>
          <div style={{display:"flex",gap:4}}>
            {[["bp","bp 단위"],["abs","절대값"]].map(([v,l])=>(
              <button key={v} onClick={()=>setMode(v)} style={{
                padding:"5px 12px",borderRadius:5,border:`1px solid ${mode===v?C.blue:C.border}`,
                background:mode===v?C.blueL:"#fff",color:mode===v?C.blue:C.text2,
                fontSize:11,fontWeight:600,cursor:"pointer",
              }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {/* RoRWA */}
          <div style={{padding:"14px 16px",borderRadius:8,background:targets.rorwa?C.blueL:C.bgSub,border:`1px solid ${targets.rorwa?C.blueM:C.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:targets.rorwa?12:0}}>
              <input type="checkbox" checked={targets.rorwa} onChange={e=>setTargets(p=>({...p,rorwa:e.target.checked}))} style={{accentColor:C.blue,width:14,height:14,cursor:"pointer"}}/>
              <span style={{fontSize:13,fontWeight:600,color:targets.rorwa?C.blue:C.text2}}>📈 RoRWA 목표 설정</span>
              <Chip color={C.text3} bg={C.bgSub}>현재 {BASE.rorwa}%</Chip>
            </div>
            {targets.rorwa && (
              mode==="bp"
                // NH 현실: RoRWA 개선 목표 5~30bp 범위 (NIM 1.78% 수준에서 큰 폭 개선 어려움)
                ? <SliderRow label="개선 목표" val={bp.rorwa} min={5} max={30} step={1} color={C.blue} onChange={e=>setBp(p=>({...p,rorwa:+e.target.value}))} targetVal={BASE.rorwa+bp.rorwa/100}/>
                // 절대값: 1.85~2.20% 현실적 목표 범위
                : <SliderRow label="목표 RoRWA" val={abs.rorwa} min={1.85} max={2.20} step={0.01} color={C.blue} onChange={e=>setAbs(p=>({...p,rorwa:+e.target.value}))} targetVal={abs.rorwa}/>
            )}
          </div>
          {/* BIS */}
          <div style={{padding:"14px 16px",borderRadius:8,background:targets.bis?C.purpleL:C.bgSub,border:`1px solid ${targets.bis?"#DDD6FE":C.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:targets.bis?12:0}}>
              <input type="checkbox" checked={targets.bis} onChange={e=>setTargets(p=>({...p,bis:e.target.checked}))} style={{accentColor:C.purple,width:14,height:14,cursor:"pointer"}}/>
              <span style={{fontSize:13,fontWeight:600,color:targets.bis?C.purple:C.text2}}>🏛️ BIS 비율 목표 설정</span>
              <Chip color={C.text3} bg={C.bgSub}>현재 {BASE.bis}%</Chip>
            </div>
            {targets.bis && (
              mode==="bp"
                // BIS 18.64% → 추가 개선 목표 10~100bp
                ? <SliderRow label="개선 목표" val={bp.bis} min={10} max={100} step={5} color={C.purple} onChange={e=>setBp(p=>({...p,bis:+e.target.value}))} targetVal={BASE.bis+bp.bis/100}/>
                // 절대값: 18.5~20.0% 범위
                : <SliderRow label="목표 BIS" val={abs.bis} min={18.5} max={20.0} step={0.1} color={C.purple} onChange={e=>setAbs(p=>({...p,bis:+e.target.value}))} targetVal={abs.bis}/>
            )}
          </div>
          {/* LCR */}
          <div style={{padding:"14px 16px",borderRadius:8,background:targets.lcr?C.tealL:C.bgSub,border:`1px solid ${targets.lcr?"#99F6E4":C.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:targets.lcr?12:0}}>
              <input type="checkbox" checked={targets.lcr} onChange={e=>setTargets(p=>({...p,lcr:e.target.checked}))} style={{accentColor:C.teal,width:14,height:14,cursor:"pointer"}}/>
              <span style={{fontSize:13,fontWeight:600,color:targets.lcr?C.teal:C.text2}}>💧 LCR 목표 설정</span>
              <Chip color={C.text3} bg={C.bgSub}>현재 {BASE.lcr}%</Chip>
            </div>
            {targets.lcr && (
              mode==="bp"
                // LCR 117.3% → 추가 개선 50~500bp
                ? <SliderRow label="개선 목표" val={bp.lcr} min={50} max={500} step={50} color={C.teal} onChange={e=>setBp(p=>({...p,lcr:+e.target.value}))} targetVal={BASE.lcr+bp.lcr/100}/>
                // 절대값: 118~130% 범위
                : <SliderRow label="목표 LCR" val={abs.lcr} min={118} max={130} step={0.5} color={C.teal} onChange={e=>setAbs(p=>({...p,lcr:+e.target.value}))} targetVal={abs.lcr}/>
            )}
          </div>
        </div>

        {/* 제약 */}
        <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:12,color:C.text2}}>최대 자산 이동 한도</span>
              <span style={{fontSize:12,fontWeight:700,color:C.amber}}>{(maxDelta/10000).toFixed(0)}조원</span>
            </div>
            <input type="range" min={50000} max={1000000} step={50000} value={maxDelta} onChange={e=>setMaxDelta(+e.target.value)} style={{width:"100%",accentColor:C.amber,height:4}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.text3,marginTop:2}}>
              <span>5조</span><span>100조</span>
            </div>
          </div>
          <div>
            <div style={{fontSize:12,color:C.text2,marginBottom:7}}>고정 자산군 (변경 불가)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {ASSETS.map(a=>(
                <button key={a.id} onClick={()=>setLockIds(p=>p.includes(a.id)?p.filter(x=>x!==a.id):[...p,a.id])} style={{
                  fontSize:10,padding:"3px 8px",borderRadius:4,cursor:"pointer",
                  border:`1px solid ${lockIds.includes(a.id)?a.color:C.border}`,
                  background:lockIds.includes(a.id)?a.color+"14":"#fff",
                  color:lockIds.includes(a.id)?a.color:C.text2,fontWeight:lockIds.includes(a.id)?700:400,
                }}>{lockIds.includes(a.id)?"🔒 ":""}{a.name.slice(0,5)}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{marginTop:16}}>
          <button onClick={run} disabled={loading||(!targets.rorwa&&!targets.bis&&!targets.lcr)} style={{
            width:"100%",padding:"11px",borderRadius:7,border:"none",
            background: loading||(!targets.rorwa&&!targets.bis&&!targets.lcr) ? C.bgSub : C.blue,
            color: loading||(!targets.rorwa&&!targets.bis&&!targets.lcr) ? C.text3 : "#fff",
            fontSize:13,fontWeight:700,cursor:"pointer",letterSpacing:"-0.2px",
          }}>
            {loading?`⚙️ 역산 최적화 중... (${iterN}회 반복)`:"🎯 목표값 역산 최적화 실행"}
          </button>
        </div>
      </Card>

      {/* 결과 */}
      {result && (
        <Card style={{animation:"fadeIn 0.3s ease"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
            <Chip color={C.green}>✓ 역산 최적화 완료</Chip>
            <span style={{fontSize:13,fontWeight:700,color:C.text1}}>목표 달성 포트폴리오 도출</span>
          </div>

          {/* 목표 달성 게이지 3종 */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
            {[
              {l:"RoRWA",cur:result.resultRorwa,tgt:tgt.rorwa,base:BASE.rorwa,c:C.blue,d:2},
              {l:"BIS 비율",cur:result.resultBis,tgt:tgt.bis,base:BASE.bis,c:C.purple,d:2},
              {l:"LCR",cur:result.resultLcr,tgt:tgt.lcr,base:BASE.lcr,c:C.teal,d:1},
            ].map(g=>(
              <div key={g.l} style={{padding:"14px 16px",background:C.bgSub,borderRadius:9,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:11,color:C.text2,marginBottom:4}}>{g.l}</div>
                <div style={{fontSize:22,fontWeight:800,color:g.c}}>{g.cur.toFixed(g.d)}%</div>
                {g.tgt && (
                  <>
                    <div style={{fontSize:10,color:C.text3,marginTop:2}}>목표 {g.tgt.toFixed(g.d)}% · 기준 {g.base}%</div>
                    <div style={{marginTop:6,height:4,background:C.border,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${Math.min((g.cur/g.tgt)*100,100)}%`,height:"100%",background:g.cur>=g.tgt?C.green:g.c,borderRadius:2,transition:"width 0.8s"}}/>
                    </div>
                    <div style={{fontSize:10,fontWeight:700,color:g.cur>=g.tgt?C.green:C.amber,marginTop:3}}>
                      {g.cur>=g.tgt?`✓ 달성 (+${(g.cur-g.tgt).toFixed(g.d)}%p 초과)`:`미달 (${(g.cur-g.tgt).toFixed(g.d)}%p)`}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* 자산 조정안 테이블 */}
          <div style={{fontSize:12,fontWeight:700,color:C.text2,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.04em"}}>최적 자산 조정안 — 금액 · 비중 · RWA 변동</div>
          {(()=>{
            const totBefore = result.assets.reduce((s,a)=>s+a.balance,0);
            const totAfter  = result.assets.reduce((s,a)=>s+a.balance+a.delta,0);
            const totRwaBef = result.assets.reduce((s,a)=>s+a.rwa,0);
            return (
              <div style={{overflowX:"auto",marginBottom:14}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:C.bgSub}}>
                      {["자산군","현재 잔액","조정 후 잔액","증감액","비중 변동","RWA 변동","방향"].map(h=>(
                        <th key={h} style={{padding:"7px 10px",color:C.text2,textAlign:"right",fontWeight:600,fontSize:11,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.assets.map(a=>{
                      const newBal  = a.balance+a.delta;
                      const wBef    = (a.balance/totBefore)*100;
                      const wAft    = (newBal/totAfter)*100;
                      const dW      = wAft-wBef;
                      const rwaAft  = newBal*(a.rw/100);
                      const dRwa    = rwaAft-a.rwa;
                      const chg     = a.delta!==0;
                      return (
                        <tr key={a.id} style={{borderBottom:`1px solid ${C.border}`,background:chg?a.color+"08":"transparent",opacity:chg?1:0.6}}>
                          <td style={{padding:"8px 10px",color:C.text1,fontWeight:chg?600:400,whiteSpace:"nowrap"}}>
                            <span style={{display:"inline-block",width:8,height:8,borderRadius:2,background:a.color,marginRight:6}}/>
                            {a.name}
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>
                            <div style={{fontSize:12,color:C.text2}}>{a.balance.toLocaleString()}억</div>
                            <div style={{fontSize:10,color:C.text3}}>{wBef.toFixed(1)}%</div>
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>
                            <div style={{fontSize:12,fontWeight:chg?700:400,color:chg?C.text1:C.text3}}>{newBal.toLocaleString()}억</div>
                            <div style={{fontSize:10,color:chg?a.color:C.text3}}>{wAft.toFixed(1)}%</div>
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>
                            {chg ? <span style={{fontSize:13,fontWeight:800,color:a.delta>0?C.green:C.red}}>{fmtN(a.delta)}억</span> : <span style={{color:C.text3}}>—</span>}
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>
                            {chg ? (
                              <div>
                                <span style={{fontSize:12,fontWeight:700,color:dW>0?C.green:C.red}}>{dW>=0?"+":""}{dW.toFixed(2)}%p</span>
                                <div style={{display:"flex",justifyContent:"flex-end",marginTop:3}}>
                                  <div style={{width:48,height:4,background:C.border,borderRadius:2,position:"relative",overflow:"hidden"}}>
                                    <div style={{position:"absolute",left:dW>0?"50%":"auto",right:dW<0?"50%":"auto",width:`${Math.min(Math.abs(dW)*5,50)}%`,height:"100%",background:dW>0?C.green:C.red,borderRadius:2}}/>
                                    <div style={{position:"absolute",left:"50%",top:0,width:1,height:"100%",background:C.border2}}/>
                                  </div>
                                </div>
                              </div>
                            ) : <span style={{color:C.text3}}>—</span>}
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>
                            {chg ? (
                              <div>
                                <span style={{fontSize:12,fontWeight:700,color:dRwa>0?C.amber:C.teal}}>{fmtN(Math.round(dRwa))}억</span>
                                <div style={{fontSize:10,color:C.text3}}>{a.rwa.toLocaleString()}→{Math.round(rwaAft).toLocaleString()}</div>
                              </div>
                            ) : <span style={{color:C.text3}}>—</span>}
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>
                            {chg
                              ? <Chip color={a.delta>0?C.green:C.red}>{a.delta>0?"▲ 확대":"▼ 축소"}</Chip>
                              : <span style={{fontSize:10,color:C.text3}}>유지</span>
                            }
                          </td>
                        </tr>
                      );
                    })}
                    {/* 합계 */}
                    <tr style={{background:C.bgSub,borderTop:`2px solid ${C.border2}`}}>
                      <td style={{padding:"8px 10px",fontWeight:700,color:C.text1,fontSize:12}}>합 계</td>
                      <td style={{padding:"8px 10px",textAlign:"right"}}>
                        <div style={{fontSize:12,color:C.text2}}>{totBefore.toLocaleString()}억</div>
                        <div style={{fontSize:10,color:C.text3}}>100.0%</div>
                      </td>
                      <td style={{padding:"8px 10px",textAlign:"right"}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.text1}}>{totAfter.toLocaleString()}억</div>
                        <div style={{fontSize:10,color:C.blue}}>100.0%</div>
                      </td>
                      <td style={{padding:"8px 10px",textAlign:"right"}}>
                        <span style={{fontSize:13,fontWeight:800,color:(totAfter-totBefore)>=0?C.green:C.red}}>{fmtN(totAfter-totBefore)}억</span>
                      </td>
                      <td style={{padding:"8px 10px",textAlign:"right",color:C.text3}}>—</td>
                      <td style={{padding:"8px 10px",textAlign:"right"}}>
                        <span style={{fontSize:12,fontWeight:700,color:(result.totalRwa-totRwaBef)>=0?C.amber:C.teal}}>{fmtN(Math.round(result.totalRwa-totRwaBef))}억</span>
                        <div style={{fontSize:10,color:C.text3}}>{fmtT(totRwaBef)} → {fmtT(result.totalRwa)}</div>
                      </td>
                      <td/>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* 요약 KPI */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
            {[
              {l:"총 자산 이동",v:`${(result.totalDelta/10000).toFixed(1)}조`,c:C.amber},
              {l:"조정 후 총 RWA",v:fmtT(result.totalRwa),c:C.blue},
              {l:"RoRWA 개선폭",v:`+${((result.resultRorwa-BASE.rorwa)*100).toFixed(0)}bp`,c:C.green},
              {l:"BIS 변동",v:`${((result.resultBis-BASE.bis)*100)>=0?"+":""}${((result.resultBis-BASE.bis)*100).toFixed(0)}bp`,c:C.purple},
            ].map(k=>(
              <div key={k.l} style={{textAlign:"center",padding:"10px 12px",background:C.bgSub,borderRadius:7,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:10,color:C.text3,marginBottom:3}}>{k.l}</div>
                <div style={{fontSize:16,fontWeight:800,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>

          <Btn onClick={getComment} disabled={aiLoad}>{aiLoad?"📝 분석 중...":"🤖 AI 경영진 코멘트 생성"}</Btn>
          {aiTxt && (
            <div style={{marginTop:12,padding:"14px 16px",background:C.blueL,border:`1px solid ${C.blueM}`,borderRadius:8,fontSize:13,color:C.text1,lineHeight:1.7,animation:"fadeIn 0.3s ease"}}>
              <div style={{fontSize:11,fontWeight:700,color:C.blue,marginBottom:5}}>🤖 AI 코멘트</div>
              {aiTxt}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ── MAIN ─────────────────────────────────────────────────────────
const FWD_TABS = [
  {id:"s1", label:"① 자연어 입력"},
  {id:"s2", label:"② 데이터 집계"},
  {id:"s3", label:"③ 최적화 실행"},
  {id:"s4", label:"④ 리스크 분석"},
  {id:"s5", label:"⑤ 결과 보고"},
  {id:"s6", label:"⑥ 경영계획 연동"},
];

export default function App() {
  const [mainTab, setMainTab]     = useState("fwd");    // "fwd" | "inv"
  const [fwdStep, setFwdStep]     = useState("s1");
  const [doneSteps, setDoneSteps] = useState(new Set());
  const [stepData, setStepData]   = useState({});
  const [simResult, setSimResult] = useState(null);
  const [invResult, setInvResult] = useState(null);

  function completeStep(id, data={}) {
    setDoneSteps(p => new Set([...p, id]));
    setStepData(p => ({...p, [id]:data}));
    const idx = FWD_TABS.findIndex(t=>t.id===id);
    if (idx < FWD_TABS.length-1) setFwdStep(FWD_TABS[idx+1].id);
    if (id==="s3") setSimResult(data);
  }

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Noto Sans KR','Pretendard',sans-serif",color:C.text1}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800&display=swap');
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:${C.bgSub};}
        ::-webkit-scrollbar-thumb{background:${C.border2};border-radius:3px;}
        input[type=range]{height:4px;border-radius:2px;cursor:pointer;}
        textarea{resize:vertical;} textarea:focus,input:focus{outline:none;}
        button{font-family:inherit;}
      `}</style>

      {/* ── 상단 네비게이션 바 ── */}
      <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"0 28px",position:"sticky",top:0,zIndex:200,boxShadow:"0 1px 0 rgba(15,23,42,0.06)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:32,height:32,borderRadius:8,background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🏦</div>
            <div>
              <span style={{fontSize:14,fontWeight:800,color:C.text1,letterSpacing:"-0.3px"}}>AI Portfolio Manager</span>
              <span style={{fontSize:11,color:C.text3,marginLeft:10}}>NH농협은행</span>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <StatusDot ok />
            <span style={{fontSize:11,color:C.text2,fontWeight:500}}>AI Agent 활성</span>
            <span style={{marginLeft:8,fontSize:11,color:C.text3}}>2025.01 기준</span>
          </div>
        </div>
      </div>

      {/* ── 상단 결과 대시보드 ── */}
      <TopDashboard simResult={simResult} inverseResult={invResult} />

      {/* ── 메인 탭 (순방향 / 역산) ── */}
      <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"0 28px"}}>
        <div style={{display:"flex",gap:0}}>
          {[["fwd","📊 순방향 최적화","자산 조정 → 지표 결과"],["inv","🎯 역산 최적화","목표 지표 → 최적 포트폴리오"]].map(([id,lbl,sub])=>(
            <button key={id} onClick={()=>setMainTab(id)} style={{
              padding:"13px 22px",border:"none",background:"transparent",cursor:"pointer",
              borderBottom:mainTab===id?`2px solid ${C.blue}`:"2px solid transparent",
              marginBottom:"-1px",
            }}>
              <div style={{fontSize:13,fontWeight:mainTab===id?700:500,color:mainTab===id?C.blue:C.text2}}>{lbl}</div>
              <div style={{fontSize:10,color:C.text3,marginTop:1}}>{sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── 순방향: 단계별 탭 ── */}
      {mainTab==="fwd" && (
        <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"0 28px"}}>
          <div style={{display:"flex",gap:0,overflowX:"auto"}}>
            {FWD_TABS.map((t,i)=>{
              const isDone = doneSteps.has(t.id);
              const isActive = fwdStep===t.id;
              const canClick = isDone || isActive || (i>0 && doneSteps.has(FWD_TABS[i-1].id));
              return (
                <button key={t.id} onClick={()=>canClick&&setFwdStep(t.id)} style={{
                  display:"flex",alignItems:"center",gap:7,padding:"10px 16px",border:"none",background:"transparent",
                  borderBottom:isActive?`2px solid ${C.blue}`:"2px solid transparent",marginBottom:"-1px",
                  cursor:canClick?"pointer":"default",whiteSpace:"nowrap",
                }}>
                  <div style={{
                    width:18,height:18,borderRadius:"50%",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
                    background: isDone?C.green : isActive?C.blue : C.bgSub,
                    color: isDone||isActive?"#fff" : C.text3,
                  }}>{isDone?"✓":i+1}</div>
                  <span style={{fontSize:12,fontWeight:isActive?700:500,color:isActive?C.blue:isDone?C.green:C.text2}}>{t.label.slice(2)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 콘텐츠 영역 ── */}
      <div style={{maxWidth:860,margin:"0 auto",padding:"24px 28px 60px"}}>
        {mainTab==="fwd" && (
          <div key={fwdStep} style={{animation:"fadeIn 0.25s ease"}}>
            {fwdStep==="s1" && <Step1 onComplete={d=>completeStep("s1",d)} />}
            {fwdStep==="s2" && <Step2 onComplete={()=>completeStep("s2")} />}
            {fwdStep==="s3" && <Step3 onComplete={d=>completeStep("s3",d)} />}
            {fwdStep==="s4" && <Step4 onComplete={()=>completeStep("s4")} />}
            {fwdStep==="s5" && <Step5 onComplete={()=>completeStep("s5")} />}
            {fwdStep==="s6" && <Step6 />}
          </div>
        )}
        {mainTab==="inv" && (
          <div key="inv" style={{animation:"fadeIn 0.25s ease"}}>
            <InverseTab onResult={r=>setInvResult(r)} />
          </div>
        )}
      </div>
    </div>
  );
}
