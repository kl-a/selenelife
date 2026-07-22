import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DayRecord, MealLog } from '../types';
import { v4 as uuid } from 'uuid';
import { useDayHistoryStore } from './dayHistoryStore';
import { resolveChecklistTime } from '../utils/checklistTime';

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultMeals(): MealLog[] {
  return [
    { meal: 'breakfast', logged: false, loggedTime: null, note: '', properBreak: false },
    { meal: 'lunch', logged: false, loggedTime: null, note: '', properBreak: false },
    { meal: 'dinner', logged: false, loggedTime: null, note: '', properBreak: false },
  ];
}

function defaultDayRecord(date: string): DayRecord {
  return {
    id: uuid(),
    date,
    medicationTaken: false,
    medicationTime: null,
    medicationMorningTaken: false,
    medicationMorningTime: null,
    medicationArvoTaken: false,
    medicationArvoTime: null,
    ssriTaken: false,
    ssriTime: null,
    meals: defaultMeals(),
    lunchBreakTaken: false,
    lunchBreakTime: null,
    gymToday: false,
    gymTime: null,
    aloneTimeToday: false,
    aloneTimeStart: null,
    symptoms: [],
    brainFog: null,
    workingMemoryImpaired: false,
    focusQuality: null,
    sleepHours: null,
    sleepQuality: null,
    thatWasntMe: false,
    thatWasntMeNote: '',
    moodAverage: null,
    dominantZone: null,
    created_at: new Date().toISOString(),
    updated_at: '',       // empty so any remote with real data always wins
    fieldUpdatedAt: {},   // empty — per-field timestamps default to '' (always loses to any real update)
  };
}

// Helper: stamp a field key with the current time
function stamp(record: DayRecord, key: string): Record<string, string> {
  return { ...(record.fieldUpdatedAt ?? {}), [key]: new Date().toISOString() };
}

interface DayStore {
  dayRecord: DayRecord;
  ensureToday: () => void;
  setMedicationTaken: (taken: boolean) => void;
  setMedicationTime: (iso: string) => void;
  setMedicationMorningTaken: (taken: boolean) => void;
  setMedicationMorningTime: (iso: string) => void;
  setMedicationArvoTaken: (taken: boolean) => void;
  setMedicationArvoTime: (iso: string) => void;
  setSsriTaken: (taken: boolean) => void;
  setSsriTime: (iso: string) => void;
  updateMeal: (meal: 'breakfast' | 'lunch' | 'dinner', patch: Partial<MealLog>) => void;
  setMealTime: (meal: 'breakfast' | 'lunch' | 'dinner', iso: string) => void;
  setLunchBreakTaken: (taken: boolean) => void;
  setGymToday: (v: boolean) => void;
  setGymTime: (iso: string) => void;
  setAloneTimeToday: (v: boolean) => void;
  setAloneTimeStart: (iso: string) => void;
  toggleSymptom: (s: string) => void;
  setBrainFog: (v: number | null) => void;
  setWorkingMemoryImpaired: (v: boolean) => void;
  setFocusQuality: (v: number | null) => void;
  setSleepHours: (v: number | null) => void;
  setSleepQuality: (v: number | null) => void;
  setThatWasntMe: (v: boolean) => void;
  setThatWasntMeNote: (note: string) => void;
}

export const useDayStore = create<DayStore>()(
  persist(
    (set, get) => ({
      dayRecord: defaultDayRecord(todayDate()),

      ensureToday: () => {
        const today = todayDate();
        const current = get().dayRecord;
        if (current.date !== today) {
          useDayHistoryStore.getState().archiveDay(current);
          set({ dayRecord: defaultDayRecord(today) });
        }
      },

      setMedicationTaken: (taken) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            medicationTaken: taken,
            medicationTime: taken ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'medication'),
          },
        })),

      setMedicationTime: (iso) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            medicationTime: iso,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'medication'),
          },
        })),

      setMedicationMorningTaken: (taken) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            medicationMorningTaken: taken,
            medicationMorningTime: taken ? resolveChecklistTime('morningMeds') : null,
            medicationTaken: taken || s.dayRecord.medicationArvoTaken,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'medicationMorning'),
          },
        })),

      setMedicationMorningTime: (iso) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            medicationMorningTime: iso,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'medicationMorning'),
          },
        })),

      setMedicationArvoTaken: (taken) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            medicationArvoTaken: taken,
            medicationArvoTime: taken ? resolveChecklistTime('arvoMeds') : null,
            medicationTaken: s.dayRecord.medicationMorningTaken || taken,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'medicationArvo'),
          },
        })),

      setMedicationArvoTime: (iso) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            medicationArvoTime: iso,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'medicationArvo'),
          },
        })),

      setSsriTaken: (taken) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            ssriTaken: taken,
            ssriTime: taken ? resolveChecklistTime('ssri') : null, // always null per spec
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'ssri'),
          },
        })),

      setSsriTime: (iso) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            ssriTime: iso,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'ssri'),
          },
        })),

      updateMeal: (meal, patch) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            meals: s.dayRecord.meals.map((m) =>
              m.meal === meal
                ? {
                    ...m,
                    ...patch,
                    loggedTime: patch.logged && !m.logged ? resolveChecklistTime(m.meal) : m.loggedTime,
                  }
                : m
            ),
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, meal),
          },
        })),

      setMealTime: (meal, iso) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            meals: s.dayRecord.meals.map((m) =>
              m.meal === meal ? { ...m, loggedTime: iso } : m
            ),
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, meal),
          },
        })),

      setLunchBreakTaken: (taken) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            lunchBreakTaken: taken,
            lunchBreakTime: taken ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'lunchBreak'),
          },
        })),

      setGymToday: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            gymToday: v,
            gymTime: v ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'gym'),
          },
        })),

      setGymTime: (iso) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            gymTime: iso,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'gym'),
          },
        })),

      setAloneTimeToday: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            aloneTimeToday: v,
            aloneTimeStart: v ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'aloneTime'),
          },
        })),

      setAloneTimeStart: (iso) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            aloneTimeStart: iso,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'aloneTime'),
          },
        })),

      toggleSymptom: (symptom) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            symptoms: s.dayRecord.symptoms.includes(symptom)
              ? s.dayRecord.symptoms.filter((x) => x !== symptom)
              : [...s.dayRecord.symptoms, symptom],
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'symptoms'),
          },
        })),

      setBrainFog: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            brainFog: v,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'brainFog'),
          },
        })),

      setWorkingMemoryImpaired: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            workingMemoryImpaired: v,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'workingMemory'),
          },
        })),

      setFocusQuality: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            focusQuality: v,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'focusQuality'),
          },
        })),

      setSleepHours: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            sleepHours: v,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'sleep'),
          },
        })),

      setSleepQuality: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            sleepQuality: v,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'sleep'),
          },
        })),

      setThatWasntMe: (v) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            thatWasntMe: v,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'thatWasntMe'),
          },
        })),

      setThatWasntMeNote: (note) =>
        set((s) => ({
          dayRecord: {
            ...s.dayRecord,
            thatWasntMeNote: note,
            updated_at: new Date().toISOString(),
            fieldUpdatedAt: stamp(s.dayRecord, 'thatWasntMe'),
          },
        })),
    }),
    { name: 'selene_day' }
  )
);
