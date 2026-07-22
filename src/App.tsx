import { useState, useMemo, useEffect } from 'react';
import { BottomNav } from './components/BottomNav';
import { Today } from './pages/Today';
import { Calendar } from './pages/Calendar';
import { Cycle } from './pages/Cycle';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { useCycleStore } from './store/cycleStore';
import { useSettingsStore } from './store/settingsStore';
import { useDayStore } from './store/dayStore';
import { useDriveStore } from './store/driveStore';
import { getCyclePhase, isoDate } from './utils/cyclePredictor';
import { useDriveSync } from './hooks/useDriveSync';
import { connectAndSync } from './utils/driveSync';

type Tab = 'today' | 'calendar' | 'cycle' | 'dashboard';

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { ensureToday } = useDayStore();
  useDriveSync();

  // Archive yesterday and reset checklist on mount, every minute, and on visibility change.
  // The interval alone isn't reliable on mobile — browsers suspend background timers,
  // so the midnight rollover is missed. visibilitychange fires when the user returns to
  // the app from the background, catching the new-day case on mobile.
  useEffect(() => {
    ensureToday();
    const interval = setInterval(ensureToday, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') ensureToday(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const needsReconnect = useDriveStore((s) => s.needsReconnect);

  const { cycles } = useCycleStore();
  const { expectedCycleLength: cycleLen, expectedPeriodLength: periodLen } = useSettingsStore();

  const today = useMemo(() => new Date(), []);
  const cycleStartISO = cycles.length ? cycles[0].cycleStartDate : isoDate(today);
  const phaseInfo = useMemo(
    () => getCyclePhase(cycleStartISO, cycleLen, periodLen, today),
    [cycleStartISO, cycleLen, periodLen, today]
  );

  return (
    <div className="min-h-screen bg-night-sky text-cloud-white">
      {needsReconnect && (
        <div style={{
          background: '#16213e',
          border: '2px solid #c9a84c',
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: 'Nunito, sans-serif',
        }}>
          <span style={{ fontSize: 13, color: '#ffeaa7', flex: 1 }}>
            Drive sync disconnected — session expired
          </span>
          <button
            onClick={() => connectAndSync().catch(console.error)}
            style={{
              background: '#c9a84c',
              border: 'none',
              borderRadius: 4,
              padding: '4px 14px',
              color: '#16213e',
              fontFamily: 'Nunito, sans-serif',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reconnect
          </button>
        </div>
      )}
      <div className="w-full px-6 pt-6 pb-20 max-w-[1400px] mx-auto">
        {tab === 'today' && (
          <Today
            phaseInfo={phaseInfo}
            periodLen={periodLen}
            goCycle={() => setTab('cycle')}
          />
        )}
        {tab === 'calendar' && (
          <Calendar cycleStartISO={cycleStartISO} cycleLen={cycleLen} periodLen={periodLen} />
        )}
        {tab === 'cycle' && <Cycle />}
        {tab === 'dashboard' && <Dashboard />}
      </div>

      <BottomNav active={tab} onChange={setTab} onSettings={() => setSettingsOpen(true)} />

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
