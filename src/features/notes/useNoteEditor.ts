import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { toAppError, type AppError } from '../../core/errors';
import { createLogger } from '../../core/logger';
import type { NoteDetail } from '../../data/repositories/notesRepo';
import type { Selection } from '../../domain/markdown/editing';
import { notesRepo } from './notesService';

const log = createLogger('editor');
export const AUTOSAVE_DELAY_MS = 600;

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Editor state + autosave. Every change is persisted after a short debounce, and immediately
 * when the app goes to background or the screen unmounts — so a killed process loses at most
 * the last ~0.6 s of typing.
 */
export function useNoteEditor(id: string) {
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [title, setTitleState] = useState('');
  const [body, setBodyState] = useState('');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [status, setStatus] = useState<SaveStatus>('idle');

  const latest = useRef({ title: '', body: '', dirty: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current;
    if (!latest.current.dirty) return;
    const { title: t, body: b } = latest.current;
    latest.current.dirty = false;
    setStatus('saving');
    saving.current = notesRepo()
      .save(id, { title: t, body: b })
      .then(() => setStatus(latest.current.dirty ? 'dirty' : 'saved'))
      .catch((e) => {
        latest.current.dirty = true; // retry on next flush
        log.error('autosave failed', e);
        setStatus('error');
      })
      .finally(() => {
        saving.current = null;
      });
    await saving.current;
  }, [id]);

  const schedule = useCallback(() => {
    latest.current.dirty = true;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    let alive = true;
    notesRepo()
      .get(id)
      .then((n) => {
        if (!alive) return;
        if (!n) {
          setLoadError(toAppError(null, 'DB_QUERY_FAILED', 'Заметка не найдена'));
          return;
        }
        setNote(n);
        setTitleState(n.title);
        setBodyState(n.body);
        latest.current = { title: n.title, body: n.body, dirty: false };
      })
      .catch((e) => alive && setLoadError(toAppError(e, 'DB_QUERY_FAILED', 'Не удалось открыть заметку')));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void flush();
    });
    return () => {
      sub.remove();
      void flush();
    };
  }, [flush]);

  const setTitle = useCallback(
    (t: string) => {
      setTitleState(t);
      latest.current.title = t;
      schedule();
    },
    [schedule],
  );

  const setBody = useCallback(
    (b: string, sel?: Selection) => {
      setBodyState(b);
      if (sel) setSelection(sel);
      latest.current.body = b;
      schedule();
    },
    [schedule],
  );

  const reload = useCallback(async () => {
    const n = await notesRepo().get(id);
    if (n) setNote(n);
  }, [id]);

  return { note, loadError, title, body, selection, setSelection, setTitle, setBody, status, flush, reload };
}
