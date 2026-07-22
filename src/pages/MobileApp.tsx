import { useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { v4 as uuid } from 'uuid';
import { PadlockIcon } from '../components/PadlockIcon';
import { SyncBadge } from '../components/SyncBadge';
import { useSessionStore } from '../store/sessionStore';
import { useHistoryStore } from '../store/historyStore';
import { useDayStore } from '../store/dayStore';
import { useCycleStore } from '../store/cycleStore';
import { useSettingsStore } from '../store/settingsStore';
import { useDriveStore } from '../store/driveStore';
import { DIMENSIONS, DEFAULT_DIMENSIONS, MOOD_EMOJI, ENERGY_EMOJI, REGULATION_EMOJI } from '../data/constants';
import { calculateZone, getZoneReasons } from '../utils/regulationScore';
import { getCyclePhase, isoDate } from '../utils/cyclePredictor';
import { connectAndSync, disconnectDrive, syncToDrive, syncFromDrive } from '../utils/driveSync';
import { ActivityRoulette } from '../components/ActivityRoulette';
import { useDriveSync } from '../hooks/useDriveSync';
import type { DimensionScores, Session } from '../types';

type Zone = 'green' | 'amber' | 'red';
type Page = 'home' | 'settings';

const ZONE_STYLE: Record<Zone, { dot: string; border: string; bg: string; label: string }> = {
  green: { dot: '#b5ead7', border: '#6aab90', bg: 'rgba(181,234,215,0.15)', label: 'GREEN' },
  amber: { dot: '#ffeaa7', border: '#c9a84c', bg: 'rgba(255,234,167,0.15)', label: 'AMBER' },
  red:   { dot: '#f7cac9', border: '#c98a88', bg: 'rgba(247,202,201,0.15)', label: 'RED'   },
};

const SYMPTOMS = ['fatigue', 'bloating', 'breast tenderness', 'headache', 'nausea', 'cramps'];

const ABBREV: Record<string, string> = {
  HEALTH: 'H', MENTAL: 'M', RELATE: 'Re', FAMILY: 'F',
  WORK: 'W', CREATE: 'C', REST: 'Rs', NOURISH: 'N',
};

function fmtTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── compact slider (emoji ON the track) ──────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  emojiForValue: (v: number) => string;
  color: string;
}

function CompactSlider({ label, value, onChange, disabled, emojiForValue, color }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = ((value - 1) / 9) * 100;
  const thumbLeft = `calc(${(pct / 100).toFixed(4)} * (100% - 20px) + 10px)`;

  function updateFromX(clientX: number) {
    if (disabled || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    onChange(Math.max(1, Math.min(10, Math.round((x / rect.width) * 9) + 1)));
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', touchAction: 'pan-y', userSelect: 'none', opacity: disabled ? 0.45 : 1 }}
      onPointerDown={(e) => { if (disabled) return; dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); updateFromX(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) updateFromX(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: '#c0b2e0', width: 60, flexShrink: 0 }}>
        {label}
      </span>

      {/* Track area */}
      <div style={{ flex: 1, position: 'relative', height: 30 }}>
        {/* Filled track */}
        <div
          ref={trackRef}
          style={{
            position: 'absolute', left: 10, right: 10, top: '50%', transform: 'translateY(-50%)',
            height: 6, borderRadius: 3,
            background: `linear-gradient(to right, ${color} ${pct}%, #1a1a2e ${pct}%)`,
            border: '1px solid rgba(155,137,196,0.35)',
          }}
        />
        {/* Emoji thumb — ON the track line */}
        <div style={{
          position: 'absolute',
          left: thumbLeft,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 20,
          lineHeight: 1,
          pointerEvents: 'none',
          userSelect: 'none',
        }}>
          {emojiForValue(value)}
        </div>
      </div>

      <span style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: 15, color, width: 18, textAlign: 'right', flexShrink: 0 }}>
        {value}
      </span>
    </div>
  );
}

// ─── dimension slider (compact, for wheel of life) ────────────────────────────

function DimSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = ((value - 1) / 9) * 100;

  function updateFromX(clientX: number) {
    if (disabled || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    onChange(Math.max(1, Math.min(10, Math.round((x / rect.width) * 9) + 1)));
  }

  return (
    <div
      style={{ position: 'relative', height: 14, touchAction: 'pan-y' }}
      onPointerDown={(e) => { if (disabled) return; dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); updateFromX(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) updateFromX(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <div ref={trackRef} style={{ position: 'absolute', left: 0, right: 0, top: 4, height: 6, borderRadius: 3, background: '#1a1a2e', border: '1px solid rgba(155,137,196,0.4)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: '#c9b8f0', opacity: 0.45 }} />
      </div>
      <div style={{ position: 'absolute', top: 1, left: `${pct}%`, transform: 'translateX(-50%)', width: 12, height: 12, borderRadius: '50%', background: '#c9b8f0', border: '2px solid #16213e', pointerEvents: 'none' }} />
    </div>
  );
}

// ─── zone badge ───────────────────────────────────────────────────────────────

function ZoneBadge({ zone, reasons, onTap }: { zone: Zone; reasons: string[]; onTap: () => void }) {
  const s = ZONE_STYLE[zone];
  return (
    <motion.button
      onClick={onTap}
      animate={zone === 'red' ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
      transition={zone === 'red' ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 }}
      style={{ background: s.bg, border: `1.5px solid ${s.border}`, borderRadius: 6, padding: '6px 10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, cursor: 'pointer', minWidth: 80, boxShadow: `2px 2px 0px ${s.border}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: s.dot }}>{s.label}</span>
      </div>
      {zone !== 'green' && reasons.length > 0 && (
        <span style={{ fontFamily: 'Nunito, sans-serif', fontSize: 12, color: '#c0b2e0', lineHeight: 1.2 }}>
          {reasons.slice(0, 2).join(' · ')}
        </span>
      )}
    </motion.button>
  );
}

// ─── status bar ───────────────────────────────────────────────────────────────

function StatusBar({ phaseInfo, periodLen, hasCycle, zone, zoneReasons, onZoneTap }: {
  phaseInfo: ReturnType<typeof getCyclePhase>;
  periodLen: number; hasCycle: boolean;
  zone: Zone; zoneReasons: string[]; onZoneTap: () => void;
}) {
  const daysUntilPeriod = phaseInfo.totalLen - phaseInfo.cyclePos;
  const inPeriod = phaseInfo.phase === 'menstrual' && phaseInfo.cyclePos <= periodLen;
  const inLuteal = phaseInfo.phase === 'luteal';
  const warningClose = !inPeriod && daysUntilPeriod <= 12;

  let barBg = '#16213e';
  let barBorder = '#c0b2e0';
  if (inLuteal) { barBg = 'rgba(255,234,167,0.08)'; barBorder = '#c9a84c'; }
  if (inPeriod || warningClose) { barBg = 'rgba(247,202,201,0.08)'; barBorder = '#c98a88'; }

  let icon = '🌙', text = `${daysUntilPeriod}d to period`, color = '#c9b8f0', font = 'Nunito, sans-serif', size = 13;
  if (!hasCycle) { text = 'Set up cycle →'; color = '#c0b2e0'; }
  else if (inPeriod) { icon = '🔴'; text = `Period day ${phaseInfo.cyclePos}`; color = '#f7cac9'; font = "'Press Start 2P', monospace"; size = 12; }
  else if (warningClose) { icon = '⚠️'; text = `${daysUntilPeriod}d to period`; color = '#f7cac9'; font = "'Press Start 2P', monospace"; size = 12; }
  else if (inLuteal) { text = `Luteal · ${daysUntilPeriod}d`; color = '#ffeaa7'; font = "'Press Start 2P', monospace"; size = 12; }

  return (
    <div style={{ background: barBg, border: `2px solid ${barBorder}`, borderRadius: 4, margin: '0 16px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, boxShadow: '3px 3px 0px rgba(155,137,196,0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontFamily: font, fontSize: size, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
      </div>
      <ZoneBadge zone={zone} reasons={zoneReasons} onTap={onZoneTap} />
    </div>
  );
}

// ─── checklist grid ───────────────────────────────────────────────────────────

type ClockTarget =
  | { kind: 'medicationMorning' }
  | { kind: 'medicationArvo' }
  | { kind: 'medicationSsri' }
  | { kind: 'meal'; id: 'breakfast' | 'lunch' | 'dinner' }
  | { kind: 'gym' }
  | { kind: 'alone' };

function ChecklistGrid() {
  const { dayRecord, setMedicationMorningTaken, setMedicationMorningTime, setMedicationArvoTaken, setMedicationArvoTime, setSsriTaken, setSsriTime, updateMeal, setMealTime, setGymToday, setGymTime, setAloneTimeToday, setAloneTimeStart } = useDayStore();
  const { cycles } = useCycleStore();
  const { expectedCycleLength, expectedPeriodLength } = useSettingsStore();
  const [clockTarget, setClockTarget] = useState<ClockTarget | null>(null);
  const [timeInput, setTimeInput] = useState('');
  const isWeekday = new Date().getDay() >= 1 && new Date().getDay() <= 5;

  const { isSSRIWindow, daysUntilPeriod } = useMemo(() => {
    if (!cycles.length) return { isSSRIWindow: false, daysUntilPeriod: 0 };
    const phase = getCyclePhase(cycles[0].cycleStartDate, expectedCycleLength, expectedPeriodLength, new Date());
    const days = expectedCycleLength - phase.cyclePos;
    return {
      isSSRIWindow: phase.phase === 'menstrual' || (days >= 0 && days <= 14),
      daysUntilPeriod: days,
    };
  }, [cycles, expectedCycleLength, expectedPeriodLength]);
  const meal = (id: 'breakfast' | 'lunch' | 'dinner') => dayRecord.meals.find(m => m.meal === id)!;

  function openClock(target: ClockTarget, currentIso: string | null, e: React.MouseEvent) {
    e.stopPropagation();
    const t = currentIso ? new Date(currentIso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }) : new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
    setTimeInput(t);
    setClockTarget(target);
  }

  function saveTime() {
    if (!clockTarget || !timeInput) { setClockTarget(null); return; }
    const [h, m] = timeInput.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    const iso = d.toISOString();
    if (clockTarget.kind === 'medicationMorning') setMedicationMorningTime(iso);
    else if (clockTarget.kind === 'medicationArvo') setMedicationArvoTime(iso);
    else if (clockTarget.kind === 'medicationSsri') setSsriTime(iso);
    else if (clockTarget.kind === 'meal') setMealTime(clockTarget.id, iso);
    else if (clockTarget.kind === 'gym') setGymTime(iso);
    else setAloneTimeStart(iso);
    setClockTarget(null);
  }

  const cellStyle = (checked: boolean): React.CSSProperties => ({
    minHeight: 64, padding: '10px 12px', borderRadius: 4, position: 'relative',
    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none',
    background: checked ? 'rgba(181,234,215,0.15)' : '#16213e',
    border: `2px solid ${checked ? '#6aab90' : 'rgba(155,137,196,0.4)'}`,
    boxShadow: `3px 3px 0px ${checked ? '#6aab90' : '#a096c8'}`,
    transition: 'background 0.12s, border-color 0.12s',
  });

  // Generic cell — tap body to toggle, tap 🕐 to edit time
  function Cell({ emoji, label, checked, iso, onToggle, clockT }: {
    emoji: string; label: string; checked: boolean; iso: string | null;
    onToggle: () => void; clockT: ClockTarget;
  }) {
    return (
      <div style={cellStyle(checked)} onClick={onToggle}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: checked ? '#b5ead7' : '#fdfcff' }}>{label}</div>
          {checked && fmtTime(iso) && (
            <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 12, color: '#6aab90', marginTop: 3 }}>{fmtTime(iso)}</div>
          )}
        </div>
        {checked && <span style={{ position: 'absolute', top: 6, right: 8, color: '#b5ead7', fontSize: 13, fontWeight: 700 }}>✓</span>}
        {checked && (
          <button
            onClick={(e) => openClock(clockT, iso, e)}
            style={{ position: 'absolute', bottom: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
            title="Edit time"
          >🕐</button>
        )}
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: '12px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* Medication — morning + arvo + SSRI */}
        {!isWeekday && (
          <div style={{ gridColumn: 'span 2', padding: '10px 14px', borderRadius: 4, background: 'rgba(255,234,167,0.08)', border: '1px solid rgba(201,168,76,0.35)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: '#c9a84c', lineHeight: 1.6 }}>REST DAY — you don't need DEX today, but you can still log it if you take it</span>
          </div>
        )}
        <Cell emoji="💊" label="Morning" checked={dayRecord.medicationMorningTaken} iso={dayRecord.medicationMorningTime}
          onToggle={() => setMedicationMorningTaken(!dayRecord.medicationMorningTaken)} clockT={{ kind: 'medicationMorning' }} />
        <Cell emoji="💊" label="Arvo" checked={dayRecord.medicationArvoTaken} iso={dayRecord.medicationArvoTime}
          onToggle={() => setMedicationArvoTaken(!dayRecord.medicationArvoTaken)} clockT={{ kind: 'medicationArvo' }} />
        {isSSRIWindow && (
          <div
            style={{
              gridColumn: 'span 2',
              minHeight: 64, padding: '10px 12px', borderRadius: 4, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'rgba(247,202,201,0.12)',
              border: '2px solid #c98a88',
              boxShadow: '3px 3px 0px #c98a88',
            }}
            onClick={() => setSsriTaken(!(dayRecord.ssriTaken ?? false))}
          >
            <span style={{ fontSize: 20, flexShrink: 0 }}>🌙</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: '#fdfcff' }}>SSRI</div>
              <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 11, color: 'rgba(155,137,196,0.7)', marginTop: 2 }}>
                Luteal window · {daysUntilPeriod <= 0 ? 'Period in progress' : `${daysUntilPeriod} days to period`}
              </div>
            </div>
            <span style={{ color: dayRecord.ssriTaken ? '#f7cac9' : 'rgba(201,138,136,0.5)', fontSize: 13, fontWeight: 700 }}>
              {dayRecord.ssriTaken ? '✓' : ''}
            </span>
          </div>
        )}

        <Cell emoji="🍳" label="Breakfast" checked={meal('breakfast').logged} iso={meal('breakfast').loggedTime}
          onToggle={() => updateMeal('breakfast', { logged: !meal('breakfast').logged, loggedTime: !meal('breakfast').logged ? new Date().toISOString() : null })}
          clockT={{ kind: 'meal', id: 'breakfast' }} />

        <Cell emoji="🍱" label="Lunch" checked={meal('lunch').logged} iso={meal('lunch').loggedTime}
          onToggle={() => updateMeal('lunch', { logged: !meal('lunch').logged, loggedTime: !meal('lunch').logged ? new Date().toISOString() : null })}
          clockT={{ kind: 'meal', id: 'lunch' }} />

        <Cell emoji="🍽️" label="Dinner" checked={meal('dinner').logged} iso={meal('dinner').loggedTime}
          onToggle={() => updateMeal('dinner', { logged: !meal('dinner').logged, loggedTime: !meal('dinner').logged ? new Date().toISOString() : null })}
          clockT={{ kind: 'meal', id: 'dinner' }} />

        <Cell emoji="🏋️" label="Gym" checked={dayRecord.gymToday} iso={dayRecord.gymTime}
          onToggle={() => setGymToday(!dayRecord.gymToday)} clockT={{ kind: 'gym' }} />

        <Cell emoji="🔇" label="Alone time" checked={dayRecord.aloneTimeToday} iso={dayRecord.aloneTimeStart}
          onToggle={() => setAloneTimeToday(!dayRecord.aloneTimeToday)} clockT={{ kind: 'alone' }} />
      </div>

      {/* Time edit sheet */}
      <AnimatePresence>
        {clockTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.85)', zIndex: 60 }}
            onClick={() => setClockTarget(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: '#16213e', borderTop: '2px solid #9b89c4', borderRadius: '8px 8px 0 0', padding: '20px 16px 40px' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(155,137,196,0.4)' }} />
              </div>
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: '#ffe066', marginBottom: 16 }}>EDIT TIME</div>
              <input
                type="time" value={timeInput} onChange={e => setTimeInput(e.target.value)}
                autoFocus
                style={{ width: '100%', background: '#1a1a2e', border: '1px solid rgba(155,137,196,0.4)', borderRadius: 4, padding: '12px', color: '#fdfcff', fontFamily: 'Nunito, sans-serif', fontSize: 18, textAlign: 'center', outline: 'none', boxSizing: 'border-box' }}
              />
              <button onClick={saveTime}
                style={{ marginTop: 14, width: '100%', padding: 12, cursor: 'pointer', background: 'rgba(181,234,215,0.2)', border: '1px solid #6aab90', borderRadius: 4, color: '#b5ead7', fontFamily: "'Press Start 2P', monospace", fontSize: 12 }}>
                SAVE
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── physical symptoms ────────────────────────────────────────────────────────

function SymptomsSection() {
  const { dayRecord, toggleSymptom, setThatWasntMe, setThatWasntMeNote, setBrainFog, setWorkingMemoryImpaired } = useDayStore();
  const [open, setOpen] = useState(false);
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const [noteText, setNoteText] = useState(dayRecord.thatWasntMeNote);
  const summary = dayRecord.symptoms.length > 0 ? dayRecord.symptoms.slice(0, 3).join(' · ') : 'optional';

  return (
    <div style={{ margin: '0 16px', background: '#16213e', border: '2px solid rgba(155,137,196,0.35)', borderRadius: 4, boxShadow: '3px 3px 0px #7a6fa0' }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}
          style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: '#c0b2e0', display: 'inline-block', transformOrigin: 'center' }}>▶</motion.span>
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: '#c0b2e0' }}>SYMPTOMS</span>
        {!open && <span style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#a096c8', marginLeft: 4, flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0 14px 14px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {SYMPTOMS.map(s => {
                  const active = dayRecord.symptoms.includes(s);
                  return (
                    <button key={s} onClick={() => toggleSymptom(s)}
                      style={{ height: 36, padding: '0 12px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${active ? '#c98a88' : '#c0b2e0'}`, background: active ? 'rgba(247,202,201,0.2)' : 'transparent', color: active ? '#f7cac9' : '#c0b2e0', fontFamily: 'Nunito, sans-serif', fontSize: 13, userSelect: 'none', display: 'flex', alignItems: 'center' }}>
                      {s}
                    </button>
                  );
                })}
              </div>
              <div style={{ background: 'rgba(247,202,201,0.05)', border: '1px solid rgba(201,138,136,0.3)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#fdfcff', marginBottom: 10 }}>😶 "That wasn't me" today</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setThatWasntMe(false)}
                    style={{ flex: 1, padding: 8, borderRadius: 4, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, background: !dayRecord.thatWasntMe ? 'rgba(155,137,196,0.15)' : 'transparent', border: `1px solid ${!dayRecord.thatWasntMe ? '#c0b2e0' : 'rgba(155,137,196,0.3)'}`, color: !dayRecord.thatWasntMe ? '#fdfcff' : '#a096c8' }}>No</button>
                  <button onClick={() => { setThatWasntMe(true); setNoteSheetOpen(true); }}
                    style={{ flex: 1, padding: 8, borderRadius: 4, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, background: dayRecord.thatWasntMe ? 'rgba(247,202,201,0.15)' : 'transparent', border: `1px solid ${dayRecord.thatWasntMe ? '#c98a88' : 'rgba(155,137,196,0.3)'}`, color: dayRecord.thatWasntMe ? '#f7cac9' : '#a096c8' }}>Yes + note</button>
                </div>
                {dayRecord.thatWasntMe && dayRecord.thatWasntMeNote && (
                  <div style={{ marginTop: 8, fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#c0b2e0', fontStyle: 'italic' }}>"{dayRecord.thatWasntMeNote}"</div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#c0b2e0' }}>Brain fog</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {([1, 2, 3] as const).map((v, i) => {
                      const active = dayRecord.brainFog === v;
                      return <button key={v} onClick={() => setBrainFog(active ? null : v)} style={{ padding: '4px 10px', borderRadius: 3, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, background: active ? 'rgba(201,184,240,0.2)' : 'transparent', border: `1px solid ${active ? '#c9b8f0' : 'rgba(155,137,196,0.3)'}`, color: active ? '#c9b8f0' : '#a096c8' }}>{['Low', 'Med', 'High'][i]}</button>;
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#c0b2e0' }}>Working memory</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['Fine', 'Struggling'] as const).map(label => {
                      const val = label === 'Struggling';
                      const active = dayRecord.workingMemoryImpaired === val;
                      return <button key={label} onClick={() => setWorkingMemoryImpaired(val)} style={{ padding: '4px 10px', borderRadius: 3, cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700, background: active ? 'rgba(201,184,240,0.2)' : 'transparent', border: `1px solid ${active ? '#c9b8f0' : 'rgba(155,137,196,0.3)'}`, color: active ? '#c9b8f0' : '#a096c8' }}>{label}</button>;
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {noteSheetOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.85)', zIndex: 60 }}
            onClick={() => setNoteSheetOpen(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: '#16213e', borderTop: '2px solid #c98a88', borderRadius: '8px 8px 0 0', padding: '20px 16px 40px' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(155,137,196,0.4)' }} />
              </div>
              <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 14, color: '#f7cac9', marginBottom: 12 }}>😶 What happened today?</div>
              <input type="text" value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Brief note..." autoFocus
                style={{ width: '100%', background: '#1a1a2e', borderRadius: 4, outline: 'none', border: '1px solid rgba(155,137,196,0.3)', padding: '10px 12px', color: '#fdfcff', fontFamily: 'Nunito, sans-serif', fontSize: 14, boxSizing: 'border-box' }} />
              <button onClick={() => { setThatWasntMeNote(noteText); setNoteSheetOpen(false); }}
                style={{ marginTop: 16, width: '100%', padding: 12, cursor: 'pointer', background: 'rgba(247,202,201,0.2)', border: '1px solid #c98a88', borderRadius: 4, color: '#f7cac9', fontFamily: "'Press Start 2P', monospace", fontSize: 12 }}>SAVE NOTE</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── wheel of life section ────────────────────────────────────────────────────

function WheelSection({ disabled, dimensions, onChange, lowestDimension }: { disabled: boolean; dimensions: DimensionScores; onChange: (key: keyof DimensionScores, v: number) => void; lowestDimension?: keyof DimensionScores | null }) {
  const [open, setOpen] = useState(false);
  const summary = DIMENSIONS.map(d => `${ABBREV[d.short] ?? d.short[0]}${dimensions[d.key]}`).join(' ');

  return (
    <div style={{ margin: '0 16px', background: '#16213e', border: '2px solid rgba(155,137,196,0.35)', borderRadius: 4, boxShadow: '3px 3px 0px #7a6fa0' }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', padding: '14px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer' }}>
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}
          style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: '#c0b2e0', display: 'inline-block', transformOrigin: 'center' }}>▶</motion.span>
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: '#c0b2e0' }}>WHEEL OF LIFE</span>
        {!open && <span style={{ fontFamily: 'Nunito, sans-serif', fontSize: 12, color: '#a096c8', marginLeft: 4, flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0 14px 14px' }}>
              {disabled && <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#a096c8', marginBottom: 12 }}>Unlock to adjust</div>}
              {DIMENSIONS.map(d => (
                <div key={d.key} style={{ marginBottom: 16, opacity: disabled ? 0.55 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: '#c0b2e0' }}>{d.short}</span>
                    <span style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: 13, color: '#c9b8f0' }}>{dimensions[d.key]}</span>
                  </div>
                  <DimSlider value={dimensions[d.key]} onChange={v => onChange(d.key, v)} disabled={disabled} />
                </div>
              ))}
              <div style={{ borderTop: '1px solid rgba(155,137,196,0.2)', paddingTop: 12, marginTop: 4 }}>
                <ActivityRoulette lowestDimension={lowestDimension} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── zone override sheet ──────────────────────────────────────────────────────

function ZoneOverrideSheet({ current, onSelect, onClose }: { current: Zone; onSelect: (z: Zone) => void; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.85)', zIndex: 60 }}
      onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: '#16213e', borderTop: '2px solid #9b89c4', borderRadius: '8px 8px 0 0', padding: '20px 16px 40px' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(155,137,196,0.4)' }} />
        </div>
        <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: '#c0b2e0', marginBottom: 16 }}>OVERRIDE ZONE</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['green', 'amber', 'red'] as Zone[]).map(z => {
            const s = ZONE_STYLE[z];
            return (
              <button key={z} onClick={() => { onSelect(z); onClose(); }}
                style={{ flex: 1, padding: '16px 0', borderRadius: 4, cursor: 'pointer', background: s.bg, border: `2px solid ${s.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: z === current ? 1 : 0.6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
                <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: s.dot }}>{s.label}</span>
              </button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── settings page ────────────────────────────────────────────────────────────

function SettingsPage({ onBack }: { onBack: () => void }) {
  const { connected, syncStatus, syncError, lastSyncedAt } = useDriveStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleConnect() {
    setBusy(true); setErr(null);
    try { await connectAndSync(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  async function handleDisconnect() {
    setBusy(true);
    try { await disconnectDrive(); } catch { /* ignore */ }
    finally { setBusy(false); }
  }
  async function handleSyncNow() {
    setBusy(true); setErr(null);
    try { await syncFromDrive(); await syncToDrive(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const lastSyncLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  return (
    <div style={{ width: '100%', maxWidth: 480, margin: '0 auto', minHeight: '100dvh', background: '#1a1a2e', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(155,137,196,0.15)' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#c0b2e0', fontFamily: "'Press Start 2P', monospace", fontSize: 12, padding: '4px 0' }}>← BACK</button>
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, color: '#fdfcff' }}>Settings</span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Google Drive */}
        <div style={{ background: '#16213e', border: '2px solid rgba(155,137,196,0.4)', borderRadius: 4, boxShadow: '3px 3px 0px #7a6fa0', padding: 16 }}>
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: '#ffe066', marginBottom: 14 }}>GOOGLE DRIVE SYNC</div>

          {!connected ? (
            <>
              <p style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#c0b2e0', marginBottom: 14, lineHeight: 1.5 }}>
                Connect Google Drive to sync your data across devices.
              </p>
              <button onClick={handleConnect} disabled={busy}
                style={{ width: '100%', padding: '12px 0', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, background: '#c9b8f0', border: '2px solid #7a6fa0', borderRadius: 4, boxShadow: '3px 3px 0px #7a6fa0', color: '#2d2b3d', fontFamily: "'Press Start 2P', monospace", fontSize: 11 }}>
                {busy ? 'CONNECTING…' : '✦ CONNECT'}
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: syncStatus === 'error' ? '#f7cac9' : '#b5ead7', display: 'inline-block' }} />
                <span style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#fdfcff' }}>
                  {syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'error' ? `Error: ${syncError}` : lastSyncLabel ? `Synced ${lastSyncLabel}` : 'Connected'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleSyncNow} disabled={busy}
                  style={{ flex: 1, padding: '10px 0', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, background: 'rgba(181,234,215,0.15)', border: '2px solid #6aab90', borderRadius: 4, boxShadow: '2px 2px 0px #6aab90', color: '#b5ead7', fontFamily: "'Press Start 2P', monospace", fontSize: 10 }}>
                  {busy ? '…' : 'SYNC NOW'}
                </button>
                <button onClick={handleDisconnect} disabled={busy}
                  style={{ padding: '10px 14px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, background: 'rgba(247,202,201,0.1)', border: '2px solid #c98a88', borderRadius: 4, color: '#f7cac9', fontFamily: "'Press Start 2P', monospace", fontSize: 10 }}>
                  DISCONNECT
                </button>
              </div>
            </>
          )}
          {err && <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#f7cac9', marginTop: 10 }}>{err}</div>}
        </div>

        <div style={{ background: '#16213e', border: '2px solid rgba(155,137,196,0.2)', borderRadius: 4, padding: '12px 16px' }}>
          <p style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: '#a096c8', lineHeight: 1.5 }}>
            To change routine times, cycle length, or other settings, use the desktop app at <Link to="/" style={{ color: '#c0b2e0' }}>Selene desktop →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── main mobile app ──────────────────────────────────────────────────────────

export function MobileApp() {
  const { locked, dimensions, mood, energy, regulation, lastSavedISO, note, unlock, lock, setDimension, setMood, setEnergy, setRegulation, setNote } = useSessionStore();
  const { sessions, addSession, updateSession } = useHistoryStore();
  const { dayRecord } = useDayStore();
  const { cycles } = useCycleStore();
  const { expectedCycleLength: cycleLen, expectedPeriodLength: periodLen } = useSettingsStore();

  useDriveSync();

  const [page, setPage] = useState<Page>('home');
  const [confirmedZone, setConfirmedZone] = useState<Zone>('green');
  const [hasManualOverride, setHasManualOverride] = useState(false);
  const [zoneSheetOpen, setZoneSheetOpen] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [timeEditSessionId, setTimeEditSessionId] = useState<string | null>(null);
  const [timeEditValue, setTimeEditValue] = useState('');

  const now = useMemo(() => new Date(), []);
  const cycleStartISO = cycles.length ? cycles[0].cycleStartDate : isoDate(now);
  const phaseInfo = useMemo(() => getCyclePhase(cycleStartISO, cycleLen, periodLen, now), [cycleStartISO, cycleLen, periodLen, now]);

  const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
  const mealsLogged = dayRecord.meals.filter(m => m.logged).length;
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const localDateOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const todaySessions = sessions.filter(s => localDateOf(s.timestamp) === localToday);
  const latestByTime = (arr: Session[]) => arr.length ? [...arr].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] : undefined;
  const lastSession = latestByTime(todaySessions) ?? latestByTime(sessions);

  const displayDimensions: DimensionScores = locked && lastSession ? { ...DEFAULT_DIMENSIONS, ...lastSession.dimensions } : dimensions;
  const displayMood = locked && lastSession ? lastSession.mood : mood;
  const displayEnergy = locked && lastSession ? lastSession.energy : energy;
  const displayRegulation = locked && lastSession ? lastSession.emotionalRegulation : regulation;

  const zoneInputs = { mood: displayMood, energy: displayEnergy, regulation: displayRegulation, isLutealPhase: phaseInfo.phase === 'luteal', medicationTaken: dayRecord.medicationTaken, isWeekday, symptomCount: dayRecord.symptoms.length, thatWasntMeToday: dayRecord.thatWasntMe, sleepQuality: dayRecord.sleepQuality, mealsLogged, gymToday: dayRecord.gymToday };
  const systemZone = calculateZone(zoneInputs);
  const zoneReasons = getZoneReasons(zoneInputs);

  const lastSavedLabel = lastSavedISO
    ? new Date(lastSavedISO).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  function handleToggleLock() {
    if (locked) {
      const last = sessions[sessions.length - 1];
      const safeDims: DimensionScores = { ...DEFAULT_DIMENSIONS, ...(last?.dimensions ?? {}) };
      unlock(safeDims, last?.mood ?? 5, last?.energy ?? 5, last?.emotionalRegulation ?? 5);
      setHasManualOverride(false);
    } else {
      const finalZone = hasManualOverride ? confirmedZone : systemZone;
      const newSession: Session = {
        id: uuid(), timestamp: new Date().toISOString(),
        dimensions: { ...dimensions }, mood, energy, emotionalRegulation: regulation,
        systemZone, confirmedZone: finalZone,
        zoneOverride: hasManualOverride && confirmedZone !== systemZone ? { sessionId: '', date: isoDate(now), systemSuggested: systemZone, userConfirmed: confirmedZone, inputsSnapshot: zoneInputs } : null,
        note: note.trim() || undefined,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      addSession(newSession);
      useSessionStore.setState({ lastSavedISO: newSession.timestamp });
      lock();
      setFlashing(true);
    }
  }

  function openSessionTimeEdit(s: Session) {
    const d = new Date(s.timestamp);
    setTimeEditValue(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    setTimeEditSessionId(s.id);
  }

  function saveSessionTimeEdit() {
    if (!timeEditSessionId || !timeEditValue) { setTimeEditSessionId(null); return; }
    const [h, m] = timeEditValue.split(':').map(Number);
    const sess = sessions.find((s) => s.id === timeEditSessionId);
    if (sess && !isNaN(h) && !isNaN(m)) {
      const d = new Date(sess.timestamp);
      d.setHours(h, m, 0, 0);
      updateSession(timeEditSessionId, { timestamp: d.toISOString() });
    }
    setTimeEditSessionId(null);
  }

  if (page === 'settings') return <SettingsPage onBack={() => setPage('home')} />;

  return (
    <div style={{ width: '100%', maxWidth: 480, margin: '0 auto', minHeight: '100dvh', background: '#1a1a2e', display: 'flex', flexDirection: 'column', paddingBottom: 72, gap: 10 }}>

      {/* ── Header bar ── */}
      <div style={{ padding: '10px 16px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(155,137,196,0.12)' }}>
        {/* Left: ⚡ Selene */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 13, color: '#fdfcff', letterSpacing: '0.03em' }}>Selene</span>
        </div>

        {/* Centre: lock toggle */}
        <motion.button
          onClick={handleToggleLock}
          animate={!locked ? { scale: [1, 1.03, 1] } : { scale: 1 }}
          transition={!locked ? { duration: 2, repeat: Infinity } : {}}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            borderRadius: 20, cursor: 'pointer', border: 'none',
            background: locked ? 'rgba(155,137,196,0.15)' : 'rgba(181,234,215,0.18)',
            boxShadow: locked ? '0 0 0 1.5px #7a6fa0' : '0 0 0 1.5px #6aab90',
          }}
        >
          <PadlockIcon locked={locked} size={12} />
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: locked ? '#c0b2e0' : '#b5ead7' }}>
            {locked ? `LOCKED${lastSavedLabel ? ` · ${lastSavedLabel}` : ''}` : 'OPEN'}
          </span>
        </motion.button>

        {/* Right: sync badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <SyncBadge />
        </div>
      </div>

      {/* ── Status bar ── */}
      <StatusBar phaseInfo={phaseInfo} periodLen={periodLen} hasCycle={cycles.length > 0} zone={systemZone} zoneReasons={zoneReasons} onZoneTap={() => setZoneSheetOpen(true)} />

      {/* ── Sliders ── */}
      <div style={{ margin: '0 16px', background: '#16213e', border: '2px solid rgba(155,137,196,0.35)', borderRadius: 4, boxShadow: '3px 3px 0px #7a6fa0', paddingTop: 4, paddingBottom: 4 }}>
        <CompactSlider label="Mood" value={displayMood} onChange={setMood} disabled={locked} emojiForValue={MOOD_EMOJI} color="#ffe066" />
        <div style={{ height: 1, background: 'rgba(155,137,196,0.1)', margin: '0 16px' }} />
        <CompactSlider label="Energy" value={displayEnergy} onChange={setEnergy} disabled={locked} emojiForValue={ENERGY_EMOJI} color="#b5ead7" />
        <div style={{ height: 1, background: 'rgba(155,137,196,0.1)', margin: '0 16px' }} />
        <CompactSlider label="Reg" value={displayRegulation} onChange={setRegulation} disabled={locked} emojiForValue={REGULATION_EMOJI} color="#c9b8f0" />
      </div>

      {/* ── Session note (only when unlocked) ── */}
      {!locked && (
        <div style={{ margin: '0 16px' }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Session note (optional)…"
            rows={2}
            style={{ width: '100%', background: '#16213e', border: '1px solid rgba(155,137,196,0.3)', borderRadius: 4, padding: '8px 12px', color: '#fdfcff', fontFamily: 'Nunito, sans-serif', fontSize: 13, resize: 'none', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      )}

      {/* ── Checklist ── */}
      <div style={{ margin: '0 0' }}>
        <ChecklistGrid />
      </div>

      {/* ── Today's sessions ── */}
      {todaySessions.length > 0 && (
        <div style={{ margin: '0 16px', background: '#16213e', border: '2px solid rgba(155,137,196,0.35)', borderRadius: 4, boxShadow: '3px 3px 0px #7a6fa0', padding: '12px 14px' }}>
          <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: '#ffe066', marginBottom: 10 }}>
            TODAY · {todaySessions.length} {todaySessions.length === 1 ? 'SESSION' : 'SESSIONS'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...todaySessions].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(s => {
              const t = new Date(s.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true });
              const displayedZone = s.zoneOverride ? s.confirmedZone : s.systemZone;
              const zc = { green: '#b5ead7', amber: '#ffeaa7', red: '#f7cac9' }[displayedZone];
              return (
                <div key={s.id} style={{ background: 'rgba(155,137,196,0.08)', border: '1px solid rgba(155,137,196,0.2)', borderRadius: 4, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                      <span style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: 13, color: '#fdfcff' }}>{t}</span>
                      <button
                        onClick={() => openSessionTimeEdit(s)}
                        style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: 'rgba(155,137,196,0.5)' }}
                        title="Edit time"
                      >🕐</button>
                    </div>
                    <span style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: 13, color: '#ffe066' }}>{MOOD_EMOJI(s.mood)} {s.mood}</span>
                    <span style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: 13, color: '#b5ead7' }}>⚡{s.energy}</span>
                    <span style={{ fontFamily: 'Nunito, sans-serif', fontWeight: 700, fontSize: 13, color: '#c9b8f0' }}>🧘{s.emotionalRegulation}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: zc, display: 'inline-block' }} />
                      <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: zc }}>{displayedZone.toUpperCase()}</span>
                    </div>
                  </div>
                  {s.note && <p style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, color: 'rgba(155,137,196,0.7)', fontStyle: 'italic', margin: '4px 0 0' }}>{s.note}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Collapsible sections ── */}
      <SymptomsSection />
      <WheelSection
        disabled={locked}
        dimensions={displayDimensions}
        onChange={(key, v) => setDimension(key, v)}
        lowestDimension={(Object.entries(displayDimensions).sort(([, a], [, b]) => a - b)[0]?.[0] ?? null) as keyof DimensionScores | null}
      />

      <div style={{ flex: 1 }} />

      {/* ── Fixed bottom nav ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480,
        background: '#16213e',
        boxShadow: '0px -2px 0px #9b89c4',
        display: 'flex', alignItems: 'center',
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 30,
      }}>
        {/* Today (active) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 4 }}>
          <span style={{ fontSize: 18 }}>🌸</span>
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: '#ffe066' }}>Today</span>
        </div>

        {/* Desktop link */}
        <Link to="/" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 4, textDecoration: 'none' }}>
          <span style={{ fontSize: 18 }}>🖥️</span>
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: '#a096c8' }}>Desktop</span>
        </Link>

        {/* Settings */}
        <button onClick={() => setPage('settings')} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 4, background: 'none', border: 'none', cursor: 'pointer' }}>
          <span style={{ fontSize: 18 }}>⚙️</span>
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: '#a096c8' }}>Settings</span>
        </button>
      </div>

      {/* Lock flash overlay */}
      {flashing && (
        <motion.div key="flash" animate={{ opacity: [0, 0.15, 0] }} transition={{ duration: 0.3, ease: 'easeInOut' }}
          onAnimationComplete={() => setFlashing(false)}
          style={{ position: 'fixed', inset: 0, background: '#b5ead7', pointerEvents: 'none', zIndex: 50 }} />
      )}

      {/* Session time edit sheet */}
      <AnimatePresence>
        {timeEditSessionId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.85)', zIndex: 60 }}
            onClick={() => setTimeEditSessionId(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 480, background: '#16213e', borderTop: '2px solid #9b89c4', borderRadius: '8px 8px 0 0', padding: '20px 16px 40px' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(155,137,196,0.4)' }} />
              </div>
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: '#ffe066', marginBottom: 16 }}>EDIT SESSION TIME</div>
              <input
                type="time" value={timeEditValue} onChange={e => setTimeEditValue(e.target.value)}
                autoFocus
                style={{ width: '100%', background: '#1a1a2e', border: '1px solid rgba(155,137,196,0.4)', borderRadius: 4, padding: '12px', color: '#fdfcff', fontFamily: 'Nunito, sans-serif', fontSize: 18, textAlign: 'center', outline: 'none', boxSizing: 'border-box' }}
              />
              <button onClick={saveSessionTimeEdit}
                style={{ marginTop: 14, width: '100%', padding: 12, cursor: 'pointer', background: 'rgba(181,234,215,0.2)', border: '1px solid #6aab90', borderRadius: 4, color: '#b5ead7', fontFamily: "'Press Start 2P', monospace", fontSize: 12 }}>
                SAVE
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {zoneSheetOpen && (
          <ZoneOverrideSheet current={systemZone} onSelect={(z) => { setConfirmedZone(z); setHasManualOverride(true); }} onClose={() => setZoneSheetOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
