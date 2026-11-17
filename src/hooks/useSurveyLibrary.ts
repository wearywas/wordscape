import { useCallback, useEffect, useState } from 'react';
import {
  listSavedSurveys,
  readSavedSurvey,
  removeSavedSurvey,
  saveSurveySnapshots,
  surveyStorageMessage,
} from '../world/surveyLibrary';
import type { SavedSurvey } from '../world/surveyLibrary';
import type { WorldDocument } from '../world/types';

export function useSurveyLibrary(initial: WorldDocument) {
  const [entries, setEntries] = useState<SavedSurvey[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [initialWorld] = useState(initial);
  const refresh = useCallback(async () => {
    const entries = await listSavedSurveys();
    setEntries(entries);
    return entries;
  }, []);
  const archive = useCallback(
    async (worlds: WorldDocument[]): Promise<boolean> => {
      try {
        await saveSurveySnapshots(worlds);
        await refresh();
        setError('');
        return true;
      } catch (error) {
        setError(surveyStorageMessage(error));
        return false;
      }
    },
    [refresh],
  );
  useEffect(() => {
    // Import the pre-library active document once. Deleting a saved copy must survive reload.
    void saveSurveySnapshots([initialWorld], true)
      .then(refresh)
      .catch((error) => setError(surveyStorageMessage(error)))
      .finally(() => setLoading(false));
  }, [refresh, initialWorld]);
  const remove = async (id: string) => {
    try {
      await removeSavedSurvey(id);
      await refresh();
      setError('');
    } catch (error) {
      setError(surveyStorageMessage(error));
      throw error;
    }
  };
  return { entries, error, loading, archive, remove, read: readSavedSurvey, refresh };
}
