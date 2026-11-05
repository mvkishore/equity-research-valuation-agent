import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiResponse } from "./api";

type Analysis = ApiResponse<typeof api, "listAnalyses">["analyses"][number];
type Payload = {
  syn: any; sources: { title: string; url: string }[]; netCashAssumed: boolean;
  sharesBnUsed: number | null; fcf0UsedBn: number | null; impliedGrowthPct: number | null;
  verdictNote?: string | null;
  changeDetection: { area: string; previous: string; current: string; verdict: string }[];
  valueVerdict: string;
  historyPoints: { date: string; close: number | null }[];
  entryPrices: { mos10: number; mos20: number; mos30: number } | null;
};

const money = (v: number | null | undefined, d = 2) => v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const bn = (v: number | null | undefined) => v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
const pct = (v: number | null | undefined) => v == null ? "—" : `${v.toFixed(1)}%`;
const bigCap = (v: number | null | undefined) => v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function dcfClient(fcf0: number, gPct: number, rPct: number, tgPct: number, netCash: number, shares: number): number | null {
  if (!fcf0 || fcf0 <= 0 || !shares) return null;
  const g = clamp(gPct, -15, 45) / 100; const r = clamp(rPct, 6, 15) / 100;
  let tg = clamp(tgPct, 0, 4) / 100; if (tg >= r - 0.01) tg = r - 0.015;
  let pv = 0; let fcf = fcf0;
  for (let t = 1; t <= 5; t++) { fcf = fcf0 * Math.pow(1 + g, t); pv += fcf / Math.pow(1 + r, t); }
  pv += ((fcf * (1 + tg)) / (r - tg)) / Math.pow(1 + r, 5);
  return (pv + netCash) / shares;
}

function recColor(rec: string) {
  if (["Strong Buy", "Buy", "Accumulate"].includes(rec)) return "var(--green)";
  if (["Trim", "Sell"].includes(rec)) return "var(--red)";
  return "var(--brass)";
}

