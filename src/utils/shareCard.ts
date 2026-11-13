import type { PlayerSeasonAverage } from '../types/database';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function downloadPlayerStatCard(avg: PlayerSeasonAverage) {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 520;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const accent = avg.team_primary_color || '#f97316';

  // Background
  const bg = ctx.createLinearGradient(0, 0, 900, 520);
  bg.addColorStop(0, '#090d16');
  bg.addColorStop(1, '#131c2e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 900, 520);

  // Subtle accent glow
  const glow = ctx.createRadialGradient(760, 100, 20, 760, 100, 380);
  glow.addColorStop(0, `${accent}44`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 900, 520);

  // Header brand
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.fillText('COURTVISION · TEMPORADA 2026-27', 48, 56);

  // Team badge
  ctx.fillStyle = accent;
  roundRect(ctx, 48, 86, 86, 36, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 18px system-ui, sans-serif';
  ctx.fillText(avg.team_abbreviation ?? 'NBA', 68, 110);

  if (avg.position || avg.jersey_number) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(
      `#${avg.jersey_number ?? '-'} · ${avg.position ?? 'JUG'} · ${avg.gp} PJ`,
      150,
      110,
    );
  }

  // Player name
  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 48px system-ui, sans-serif';
  ctx.fillText(avg.full_name, 48, 178);

  // Main stat boxes
  const mainStats = [
    { label: 'PTS / PJ', val: Number(avg.ppg ?? 0).toFixed(1) },
    { label: 'REB / PJ', val: Number(avg.rpg ?? 0).toFixed(1) },
    { label: 'AST / PJ', val: Number(avg.apg ?? 0).toFixed(1) },
    { label: 'TS%', val: avg.ts_pct != null ? `${Number(avg.ts_pct).toFixed(1)}%` : '-' },
  ];

  mainStats.forEach((st, idx) => {
    const x = 48 + idx * 204;
    const y = 225;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, y, 188, 132, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(st.label, x + 22, y + 36);

    ctx.fillStyle = idx === 0 ? '#fb923c' : '#f8fafc';
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.fillText(st.val, x + 22, y + 98);
  });

  // Secondary shooting row
  const splits = [
    `FG: ${avg.fg_pct ?? '-'}%`,
    `3P: ${avg.tp_pct ?? '-'}%`,
    `TL: ${avg.ft_pct ?? '-'}%`,
    `eFG%: ${avg.efg_pct ?? '-'}%`,
    `DD: ${avg.double_doubles}`,
  ];
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillText(splits.join('   ·   '), 48, 412);

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.fillText('Generado gratis con CourtVision Stats PWA', 48, 476);

  const link = document.createElement('a');
  link.download = `${avg.full_name.toLowerCase().replace(/\s+/g, '-')}-stats.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function downloadCompareCard(a: PlayerSeasonAverage, b: PlayerSeasonAverage) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 560;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bg = ctx.createLinearGradient(0, 0, 960, 560);
  bg.addColorStop(0, '#090d16');
  bg.addColorStop(1, '#111827');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 960, 560);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('COURTVISION · CARA A CARA 2026-27', 480, 46);

  // Left & Right headers
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fb923c';
  ctx.font = '800 32px system-ui, sans-serif';
  ctx.fillText(a.full_name, 48, 102);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillText(`${a.team_abbreviation ?? 'NBA'} · ${a.gp} PJ`, 48, 130);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#38bdf8';
  ctx.font = '800 32px system-ui, sans-serif';
  ctx.fillText(b.full_name, 912, 102);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillText(`${b.team_abbreviation ?? 'NBA'} · ${b.gp} PJ`, 912, 130);

  const metrics: Array<{ label: string; va: number; vb: number; suffix?: string }> = [
    { label: 'PUNTOS / PJ', va: Number(a.ppg ?? 0), vb: Number(b.ppg ?? 0) },
    { label: 'REBOTES / PJ', va: Number(a.rpg ?? 0), vb: Number(b.rpg ?? 0) },
    { label: 'ASISTENCIAS / PJ', va: Number(a.apg ?? 0), vb: Number(b.apg ?? 0) },
    { label: 'EFECTIVIDAD %', va: Number(a.fg_pct ?? 0), vb: Number(b.fg_pct ?? 0), suffix: '%' },
    { label: 'TRUE SHOOTING %', va: Number(a.ts_pct ?? 0), vb: Number(b.ts_pct ?? 0), suffix: '%' },
  ];

  metrics.forEach((m, idx) => {
    const y = 185 + idx * 66;
    const s = m.suffix ?? '';
    ctx.textAlign = 'left';
    ctx.fillStyle = m.va >= m.vb ? '#fb923c' : '#cbd5e1';
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillText(`${m.va.toFixed(1)}${s}`, 48, y);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(m.label, 480, y - 4);

    ctx.textAlign = 'right';
    ctx.fillStyle = m.vb >= m.va ? '#38bdf8' : '#cbd5e1';
    ctx.font = '800 28px system-ui, sans-serif';
    ctx.fillText(`${m.vb.toFixed(1)}${s}`, 912, y);

    // Divider
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(48, y + 18, 864, 1);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText('CourtVision Stats — 100% Gratis · Web & Móvil', 480, 530);

  const link = document.createElement('a');
  link.download = `comparativa-${a.full_name.split(' ').pop()}-vs-${b.full_name.split(' ').pop()}.png`.toLowerCase();
  link.href = canvas.toDataURL('image/png');
  link.click();
}