function ScoreBar({ label, score, note }: { label: string; score: number; note?: string }) {
  return (
    <div className="py-2 border-b border-[var(--border)] last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm" style={{ fontFamily: "var(--serif)" }}>{score.toFixed(1)} / 10</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[var(--surface2)] overflow-hidden" role="img" aria-label={`${label} score ${score} out of 10`}>
        <div className="h-full rounded-full" style={{ width: `${score * 10}%`, background: score >= 7 ? "var(--green)" : score >= 4.5 ? "var(--brass)" : "var(--red)" }} />
      </div>
      {note ? <p className="mt-1 text-xs text-[var(--dim)]">{note}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)] border-b-2 border-[var(--text)] pb-2">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Report({ a }: { a: Analysis }) {
  const p: Payload = useMemo(() => { try { return JSON.parse(a.payload); } catch { return null as unknown as Payload; } }, [a.payload]);
  const qc = useQueryClient();
  const [noteText, setNoteText] = useState("");
  const [dcf, setDcf] = useState<{ g: number; r: number; tg: number } | null>(null);
  const notes = useQuery({ queryKey: ["notes", a.ticker], queryFn: () => api.listThesisNotes({ ticker: a.ticker }) });
  const addNote = useMutation({
    mutationFn: () => api.addThesisNote({ ticker: a.ticker, kind: "earnings-check", note: noteText }),
    onSuccess: () => { setNoteText(""); qc.invalidateQueries({ queryKey: ["notes", a.ticker] }); },
  });
  if (!p?.syn) return <p className="text-sm text-[var(--dim)]">This analysis record could not be read.</p>;
  const s = p.syn;
  const upside = a.intrinsicWeighted != null && a.price ? (a.intrinsicWeighted - a.price) / a.price * 100 : null;
  const baseAssump = s.base as { fcfGrowthPct: number; discountPct: number; terminalGrowthPct: number; narrative: string };
  const eff = dcf ?? { g: baseAssump.fcfGrowthPct, r: baseAssump.discountPct, tg: baseAssump.terminalGrowthPct };
  const myIv = p.fcf0UsedBn != null && p.sharesBnUsed ? dcfClient(p.fcf0UsedBn, eff.g, eff.r, eff.tg, s.netCashBn ?? 0, p.sharesBnUsed) : null;
  const scoreRows: [string, number, string][] = [
    ["Business quality", s.scores.businessQuality, s.scoreNotes.businessQuality],
    ["Competitive moat", s.scores.moat, s.scoreNotes.moat],
    ["Revenue growth durability", s.scores.growthDurability, s.scoreNotes.growthDurability],
    ["Profitability", s.scores.profitability, s.scoreNotes.profitability],
    ["FCF generation", s.scores.fcfGeneration, s.scoreNotes.fcfGeneration],
    ["Balance-sheet strength", s.scores.balanceSheet, s.scoreNotes.balanceSheet],
    ["Capital allocation", s.scores.capitalAllocation, s.scoreNotes.capitalAllocation],
    ["Management quality", s.scores.management, s.scoreNotes.management],
    ["Valuation attractiveness", s.scores.valuationAttractiveness, s.scoreNotes.valuationAttractiveness],
    ["Risk profile (10 = safest)", s.scores.riskProfile, s.scoreNotes.riskProfile],
  ];
  const scen = [
    { name: "Bear", iv: a.intrinsicBear, a: s.bear },
    { name: "Base", iv: a.intrinsicBase, a: s.base },
    { name: "Bull", iv: a.intrinsicBull, a: s.bull },
  ];
  const histData = (s.history ?? []).filter((h: any) => h.revenueBn != null || h.fcfBn != null);
  const priceData = (p.historyPoints ?? []).filter((h) => h.close != null);

  return (
    <article>
      {/* Verdict hero */}
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--dim)]">{a.ticker} · {s.sector ?? "—"} · {s.reportingPeriod ? (String(s.reportingPeriod).split(/[.;]/)[0] ?? "").slice(0, 90) : "Latest reported period"}</p>
            <h2 className="mt-1 text-2xl font-semibold" style={{ fontFamily: "var(--serif)" }}>{a.companyName}</h2>
            <p className="mt-1 text-sm text-[var(--dim)]">Analyzed {new Date(a.createdAt).toLocaleString()} · Price as of {a.priceAsOf ? new Date(a.priceAsOf).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold" style={{ fontFamily: "var(--serif)", color: recColor(a.recommendation) }}>{a.recommendation}</p>
            <p className="text-xs text-[var(--dim)]">Conviction: {a.conviction}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Current price", money(a.price)],
            ["Market cap", bigCap(a.marketCap)],
            ["Intrinsic value (weighted)", money(a.intrinsicWeighted)],
            ["Expected upside / downside", upside == null ? "—" : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-[var(--surface2)] px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-[var(--dim)]">{k}</p>
              <p className="text-lg font-semibold" style={{ fontFamily: "var(--serif)" }}>{v}</p>
            </div>
          ))}
        </div>
        {a.intrinsicBear != null && a.intrinsicBull != null && a.price != null && (
          <div className="mt-4" aria-label="Valuation range bar">
            <div className="relative h-3 rounded-full bg-[var(--surface2)]">
              {(() => {
                const lo = Math.min(a.intrinsicBear!, a.price) * 0.92; const hi = Math.max(a.intrinsicBull!, a.price) * 1.05;
                const pos = (v: number) => `${clamp((v - lo) / (hi - lo) * 100, 0, 100)}%`;
                return <>
                  <div className="absolute top-0 h-3 rounded-full" style={{ left: pos(a.intrinsicBear!), width: `calc(${pos(a.intrinsicBull!)} - ${pos(a.intrinsicBear!)})`, background: "var(--brass)", opacity: 0.55 }} />
                  <div className="absolute -top-1 h-5 w-[3px] bg-[var(--text)]" style={{ left: pos(a.price) }} title={`Price ${money(a.price)}`} />
                  {a.intrinsicBase != null && <div className="absolute -top-1 h-5 w-[3px]" style={{ left: pos(a.intrinsicBase), background: "var(--green)" }} title={`Base ${money(a.intrinsicBase)}`} />}
                </>;
              })()}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-[var(--dim)]"><span>Bear {money(a.intrinsicBear)}</span><span>Base {money(a.intrinsicBase)}</span><span>Bull {money(a.intrinsicBull)}</span><span className="font-semibold text-[var(--text)]">Price {money(a.price)}</span></div>
            <p className="mt-1 text-[11px] text-[var(--dim)]">Brass band = bear-to-bull intrinsic range; black tick = current price {a.intrinsicBull != null && a.price > a.intrinsicBull ? "— note the price sits above even the bull case, far to the right of the band" : ""}. Quality and price are judged separately — a great business above its base value is a Watchlist, not a Buy.</p>
          </div>
        )}
        {p.verdictNote ? <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--surface2)", borderLeft: "3px solid var(--brass)" }}>{p.verdictNote}</p> : null}
        <p className="mt-4 text-sm leading-relaxed">{s.businessSummary}</p>
        <p className="mt-2 text-sm leading-relaxed"><span className="font-semibold">Thesis. </span>{s.thesis}</p>
      </div>

      <Section title="Scorecard — the committee's judgment">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
          {scoreRows.map(([l, sc, n]) => <ScoreBar key={l} label={l} score={sc} note={n} />)}
        </div>
        <p className="mt-2 text-xs text-[var(--dim)]">Scores are not averaged into the verdict. Valuation, quality and downside carry different weight for every company.</p>
      </Section>

      <Section title="Fundamentals — reported figures">
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[520px] text-sm">
            <tbody>
              {[
                ["Revenue (TTM / latest FY)", bn(s.revenueBn)], ["Revenue growth", pct(s.revenueGrowthPct)],
                ["Gross margin", pct(s.grossMarginPct)], ["Operating margin", pct(s.operatingMarginPct)],
                ["Net margin", pct(s.netMarginPct)], ["ROIC", pct(s.roicPct)], ["ROE", pct(s.roePct)],
                ["Operating cash flow", bn(s.ocfBn)], ["Capital expenditure", bn(s.capexBn)],
                ["Free cash flow (OCF − capex)", bn(s.fcfBn)], ["FCF margin", pct(s.fcfMarginPct)],
                ["Stock-based compensation", bn(s.sbcBn)], ["Dilution per year", pct(s.dilutionPctPerYear)],
                ["Net cash (negative = net debt)", bn(s.netCashBn)], ["Debt / EBITDA", s.debtToEbitda == null ? "—" : `${s.debtToEbitda.toFixed(1)}×`],
                ["Diluted EPS", s.epsDiluted == null ? "—" : money(s.epsDiluted)], ["Dividend yield", pct(s.dividendYieldPct)],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-[var(--border)] last:border-0"><td className="px-4 py-2 text-[var(--dim)]">{k}</td><td className="px-4 py-2 text-right font-medium" style={{ fontFamily: "var(--serif)" }}>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm"><span className="font-semibold">SBC honesty check. </span>{s.sbcNote}</p>
        <p className="mt-1 text-sm"><span className="font-semibold">Capital allocation. </span>{s.capitalAllocationNote}</p>
        {histData.length > 1 && (
          <div className="mt-4 h-56 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="mb-2 text-xs font-medium text-[var(--dim)]">Revenue vs free cash flow ($B, fiscal years as reported)</p>
            <ResponsiveContainer width="100%" height="88%">
              <BarChart data={histData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => [`$${v}B`, ""]} />
                <Bar dataKey="revenueBn" name="Revenue" fill="#14213d" radius={[3, 3, 0, 0]} />
                <Bar dataKey="fcfBn" name="FCF" fill="#1e7a4f" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {priceData.length > 5 && (
          <div className="mt-4 h-48 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="mb-2 text-xs font-medium text-[var(--dim)]">Price — last ~3 months (daily close)</p>
            <ResponsiveContainer width="100%" height="88%">
              <AreaChart data={priceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} /><YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => [money(Number(v)), "Close"]} />
                <Area type="monotone" dataKey="close" stroke="#14213d" fill="#14213d" fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="Moat & competition">
        <p className="text-sm"><span className="font-semibold">Moat type: </span>{s.moatType}</p>
        <p className="mt-1 text-sm leading-relaxed">{s.moatAssessment}</p>
        <p className="mt-2 text-sm leading-relaxed"><span className="font-semibold">Why customers stay. </span>{s.whyCustomersStay}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(s.moatSources ?? []).map((m: string) => <span key={m} className="rounded-full bg-[var(--surface2)] px-3 py-1 text-xs">{m}</span>)}
        </div>
        <p className="mt-2 text-sm text-[var(--dim)]">Key competitors: {(s.competitors ?? []).join(", ") || "—"}</p>
        <p className="mt-2 text-sm leading-relaxed"><span className="font-semibold">Industry. </span>{s.industryNote}</p>
        <p className="mt-1 text-sm leading-relaxed"><span className="font-semibold">Management. </span>{s.managementNote}</p>
      </Section>

      <Section title="Valuation — DCF scenarios (computed, not asserted)">
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--dim)]">
              <th className="px-4 py-2">Scenario</th><th className="px-4 py-2">FCF growth (5y)</th><th className="px-4 py-2">Discount</th><th className="px-4 py-2">Terminal</th><th className="px-4 py-2 text-right">Intrinsic value</th><th className="px-4 py-2 text-right">vs price</th>
            </tr></thead>
            <tbody>
              {scen.map(({ name, iv, a: sa }) => (
                <tr key={name} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 font-medium">{name}</td>
                  <td className="px-4 py-2">{pct(sa.fcfGrowthPct)}</td><td className="px-4 py-2">{pct(sa.discountPct)}</td><td className="px-4 py-2">{pct(sa.terminalGrowthPct)}</td>
                  <td className="px-4 py-2 text-right font-semibold" style={{ fontFamily: "var(--serif)" }}>{money(iv)}</td>
                  <td className="px-4 py-2 text-right" style={{ color: iv != null && a.price && iv >= a.price ? "var(--green)" : "var(--red)" }}>{iv != null && a.price ? `${((iv - a.price) / a.price * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[var(--dim)]">Method: 5-year FCF projection from starting FCF {bn(p.fcf0UsedBn)}{p.netCashAssumed ? "; net cash unavailable in sources, treated as $0 (flagged, not invented)" : ""}, plus terminal value, plus net cash, divided by {p.sharesBnUsed ? `${p.sharesBnUsed.toFixed(2)}B` : "—"} diluted shares. Assumptions are clamped to disciplined bands (discount 6–15%, terminal 0–4%).</p>
        {scen.map(({ name, a: sa }) => <p key={name} className="mt-1 text-sm"><span className="font-semibold">{name}: </span>{sa.narrative}</p>)}
        {p.impliedGrowthPct != null && <p className="mt-2 rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm"><span className="font-semibold">Reverse DCF. </span>At {money(a.price)}, the market is pricing in roughly <span className="font-semibold">{p.impliedGrowthPct.toFixed(1)}% annual FCF growth for five years</span> (at the base discount rate). Judge for yourself whether merely average execution clears that bar.</p>}
        {p.entryPrices && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[["10% margin of safety", p.entryPrices.mos10], ["20% margin of safety", p.entryPrices.mos20], ["30% margin of safety", p.entryPrices.mos30]].map(([k, v]) => (
              <div key={k as string} className="rounded-lg border border-[var(--brass)] px-3 py-2 text-center">
                <p className="text-[11px] uppercase tracking-wide text-[var(--dim)]">{k}</p>
                <p className="text-lg font-semibold" style={{ fontFamily: "var(--serif)" }}>{money(v as number)}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold">Test the base case yourself</p>
          <p className="text-xs text-[var(--dim)]">Move the assumptions — the value recomputes with the same formula. Current price: {money(a.price)}.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {([["FCF growth %", "g", -5, 40], ["Discount rate %", "r", 6, 15], ["Terminal growth %", "tg", 0, 4]] as const).map(([label, key, lo, hi]) => (
              <label key={key} className="text-sm">{label}
                <span className="mt-1 flex items-center gap-2">
                  <input aria-label={label} type="range" min={lo} max={hi} step={0.5} value={eff[key]} onChange={(e) => setDcf({ ...eff, [key]: Number(e.target.value) })} className="w-full accent-[#14213d]" />
                  <span className="w-12 text-right" style={{ fontFamily: "var(--serif)" }}>{eff[key].toFixed(1)}%</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm">Your intrinsic value: <span className="text-lg font-semibold" style={{ fontFamily: "var(--serif)" }}>{money(myIv)}</span>{myIv != null && a.price ? <span className="text-[var(--dim)]"> ({myIv >= a.price ? "+" : ""}{((myIv - a.price) / a.price * 100).toFixed(1)}% vs price)</span> : null}</p>
        </div>
      </Section>

      <Section title="What changed since the last analysis">
        <p className="text-sm font-medium">{p.valueVerdict}</p>
        {p.changeDetection?.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--dim)]"><th className="px-4 py-2">Area</th><th className="px-4 py-2">Previous</th><th className="px-4 py-2">Current</th><th className="px-4 py-2">What changed</th></tr></thead>
              <tbody>{p.changeDetection.map((c) => <tr key={c.area} className="border-b border-[var(--border)] last:border-0"><td className="px-4 py-2 font-medium">{c.area}</td><td className="px-4 py-2">{c.previous}</td><td className="px-4 py-2">{c.current}</td><td className="px-4 py-2">{c.verdict}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {s.guidanceNote ? <p className="mt-2 text-sm"><span className="font-semibold">Guidance. </span>{s.guidanceNote} <span className="text-[var(--dim)]">(management guidance is an estimate, not a reported result)</span></p> : null}
      </Section>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Section title="Top reasons to own">
          <ul className="list-disc space-y-1 pl-5 text-sm">{(s.reasonsToOwn ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul>
        </Section>
        <Section title="Top reasons not to own">
          <ul className="list-disc space-y-1 pl-5 text-sm">{(s.reasonsNotToOwn ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul>
        </Section>
      </div>

      <Section title="Risks & thesis breakers">
        <div className="space-y-2">
          {(s.risks ?? []).map((r: any) => (
            <div key={r.title} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <p className="text-sm font-semibold">{r.title} <span className="ml-1 rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[11px] font-normal">{r.category}</span></p>
              <p className="mt-1 text-sm">{r.detail}</p>
              <p className="mt-1 text-xs text-[var(--dim)]">Warning signal: {r.signal}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm font-semibold">The thesis is broken if:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{(s.thesisBreakers ?? []).map((b: string) => <li key={b}>{b}</li>)}</ul>
        <p className="mt-3 text-sm font-semibold">Monitor over the next 2–4 quarters:</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{(s.monitorMetrics ?? []).map((m: string) => <li key={m}>{m}</li>)}</ul>
      </Section>

      <Section title="Thesis record — earnings check-ins">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (noteText.trim()) addNote.mutate(); }} className="flex gap-2">
          <label className="sr-only" htmlFor="note-input">Add an earnings check-in note</label>
          <input id="note-input" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Q3: revenue growth held, FCF conversion slipped — thesis intact but watch SBC" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
          <button type="submit" disabled={addNote.isPending} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-text)" }}>Add note</button>
        </form>
        <div className="mt-3 space-y-2">
          {(notes.data?.notes ?? []).map((n) => (
            <div key={n.id} className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm">
              <span className="text-xs text-[var(--dim)]">{new Date(n.createdAt).toLocaleDateString()} · {n.kind}</span>
              <p>{n.note}</p>
            </div>
          ))}
          {notes.data && notes.data.notes.length === 0 && <p className="text-sm text-[var(--dim)]">No check-ins yet. After each earnings release, record: is the thesis intact, what improved, what deteriorated?</p>}
        </div>
      </Section>

      <Section title="Sources & data gaps">
        <ul className="space-y-1 text-sm">
          {(p.sources ?? []).map((src) => <li key={src.url}><a href={src.url} target="_blank" rel="noreferrer" className="underline decoration-[var(--brass)] underline-offset-2">{src.title}</a></li>)}
        </ul>
        {(s.dataGaps ?? []).length > 0 && <p className="mt-2 text-sm text-[var(--dim)]">Not available from sources and therefore not estimated: {(s.dataGaps as string[]).join("; ")}. Live quote via the market data feed shown above. This report is personal research support, not financial advice.</p>}
      </Section>
    </article>
  );
}

function PortfolioTab() {
  const qc = useQueryClient();
  const positions = useQuery({ queryKey: ["positions"], queryFn: () => api.listPositions({}) });
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: () => api.listAnalyses({ limit: 100 }) });
  const [form, setForm] = useState({ ticker: "", companyName: "", status: "watchlist" as "holding" | "watchlist", shares: "", costBasis: "", notes: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: () => api.upsertPosition({ id: editId ?? undefined, ticker: form.ticker, companyName: form.companyName, status: form.status, shares: form.shares ? Number(form.shares) : null, costBasis: form.costBasis ? Number(form.costBasis) : null, notes: form.notes }),
    onSuccess: () => { setForm({ ticker: "", companyName: "", status: "watchlist", shares: "", costBasis: "", notes: "" }); setEditId(null); qc.invalidateQueries({ queryKey: ["positions"] }); },
  });
  const del = useMutation({ mutationFn: (id: number) => api.deletePosition({ id }), onSuccess: () => qc.invalidateQueries({ queryKey: ["positions"] }) });
  const latestByTicker = useMemo(() => {
    const m = new Map<string, Analysis>();
    for (const a of analyses.data?.analyses ?? []) if (!m.has(a.ticker)) m.set(a.ticker, a);
    return m;
  }, [analyses.data]);

  return (
    <div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (form.ticker.trim()) save.mutate(); }} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold">{editId ? "Edit position" : "Add a holding or watchlist name"}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-sm">Ticker<input aria-label="Position ticker" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="MSFT" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" /></label>
          <label className="text-sm">Company name<input aria-label="Position company name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Microsoft" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" /></label>
          <label className="text-sm">Status<select aria-label="Position status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "holding" | "watchlist" })} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"><option value="holding">Holding</option><option value="watchlist">Watchlist</option></select></label>
          <label className="text-sm">Shares<input aria-label="Shares owned" type="number" min="0" step="any" value={form.shares} onChange={(e) => setForm({ ...form, shares: e.target.value })} placeholder="—" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" /></label>
          <label className="text-sm">Cost basis / share<input aria-label="Cost basis per share" type="number" min="0" step="any" value={form.costBasis} onChange={(e) => setForm({ ...form, costBasis: e.target.value })} placeholder="—" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" /></label>
          <label className="text-sm">Your thesis note<input aria-label="Position thesis note" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why I own / watch this" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" /></label>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" disabled={save.isPending} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-text)" }}>{editId ? "Save changes" : "Add position"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm({ ticker: "", companyName: "", status: "watchlist", shares: "", costBasis: "", notes: "" }); }} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Cancel edit</button>}
        </div>
        {save.isError && <p className="mt-2 text-sm" style={{ color: "var(--red)" }}>Could not save. Check the values and try again.</p>}
      </form>

      <div className="mt-4 space-y-2">
        {(positions.data?.positions ?? []).map((pos) => {
          const a = latestByTicker.get(pos.ticker);
          const gain = a?.price && pos.costBasis ? (a.price - pos.costBasis) / pos.costBasis * 100 : null;
          return (
            <div key={pos.id} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold" style={{ fontFamily: "var(--serif)" }}>{pos.ticker} <span className="text-sm font-normal text-[var(--dim)]">{pos.companyName}</span>
                  <span className="ml-2 rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[11px] font-normal">{pos.status}</span></p>
                {a ? <p className="text-sm"><span style={{ color: recColor(a.recommendation) }} className="font-semibold">{a.recommendation}</span> · IV {money(a.intrinsicWeighted)} vs {money(a.price)}{gain != null ? <span className="text-[var(--dim)]"> · vs your cost {gain >= 0 ? "+" : ""}{gain.toFixed(1)}% (context only — never the reason to hold)</span> : null}</p> : <p className="text-sm text-[var(--dim)]">Not analyzed yet — run it in the Analyze tab.</p>}
              </div>
              <p className="mt-1 text-sm text-[var(--dim)]">{pos.shares != null ? `${pos.shares} shares` : ""}{pos.costBasis != null ? ` · cost ${money(pos.costBasis)}` : ""}{pos.notes ? ` · ${pos.notes}` : ""}</p>
              <div className="mt-2 flex gap-2">
                <button aria-label={`Edit ${pos.ticker}`} onClick={() => { setEditId(pos.id); setForm({ ticker: pos.ticker, companyName: pos.companyName, status: pos.status as "holding" | "watchlist", shares: pos.shares?.toString() ?? "", costBasis: pos.costBasis?.toString() ?? "", notes: pos.notes }); }} className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs">Edit</button>
                <button aria-label={`Remove ${pos.ticker}`} onClick={() => del.mutate(pos.id)} className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs" style={{ color: "var(--red)" }}>Remove</button>
              </div>
            </div>
          );
        })}
        {positions.data && positions.data.positions.length === 0 && <p className="py-8 text-center text-sm text-[var(--dim)]">Nothing here yet. Add the stocks you own and the ones you're watching — analyses you run will attach to them automatically.</p>}
      </div>
    </div>
  );
}

function CompareTab() {
  const [capital, setCapital] = useState("10000");
  const [runCap, setRunCap] = useState(10000);
  const cmp = useQuery({ queryKey: ["compare", runCap], queryFn: () => api.compareOpportunities({ capital: runCap }) });
  return (
    <div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setRunCap(Number(capital) || 10000); }} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">New capital to deploy ($)
          <input aria-label="Capital to deploy in dollars" type="number" min="1" value={capital} onChange={(e) => setCapital(e.target.value)} className="mt-1 block w-44 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2" />
        </label>
        <button type="submit" className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--accent)", color: "var(--accent-text)" }}>Rank opportunities</button>
      </form>
      <p className="mt-2 text-sm text-[var(--dim)]">The question that matters: if this capital went to only one analyzed name today, which offers the best expected return for its quality? Ranked by probability-weighted intrinsic value vs live price — never by how far a stock has fallen.</p>
      {cmp.isPending && <p className="mt-4 text-sm text-[var(--dim)]">Fetching live prices and ranking…</p>}
      {cmp.data && cmp.data.rows.length === 0 && <p className="mt-4 text-sm text-[var(--dim)]">No analyses yet. Analyze at least two tickers in the Analyze tab, then come back to compare them.</p>}
      {cmp.data && cmp.data.rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--dim)]"><th className="px-4 py-2">#</th><th className="px-4 py-2">Ticker</th><th className="px-4 py-2 text-right">Live price</th><th className="px-4 py-2 text-right">Weighted IV</th><th className="px-4 py-2 text-right">Expected return</th><th className="px-4 py-2 text-right">Quality</th><th className="px-4 py-2">Verdict</th><th className="px-4 py-2 text-right">Shares for {money(runCap, 0)}</th></tr></thead>
            <tbody>
              {cmp.data.rows.map((r, i) => (
                <tr key={r.ticker} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2">{i + 1}</td>
                  <td className="px-4 py-2 font-semibold" style={{ fontFamily: "var(--serif)" }}>{r.ticker}</td>
                  <td className="px-4 py-2 text-right">{money(r.price)}</td>
                  <td className="px-4 py-2 text-right">{money(r.intrinsicWeighted)}</td>
                  <td className="px-4 py-2 text-right font-semibold" style={{ color: r.expectedReturnPct != null && r.expectedReturnPct >= 0 ? "var(--green)" : "var(--red)" }}>{r.expectedReturnPct == null ? "—" : `${r.expectedReturnPct >= 0 ? "+" : ""}${r.expectedReturnPct.toFixed(1)}%`}</td>
                  <td className="px-4 py-2 text-right">{r.businessQualityScore?.toFixed(1) ?? "—"} / 10</td>
                  <td className="px-4 py-2" style={{ color: recColor(r.recommendation) }}>{r.recommendation}</td>
                  <td className="px-4 py-2 text-right">{r.sharesForCapital ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--dim)]">Live prices refreshed on ranking. Expected return is to weighted intrinsic value, not a forecast or a price target.</p>
    </div>
  );
}

const ANALYSIS_STAGES = [
  "Pulling the live quote and price history",
  "Researching five-plus years of financials, moat, competitors and risks",
  "Step 1 of 2 — fundamentals & scorecard: reported figures, SBC, dilution, scenario assumptions",
  "Step 2 of 2 — committee narrative: moat, thesis, risks, scenario stories",
  "Then the DCF, reverse DCF and verdict — computed in code, in seconds",
];

function ProgressPanel({ ticker, elapsed, connIssue, phase }: { ticker: string; elapsed: number; connIssue: boolean; phase: "fundamentals" | "narrative" }) {
  // Stage position follows the REAL pipeline phase, not just the clock: the
  // old panel advanced to "computing the DCF" after 60s even when the server
  // was still synthesizing (or had died), which is exactly how a stalled
  // MELI run looked like it was stuck on the DCF step.
  const current = phase === "narrative" ? 3 : elapsed < 10 ? 1 : 2;
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <div className="mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4" role="status" aria-live="polite" aria-label={`Analysis of ${ticker} in progress`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Analyzing {ticker} — the committee is working</p>
        <p className="text-sm tabular-nums" style={{ fontFamily: "var(--serif)" }}>{mmss} elapsed</p>
      </div>
      <ol className="mt-3 space-y-2">
        {ANALYSIS_STAGES.map((label, i) => (
          <li key={label} className="flex items-center gap-2 text-sm" style={i > current ? { color: "var(--dim)" } : undefined}>
            {i < current
              ? <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: "var(--green)", color: "#fff" }}>✓</span>
              : i === current
                ? <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--border)]" style={{ borderTopColor: "var(--accent)" }} />
                : <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-[var(--border)]" />}
            <span>{label}{i === current ? "…" : ""}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-[var(--dim)]">The analysis runs as two server steps of about a minute each — splitting them is what keeps heavy tickers like MELI from timing out mid-report. You can switch tabs, or close and reopen this page: progress is kept and the finished report is saved to your shelf automatically the moment it completes.</p>
      {connIssue && <p className="mt-2 text-xs font-medium" style={{ color: "var(--brass)" }}>The connection to the running analysis dropped — don't close this yet; we're checking whether the finished report still arrives, and step 2 can resume from the saved step 1.</p>}
      {!connIssue && elapsed >= 150 && <p className="mt-2 text-xs font-medium" style={{ color: "var(--brass)" }}>Taking longer than usual — still working. The report will appear here as soon as it is saved.</p>}
    </div>
  );
}

const RUN_KEY = "eqr-pending-analysis";
type PendingRun = { ticker: string; startedAt: number; baselineId: number; phase: "fundamentals" | "narrative"; draftId: number | null };

function friendlyRunError(ticker: string, msg: string | null): string {
  if (msg && /timed out|timeout/i.test(msg)) return `The ${ticker} analysis timed out on the server and no report was saved. It now runs as two shorter steps — please run ${ticker} again.`;
  if (msg) return `The ${ticker} analysis didn't complete (${msg.slice(0, 140)}). No report was saved — please run it again.`;
  return `The ${ticker} analysis didn't complete and no finished report arrived. Please run it again.`;
}

export function App() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"analyze" | "portfolio" | "compare">("analyze");
  const [ticker, setTicker] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const analyses = useQuery({ queryKey: ["analyses"], queryFn: () => api.listAnalyses({ limit: 50 }) });
  const list = analyses.data?.analyses ?? [];
  const [run, setRun] = useState<PendingRun | null>(null);
  const [checking, setChecking] = useState(false);
  const [connIssue, setConnIssue] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runErrMsg, setRunErrMsg] = useState<string | null>(null);
  const [errAt, setErrAt] = useState<number | null>(null);
  const [step2FireAt, setStep2FireAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const finishRun = useCallback((id: number) => {
    setSelectedId(id);
    setRun(null);
    setConnIssue(false);
    setRunError(null);
    setRunErrMsg(null);
    setErrAt(null);
    try { localStorage.removeItem(RUN_KEY); } catch { /* storage unavailable */ }
    qc.invalidateQueries({ queryKey: ["analyses"] });
  }, [qc]);

  // A dropped or timed-out request does not mean the server stopped: the
  // report is saved before the response returns, so it often lands anyway.
  // Record the error and let the poll below recover the finished report — or
  // surface the real server error after a grace window — instead of spinning
  // forever.
  const noteError = useCallback((err: unknown) => {
    setConnIssue(true);
    setRunErrMsg(err instanceof Error ? err.message : String(err));
    setErrAt(Date.now());
  }, []);

  const completeMut = useMutation({
    mutationFn: (draftId: number) => api.completeAnalysis({ draftId }),
    onSuccess: (d) => {
      if (d.status === "completed" && d.analysis) { finishRun(d.analysis.id); return; }
      if (d.status === "in-progress") {
        // Another completion already holds the server claim and is actively
        // working — clear any earlier error so the terminal-failure logic
        // doesn't fire while its saved report is on the way to the poll.
        setConnIssue(false);
        setErrAt(null);
        setRunErrMsg(null);
      }
      // "missing": draft gone (likely completed elsewhere); the poll finds
      // the report if one landed, else its terminal logic reports it.
    },
    onError: noteError,
  });

  const beginMut = useMutation({
    mutationFn: (t: string) => api.beginAnalysis({ ticker: t }),
    onSuccess: (d) => {
      setRun((r) => {
        if (!r || r.ticker !== d.ticker) return r;
        const nr: PendingRun = { ...r, phase: "narrative", draftId: d.draftId };
        try { localStorage.setItem(RUN_KEY, JSON.stringify(nr)); } catch { /* storage unavailable */ }
        return nr;
      });
      setStep2FireAt(Date.now());
      completeMut.mutate(d.draftId);
    },
    onError: noteError,
  });

  const startRun = async (raw: string) => {
    const tk = raw.trim().toUpperCase();
    if (!tk || run || checking) return;
    setRunError(null);
    // Fast pre-check: an unresolvable symbol fails in seconds, not minutes.
    setChecking(true);
    try {
      const q = await api.getQuote({ ticker: tk });
      if (!q.found || q.price == null) {
        setRunError(`Ticker ${tk} could not be resolved to a traded instrument. Check the symbol and try again.`);
        return;
      }
    } catch { /* quote check unavailable — let the analysis itself decide */ }
    finally { setChecking(false); }
    const r: PendingRun = { ticker: tk, startedAt: Date.now(), baselineId: list[0]?.id ?? 0, phase: "fundamentals", draftId: null };
    setRun(r);
    setConnIssue(false);
    setRunErrMsg(null);
    setErrAt(null);
    setStep2FireAt(0);
    try { localStorage.setItem(RUN_KEY, JSON.stringify(r)); } catch { /* storage unavailable */ }
    beginMut.mutate(tk);
  };

  // If the page was closed or reloaded mid-analysis, resume watching: step 1
  // survives as a server-side draft, so a stored draftId lets the poll effect
  // resume step 2 instead of starting over. Runs stored by the old
  // single-call version have no draftId — they can only be watched for a
  // report that already landed, then reported as interrupted.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RUN_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<PendingRun>;
      if (stored && typeof stored.ticker === "string" && typeof stored.startedAt === "number" && Date.now() - stored.startedAt < 15 * 60_000) {
        setRun({
          ticker: stored.ticker, startedAt: stored.startedAt, baselineId: stored.baselineId ?? 0,
          phase: stored.draftId != null ? "narrative" : "fundamentals", draftId: stored.draftId ?? null,
        });
        setConnIssue(true);
      } else localStorage.removeItem(RUN_KEY);
    } catch { /* storage unavailable */ }
  }, []);

  // Elapsed clock for the progress panel.
  useEffect(() => {
    if (!run) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [run]);

  // While a run is active, poll for the saved report. This turns a lost
  // response into a recovered result instead of a permanent "Analyzing…".
  const poll = useQuery({
    queryKey: ["analysis-poll", run?.ticker ?? "", run?.baselineId ?? 0],
    queryFn: () => api.listAnalyses({ ticker: run?.ticker ?? "", limit: 5 }),
    enabled: !!run,
    refetchInterval: 4000,
  });
  const stepPending = beginMut.isPending || completeMut.isPending;
  useEffect(() => {
    if (!run || !poll.data) return;
    const fresh = poll.data.analyses.find((a) => a.id > run.baselineId);
    if (fresh) { finishRun(fresh.id); return; }
    const now = Date.now();
    // Resume step 2 whenever we hold a draft but no completion call is in
    // flight — after a page reload, or once a stale server claim can be
    // reclaimed. Repeat calls are safe: the server claim answers
    // "in-progress" instead of duplicating the report.
    if (run.phase === "narrative" && run.draftId != null && !stepPending && now - step2FireAt > 30_000) {
      setStep2FireAt(now);
      completeMut.mutate(run.draftId);
      return;
    }
    // Terminal failure: a step errored and, after a grace window for a saved
    // report to appear anyway, nothing arrived — surface the real error
    // instead of spinning forever (the old build's failure mode).
    if (connIssue && !stepPending) {
      const errStale = errAt != null && now - errAt > 45_000;
      const runStale = now - run.startedAt > (run.draftId != null ? 600_000 : 240_000);
      if (errStale || runStale) {
        const tk = run.ticker;
        const msg = runErrMsg;
        setRun(null);
        setConnIssue(false);
        setErrAt(null);
        setRunErrMsg(null);
        try { localStorage.removeItem(RUN_KEY); } catch { /* storage unavailable */ }
        setRunError(friendlyRunError(tk, msg));
      }
    }
  }, [poll.data, run, connIssue, errAt, runErrMsg, step2FireAt, stepPending, finishRun]);

  const delAnalysis = useMutation({ mutationFn: (id: number) => api.deleteAnalysis({ id }), onSuccess: () => { setSelectedId(null); qc.invalidateQueries({ queryKey: ["analyses"] }); } });
  const selected = list.find((a) => a.id === selectedId) ?? list[0] ?? null;
  const busy = run != null || checking;
  const latestTickers = useMemo(() => { const seen = new Set<string>(); return list.filter((a) => !seen.has(a.ticker) && seen.add(a.ticker)); }, [list]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-3xl px-4 pb-10">
        <p className="pt-5 text-sm leading-relaxed text-[var(--dim)]" style={{ fontFamily: "var(--serif)" }}>
          A buy-side desk, not a tip sheet. Business quality is judged first and priced second — <em>a wonderful business can be a terrible investment at the wrong price.</em>
        </p>

        <nav className="mt-4 flex gap-1 rounded-full bg-[var(--surface2)] p-1" aria-label="Main views">
          {([["analyze", "Analyze"], ["portfolio", "Portfolio"], ["compare", "Opportunity cost"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className="flex-1 rounded-full px-3 py-2 text-sm font-medium" style={tab === k ? { background: "var(--surface)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" } : { color: "var(--dim)" }}>{label}</button>
          ))}
        </nav>

        {tab === "analyze" && (
          <div className="mt-5">
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); void startRun(ticker); }} className="flex gap-2">
              <label className="sr-only" htmlFor="ticker-input">Ticker symbol to analyze</label>
              <input id="ticker-input" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker — e.g. MSFT, GOOGL, AVGO, CRM" disabled={busy} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-base disabled:opacity-60" style={{ fontFamily: "var(--serif)" }} />
              <button type="submit" disabled={busy} className="rounded-lg px-5 py-3 text-sm font-semibold disabled:opacity-60" style={{ background: "var(--accent)", color: "var(--accent-text)" }}>{checking ? "Checking…" : run ? "Analyzing…" : "Run committee analysis"}</button>
            </form>
            {run && <ProgressPanel ticker={run.ticker} elapsed={elapsed} connIssue={connIssue} phase={run.phase} />}
            {runError && <p className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--red)", color: "var(--red)" }} role="alert">{runError}</p>}

            {latestTickers.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--dim)]">Your research shelf</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {latestTickers.map((a) => (
                    <button key={a.id} onClick={() => setSelectedId(a.id)} aria-pressed={selected?.id === a.id} className="rounded-full border px-3 py-1.5 text-sm" style={selected?.id === a.id ? { borderColor: "var(--text)", background: "var(--surface)", fontWeight: 600 } : { borderColor: "var(--border)", background: "var(--surface)" }}>
                      {a.ticker} · <span style={{ color: recColor(a.recommendation) }}>{a.recommendation}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6">
              {analyses.isPending && <p className="text-sm text-[var(--dim)]">Loading your research…</p>}
              {analyses.data && list.length === 0 && !run && (
                <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] px-5 py-10 text-center">
                  <p className="text-lg font-semibold" style={{ fontFamily: "var(--serif)" }}>No analyses yet</p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-[var(--dim)]">Enter any listed ticker above. You'll get a full committee report: business quality and moat, reported fundamentals with an SBC honesty check, a computed bear/base/bull DCF with margin-of-safety entry prices, a reverse DCF, thesis breakers, and a verdict that keeps quality and price separate.</p>
                </div>
              )}
              {selected && (
                <>
                  <Report a={selected} />
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button onClick={() => void startRun(selected.ticker)} disabled={busy} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium disabled:opacity-50">Re-run analysis (creates a new version + change detection)</button>
                    <button onClick={() => delAnalysis.mutate(selected.id)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm" style={{ color: "var(--red)" }}>Delete this version</button>
                  </div>
                  {list.filter((x) => x.ticker === selected.ticker).length > 1 && (
                    <p className="mt-3 text-xs text-[var(--dim)]">Earlier versions of {selected.ticker}: {list.filter((x) => x.ticker === selected.ticker && x.id !== selected.id).map((x) => (
                      <button key={x.id} onClick={() => setSelectedId(x.id)} className="ml-1 underline underline-offset-2">{new Date(x.createdAt).toLocaleDateString()}</button>
                    ))}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {tab === "portfolio" && <div className="mt-5"><PortfolioTab /></div>}
        {tab === "compare" && <div className="mt-5"><CompareTab /></div>}

        <footer className="mt-10 border-t border-[var(--border)] pt-4 text-xs leading-relaxed text-[var(--dim)]">
          Discipline rules enforced by design: never buy because a stock fell, never sell because it rose, analyst price targets are never used as intrinsic value, SBC is always counted as a cost, and every new dollar is compared against its best alternative. Personal research tool — not financial advice.
        </footer>
      </main>
    </div>
  );
}
